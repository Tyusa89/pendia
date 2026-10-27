// Synthetic medication day. Reuses the real presentational pieces; imports no data layer (a test enforces that).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card as Panel } from "@/components/medication-day/Card";
import { OccurrenceCard } from "@/components/medication-day/OccurrenceCard";
import {
  ReportDialog,
  type DialogMode,
  type Submission,
} from "@/components/medication-day/ReportDialog";
import { HistoryList } from "@/components/medication-day/HistoryList";
import { DOSE_ERROR_TEXT, actionsFor, type DoseOccurrence } from "@/lib/dose-administration";
import {
  DEMO_DATE,
  DEMO_MEMBERS,
  DEMO_NOW_MS,
  DEMO_TZ,
  historyOf,
  occurrencesOf,
  reduce,
  type Action,
  type DemoMemberId,
  type DemoState,
} from "@/lib/med-demo/state";
import { clear, restore, save } from "@/lib/med-demo/persist";

export function MedDayDemo() {
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DemoState>(restore);
  // The rules run in the event handler (not inside a reducer) so the message and the new state always agree.
  const dispatch = (a: Action) => {
    const out = reduce(state, a);
    setState(out.state);
    setError(out.error ? DOSE_ERROR_TEXT[out.error] : null);
  };
  const [dialog, setDialog] = useState<{ o: DoseOccurrence; mode: DialogMode } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  useEffect(() => save(state), [state]);

  const actor = DEMO_MEMBERS.find((m) => m.id === state.actor)!;
  const occ = occurrencesOf(state);
  const who = { isOrganizer: actor.role === "organizer", canSeeMeds: true, memberId: actor.id };

  const submit = (s: Submission) => {
    const o = dialog!.o;
    dispatch(
      s.mode === "flag"
        ? { type: "flag", scheduleId: o.schedule_id, expectedHead: o.head_id }
        : {
            type: "report",
            scheduleId: o.schedule_id,
            expectedHead: o.head_id,
            status: s.status,
            notGivenReason: s.notGivenReason,
            changeReason: s.changeReason,
          },
    );
    setDialog(null);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Panel className="space-y-2" aria-label="About this demo">
        <p className="font-semibold">
          Demo with made-up people and medications. Nothing is saved or sent.
        </p>
        <p className="text-muted-foreground">
          It is{" "}
          {new Intl.DateTimeFormat(undefined, {
            timeZone: DEMO_TZ,
            hour: "numeric",
            minute: "2-digit",
          }).format(DEMO_NOW_MS)}{" "}
          on {DEMO_DATE}. A dose nobody has reported stays "Not confirmed". A report is a family
          member's word, and no AI marks any dose.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="demo-actor">You are</Label>
            <select
              id="demo-actor"
              className="h-12 rounded-md border border-input bg-background px-3"
              value={state.actor}
              onChange={(e) => dispatch({ type: "actor", actor: e.target.value as DemoMemberId })}
            >
              {DEMO_MEMBERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role === "organizer" ? "organizer" : "family member"})
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              clear();
              dispatch({ type: "reset" });
              setHistoryFor(null);
            }}
          >
            Start over
          </Button>
        </div>
      </Panel>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        {occ.map((o) => (
          <OccurrenceCard
            key={o.schedule_id}
            occurrence={o}
            actions={actionsFor(o, who, DEMO_NOW_MS)}
            onReport={() => setDialog({ o, mode: "report" })}
            onChange={() => setDialog({ o, mode: "change" })}
            onFlag={() => setDialog({ o, mode: "flag" })}
            onHistory={() => setHistoryFor(historyFor === o.schedule_id ? null : o.schedule_id)}
          />
        ))}
      </div>

      {historyFor && (
        <Panel className="space-y-2" aria-label="History">
          <p className="font-semibold">History</p>
          <HistoryList entries={historyOf(state, historyFor)} tz={DEMO_TZ} />
        </Panel>
      )}

      {dialog && (
        <ReportDialog
          key={`${dialog.o.schedule_id}-${dialog.mode}`}
          occurrence={dialog.o}
          mode={dialog.mode}
          needsReason={false}
          busy={false}
          error={null}
          onSubmit={submit}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
