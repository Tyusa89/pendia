import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardCheck } from "lucide-react";
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
  head: () => ({
    meta: [
      { title: "Handoffs — Pendia" },
      { name: "description", content: "End-of-shift check-ins." }, { property: "og:title", content: "Handoffs — Pendia" }, { property: "og:description", content: "End-of-shift check-ins." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <WithFamily>{({ me }) => <Handoffs me={me} />}</WithFamily>,
});

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((v) => (
        <Button
          key={String(v)}
          type="button"
          variant={value === v ? "default" : "outline"}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`h-14 cursor-pointer rounded-xl border-2 text-lg font-bold ${value === v ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}
        >
          {v ? "Yes" : "No"}
        </Button>
      ))}
    </div>
  );
}

function Handoffs({ me }: { me: Member }) {
  const qc = useQueryClient();
  const fid = me.family_id;
  const { data: list = [] } = useQuery({
    queryKey: ["handoffs", fid],
    queryFn: () => handoffService.list(fid),
  });
  const { data: watch = [] } = useQuery({
    queryKey: ["watch-active", fid],
    queryFn: () => handoffService.activeWatchItems(fid),
  });
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
      const base = {
        family_id: fid,
        author_member_id: me.id,
        ate,
        meds_taken: meds,
        unusual: unusual || null,
        watch_answers: answers,
      };
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
    onSuccess: () => {
      setAte(null);
      setMeds(null);
      setUnusual("");
      setAnswers({});
      setKeep(false);
      setResetSignal((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["handoffs", fid] });
      setJustSaved(true);
      toast.success("Handoff saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function onSaveClick() {
    // First time a recording is kept on this device: show the storage notice before anything is uploaded.
    if (keep && take?.wav && !hasAcknowledgedRecordingNotice()) setNoticeOpen(true);
    else save.mutate();
  }

  const canSave = me.role === "organizer"; // handoff writes are organizer-only in the database today
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (ate !== null || meds !== null || unusual) setJustSaved(false);
  }, [ate, meds, unusual]);

  return (
    <>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <PageTitle title="Handoff" subtitle="Quick check-in before you leave" />
          {justSaved && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-2xl bg-success p-3.5 text-success-foreground"
            >
              <Check className="mt-0.5 size-6 shrink-0" aria-hidden />
              <div>
                <p className="font-bold">Handoff saved</p>
                <p className="text-[0.9412rem]">The family can see it now.</p>
              </div>
            </div>
          )}
          {!canSave && (
            <p role="note" className="rounded-2xl bg-primary/10 p-3.5">
              Only the organizer can save a handoff in the app for now. You can read past handoffs
              below.
            </p>
          )}

          <Panel aria-label="Check-in" className="space-y-5">
            <div>
              <p className="mb-2 text-lg font-bold">Did she eat?</p>
              <YesNo value={ate} onChange={setAte} />
            </div>
            <div>
              <p className="mb-2 text-lg font-bold">Did she take her medication?</p>
              <YesNo value={meds} onChange={setMeds} />
            </div>
            {watch.map((w) => (
              <div key={w.id}>
                <p className="mb-2 text-lg font-bold">Watching: {w.text}?</p>
                <YesNo
                  value={answers[w.text] === undefined ? null : answers[w.text] === "Yes"}
                  onChange={(v) => setAnswers({ ...answers, [w.text]: v ? "Yes" : "No" })}
                />
              </div>
            ))}
            <div>
              <p className="mb-2 text-lg font-bold">Anything unusual?</p>
              <Textarea
                placeholder="Optional. Type here, or use your voice below."
                value={unusual}
                onChange={(e) => setUnusual(e.target.value)}
              />
            </div>
          </Panel>

          <Panel aria-label="Voice note">
            <HandoffDictation
              onAccept={(text) =>
                setUnusual((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text))
              }
              keep={keep}
              onKeepChange={setKeep}
              onTakeChange={(t) => {
                setTake(t);
                if (!t) setKeep(false);
              }}
              resetSignal={resetSignal}
            />
          </Panel>

          <Button
            size="lg"
            className="w-full"
            disabled={ate === null || meds === null || save.isPending || !canSave}
            onClick={onSaveClick}
          >
            Save handoff
          </Button>
        </div>

        <AlertDialog open={noticeOpen} onOpenChange={setNoticeOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Store this recording?</AlertDialogTitle>
              <AlertDialogDescription>
                The recording will be uploaded and stored privately for your family, along with a
                processed copy that can be turned into text later. Only people in your family with
                access to handoffs can play it, and you can delete it at any time. Pendia does not
                give medical advice: check with your doctor or pharmacist.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  acknowledgeRecordingNotice();
                  save.mutate();
                }}
              >
                Store the recording
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <aside aria-label="Past handoffs" className="min-w-0">
          <h2 className="mb-3 text-xl">Past handoffs</h2>
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-[1.25rem] bg-card p-5 text-center shadow-card">
              <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ClipboardCheck className="size-6" aria-hidden />
              </span>
              <p className="text-lg font-bold">No handoffs yet</p>
              <p className="text-muted-foreground">
                When someone finishes a shift, their check-in shows up here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {list.map((h) => {
                const wa = (h.watch_answers ?? {}) as Record<string, string>;
                return (
                  <Panel key={h.id} className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="font-bold">
                        {members.find((m) => m.id === h.author_member_id)?.name ?? "Someone"}
                      </p>
                      <p className="text-[0.8235rem] text-muted-foreground">
                        {new Date(h.created_at).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip ok={h.ate} good="Ate" bad="Didn't eat" unknown="Ate: not recorded" />
                      <Chip
                        ok={h.meds_taken}
                        good="Meds taken"
                        bad="Meds not taken"
                        unknown="Meds: not recorded"
                      />
                      {Object.entries(wa).map(([k, v]) => (
                        <Chip key={k} ok={v !== "Yes"} good={`${k}: ${v}`} bad={`${k}: ${v}`} />
                      ))}
                    </div>
                    {h.unusual && (
                      <p className="break-words rounded-xl bg-unassigned p-3 text-[0.9412rem] text-unassigned-foreground">
                        {h.unusual}
                      </p>
                    )}
                    {h.note && <p className="text-muted-foreground">{h.note}</p>}
                    {h.audio_path ? (
                      <SavedRecording
                        handoff={{
                          id: h.id,
                          family_id: h.family_id,
                          audio_path: h.audio_path,
                          audio_wav_path: h.audio_wav_path,
                          duration_seconds: h.duration_seconds,
                        }}
                        canDelete={me.role === "organizer"}
                        onDeleted={() => qc.invalidateQueries({ queryKey: ["handoffs", fid] })}
                      />
                    ) : (
                      <p className="text-[0.8235rem] text-muted-foreground">No recording kept</p>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Chip({
  ok,
  good,
  bad,
  unknown,
}: {
  ok: boolean | null;
  good: string;
  bad: string;
  unknown?: string;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[0.8235rem] font-bold ${ok ? "bg-secondary text-secondary-foreground" : "bg-unassigned text-unassigned-foreground"}`}
    >
      {ok === null && unknown ? unknown : ok ? good : bad}
    </span>
  );
}
