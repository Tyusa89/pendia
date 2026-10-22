// One-shot REST file-transcription test for Meta Voice Transcribe (Phase M1 preparation).
//
// STATUS OF THESE CONSTANTS: the endpoint, model, mode, Bearer authentication, audio limits and the idea of a `turns[]`
// response come from the Muse research report. Meta's own page (https://dev.meta.ai/docs/speech-to-text) could NOT be
// reached from the build sandbox, so nothing here has been checked against official documentation. Every item marked
// ASSUMPTION is isolated in this file, request.ts or response.ts so it is a one-line change once the docs are read.
export const REST_URL = "https://api.meta.ai/v1/asr/transcribe";
export const ALLOWED_HOST = "api.meta.ai";
export const ALLOWED_PATH = "/v1/asr/transcribe";
export const MODEL = "muse-voice-transcribe-1.0";
export const MODE = "DIARIZATION";

/** Audio limits from the research report: mono 16-bit PCM WAV at 16 or 24 kHz, at most 10 minutes and 32 MB. */
export const ACCEPTED_SAMPLE_RATES = [16000, 24000] as const;
export const MAX_AUDIO_SECONDS = 600;
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export const MIN_AUDIO_SECONDS = 1;

/** Network safety: one explicit timeout, no redirects, no retries, and a cap on how much of a reply is read. */
export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Live use needs this in the environment AND --live --confirm-one-call on the command line. */
export const APPROVAL_TOKEN = "I_HAVE_APPROVAL";

/** Where the sanitized scorecard goes (git-ignored folder; see ../diarization/output.ts). */
export const SCORECARD_NAME = "rest-scorecard.json";
export const LOCK_NAME = "rest-call.lock";

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
