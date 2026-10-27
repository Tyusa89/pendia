// Append-only history of one dose, oldest first. Presentational.
import {
  CHANGE_REASON_LABEL,
  NOT_GIVEN_REASON_LABEL,
  STATUS_LABEL,
  type DoseHistoryEntry,
} from "@/lib/dose-administration";

export function HistoryList({ entries, tz }: { entries: DoseHistoryEntry[]; tz: string }) {
  const when = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  return (
    <ol className="space-y-2" aria-label="Report history">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md bg-muted p-3">
          <p className="font-semibold">
            {e.entry_kind === "disagreement"
              ? `${e.reporter_name} flagged a disagreement`
              : `${e.reporter_name} reported ${STATUS_LABEL[e.status ?? "not_confirmed"].toLowerCase()}`}
          </p>
          <p className="text-[0.8235rem] text-muted-foreground">
            {when(e.reported_at)}
            {e.not_given_reason ? ` · ${NOT_GIVEN_REASON_LABEL[e.not_given_reason]}` : ""}
            {e.change_reason ? ` · ${CHANGE_REASON_LABEL[e.change_reason]}` : ""}
            {e.outside_window ? " · after the 48-hour window" : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
