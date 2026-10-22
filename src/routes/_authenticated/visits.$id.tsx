import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Eye, Mic } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, Panel, WithFamily } from "@/components/AppShell";
import { AppointmentSummary } from "@/components/AppointmentSummary";
import { AppointmentList } from "@/components/AppointmentList";
import { useMembers } from "@/hooks/use-family";
import { findOverlaps } from "@/lib/appointments";
import { formatTimestamp } from "@/lib/format";
import { visitService, type Member, type TranscriptLine } from "@/services";

export const Route = createFileRoute("/_authenticated/visits/$id")({
  head: () => ({ meta: [{ title: "Visit details — Pendia" }, { name: "description", content: "Summary, medication changes and tasks from a doctor visit." }, { property: "og:title", content: "Visit details — Pendia" }, { property: "og:description", content: "Summary, medication changes and tasks from a doctor visit." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => <WithFamily>{({ me, family }) => <VisitDetail me={me} timeZone={family.timezone} />}</WithFamily>,
});

function VisitDetail({ me, timeZone }: { me: Member; timeZone: string }) {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["visit", id], queryFn: () => visitService.get(id) });
  const { data: members = [] } = useMembers(me.family_id);
  const { data: allVisits = [] } = useQuery({ queryKey: ["visits", me.family_id], queryFn: () => visitService.list(me.family_id) });
  const nameOf = (mid: string | null) => members.find((m) => m.id === mid)?.name ?? "Unassigned";
  const confirm = useMutation({
    mutationFn: (cid: string) => visitService.confirmChange(cid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["visit", id] }); toast.success("Change confirmed"); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  const { visit, changes, tasks, watch } = data;
  const transcript = (visit.transcript as TranscriptLine[]) ?? [];

  return (
    <div>
      <Link to="/visits" className="-ml-1 inline-flex min-h-11 items-center gap-2 font-semibold text-primary"><ArrowLeft className="size-5" /> All visits</Link>
      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.65fr)]">
      <aside aria-label="Other visits" className="hidden min-w-0 lg:block">
        <AppointmentList familyId={me.family_id} timeZone={timeZone} canWrite={me.role === "organizer"} compact />
      </aside>
      <div className="min-w-0 space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          {new Date(visit.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{visit.provider_name?.trim() || visit.doctor?.trim() || "Appointment"}</h1>
      </div>

      <AppointmentSummary
        visit={visit}
        timeZone={timeZone}
        canWrite={me.role === "organizer"}
        overlapCount={findOverlaps(allVisits).get(visit.id)?.length ?? 0}
      />

      <Panel>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Mic className="size-5 text-primary" /> Recording</h2>
        {visit.audio_url ? <audio controls src={visit.audio_url} className="w-full" /> : (
          <div className="rounded-xl border-2 border-dashed p-5 text-center text-muted-foreground">No audio uploaded for this visit yet.</div>
        )}
      </Panel>

      <Panel className="bg-secondary">
        <h2 className="text-lg font-semibold text-secondary-foreground">In plain language</h2>
        <p className="mt-2 text-lg leading-relaxed">{visit.summary || "No summary yet."}</p>
      </Panel>

      <section>
        <h2 className="mb-3 text-2xl font-semibold">Medication changes</h2>
        {changes.length === 0 ? <Empty>No changes.</Empty> : changes.map((c) => (
          <Panel key={c.id} className="mb-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xl font-semibold">{c.medication}</p>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${c.status === "confirmed" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}>
                {c.status === "confirmed" ? "Confirmed" : "Pending"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-lg">
              <span className="rounded-lg bg-muted px-3 py-1 line-through decoration-muted-foreground/60">{c.before}</span>
              <ArrowRight className="size-5 text-primary" />
              <span className="rounded-lg bg-accent px-3 py-1 font-semibold">{c.after}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Heard at {formatTimestamp(c.source_seconds)} · {c.speaker_label ?? "Unknown speaker"}</p>
            {c.unclear && <p className="mt-1 text-sm font-semibold text-warning-foreground">Unclear — ask the pharmacist</p>}
            {c.status === "pending" ? (
              <Button variant="success" className="mt-4 w-full" disabled={confirm.isPending} onClick={() => confirm.mutate(c.id)}>
                <Check /> Confirm this change
              </Button>
            ) : <p className="mt-3 text-sm font-medium text-success">Confirmed by {nameOf(c.confirmed_by)}</p>}
          </Panel>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-semibold">Tasks</h2>
        {tasks.length === 0 ? <Empty>No tasks.</Empty> : (
          <Panel className="divide-y p-0">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-lg font-semibold">{t.title}</p>
                  <p className="text-muted-foreground">{nameOf(t.owner_member_id)}</p>
                </div>
                {t.due_date && <p className="shrink-0 text-right font-semibold text-primary">Due {new Date(t.due_date + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>}
              </div>
            ))}
          </Panel>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-semibold">Watch for</h2>
        {watch.length === 0 ? <Empty>Nothing to watch.</Empty> : watch.map((w) => (
          <Panel key={w.id} className="mb-3 flex items-center gap-3">
            <Eye className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-lg font-semibold">{w.text}</p>
              {w.ends_on && <p className="text-sm text-muted-foreground">Until {new Date(w.ends_on + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>}
            </div>
          </Panel>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-semibold">Transcript</h2>
        {transcript.length === 0 ? <Empty>No transcript yet.</Empty> : (
          <Panel className="space-y-4">
            {transcript.map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-12 shrink-0 pt-0.5 font-mono text-sm text-muted-foreground">{formatTimestamp(l.start_s)}</span>
                <div>
                  <p className={`text-sm font-bold ${l.speaker === "A" ? "text-primary" : "text-success"}`}>Speaker {l.speaker}</p>
                  <p className="text-lg">{l.text}</p>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </section>
      </div>
      </div>
    </div>
  );
}
