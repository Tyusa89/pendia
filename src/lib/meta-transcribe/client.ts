// Browser side of the Handoff transcription: asks the server whether transcription is available for this caregiver, and turns a
// recording into a DRAFT with anonymous speaker labels and timestamps. The browser never sees the Meta key or calls Meta; it
// only calls the two authenticated server functions. Nothing returned here is saved: the caller shows it for review first.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DictationError, type DictationTranscriber } from "@/services/dictation";
import { formatDraftText, type TranscriptTurn } from "@/lib/meta-transcribe/response";
import {
  STATUS_CONFIRMED_STALE_MS,
  STATUS_RETRY_DELAYS_MS,
  deriveTranscriberState,
  type TranscriberState,
  type TranscriptionStatus,
} from "@/lib/meta-transcribe/status";
import { getTranscriptionStatus, transcribeRecording } from "./transcribe.functions";
import { isJudgeDemo } from "@/lib/judge-demo";

/** What the caregiver reads for each fixed server code. Never provider text. */
export const TRANSCRIBE_ERROR_MESSAGES: Record<string, string> = {
  not_available: "Transcription isn't available right now. Please type the note instead.",
  forbidden: "Only the family organizer can transcribe a recording. Please type the note instead.",
  check_failed:
    "We couldn't confirm your access just now. Your recording is still here; please try again in a moment or type the note.",
  rate_limited:
    "Too many transcriptions in a short time. Please wait a few minutes or type the note.",
  timeout:
    "Transcription took too long. Your recording is still here; you can try again or type the note.",
  network_error:
    "Couldn't reach the transcription service. Your recording is still here; try again or type the note.",
  no_speech: "No speech was found in this recording. You can record again or type the note.",
  audio_not_wav:
    "This browser couldn't make a transcription-ready copy of the recording. Please type the note instead.",
  audio_too_short: "The recording is too short to transcribe (under 1 second).",
  audio_too_long: "The recording is too long to transcribe (over 10 minutes).",
  audio_too_large: "The recording is too large to transcribe.",
  http_401: "Transcription isn't available right now. Please type the note instead.",
  http_403: "Transcription isn't available right now. Please type the note instead.",
  http_429:
    "The transcription service is busy. Please try again in a few minutes or type the note.",
};
export const GENERIC_TRANSCRIBE_ERROR =
  "Couldn't turn this recording into text. Your recording is still here, and you can type the note instead.";

export function messageForCode(code: string): string {
  return TRANSCRIBE_ERROR_MESSAGES[code] ?? GENERIC_TRANSCRIBE_ERROR;
}

/** `Blob.arrayBuffer` is missing in older Safari (and in jsdom); FileReader exists everywhere. */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBytes(blob));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface TranscribeCalls {
  transcribe: typeof transcribeRecording;
}

export function createMetaTranscriber(
  familyId: string,
  available: boolean,
  calls: TranscribeCalls = { transcribe: transcribeRecording },
): DictationTranscriber & { lastTurns: () => TranscriptTurn[] } {
  let last: TranscriptTurn[] = [];
  return {
    available,
    lastTurns: () => last,
    async transcribe(audio, opts) {
      if (!available) throw new DictationError("not_available", messageForCode("not_available"));
      const audioBase64 = await blobToBase64(audio);
      if (opts?.signal?.aborted) throw new DictationError("aborted", GENERIC_TRANSCRIBE_ERROR);
      let result;
      try {
        result = await calls.transcribe({ data: { familyId, audioBase64 } });
      } catch {
        // Authentication or transport failure of the function call itself: never show its text.
        throw new DictationError("request_failed", GENERIC_TRANSCRIBE_ERROR);
      }
      if (!result.ok) throw new DictationError(result.code, messageForCode(result.code));
      last = result.turns;
      return { text: formatDraftText(result.turns) };
    },
  };
}

export interface MetaTranscriberHandle {
  transcriber: DictationTranscriber;
  state: TranscriberState;
  /** Manual "Try again" after a temporary error. */
  retry: () => void;
  /** Re-check only if the last answer was not "available" (never for a confirmed yes). Safe to call repeatedly. */
  recheck: () => void;
}

/**
 * Availability comes from the server (feature switched on, key present, caller is an organizer). It sends no audio. States:
 * loading, available, disabled and not_organizer (definite answers) and error (the check keeps failing, temporarily).
 * A temporary failure retries a bounded number of times with short backoff and NEVER replaces an earlier confirmed answer;
 * only a definite server answer can. A confirmed yes is trusted for 5 minutes; any other answer is re-checked on focus.
 */
export function useMetaTranscriber(familyId: string): MetaTranscriberHandle {
  const status = useQuery<TranscriptionStatus>({
    queryKey: ["transcription-status", familyId],
    queryFn: async () => {
      if (isJudgeDemo()) return { available: false, reason: "not_organizer" };
      const r = await getTranscriptionStatus({ data: { familyId } });
      // "could not find out" is an error, not an answer: the query keeps its last confirmed data and retries.
      if (!r.available && r.reason === "check_failed") throw new Error("status_check_failed");
      return r;
    },
    retry: STATUS_RETRY_DELAYS_MS.length,
    retryDelay: (attempt) =>
      STATUS_RETRY_DELAYS_MS[Math.min(attempt, STATUS_RETRY_DELAYS_MS.length - 1)]!,
    staleTime: (q) => (q.state.data?.available === true ? STATUS_CONFIRMED_STALE_MS : 0),
  });
  const state = deriveTranscriberState({
    data: status.data,
    isFetching: status.isFetching,
    isError: status.isError,
  });
  const available = state === "available";
  const transcriber = useMemo(
    () => createMetaTranscriber(familyId, available),
    [familyId, available],
  );
  const { refetch } = status;
  const retry = useCallback(() => void refetch(), [refetch]);
  const recheck = useCallback(() => {
    if (state !== "available" && state !== "loading") void refetch({ cancelRefetch: false });
  }, [state, refetch]);
  return { transcriber, state, retry, recheck };
}
