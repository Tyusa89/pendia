// The one-shot runner. At most ONE request per execution: no retry loop exists, a module-level latch refuses a second call
// in the same process, and an exclusive lock file refuses a second call from the same working folder.
// Disabled by default: it needs SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL in the environment AND an explicit confirm flag.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { scrubSecret } from "../diarization/protocol.ts";
import {
  ALLOWED_HOST,
  ALLOWED_PATH,
  APPROVAL_TOKEN,
  MAX_RAW_BYTES,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  REST_URL,
  RestSpikeError,
} from "./config.ts";
import { assertRawPathsUsable, readBounded, saveRaw, type RawInfo } from "./raw.ts";
import { buildTranscribeRequest } from "./request.ts";
import { validateWavForUpload, type WavInfo } from "./wav-check.ts";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Only the exact documented URL is allowed: https, host api.meta.ai, the one path, no port, credentials, query or fragment. */
export function assertEndpointAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RestSpikeError("endpoint_refused", "Not a valid URL.");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== ALLOWED_HOST ||
    u.pathname !== ALLOWED_PATH ||
    u.port !== "" ||
    u.username !== "" ||
    u.password !== "" ||
    u.search !== "" ||
    u.hash !== ""
  )
    throw new RestSpikeError("endpoint_refused", `Only ${REST_URL} is allowed.`);
}

export function assertLiveApproved(
  env: Record<string, string | undefined>,
  confirmOneCall: boolean,
) {
  if (env["SPIKE_ALLOW_LIVE"] !== APPROVAL_TOKEN)
    throw new RestSpikeError(
      "live_not_approved",
      "Live call refused: set SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL only after the founder approves exactly one run.",
    );
  if (!confirmOneCall)
    throw new RestSpikeError(
      "live_not_confirmed",
      "Live call refused: pass --live --confirm-one-call.",
    );
}

/**
 * Proxy mode sends no credential of its own, so a request that bypassed the proxy would reach Meta unauthenticated and use up
 * the single call. Refuse before the call is claimed unless Node is told to route fetch through the session proxy.
 */
export function assertProxyConfigured(env: Record<string, string | undefined>): void {
  const proxy = (env["HTTPS_PROXY"] ?? env["https_proxy"] ?? "").trim();
  if (!proxy || env["NODE_USE_ENV_PROXY"] !== "1")
    throw new RestSpikeError(
      "proxy_not_configured",
      "Proxy authentication needs HTTPS_PROXY and NODE_USE_ENV_PROXY=1, so the request goes through the agent proxy. Nothing was sent.",
    );
}

/** Redacts the credential and any Bearer token from text that might reach a log or a scorecard. */
export function sanitize(text: string, apiKey: string): string {
  return scrubSecret(text, apiKey)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .slice(0, 300);
}

let latch = false;
/** Test hook only: lets one test file start from a fresh process state. */
export function _resetLatchForTests() {
  latch = false;
}

export interface OneShotResult {
  audio: WavInfo;
  status: number;
  elapsedMs: number;
  json: unknown;
}

export async function transcribeOnce(opts: {
  wav: Uint8Array;
  env: Record<string, string | undefined>;
  confirmOneCall: boolean;
  fetchImpl: FetchLike;
  lockPath: string;
  /** Where the raw reply is saved (gitignored output folder). Written before the reply is checked, parsed or scored. */
  rawPaths: { body: string; meta: string };
  /** Receives the raw-save report even when the call then fails, so the scorecard can describe it. */
  onRaw?: (info: RawInfo) => void;
  timeoutMs?: number;
  /**
   * Opt-in proxy-authentication mode: no META_API_KEY is needed and no Authorization header is built; the agent proxy
   * supplies it. Refused unless this process is itself routed through that proxy (see `assertProxyConfigured`).
   */
  authViaProxy?: boolean;
  /** Test hook: a smaller ceiling than MAX_RAW_BYTES. */
  rawLimit?: number;
  now?: () => number;
}): Promise<OneShotResult> {
  const key = (opts.env["META_API_KEY"] ?? "").trim();
  let claimed = false;
  let rawDone = false;
  let noReply: string | null = null;
  try {
    // 1. Refusals that cost nothing.
    assertLiveApproved(opts.env, opts.confirmOneCall);
    if (opts.authViaProxy) assertProxyConfigured(opts.env);
    else if (!key) throw new RestSpikeError("missing_key", "META_API_KEY is not set.");
    // A call already made (this process, or this folder) is reported as such before anything else is checked.
    if (latch)
      throw new RestSpikeError(
        "second_call_refused",
        "A live call was already made by this process.",
      );
    if (existsSync(opts.lockPath))
      throw new RestSpikeError(
        "second_call_refused",
        "A live call was already made from this folder.",
      );
    assertRawPathsUsable(opts.rawPaths); // before the call is claimed: a mistake here can never cost the authorization
    const audio = validateWavForUpload(opts.wav);
    const { url, init } = buildTranscribeRequest(key, opts.wav, undefined, {
      authViaProxy: opts.authViaProxy === true,
    });
    assertEndpointAllowed(url);

    // 2. Claim the single call. After this point the request may be made, so nothing below can ever run twice.
    mkdirSync(dirname(opts.lockPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(opts.lockPath, new Date().toISOString(), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as { code?: string } | null)?.code === "EEXIST")
        throw new RestSpikeError(
          "second_call_refused",
          "A live call was already made from this folder.",
        );
      throw e;
    }
    latch = true;
    claimed = true;

    // 3. The one request: explicit timeout, no redirects, no retry.
    const now = opts.now ?? Date.now;
    const t0 = now();
    let res: Response;
    try {
      res = await opts.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // Only a failure of the request itself is a network failure: a fixed code, never the underlying message.
      const n = (e as { name?: string } | null)?.name;
      noReply = n === "TimeoutError" || n === "AbortError" ? "timeout" : "network_error";
      throw new RestSpikeError(
        noReply,
        noReply === "timeout"
          ? "The request timed out."
          : "The request failed before a reply arrived.",
      );
    }
    // 4. Keep the reply FIRST: status, allowlisted headers and the body bytes go to disk before any check or parse.
    const body = await readBounded(res, opts.rawLimit ?? MAX_RAW_BYTES);
    const elapsedMs = now() - t0;
    const raw = saveRaw({
      bodyPath: opts.rawPaths.body,
      metaPath: opts.rawPaths.meta,
      key,
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      bytes: body.bytes,
      truncated: body.truncated,
      readError: body.readError,
      elapsedMs,
      outcome: "reply_received",
    });
    rawDone = true;
    opts.onRaw?.(raw);

    // 5. Only now look at it.
    if (!res.ok)
      throw new RestSpikeError(
        `http_${res.status}`,
        `The service answered HTTP ${res.status}.`,
        res.status,
      );
    if (body.truncated || body.bytes.length > MAX_RESPONSE_BYTES)
      throw new RestSpikeError("response_too_large", "The reply was larger than expected.");
    if (body.readError)
      throw new RestSpikeError("network_error", "The reply ended before it was complete.");
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(body.bytes));
    } catch {
      throw new RestSpikeError("malformed_response", "The reply is not JSON.");
    }
    return { audio, status: res.status, elapsedMs, json };
  } catch (e) {
    // After the call is claimed, a failure that left no reply on disk still gets a metadata record (never throws).
    if (claimed && !rawDone) {
      const outcome = noReply ? `no_reply_${noReply}` : "internal_error";
      try {
        // saved unconditionally; onRaw only reports it (an optional call would skip evaluating its argument)
        const info = saveRaw({
          bodyPath: opts.rawPaths.body,
          metaPath: opts.rawPaths.meta,
          key,
          status: null,
          ok: null,
          bytes: null,
          truncated: false,
          readError: false,
          elapsedMs: null,
          outcome,
        });
        opts.onRaw?.(info);
      } catch {
        /* the original failure is what matters */
      }
    }
    if (e instanceof RestSpikeError)
      throw new RestSpikeError(e.code, sanitize(e.message, key), e.status);
    // Anything else is OUR bug, not the network: say so, with the error's class name only (never its message, which could
    // echo content or the key).
    const cls = (e as { name?: unknown } | null)?.name;
    const label = typeof cls === "string" && /^[A-Za-z]{1,40}$/.test(cls) ? cls : "Error";
    throw new RestSpikeError(
      "internal_error",
      `An unexpected internal error occurred (${label}). It is not a network failure. ` +
        (claimed
          ? "The call was already claimed; check the raw-reply files before anything else."
          : "Nothing was sent."),
    );
  }
}
