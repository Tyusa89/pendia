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
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  REST_URL,
  RestSpikeError,
} from "./config.ts";
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
  timeoutMs?: number;
  now?: () => number;
}): Promise<OneShotResult> {
  const key = (opts.env["META_API_KEY"] ?? "").trim();
  try {
    // 1. Refusals that cost nothing.
    assertLiveApproved(opts.env, opts.confirmOneCall);
    if (!key) throw new RestSpikeError("missing_key", "META_API_KEY is not set.");
    const audio = validateWavForUpload(opts.wav);
    const { url, init } = buildTranscribeRequest(key, opts.wav);
    assertEndpointAllowed(url);

    // 2. Claim the single call. After this point the request may be made, so nothing below can ever run twice.
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
    mkdirSync(dirname(opts.lockPath), { recursive: true, mode: 0o700 });
    writeFileSync(opts.lockPath, new Date().toISOString(), { flag: "wx", mode: 0o600 });
    latch = true;

    // 3. The one request: explicit timeout, no redirects, no retry.
    const now = opts.now ?? Date.now;
    const t0 = now();
    const res = await opts.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    if (!res.ok)
      throw new RestSpikeError(
        `http_${res.status}`,
        `The service answered HTTP ${res.status}.`,
        res.status,
      );
    const text = await res.text();
    const elapsedMs = now() - t0;
    if (text.length > MAX_RESPONSE_BYTES)
      throw new RestSpikeError("response_too_large", "The reply was larger than expected.");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new RestSpikeError("malformed_response", "The reply is not JSON.");
    }
    return { audio, status: res.status, elapsedMs, json };
  } catch (e) {
    if (e instanceof RestSpikeError)
      throw new RestSpikeError(e.code, sanitize(e.message, key), e.status);
    const name = (e as { name?: string } | null)?.name;
    // Network failures, aborts and redirect refusals: a fixed code, never the underlying message.
    if (name === "TimeoutError" || name === "AbortError")
      throw new RestSpikeError("timeout", "The request timed out.");
    throw new RestSpikeError("network_error", "The request failed before a reply arrived.");
  }
}
