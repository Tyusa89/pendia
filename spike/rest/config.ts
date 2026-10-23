// One-shot REST file-transcription test for Meta Voice Transcribe (Phase M1 preparation).
//
// CONTRACT: the request and response shapes below follow the documented contract supplied by the founder from
// https://dev.meta.ai/docs/speech-to-text (multipart fields `request` + `audio`; reply with `sessionId`, `transcript`,
// `audioDurationMs` and `turns[]` of `turnId`, `startMs`, `endMs`, `transcript`, `speaker`; times in milliseconds).
// That page could not be fetched from the build sandbox (DNS failure), so it was not re-read here: the contract is taken
// from the founder's transcription of it. Anything still unconfirmed is called out in README.md and request.ts.
export const REST_URL = "https://api.meta.ai/v1/asr/transcribe";
export const ALLOWED_HOST = "api.meta.ai";
export const ALLOWED_PATH = "/v1/asr/transcribe";
export const MODEL = "muse-voice-transcribe-1.0";
export const MODE = "DIARIZATION";
export const AUDIO_ENCODING = "WAV";

/** Audio limits from the research report: mono 16-bit PCM WAV at 16 or 24 kHz, at most 10 minutes and 32 MB. */
export const ACCEPTED_SAMPLE_RATES = [16000, 24000] as const;
export const MAX_AUDIO_SECONDS = 600;
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export const MIN_AUDIO_SECONDS = 1;

/** Network safety: one explicit timeout, no redirects, no retries, and a cap on how much of a reply is read. */
export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Hard ceiling on how much of a reply is read and saved. Beyond it the cut is recorded, never silent. */
export const MAX_RAW_BYTES = 32 * 1024 * 1024;

/** Live use needs this in the environment AND --live --confirm-one-call on the command line. */
export const APPROVAL_TOKEN = "I_HAVE_APPROVAL";

/** Where the sanitized scorecard goes (git-ignored folder; see ../diarization/output.ts). */
export const SCORECARD_NAME = "rest-scorecard.json";
export const LOCK_NAME = "rest-call.lock";
/** The raw reply (body bytes) and its metadata (status, allowlisted headers, sizes, hashes), saved before parsing. */
export const RAW_BODY_NAME = "rest-raw-response.body";
export const RAW_META_NAME = "rest-raw-response.meta.json";

export class RestSpikeError extends Error {
  /** A short fixed code. Only the code (never a message that could echo input) reaches a scorecard. */
  readonly code: string;
  /** HTTP status when the service answered, else null. */
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "RestSpikeError";
    this.code = code;
    this.status = status;
  }
}
