// Browser side of the Handoff transcription: asks the server whether transcription is available for this caregiver, and turns a
// recording into a DRAFT with anonymous speaker labels and timestamps. The browser never sees the Meta key or calls Meta; it
// only calls the two authenticated server functions. Nothing returned here is saved: the caller shows it for review first.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DictationError, type DictationTranscriber } from "@/services/dictation";
import { formatDraftText, type TranscriptTurn } from "@/lib/meta-transcribe/response";
import { getTranscriptionStatus, transcribeRecording } from "./transcribe.functions";

/** What the caregiver reads for each fixed server code. Never provider text. */
export const TRANSCRIBE_ERROR_MESSAGES: Record<string, string> = {
  not_available: "Transcription isn't available right now. Please type the note instead.",
  forbidden: "Only the family organizer can transcribe a recording. Please type the note instead.",
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

/** Availability comes from the server (feature switched on, key present, caller is an organizer); until then, unavailable. */
export function useMetaTranscriber(familyId: string): DictationTranscriber {
  const status = useQuery({
    queryKey: ["transcription-status", familyId],
    queryFn: () => getTranscriptionStatus({ data: { familyId } }),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const available = status.data?.available === true;
  return useMemo(() => createMetaTranscriber(familyId, available), [familyId, available]);
}
