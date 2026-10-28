// SERVER ONLY. The one place that sends a caregiver's recording to Meta Voice Transcribe. Imported only from the server-function
// handlers in src/lib/meta-transcribe/transcribe.functions.ts. The caller passes the environment in; this module has no UI,
// storage or database access (the permission check is injected), and logs nothing.
//
// Gates, in order, each answered with a fixed code and no detail: the feature flag META_TRANSCRIBE_ENABLED must be exactly
// "true" (off by default); META_API_KEY must be set on the server; the caller must be an organizer of the family (the same
// people who can save a handoff); the audio must be a valid mono 16-bit PCM WAV; and a small per-user rate limit applies.
// Then exactly ONE POST to exactly the documented endpoint: the key only in the Authorization header, an explicit timeout,
// redirects refused, a bounded reply, no retry of any kind. The reply body never reaches an error.
import {
  MAX_AUDIO_BYTES,
  MAX_RESPONSE_BYTES,
  META_TRANSCRIBE_URL,
  MetaTranscribeError,
  REQUEST_TIMEOUT_MS,
  assertEndpointAllowed,
  buildTranscribeRequest,
  validateWavForUpload,
} from "@/lib/meta-transcribe/contract";
import { parseTranscribeResponse, type TranscriptTurn } from "@/lib/meta-transcribe/response";
import type { TranscriptionStatus } from "@/lib/meta-transcribe/status";

export interface MetaTranscribeEnv {
  META_TRANSCRIBE_ENABLED?: string | undefined;
  META_API_KEY?: string | undefined;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const TRANSCRIBE_RATE_MAX = 10;
export const TRANSCRIBE_RATE_WINDOW_MS = 10 * 60_000;
export const TRANSCRIBE_INSTANCE_MAX = 60;

const calls = new Map<string, number[]>();
let instanceCalls = 0;
/** Test hook only. */
export function resetTranscribeLimits(): void {
  calls.clear();
  instanceCalls = 0;
}

/** Whether the feature is switched on and configured. Says nothing about WHICH of the two is missing. */
export function metaTranscribeConfigured(env: MetaTranscribeEnv): boolean {
  return env.META_TRANSCRIBE_ENABLED === "true" && (env.META_API_KEY ?? "").trim() !== "";
}

/**
 * The availability answer for one family. `isOrganizer` must THROW when it cannot find out (a failed lookup); that is reported as
 * `check_failed`, never as "not an organizer" and never as "disabled". Sends nothing to Meta and reads no audio.
 */
export async function transcriptionStatus(opts: {
  env: MetaTranscribeEnv;
  familyId: string;
  isOrganizer: (familyId: string) => Promise<boolean>;
}): Promise<TranscriptionStatus> {
  if (!metaTranscribeConfigured(opts.env)) return { available: false, reason: "disabled" };
  try {
    return (await opts.isOrganizer(opts.familyId))
      ? { available: true }
      : { available: false, reason: "not_organizer" };
  } catch {
    return { available: false, reason: "check_failed" };
  }
}

export interface TranscribeSuccess {
  ok: true;
  turns: TranscriptTurn[];
  speakerCount: number;
  audioSeconds: number;
  elapsedMs: number;
}
export interface TranscribeFailure {
  ok: false;
  /** A fixed code such as not_available, forbidden, check_failed, rate_limited, audio_too_long, timeout, http_401, no_speech. */
  code: string;
}
export type TranscribeResult = TranscribeSuccess | TranscribeFailure;

const fail = (code: string): TranscribeFailure => ({ ok: false, code });

/** Base64 to bytes, or null if it is not valid base64. Works in Node and in the Worker runtime (no Buffer). */
export function decodeBase64(b64: string): Uint8Array | null {
  if (b64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

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
      throw new MetaTranscribeError("response_too_large", "The reply was larger than expected.");
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

function transportCode(e: unknown): string {
  const n = (e as { name?: string } | null)?.name;
  return n === "TimeoutError" || n === "AbortError" ? "timeout" : "network_error";
}

export async function transcribeRecording(opts: {
  env: MetaTranscribeEnv;
  userId: string;
  familyId: string;
  audioBase64: string;
  /**
   * Injected by the server function: true only if this user is an organizer of that family (checked with the user's own session).
   * It must THROW if the lookup itself fails; that is answered `check_failed` (retryable), never `forbidden`.
   */
  isOrganizer: (familyId: string) => Promise<boolean>;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}): Promise<TranscribeResult> {
  if (!metaTranscribeConfigured(opts.env)) return fail("not_available");
  let allowed: boolean;
  try {
    allowed = await opts.isOrganizer(opts.familyId);
  } catch {
    return fail("check_failed"); // we could not find out: not a "no"
  }
  if (!allowed) return fail("forbidden");

  const wav = decodeBase64(opts.audioBase64);
  if (!wav || wav.byteLength > MAX_AUDIO_BYTES)
    return fail(wav ? "audio_too_large" : "audio_not_wav");
  try {
    validateWavForUpload(wav);
  } catch (e) {
    return fail(e instanceof MetaTranscribeError ? e.code : "audio_not_wav");
  }

  const key = (opts.env.META_API_KEY ?? "").trim();
  if ([...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
    return fail("not_available");

  const now = opts.now ?? Date.now;
  const clock = now();
  const recent = (calls.get(opts.userId) ?? []).filter(
    (t) => clock - t < TRANSCRIBE_RATE_WINDOW_MS,
  );
  if (recent.length >= TRANSCRIBE_RATE_MAX || instanceCalls >= TRANSCRIBE_INSTANCE_MAX)
    return fail("rate_limited");

  let req: ReturnType<typeof buildTranscribeRequest>;
  try {
    assertEndpointAllowed(META_TRANSCRIBE_URL);
    req = buildTranscribeRequest(wav);
  } catch (e) {
    return fail(e instanceof MetaTranscribeError ? e.code : "request_failed");
  }

  // The one request. Counted before it is made, so a failure still uses an attempt. No retry, whatever happens.
  calls.set(opts.userId, [...recent, clock]);
  instanceCalls++;
  const t0 = now();
  let res: Response;
  try {
    res = await opts.fetchImpl(req.url, {
      method: "POST",
      headers: { ...req.headers, Authorization: `Bearer ${key}` },
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    return fail(transportCode(e));
  }
  // A followed redirect could carry the key to another host; `manual` hands back the 3xx itself.
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
    await res.body?.cancel().catch(() => undefined);
    return fail("redirect_refused");
  }
  let text: string;
  try {
    text = await readBounded(res, MAX_RESPONSE_BYTES);
  } catch (e) {
    return fail(e instanceof MetaTranscribeError ? e.code : transportCode(e));
  }
  const elapsedMs = now() - t0;
  if (!res.ok) return fail(`http_${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("malformed_response");
  }
  try {
    const p = parseTranscribeResponse(json);
    return {
      ok: true,
      turns: p.turns,
      speakerCount: p.speakerCount,
      audioSeconds: p.audioSeconds,
      elapsedMs,
    };
  } catch (e) {
    return fail(e instanceof MetaTranscribeError ? e.code : "malformed_response");
  }
}
