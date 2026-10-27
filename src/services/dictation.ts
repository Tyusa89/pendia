// Seam for turning a dictated handoff recording into draft text.
//
// The DEFAULT transcriber below is NOT CONNECTED and makes no network request. The Handoffs page passes a connected one
// (src/lib/meta-transcribe/client.ts: a server function; API keys stay server-side and the browser never calls the provider)
// only after the server reports that transcription is switched on for this caregiver. The UI handles availability, progress,
// errors, cancel, and the review-and-edit step. `text` is always a DRAFT: nothing is added to a note until it is confirmed.

export interface DictationTranscriber {
  /** False until a verified transcription service is wired in; the UI disables Transcribe accordingly. */
  readonly available: boolean;
  transcribe(audio: Blob, opts?: { signal?: AbortSignal }): Promise<{ text: string }>;
}

/** A failure whose message is safe and kind to show a caregiver as-is (never raw provider text). */
export class DictationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DictationError";
    this.code = code;
  }
}

export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super("Transcription is not connected yet.");
    this.name = "TranscriptionNotConfiguredError";
  }
}

export const dictationTranscriber: DictationTranscriber = {
  available: false,
  async transcribe() {
    throw new TranscriptionNotConfiguredError();
  },
};
