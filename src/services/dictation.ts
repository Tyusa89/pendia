// Seam for turning a dictated handoff recording into draft text.
//
// NOT CONNECTED. No Meta speech-to-text endpoint, model call or network request exists here, and none should be
// added until the real service has been verified (see the Phase 2 diarization spike). When it is, implement
// `DictationTranscriber` by calling a Supabase Edge Function (API keys stay server-side; the client never calls
// the model provider directly) and swap it in below. The UI already handles availability, progress, errors,
// cancel, and the review-and-edit step, so no UI change should be needed.

export interface DictationTranscriber {
  /** False until a verified transcription service is wired in; the UI disables Transcribe accordingly. */
  readonly available: boolean;
  transcribe(audio: Blob, opts?: { signal?: AbortSignal }): Promise<{ text: string }>;
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
