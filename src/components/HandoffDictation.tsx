import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Lock,
  Mic,
  RotateCcw,
  Smartphone,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  RECORDER_ERROR_MESSAGES,
  RECORDER_NOTICE_MESSAGES,
  useAudioRecorder,
} from "@/hooks/use-audio-recorder";
import { formatTimestamp } from "@/lib/format";
import type { PcmProvider } from "@/lib/pcm-capture";
import type { TranscriberState } from "@/lib/meta-transcribe/status";
import {
  DictationError,
  dictationTranscriber,
  type DictationTranscriber,
} from "@/services/dictation";

/** What the page needs in order to save a recording (only used if the caregiver ticks "Keep"). */
export interface KeptTake {
  original: Blob;
  originalMime: string;
  /** null when this browser could not capture the 16 kHz WAV copy (the recording then cannot be kept). */
  wav: Blob | null;
  durationSec: number;
}

interface Props {
  /** Called only when the caregiver explicitly taps "Add to note" on reviewed text. */
  onAccept: (text: string) => void;
  transcriber?: DictationTranscriber;
  /** Persistence is opt-in. Without these props the panel is on-device only, exactly as before. */
  keep?: boolean;
  onKeepChange?: (keep: boolean) => void;
  onTakeChange?: (take: KeptTake | null) => void;
  /** Changing this number discards the current recording (the page bumps it after a successful save). */
  resetSignal?: number;
  /** Test/e2e seam for the PCM capture provider. */
  pcm?: PcmProvider;
  /**
   * Why transcription is or isn't offered, from the availability check (loading, disabled, not_organizer or a temporary error).
   * Omitted: the old behaviour, where `transcriber.available` alone decides. The check sends no audio.
   */
  transcriberState?: TranscriberState;
  /** "Try again" after a temporary availability error. */
  onRetryAvailability?: () => void;
  /** Called when a recording stops, so the page can re-check availability (only if it was not already available). */
  onRecordingStopped?: () => void;
}

/**
 * Dictation for handoff notes. Recording stays in this browser tab: it is never saved or uploaded.
 * Transcription is optional and only offered when a verified transcriber is connected; its output is a
 * draft the caregiver can edit before it is added to the note, and the handoff is still saved explicitly.
 */
export function HandoffDictation({
  onAccept,
  transcriber = dictationTranscriber,
  keep = false,
  onKeepChange,
  onTakeChange,
  resetSignal,
  pcm,
  transcriberState,
  onRetryAvailability,
  onRecordingStopped,
}: Props) {
  const rec = useAudioRecorder(pcm ? { pcm } : {});
  const onTakeChangeRef = useRef(onTakeChange);
  onTakeChangeRef.current = onTakeChange;
  const audio = rec.audio;
  useEffect(() => {
    onTakeChangeRef.current?.(
      audio
        ? {
            original: audio.blob,
            originalMime: audio.mimeType,
            wav: audio.wav,
            durationSec: audio.durationSec,
          }
        : null,
    );
  }, [audio]);
  const onStoppedRef = useRef(onRecordingStopped);
  onStoppedRef.current = onRecordingStopped;
  const stoppedTake = rec.status === "stopped" && rec.audio ? rec.audio.url : null;
  useEffect(() => {
    // Once per finished recording. Only asks the page to re-check; the recording and any draft are untouched.
    if (stoppedTake) onStoppedRef.current?.();
  }, [stoppedTake]);
  const lastReset = useRef(resetSignal);
  const { discard: discardRec } = rec;
  useEffect(() => {
    if (resetSignal !== lastReset.current) {
      lastReset.current = resetSignal;
      discardRec();
    }
  }, [resetSignal, discardRec]);
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
      // The 16 kHz mono WAV copy is the transcription-ready one; without it the service will refuse the original.
      const { text } = await transcriber.transcribe(rec.audio.wav ?? rec.audio.blob, {
        signal: ac.signal,
      });
      if (!ac.signal.aborted) setDraft(text);
    } catch (e) {
      if (!ac.signal.aborted)
        setTranscribeError(
          e instanceof DictationError
            ? e.message
            : "Couldn't turn this recording into text. Your recording is still here, and you can type the note instead.",
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

  const kept = keep && !!rec.audio?.wav;

  return (
    <div className="space-y-4" aria-label="Dictate a note">
      <div className="flex items-center gap-2">
        <h2 className="text-xl">Voice note</h2>
      </div>

      {/* Temporary (stays on this phone) vs Saved (kept with the handoff once Save is pressed). */}
      <p
        data-testid="storage-state"
        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.9412rem] font-bold ${
          kept ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {kept ? (
          <>
            <Lock className="size-[18px] shrink-0" aria-hidden /> Will be saved privately with this
            handoff
          </>
        ) : (
          <>
            <Smartphone className="size-[18px] shrink-0" aria-hidden /> Temporary · stays on this
            device, not saved
          </>
        )}
      </p>
      <p className="text-[0.9412rem] text-muted-foreground">
        {keep
          ? "This recording will be saved with the handoff when you press Save handoff."
          : transcriber.available
            ? "Your recording stays on this device unless you press Transcribe or choose to keep it."
            : onKeepChange
              ? "Your recording stays on this device. It isn't saved or uploaded unless you choose to keep it."
              : "Your recording stays on this device. It isn't saved or uploaded."}
      </p>

      <div role="status" aria-live="polite" className="min-h-6 text-base">
        {requesting && <span>Waiting for microphone permission…</span>}
        {recording && (
          <span className="inline-flex items-center gap-2 font-bold text-destructive">
            <span
              aria-hidden
              className="size-3 rounded-full bg-destructive motion-safe:animate-pulse"
            />
            Recording {formatTimestamp(rec.elapsedSec)}
          </span>
        )}
      </div>

      {rec.status === "error" && rec.errorCode && (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl bg-warning p-3.5 text-warning-foreground"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{RECORDER_ERROR_MESSAGES[rec.errorCode]}</p>
        </div>
      )}

      {rec.status === "idle" && (
        <div className="flex flex-col items-center gap-2.5 py-2 text-center [@media(max-height:500px)_and_(orientation:landscape)]:flex-row [@media(max-height:500px)_and_(orientation:landscape)]:justify-center [@media(max-height:500px)_and_(orientation:landscape)]:text-left">
          <Button
            type="button"
            aria-label="Record"
            onClick={() => void rec.start()}
            className="inline-flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-warm [@media(max-height:500px)_and_(orientation:landscape)]:size-16"
          >
            <Mic className="size-10" aria-hidden />
          </Button>
          <div>
            <p className="text-lg font-bold">Tap to record</p>
            <p className="text-[0.9412rem] text-muted-foreground">
              Say how she ate, her meds, and anything unusual.
            </p>
          </div>
        </div>
      )}

      {rec.status === "error" && (
        <Button
          type="button"
          size="lg"
          variant={rec.errorCode === "unsupported" ? "outline" : "default"}
          className="h-14 w-full"
          onClick={() => void rec.start()}
        >
          {rec.errorCode !== "unsupported" ? (
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
        <>
          <div className="flex flex-col items-center gap-2.5 py-2 text-center">
            <Button
              type="button"
              aria-label="Stop"
              onClick={rec.stop}
              variant="destructive"
              className="inline-flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-full"
            >
              <Square className="size-8 fill-current" aria-hidden />
            </Button>
            <p className="text-[0.9412rem] text-muted-foreground">
              Tap to stop. You can play it back first.
            </p>
          </div>
          {/* Docked above the tab bar so Stop is always reachable, in portrait or landscape. */}
          <div
            role="region"
            aria-label="Recording in progress"
            className="recording-dock fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 border-t-2 border-destructive bg-card px-4 py-2.5 lg:left-[var(--side-w)] lg:bottom-0 lg:px-8"
          >
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-destructive">
                Recording {formatTimestamp(rec.elapsedSec)}
              </p>
              <p className="text-[0.9412rem] text-muted-foreground">
                {keep ? "Will be saved when you press Save handoff" : "Stays on this device"}
              </p>
            </div>
            <Button
              type="button"
              aria-label="Stop recording"
              onClick={rec.stop}
              variant="destructive"
              className="inline-flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full"
            >
              <Square className="size-6 fill-current" aria-hidden />
            </Button>
          </div>
        </>
      )}

      {rec.status === "stopped" && rec.audio && (
        <div className="space-y-3">
          {rec.notice && (
            <p className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
              {RECORDER_NOTICE_MESSAGES[rec.notice]}
            </p>
          )}
          <div className="rounded-2xl bg-primary/10 p-3">
            <audio
              controls
              src={rec.audio.url}
              aria-label="Playback of your recording"
              className="w-full"
              onError={() => setFailedUrl(rec.audio?.url ?? null)}
            />
          </div>
          {failedUrl === rec.audio.url && (
            <p role="alert" className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
              This device couldn't play the recording back ({rec.audio.mimeType.split(";")[0]},{" "}
              {Math.max(1, Math.round(rec.audio.blob.size / 1024))} KB). Tap Record again, or type
              your note instead.
            </p>
          )}
          <p className="text-[0.9412rem] text-muted-foreground">
            Recorded {formatTimestamp(rec.audio.durationSec)}
          </p>
          <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:basis-40">
            <Button type="button" variant="outline" onClick={() => void rec.start()}>
              <RotateCcw /> Record again
            </Button>
            <Button type="button" variant="outline" onClick={discardRecording}>
              <Trash2 /> Discard recording
            </Button>
          </div>

          {onKeepChange && (
            <div className="space-y-2 rounded-2xl border p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor="keep-recording" className="block font-bold">
                    Keep the recording with this handoff
                  </label>
                  <span className="text-[0.9412rem] text-muted-foreground">
                    (about{" "}
                    {((rec.audio.blob.size + (rec.audio.wav?.size ?? 0)) / 1048576).toFixed(1)} MB)
                  </span>
                </div>
                <Switch
                  id="keep-recording"
                  checked={kept}
                  disabled={!rec.audio.wav}
                  onCheckedChange={(v) => onKeepChange(v)}
                />
              </div>
              {rec.audio.wav ? (
                <p className="text-[0.9412rem] text-muted-foreground">
                  Off by default. If on, the recording is stored privately for your family when you
                  press Save handoff, and you can delete it any time. Otherwise it is never saved.
                </p>
              ) : (
                <p className="text-[0.9412rem] text-muted-foreground">
                  This browser couldn't capture the transcription-ready copy, so this recording
                  can't be kept. You can still save the handoff without it.
                </p>
              )}
            </div>
          )}

          {transcriber.available ? (
            transcribing ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={cancelTranscription}
              >
                <Loader2 className="animate-spin" /> Transcribing… tap to cancel
              </Button>
            ) : (
              <>
                <p className="text-[0.9412rem] text-muted-foreground">
                  Transcribe sends this recording to Meta's speech service to turn it into text. It
                  is only sent when you press the button. Pendia does not store it unless you choose
                  to keep the recording; how Meta handles it is covered by Meta's own terms.
                </p>
                <Button type="button" className="w-full" onClick={() => void runTranscribe()}>
                  Transcribe
                </Button>
              </>
            )
          ) : transcriberState === "loading" ? (
            <p role="status" className="text-[0.9412rem] text-muted-foreground">
              Checking whether transcription is available… You can type the note below meanwhile.
            </p>
          ) : transcriberState === "not_organizer" ? (
            <p className="text-[0.9412rem] text-muted-foreground">
              Only the family organizer can transcribe a recording. You can play your recording
              back, but please type the note below.
            </p>
          ) : transcriberState === "error" ? (
            <div className="space-y-2">
              <p role="alert" className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
                Couldn't check whether transcription is available. Your recording is still here; you
                can try again or type the note below.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onRetryAvailability}
              >
                <RotateCcw /> Try again
              </Button>
            </div>
          ) : (
            <p className="text-[0.9412rem] text-muted-foreground">
              Transcription isn't connected yet. You can play your recording back, but please type
              the note below for now.
            </p>
          )}
          {transcribeError && (
            <p role="alert" className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
              {transcribeError}
            </p>
          )}
        </div>
      )}

      {draft !== null && (
        <div className="space-y-2 rounded-2xl border-2 border-dashed border-input bg-card p-3.5">
          <label htmlFor="dictation-draft" className="block font-bold">
            Draft from dictation: review and edit before adding
          </label>
          <p className="text-[0.9412rem] text-muted-foreground">
            Not saved yet. Add it to the note, then press Save handoff.
          </p>
          <p
            role="note"
            className="rounded-xl bg-warning p-2.5 text-[0.9412rem] text-warning-foreground"
          >
            Check this against what was said. "Speaker A" and "Speaker B" are labels from the
            transcription, not names. Fix any names, doses, medicines or instructions before adding
            it.
          </p>
          <Textarea id="dictation-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:basis-40">
            <Button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                onAccept(draft.trim());
                setDraft(null);
              }}
            >
              Add to note
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Discard draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
