import { useRef, useState } from "react";
import { Download, Loader2, Play, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import { recordingService } from "@/services";

export interface SavedRecordingRef {
  id: string;
  family_id: string;
  audio_path: string;
  audio_wav_path: string | null;
  duration_seconds: number | null;
}

type Service = Pick<typeof recordingService, "getPlaybackUrl" | "deleteHandoffRecording">;

function saveViaAnchor(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * A recording kept with a saved handoff. Everything is driven by the database reference, so it plays after a page
 * refresh or a new sign-in. Playback and download both use a short-lived signed URL requested on demand (never stored),
 * under the signed-in user's own authorization. If the original won't play (e.g. webm on some browsers) it retries once
 * with a fresh link (they expire), then falls back to the WAV copy, which plays everywhere.
 */
export function SavedRecording({
  handoff,
  onDeleted,
  service = recordingService,
  saveFile = saveViaAnchor,
}: {
  handoff: SavedRecordingRef;
  onDeleted: () => void;
  service?: Service;
  saveFile?: (url: string) => void;
}) {
  const sources = [
    handoff.audio_path,
    handoff.audio_path,
    ...(handoff.audio_wav_path ? [handoff.audio_wav_path] : []),
  ];
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const requestId = useRef(0);

  async function load(index: number) {
    const mine = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const url = await service.getPlaybackUrl(sources[index]!, {
        expectFamilyId: handoff.family_id,
      });
      if (mine !== requestId.current) return;
      setAttempt(index);
      setSrc(url);
      setNote(index === 2 ? "Playing the compatible copy of this recording." : null);
    } catch {
      if (mine !== requestId.current) return;
      setSrc(null);
      setError("Couldn't open the recording. Check your connection and tap Play again.");
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }

  function onPlayerError() {
    if (attempt + 1 < sources.length) void load(attempt + 1);
    else {
      setSrc(null);
      setError(
        "This device couldn't play the recording. Try Download, or open it on another device.",
      );
    }
  }

  async function download(path: string) {
    setError(null);
    try {
      saveFile(
        await service.getPlaybackUrl(path, {
          expectFamilyId: handoff.family_id,
          download: path.split("/").pop() ?? "recording",
        }),
      );
    } catch {
      setError("Couldn't prepare the download. Please try again.");
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const { filesRemoved } = await service.deleteHandoffRecording({
        id: handoff.id,
        audio_path: handoff.audio_path,
        audio_wav_path: handoff.audio_wav_path,
      });
      setConfirmOpen(false);
      setSrc(null);
      onDeleted();
      if (!filesRemoved)
        setNote(
          "The recording was removed from this handoff. Cleaning up the stored file will be retried.",
        );
    } catch (e) {
      setConfirmOpen(false);
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border p-3" aria-label="Saved recording">
      <p className="font-semibold">
        Recording{" "}
        <span className="font-normal text-muted-foreground">
          · {formatTimestamp(handoff.duration_seconds)}
        </span>
      </p>
      {src && (
        <audio
          key={src}
          controls
          autoPlay
          src={src}
          aria-label="Playback of the saved recording"
          className="w-full"
          onError={onPlayerError}
        />
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-warning p-3 text-warning-foreground">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" className="h-12" onClick={() => void load(0)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Play />} Play recording
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => void download(handoff.audio_path)}
        >
          <Download /> Download recording
        </Button>
        {handoff.audio_wav_path && (
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => void download(handoff.audio_wav_path!)}
          >
            <Download /> Download WAV copy
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 /> Delete recording
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the recording from the handoff and deletes the stored audio files. The
              written handoff stays. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {deleting ? "Deleting…" : "Delete recording"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
