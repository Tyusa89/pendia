// SERVER ONLY. The one place that talks to Meta for Spark extraction. It is imported only from server-function handlers,
// reads no environment itself (the caller passes the key in), and has no UI, storage or database access.
//
// Guarantees (each pinned by a test): exactly one POST per call, to exactly SPARK_CHAT_URL; the key only in the Authorization
// header; a timeout; no redirects; no retries (there is no loop); a bounded body; errors are fixed codes. Nothing from a
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
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? SPARK_TIMEOUT_MS),
    });
  } catch (e) {
    const n = (e as { name?: string } | null)?.name;
    if (n === "TimeoutError" || n === "AbortError")
      throw new SparkHttpError("timeout", "The request timed out.");
    const cause = causeCode(e);
    throw new SparkHttpError(
      "network_error",
      `The request failed before a reply arrived${cause ? ` (cause: ${cause})` : ""}.`,
    );
  }
  const text = await readBounded(res, SPARK_MAX_RESPONSE_BYTES);
  const elapsedMs = now() - t0;
  if (!res.ok) {
    const token = providerErrorToken(text);
    throw new SparkHttpError(
      `http_${res.status}`,
      `Meta answered HTTP ${res.status}${token ? ` (${token})` : ""}.`,
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
