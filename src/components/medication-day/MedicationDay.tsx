// Medication day: the computed dose times for one day, with reporting, correction, disagreement flags and history.
// Data access goes through doseService only. If the database part is not switched on yet the section says so and the
// rest of the Medications page keeps working.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, Panel } from "@/components/AppShell";
import { dateInZone } from "@/lib/zoned-time";
import { DoseError, actionsFor, addDays, type DoseOccurrence } from "@/lib/dose-administration";
import { doseService } from "@/services";
import { OccurrenceCard } from "./OccurrenceCard";
import { ReportDialog, type DialogMode, type Submission } from "./ReportDialog";
import { HistoryList } from "./HistoryList";

export function MedicationDay({
  familyId,
  timeZone,
  me,
  medications,
  renderMedications,
}: {
  familyId: string;
  timeZone: string;
  me: { id: string; role: string; can_see_meds: boolean };
  /** kept for callers; dose times are edited on each medication card */
  medications?: { id: string; name: string }[];
  /** when given, each medication's doses for the day are placed inside that medication's own card (grouped by id) */
  renderMedications?: (dosesFor: (medicationId: string) => ReactNode) => ReactNode;
}) {
  const qc = useQueryClient();
  const isOrganizer = me.role === "organizer";
  const today = dateInZone(new Date(), timeZone);
  const [day, setDay] = useState(today);
  const [dialog, setDialog] = useState<{ o: DoseOccurrence; mode: DialogMode } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<DoseOccurrence | null>(null);

  const occKey = ["dose-occurrences", familyId, day] as const;
  const occ = useQuery({
    queryKey: occKey,
    queryFn: () => doseService.occurrences(familyId, day, day),
    enabled: me.can_see_meds || isOrganizer,
    retry: false,
  });
  const history = useQuery({
    queryKey: [
      "dose-history",
      historyFor?.schedule_id,
      historyFor?.local_date,
      historyFor?.history_count,
    ],
    queryFn: () => doseService.history(historyFor!.schedule_id, historyFor!.local_date),
    enabled: !!historyFor,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["dose-occurrences", familyId] });

  const submit = useMutation({
    mutationFn: (s: Submission) => {
      const o = dialog!.o;
      const base = {
        scheduleId: o.schedule_id,
        localDate: o.local_date,
        expectedHead: o.head_id,
        requestId: s.requestId,
      };
      return s.mode === "flag"
        ? doseService.flagDisagreement(base)
        : doseService.report({
            ...base,
            status: s.status,
            notGivenReason: s.notGivenReason,
            changeReason: s.changeReason,
          });
    },
    onSuccess: () => {
      setDialog(null);
      setDialogError(null);
      refresh();
      toast.success(
        "Saved. This is a family member's report, not a check that the medication was taken.",
      );
    },
    onError: (e) => {
      const err = e as DoseError;
      setDialogError(err.message);
      // someone else reported meanwhile: show the current state instead of letting this attempt overwrite it
      if (err.code === "dose_conflict" || err.code === "dose_window_closed") refresh();
    },
  });

  const unavailable = occ.error instanceof DoseError && occ.error.code === "dose_unavailable";
  const now = Date.now();
  const actor = { isOrganizer, canSeeMeds: me.can_see_meds || isOrganizer, memberId: me.id };

  const card = (o: DoseOccurrence, embedded: boolean) => {
    const actions = actionsFor(o, actor, now);
    const open = (mode: DialogMode) => {
      setDialogError(null);
      setDialog({ o, mode });
    };
    return (
      <OccurrenceCard
        key={`${o.schedule_id}-${o.local_date}`}
        occurrence={o}
        actions={actions}
        embedded={embedded}
        onReport={() => open("report")}
        onChange={() => open("change")}
        onFlag={() => open("flag")}
        onHistory={() =>
          setHistoryFor(
            historyFor?.schedule_id === o.schedule_id && historyFor.local_date === o.local_date
              ? null
              : o,
          )
        }
      />
    );
  };
  const renderGrid = (list: DoseOccurrence[]) => (
    <div className="grid items-start gap-4 md:grid-cols-2">{list.map((o) => card(o, false))}</div>
  );
  const listed = new Set((medications ?? []).map((m) => m.id));
  const ready = !unavailable && !occ.isLoading && !occ.error;
  const dosesFor = (medicationId: string): ReactNode => {
    if (!ready) return null;
    const mine = (occ.data ?? []).filter((o) => o.medication_id === medicationId);
    if (!mine.length)
      return <p className="text-muted-foreground">No doses scheduled on this day.</p>;
    return <div className="space-y-3">{mine.map((o) => card(o, true))}</div>;
  };
  // doses whose medication isn't on the list stay visible on their own
  const orphans = (occ.data ?? []).filter((o) => !listed.has(o.medication_id));

  return (
    <section
      className={`mb-6 space-y-4 ${renderMedications ? "" : "max-w-4xl"}`}
      aria-labelledby="med-day-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="med-day-title" className="text-2xl font-semibold">
          Medication day
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            aria-label="Previous day"
            onClick={() => setDay(addDays(day, -1))}
          >
            ←
          </Button>
          <span className="min-w-28 text-center font-semibold">
            {day === today ? "Today" : day}
          </span>
          <Button variant="outline" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>
            →
          </Button>
        </div>
      </div>

      {unavailable ? (
        <Empty>Dose reporting is not switched on for this family yet.</Empty>
      ) : occ.isLoading ? (
        <Empty>Loading dose times…</Empty>
      ) : occ.error ? (
        <Empty>{(occ.error as Error).message}</Empty>
      ) : renderMedications ? (
        orphans.length > 0 ? (
          renderGrid(orphans)
        ) : null
      ) : (occ.data ?? []).length === 0 ? (
        <Empty>No dose times on this day.{isOrganizer ? " Add dose times below." : ""}</Empty>
      ) : (
        renderGrid(occ.data!)
      )}

      {renderMedications?.(dosesFor)}

      {historyFor && (
        <Panel className="space-y-2" aria-label="History">
          <p className="font-semibold">
            History · {historyFor.medication_name} · {historyFor.local_date}
          </p>
          {history.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <HistoryList entries={history.data ?? []} tz={timeZone} />
          )}
        </Panel>
      )}

      {dialog && (
        <ReportDialog
          key={`${dialog.o.schedule_id}-${dialog.o.local_date}-${dialog.mode}`}
          occurrence={dialog.o}
          mode={dialog.mode}
          needsReason={actionsFor(dialog.o, actor, now).lateOnly}
          busy={submit.isPending}
          error={dialogError}
          onSubmit={(s) => submit.mutate(s)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
