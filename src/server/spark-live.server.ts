// SERVER ONLY. The one place that talks to Meta for Spark extraction. It is imported only from server-function handlers,
// reads no environment itself (the caller passes the key in), and has no UI, storage or database access.
//
// Guarantees (each pinned by a test): exactly one POST per call, to exactly SPARK_CHAT_URL; the key only in the Authorization
// header; a timeout; redirects refused, never followed; no retries (there is no loop); a bounded body; errors are fixed codes. Nothing from a
// response body ever reaches an error message: only an allowlisted provider error token and an allowlisted transport cause
// code are surfaced, because they are non-sensitive and make a failure diagnosable.
import type { SparkRequest } from "@/lib/visit-pipeline/spark-contract";
import {
  SPARK_ALLOWED_HOST,
  SPARK_ALLOWED_PATH,
  SPARK_CHAT_URL,
  SparkHttpError,
  buildChatCompletionsBody,
  parseChatCompletion,
  type ParsedChatCompletion,
} from "@/lib/spark/spark-http";

export const SPARK_TIMEOUT_MS = 60_000;
export const SPARK_MAX_RESPONSE_BYTES = 1024 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function assertSparkUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SparkHttpError("endpoint_refused", "Not a valid URL.");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== SPARK_ALLOWED_HOST ||
    u.pathname !== SPARK_ALLOWED_PATH ||
    u.port !== "" ||
    u.username !== "" ||
    u.password !== "" ||
    u.search !== "" ||
    u.hash !== ""
  )
    throw new SparkHttpError("endpoint_refused", `Only ${SPARK_CHAT_URL} is allowed.`);
}

/** Reads at most `limit` bytes; a longer body is an error, never silently cut. */
async function readBounded(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SparkHttpError("response_too_large", "The reply was larger than expected.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}

/** A short upper-case code such as ECONNRESET or UNABLE_TO_VERIFY_LEAF_SIGNATURE, or null. Never a message. */
export function causeCode(e: unknown): string | null {
  const c = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof c === "string" && /^[A-Z0-9_]{3,60}$/.test(c) ? c : null;
}

/** A provider error token such as invalid_request_error, if the body has one. Never the message. */
export function providerErrorToken(bodyText: string): string | null {
  try {
    const j = JSON.parse(bodyText) as { error?: { code?: unknown; type?: unknown } };
    for (const v of [j?.error?.code, j?.error?.type])
      if (typeof v === "string" && /^[a-z0-9_.-]{1,60}$/i.test(v)) return v;
  } catch {
    /* not JSON */
  }
  return null;
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_FAIL", "EAI_NONAME"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const isTlsCode = (c: string) =>
  /^(CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|ERR_TLS_|ERR_SSL_|ERR_OSSL_)/.test(c) ||
  c === "EPROTO";

/** Error and cause messages are read ONLY to pick a fixed category; their text is never returned. */
function errorText(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  const c = (e as { cause?: { message?: unknown } } | null)?.cause?.message;
  return `${typeof m === "string" ? m : ""} ${typeof c === "string" ? c : ""}`.toLowerCase();
}

/**
 * Turns a thrown fetch/body error (no HTTP reply) into a fixed code and a fixed message. Only an allowlisted cause code and an
 * allowlisted error-class name may be added; nothing from the error text, request or response is ever included.
 */
export function classifyTransportError(e: unknown): SparkHttpError {
  const n = (e as { name?: string } | null)?.name;
  if (n === "TimeoutError" || n === "AbortError")
    return new SparkHttpError("timeout", "The request timed out.");
  const code = causeCode(e);
  const text = errorText(e);
  const suffix = code ? ` (cause: ${code})` : "";
  if (code && DNS_CODES.has(code))
    return new SparkHttpError(
      "dns_failure",
      `The server could not resolve the Meta API host name${suffix}.`,
    );
  if (code && isTlsCode(code))
    return new SparkHttpError(
      "tls_failure",
      `The secure (TLS) connection to Meta could not be established${suffix}.`,
    );
  if (code && CONNECTION_CODES.has(code))
    return new SparkHttpError(
      "connection_failed",
      `The connection to Meta failed or was reset before a reply arrived${suffix}.`,
    );
  if (/redirect/.test(text))
    return new SparkHttpError(
      "redirect_refused",
      "Meta answered with a redirect, which is refused.",
    );
  if (/getaddrinfo|enotfound|dns|name resolution|could not resolve/.test(text))
    return new SparkHttpError(
      "dns_failure",
      `The server could not resolve the Meta API host name${suffix}.`,
    );
  if (/certificate|\btls\b|\bssl\b|handshake/.test(text))
    return new SparkHttpError(
      "tls_failure",
      `The secure (TLS) connection to Meta could not be established${suffix}.`,
    );
  if (/connection (lost|reset|refused|closed)|socket|econn|network connection/.test(text))
    return new SparkHttpError(
      "connection_failed",
      `The connection to Meta failed or was reset before a reply arrived${suffix}.`,
    );
  const kind = typeof n === "string" && /^[A-Za-z]{1,40}$/.test(n) ? n : null;
  return new SparkHttpError(
    "network_error",
    `The request failed before a reply arrived${kind || code ? ` (${[kind ? `error: ${kind}` : "", code ? `cause: ${code}` : ""].filter(Boolean).join("; ")})` : ""}.`,
  );
}

/** The host named by a redirect's Location header, only if it is a plain host name. */
function redirectHost(res: Response): string | null {
  try {
    const loc = res.headers.get("location");
    if (!loc) return null;
    const host = new URL(loc, SPARK_CHAT_URL).hostname;
    return /^[a-z0-9.-]{1,100}$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

export interface SparkCallResult {
  parsed: ParsedChatCompletion;
  status: number;
  elapsedMs: number;
}

/** ONE request. No retry, whatever happens. */
export async function callSparkOnce(opts: {
  request: SparkRequest;
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}): Promise<SparkCallResult> {
  const key = (opts.apiKey ?? "").trim();
  if (!key)
    throw new SparkHttpError("missing_key", "The Meta API key is not configured on the server.");
  if ([...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
    throw new SparkHttpError("bad_key_format", "The Meta API key has an invalid format.");
  assertSparkUrl(SPARK_CHAT_URL);
  const body = JSON.stringify(buildChatCompletionsBody(opts.request));
  const now = opts.now ?? Date.now;
  const t0 = now();
  let res: Response;
  try {
    res = await opts.fetchImpl(SPARK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? SPARK_TIMEOUT_MS),
    });
  } catch (e) {
    throw classifyTransportError(e);
  }
  // Redirects are never followed (a followed redirect could carry the key to another host). `manual` returns the 3xx itself,
  // so it is reported as what it is instead of an anonymous network error.
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
    const host = redirectHost(res);
    await res.body?.cancel().catch(() => undefined);
    throw new SparkHttpError(
      "redirect_refused",
      `Meta answered HTTP ${res.status || 3} with a redirect${host ? ` to ${host}` : ""}, which is refused.`,
      res.status || null,
    );
  }
  let text: string;
  try {
    text = await readBounded(res, SPARK_MAX_RESPONSE_BYTES);
  } catch (e) {
    if (e instanceof SparkHttpError) throw e;
    throw classifyTransportError(e);
  }
  const elapsedMs = now() - t0;
  if (!res.ok) {
    const token = providerErrorToken(text);
    throw new SparkHttpError(
      `http_${res.status}`,
      `Meta answered HTTP ${res.status}${token ? ` (${token})` : ""}${
        res.status === 401 || res.status === 403
          ? "; the server's API key was rejected or lacks access"
          : ""
      }.`,
      res.status,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SparkHttpError("malformed_response", "The reply is not JSON.", res.status);
  }
  return { parsed: parseChatCompletion(json), status: res.status, elapsedMs };
}

/** The `complete` function that extractWithModel calls exactly once. Reports the call's facts through `onResult`. */
export function makeSparkComplete(opts: {
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  onResult?: (r: SparkCallResult) => void;
  /** Receives the call's own failure (a SparkHttpError: fixed code and safe message) before it propagates. */
  onError?: (e: SparkHttpError) => void;
}): (request: SparkRequest) => Promise<string> {
  let used = false;
  return async (request) => {
    if (used)
      throw new SparkHttpError("second_call_refused", "This model function allows one call.");
    used = true;
    try {
      const r = await callSparkOnce({
        request,
        apiKey: opts.apiKey,
        fetchImpl: opts.fetchImpl,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
      opts.onResult?.(r);
      return r.parsed.content;
    } catch (e) {
      if (e instanceof SparkHttpError) opts.onError?.(e);
      throw e;
    }
  };
}
