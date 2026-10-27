// Meta Voice Transcribe, file endpoint: the request side. Pure (no network, environment or storage), so it is safe in both
// bundles. Ported from the verified REST spike (its config, request builder and WAV check); the live call that proved the
// contract is recorded in PR #50. The credential is added by the server module only; nothing here ever sees it.
//
// CONTRACT: multipart/form-data with a JSON `request` field (no filename) and an `audio` WAV file part.
export const META_TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe";
export const META_TRANSCRIBE_HOST = "api.meta.ai";
export const META_TRANSCRIBE_PATH = "/v1/asr/transcribe";
export const META_MODEL = "muse-voice-transcribe-1.0";
export const META_MODE = "DIARIZATION";
export const META_AUDIO_ENCODING = "WAV";

/** Mono 16-bit PCM WAV at 16 or 24 kHz, 1 second to 10 minutes, at most 32 MB. */
export const ACCEPTED_SAMPLE_RATES = [16000, 24000] as const;
export const MIN_AUDIO_SECONDS = 1;
export const MAX_AUDIO_SECONDS = 600;
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** A fixed code plus a safe message. Nothing from the audio, a reply body or a header ever goes into either. */
export class MetaTranscribeError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "MetaTranscribeError";
    this.code = code;
    this.status = status;
  }
}

export interface WavInfo {
  sampleRate: number;
  seconds: number;
  bytes: number;
}

export function validateWavForUpload(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength > MAX_AUDIO_BYTES)
    throw new MetaTranscribeError("audio_too_large", "The recording is over the 32 MB limit.");
  if (bytes.byteLength < 44) throw new MetaTranscribeError("audio_not_wav", "Not a WAV file.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new MetaTranscribeError("audio_not_wav", "Not a WAV file.");

  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength)
        throw new MetaTranscribeError("audio_bad_header", "The WAV format chunk is truncated.");
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt)
        throw new MetaTranscribeError("audio_bad_header", "The data chunk comes before fmt.");
      if (fmt.format !== 1)
        throw new MetaTranscribeError("audio_not_pcm", "Only uncompressed PCM WAV is accepted.");
      if (fmt.channels !== 1)
        throw new MetaTranscribeError("audio_not_mono", "Expected mono audio.");
      if (fmt.bits !== 16)
        throw new MetaTranscribeError("audio_not_16bit", "Expected 16-bit samples.");
      if (!(ACCEPTED_SAMPLE_RATES as readonly number[]).includes(fmt.rate))
        throw new MetaTranscribeError("audio_bad_rate", "Expected 16 or 24 kHz audio.");
      if (body + size > bytes.byteLength)
        throw new MetaTranscribeError(
          "audio_truncated",
          "The WAV data is shorter than its header says.",
        );
      if (size === 0 || size % 2 !== 0)
        throw new MetaTranscribeError(
          "audio_bad_header",
          "The WAV data chunk is empty or misaligned.",
        );
      const seconds = size / (fmt.rate * 2);
      if (seconds > MAX_AUDIO_SECONDS)
        throw new MetaTranscribeError("audio_too_long", "The recording is longer than 10 minutes.");
      if (seconds < MIN_AUDIO_SECONDS)
        throw new MetaTranscribeError("audio_too_short", "The recording is shorter than 1 second.");
      return { sampleRate: fmt.rate, seconds, bytes: bytes.byteLength };
    }
    off = body + size + (size % 2);
  }
  throw new MetaTranscribeError("audio_bad_header", "The WAV has no data chunk.");
}

const CRLF = "\r\n";
const enc = new TextEncoder();
const AUDIO_FILENAME = "recording.wav";

const requestJson = () =>
  JSON.stringify({ mode: META_MODE, model: META_MODEL, audioEncoding: META_AUDIO_ENCODING });

function randomBoundary(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `----Pendia${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function occursIn(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * The multipart body, written by hand: the platform FormData would add filename="blob" to the JSON `request` part, which
 * Meta's own example does not have.
 */
export function buildMultipartBody(
  wav: Uint8Array,
  boundary: string = randomBoundary(),
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9'()+_,\-./:=?]{1,70}$/.test(boundary))
    throw new MetaTranscribeError("bad_boundary", "The multipart boundary is not valid.");
  if (occursIn(wav, enc.encode(`--${boundary}`)))
    throw new MetaTranscribeError(
      "bad_boundary",
      "The multipart boundary occurs inside the audio.",
    );
  const head1 = enc.encode(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="request"${CRLF}` +
      `Content-Type: application/json${CRLF}${CRLF}${requestJson()}${CRLF}`,
  );
  const head2 = enc.encode(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="audio"; filename="${AUDIO_FILENAME}"${CRLF}` +
      `Content-Type: audio/wav${CRLF}${CRLF}`,
  );
  const tail = enc.encode(`${CRLF}--${boundary}--${CRLF}`);
  const out = new Uint8Array(head1.length + head2.length + wav.length + tail.length);
  out.set(head1, 0);
  out.set(head2, head1.length);
  out.set(wav, head1.length + head2.length);
  out.set(tail, head1.length + head2.length + wav.length);
  return out;
}

/** The request without its credential: URL, headers (no Authorization) and body. The server module adds the key. */
export function buildTranscribeRequest(wav: Uint8Array, boundary?: string) {
  const b = boundary ?? randomBoundary();
  return {
    url: META_TRANSCRIBE_URL,
    headers: {
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${b}`,
    },
    body: buildMultipartBody(wav, b),
  };
}

/** Only the exact documented endpoint is ever called. */
export function assertEndpointAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new MetaTranscribeError("endpoint_refused", "Not a valid URL.");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== META_TRANSCRIBE_HOST ||
    u.pathname !== META_TRANSCRIBE_PATH ||
    u.port !== "" ||
    u.username !== "" ||
    u.password !== "" ||
    u.search !== "" ||
    u.hash !== ""
  )
    throw new MetaTranscribeError(
      "endpoint_refused",
      "Only the Meta transcription endpoint is allowed.",
    );
}
