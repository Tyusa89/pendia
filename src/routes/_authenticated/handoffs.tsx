import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Empty, PageTitle, Panel, WithFamily } from "@/components/AppShell";
import { HandoffDictation, type KeptTake } from "@/components/HandoffDictation";
import { SavedRecording } from "@/components/SavedRecording";
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
import { acknowledgeRecordingNotice, hasAcknowledgedRecordingNotice } from "@/lib/recording-notice";
import { useMembers } from "@/hooks/use-family";
import { handoffService, recordingService, type Member } from "@/services";

export const Route = createFileRoute("/_authenticated/handoffs")({
  head: () => ({ meta: [{ title: "Handoffs — Pendia" }, { name: "description", content: "End-of-shift check-ins." }] }),
  component: () => <WithFamily>{({ me }) => <Handoffs me={me} />}</WithFamily>,
});

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={`h-14 rounded-xl border-2 text-lg font-semibold ${value === v ? (v ? "border-success bg-success text-success-foreground" : "border-destructive bg-destructive text-destructive-foreground") : "bg-card"}`}>
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

function Handoffs({ me }: { me: Member }) {
  const qc = useQueryClient();
  const fid = me.family_id;
  const { data: list = [] } = useQuery({ queryKey: ["handoffs", fid], queryFn: () => handoffService.list(fid) });
  const { data: watch = [] } = useQuery({ queryKey: ["watch-active", fid], queryFn: () => handoffService.activeWatchItems(fid) });
  const { data: members = [] } = useMembers(fid);
  const [ate, setAte] = useState<boolean | null>(null);
  const [meds, setMeds] = useState<boolean | null>(null);
  const [unusual, setUnusual] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [take, setTake] = useState<KeptTake | null>(null);
  const [keep, setKeep] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const save = useMutation({
    mutationFn: async (): Promise<unknown> => {
      const base = { family_id: fid, author_member_id: me.id, ate, meds_taken: meds, unusual: unusual || null, watch_answers: answers };
      // Only when the caregiver ticked "Keep the recording" does anything beyond the existing save happen.
      if (keep && take?.wav) {
        return recordingService.saveHandoffWithRecording(base, {
          original: take.original,
          originalMime: take.originalMime,
          wav: take.wav,
          durationSec: take.durationSec,
        });
      }
      return handoffService.create(base);
    },
    onSuccess: () => { setAte(null); setMeds(null); setUnusual(""); setAnswers({}); setKeep(false); setResetSignal((n) => n + 1); qc.invalidateQueries({ queryKey: ["handoffs", fid] }); toast.success("Handoff saved"); },
    onError: (e) => toast.error((e as Error).message),
  });

  function onSaveClick() {
    // First time a recording is kept on this device: show the storage notice before anything is uploaded.
    if (keep && take?.wav && !hasAcknowledgedRecordingNotice()) setNoticeOpen(true);
    else save.mutate();
  }

  return (
    <>
      <PageTitle title="Handoff" subtitle="Quick check-in before you leave." />
      <Panel className="space-y-5">
        <div><p className="mb-2 text-lg font-semibold">Did she eat?</p><YesNo value={ate} onChange={setAte} /></div>
        <div><p className="mb-2 text-lg font-semibold">Took her meds?</p><YesNo value={meds} onChange={setMeds} /></div>
        {watch.map((w) => (
          <div key={w.id}>
            <p className="mb-2 text-lg font-semibold">Watching: {w.text}?</p>
            <YesNo value={answers[w.text] === undefined ? null : answers[w.text] === "Yes"} onChange={(v) => setAnswers({ ...answers, [w.text]: v ? "Yes" : "No" })} />
          </div>
        ))}
        <div><p className="mb-2 text-lg font-semibold">Anything unusual?</p>
          <Textarea className="min-h-24 text-base" placeholder="Optional" value={unusual} onChange={(e) => setUnusual(e.target.value)} /></div>
        <HandoffDictation
          onAccept={(text) => setUnusual((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text))}
          keep={keep}
          onKeepChange={setKeep}
          onTakeChange={(t) => { setTake(t); if (!t) setKeep(false); }}
          resetSignal={resetSignal}
        />
        <Button size="lg" className="w-full" disabled={ate === null || meds === null || save.isPending} onClick={onSaveClick}>Save handoff</Button>
      </Panel>

      <AlertDialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Store this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The recording will be uploaded and stored privately for your family, along with a processed copy that can be turned into text
              later. Only people in your family with access to handoffs can play it, and you can delete it at any time. Pendia does not
              give medical advice: check with your doctor or pharmacist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => { acknowledgeRecordingNotice(); save.mutate(); }}>Store the recording</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <h2 className="mb-3 mt-8 text-2xl font-semibold">Past handoffs</h2>
      {list.length === 0 ? <Empty>No handoffs yet.</Empty> : (
        <div className="space-y-3">
          {list.map((h) => {
            const wa = (h.watch_answers ?? {}) as Record<string, string>;
            return (
              <Panel key={h.id}>
                <div className="flex justify-between gap-3">
                  <p className="font-semibold">{members.find((m) => m.id === h.author_member_id)?.name ?? "Someone"}</p>
                  <p className="text-sm text-muted-foreground">{new Date(h.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <Chip ok={h.ate}>Ate</Chip><Chip ok={h.meds_taken}>Meds</Chip>
                  {Object.entries(wa).map(([k, v]) => <Chip key={k} ok={v !== "Yes"}>{k}: {v}</Chip>)}
                </div>
                {h.unusual && <p className="mt-3 rounded-lg bg-unassigned p-3 text-unassigned-foreground">{h.unusual}</p>}
                {h.note && <p className="mt-2 text-muted-foreground">{h.note}</p>}
                {h.audio_path && (
                  <SavedRecording
                    handoff={{ id: h.id, family_id: h.family_id, audio_path: h.audio_path, audio_wav_path: h.audio_wav_path, duration_seconds: h.duration_seconds }}
                    onDeleted={() => qc.invalidateQueries({ queryKey: ["handoffs", fid] })}
                  />
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

function Chip({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return <span className={`rounded-full px-3 py-1 font-semibold ${ok ? "bg-secondary text-secondary-foreground" : "bg-unassigned text-unassigned-foreground"}`}>{ok ? "✓" : "✗"} {children}</span>;
}
