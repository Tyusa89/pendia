// One computed dose time on one day. Presentational only: no data access, so Demo Mode can reuse it.
// A caregiver's report is shown as a report; "Not confirmed" is the honest state of a dose nobody has reported.
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/AppShell";
import {
  CHANGE_REASON_LABEL,
  NOT_CONFIRMED_DETAIL,
  NOT_GIVEN_REASON_LABEL,
  REPORT_FOOTNOTE,
  STATUS_LABEL,
  formatLocalTime,
  reportLine,
  type Actions,
  type DoseOccurrence,
} from "@/lib/dose-administration";

const badge: Record<DoseOccurrence["status"], string> = {
  given: "bg-success text-success-foreground",
  not_given: "bg-warning text-warning-foreground",
  not_confirmed: "bg-muted text-muted-foreground",
};

export interface OccurrenceCardProps {
  occurrence: DoseOccurrence;
  actions: Actions;
  onReport: () => void;
  onChange: () => void;
  onFlag: () => void;
  onHistory: () => void;
}

export function OccurrenceCard({
  occurrence: o,
  actions,
  onReport,
  onChange,
  onFlag,
  onHistory,
}: OccurrenceCardProps) {
  return (
    <Panel
      className="space-y-3"
      aria-label={`${o.medication_name} at ${formatLocalTime(o.local_time)}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-[0.8235rem] font-bold text-muted-foreground">
            {formatLocalTime(o.local_time)}
          </p>
          <p className="break-words text-xl font-semibold">
            {o.medication_name}{" "}
            {o.dose_text && (
              <span className="font-normal text-muted-foreground">{o.dose_text}</span>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[0.8235rem] font-bold ${badge[o.status]}`}
        >
          {STATUS_LABEL[o.status]}
        </span>
      </div>

      <p className="text-muted-foreground">
        {o.status === "not_confirmed" && !o.reported_at ? NOT_CONFIRMED_DETAIL : reportLine(o)}
      </p>
      {o.status === "not_given" && o.not_given_reason && (
        <p className="text-muted-foreground">
          Reason: {NOT_GIVEN_REASON_LABEL[o.not_given_reason]}
        </p>
      )}
      {o.change_reason && (
        <p className="text-muted-foreground">Changed: {CHANGE_REASON_LABEL[o.change_reason]}</p>
      )}
      {o.time_state === "ambiguous" && (
        <p className="text-muted-foreground">
          This time happens twice today because the clocks change. The earlier one is used.
        </p>
      )}
      {o.reports_differ && (
        <p role="status" className="rounded-md bg-warning/20 p-2 font-medium">
          Caregivers' reports differ. An organizer should review the history.
        </p>
      )}
      {o.open_disagreements > 0 && !o.reports_differ && (
        <p role="status" className="rounded-md bg-warning/20 p-2 font-medium">
          {o.open_disagreements === 1
            ? "A caregiver flagged this for review."
            : `${o.open_disagreements} caregivers flagged this for review.`}
        </p>
      )}
      {o.reported_at && <p className="text-[0.8235rem] text-muted-foreground">{REPORT_FOOTNOTE}</p>}

      <div className="flex flex-wrap gap-2">
        {actions.report && <Button onClick={onReport}>Report this dose</Button>}
        {actions.change && (
          <Button variant="outline" onClick={onChange}>
            Change report
          </Button>
        )}
        {actions.flag && (
          <Button variant="outline" onClick={onFlag}>
            I disagree
          </Button>
        )}
        {o.history_count > 0 && (
          <Button variant="ghost" onClick={onHistory}>
            History ({o.history_count})
          </Button>
        )}
      </div>
      {actions.why && !actions.report && !actions.change && !actions.flag && (
        <p className="text-[0.8235rem] text-muted-foreground">{actions.why}</p>
      )}
    </Panel>
  );
}
