import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Mic, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  RECORDER_ERROR_MESSAGES,
  RECORDER_NOTICE_MESSAGES,
  useAudioRecorder,
} from "@/hooks/use-audio-recorder";
import { formatTimestamp } from "@/lib/format";
import { dictationTranscriber, type DictationTranscriber } from "@/services/dictation";

interface Props {
  /** Called only when the caregiver explicitly taps "Add to note" on reviewed text. */
  onAccept: (text: string) => void;
  transcriber?: DictationTranscriber;
}

/**
 * Dictation for handoff notes. Recording stays in this browser tab: it is never saved or uploaded.
 * Transcription is optional and only offered when a verified transcriber is connected; its output is a
 * draft the caregiver can edit before it is added to the note, and the handoff is still saved explicitly.
 */
export function HandoffDictation({ onAccept, transcriber = dictationTranscriber }: Props) {
  const rec = useAudioRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function cancelTranscription() {
    abortRef.current?.abort();
    abortRef.current = null;
    setTranscribing(false);
  }

  function discardRecording() {
    cancelTranscription();
    setTranscribeError(null);
    rec.discard();
  }

  async function runTranscribe() {
    if (!rec.audio || !transcriber.available || transcribing) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const { text } = await transcriber.transcribe(rec.audio.blob, { signal: ac.signal });
      if (!ac.signal.aborted) setDraft(text);
    } catch {
      if (!ac.signal.aborted)
        setTranscribeError(
          "Couldn't turn this recording into text. Your recording is still here, and you can type the note instead.",
        );
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setTranscribing(false);
      }
    }
  }

  const recording = rec.status === "recording";
  const requesting = rec.status === "requesting";

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4" aria-label="Dictate a note">
      <div>
        <p className="text-lg font-semibold">Dictate a note</p>
        <p className="text-sm text-muted-foreground">
          Your recording stays on this device. It isn't saved or uploaded.
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-6 text-base">
        {requesting && <span>Waiting for microphone permission…</span>}
        {recording && (
          <span className="inline-flex items-center gap-2 font-semibold text-destructive">
            <span aria-hidden className="size-3 animate-pulse rounded-full bg-destructive" />
            Recording {formatTimestamp(rec.elapsedSec)}
          </span>
        )}
      </div>

      {rec.status === "error" && rec.errorCode && (
        <div role="alert" className="flex gap-3 rounded-xl bg-warning p-3 text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{RECORDER_ERROR_MESSAGES[rec.errorCode]}</p>
        </div>
      )}

      {(rec.status === "idle" || rec.status === "error") && (
        <Button
          type="button"
          size="lg"
          variant={rec.status === "error" ? "outline" : "default"}
          className="h-14 w-full"
          onClick={() => void rec.start()}
        >
          {rec.status === "error" && rec.errorCode !== "unsupported" ? (
            <>
              <RotateCcw /> Try again
            </>
          ) : (
            <>
              <Mic /> Record
            </>
          )}
        </Button>
      )}

      {requesting && (
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-14 w-full"
          onClick={rec.discard}
        >
          Cancel
        </Button>
      )}

      {recording && (
        <Button
          type="button"
          size="lg"
          variant="destructive"
          className="h-14 w-full"
          onClick={rec.stop}
        >
          <Square /> Stop
        </Button>
      )}

      {rec.status === "stopped" && rec.audio && (
        <div className="space-y-3">
          {rec.notice && (
            <p className="rounded-xl bg-warning p-3 text-warning-foreground">
              {RECORDER_NOTICE_MESSAGES[rec.notice]}
            </p>
          )}
          <audio
            controls
            src={rec.audio.url}
            aria-label="Playback of your recording"
            className="w-full"
            onError={() => setFailedUrl(rec.audio?.url ?? null)}
          />
          {failedUrl === rec.audio.url && (
            <p role="alert" className="rounded-xl bg-warning p-3 text-warning-foreground">
              This device couldn't play the recording back ({rec.audio.mimeType.split(";")[0]},{" "}
              {Math.max(1, Math.round(rec.audio.blob.size / 1024))} KB). Tap Record again, or type
              your note instead.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Recorded {formatTimestamp(rec.audio.durationSec)}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => void rec.start()}
            >
              <RotateCcw /> Record again
            </Button>
            <Button type="button" variant="outline" className="h-12" onClick={discardRecording}>
              <Trash2 /> Discard recording
            </Button>
          </div>

          {transcriber.available ? (
            transcribing ? (
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full"
                onClick={cancelTranscription}
              >
                <Loader2 className="animate-spin" /> Transcribing… tap to cancel
              </Button>
            ) : (
              <Button type="button" className="h-12 w-full" onClick={() => void runTranscribe()}>
                Transcribe
              </Button>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Transcription isn't connected yet. You can play your recording back, but please type
              the note below for now.
            </p>
          )}
          {transcribeError && (
            <p role="alert" className="rounded-xl bg-warning p-3 text-warning-foreground">
              {transcribeError}
            </p>
          )}
        </div>
      )}

      {draft !== null && (
        <div className="space-y-2 rounded-xl border-2 border-dashed p-3">
          <label htmlFor="dictation-draft" className="block font-semibold">
            Draft from dictation: review and edit before adding
          </label>
          <p className="text-sm text-muted-foreground">
            Not saved yet. Add it to the note, then press Save handoff.
          </p>
          <Textarea
            id="dictation-draft"
            className="min-h-24 text-base"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              className="h-12"
              disabled={!draft.trim()}
              onClick={() => {
                onAccept(draft.trim());
                setDraft(null);
              }}
            >
              Add to note
            </Button>
            <Button type="button" variant="outline" className="h-12" onClick={() => setDraft(null)}>
              Discard draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
