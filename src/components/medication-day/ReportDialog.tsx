// Report / change / disagree dialog. Presentational: it hands the choice to its parent and knows nothing about storage.
// One request id is made per opening and reused if the same submission is retried, so a double tap never adds a second report.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CHANGE_REASONS,
  CHANGE_REASON_LABEL,
  NOT_GIVEN_REASONS,
  NOT_GIVEN_REASON_LABEL,
  REPORT_FOOTNOTE,
  STATUS_LABEL,
  formatLocalTime,
  type ChangeReason,
  type DoseOccurrence,
  type DoseStatus,
  type NotGivenReason,
} from "@/lib/dose-administration";

export type DialogMode = "report" | "change" | "flag";
export interface Submission {
  mode: DialogMode;
  status: DoseStatus;
  notGivenReason: NotGivenReason | null;
  changeReason: ChangeReason | null;
  requestId: string;
}

const selectClass = "h-12 w-full rounded-md border border-input bg-background px-3";

export function ReportDialog({
  occurrence: o,
  mode,
  needsReason,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  occurrence: DoseOccurrence;
  mode: DialogMode;
  /** an organizer correcting outside the 48-hour window must say why */
  needsReason: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (s: Submission) => void;
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<DoseStatus>(
    mode === "change" && o.status === "given" ? "not_given" : "given",
  );
  const [ngr, setNgr] = useState<NotGivenReason | "">("");
  const [cr, setCr] = useState<ChangeReason | "">("");
  const reasonRequired = mode === "change" || needsReason;
  const options: DoseStatus[] =
    mode === "change"
      ? (["given", "not_given", "not_confirmed"] as const).filter((s) => s !== o.status)
      : ["given", "not_given"];
  const ready = mode === "flag" || !reasonRequired || cr !== "";

  const title =
    mode === "report"
      ? "Report this dose"
      : mode === "change"
        ? "Change this report"
        : "Flag a disagreement";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {o.medication_name} {o.dose_text ?? ""} · {formatLocalTime(o.local_time)} ·{" "}
            {o.local_date}
          </DialogDescription>
        </DialogHeader>

        {mode === "flag" ? (
          <p>
            This tells the care team you think the current report may be wrong. It does not change
            the report. An organizer or the person who reported it can change it.
          </p>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="font-semibold">What happened?</legend>
              {options.map((s) => (
                <label
                  key={s}
                  className="flex min-h-12 items-center gap-3 rounded-md border border-input px-3"
                >
                  <input
                    type="radio"
                    name="dose-status"
                    checked={status === s}
                    onChange={() => setStatus(s)}
                  />
                  <span>
                    {s === "not_confirmed"
                      ? "Withdraw my report (back to Not confirmed)"
                      : STATUS_LABEL[s]}
                  </span>
                </label>
              ))}
            </fieldset>
            {status === "not_given" && (
              <div className="space-y-1">
                <Label htmlFor="ngr">Reason (optional)</Label>
                <select
                  id="ngr"
                  className={selectClass}
                  value={ngr}
                  onChange={(e) => setNgr(e.target.value as NotGivenReason | "")}
                >
                  <option value="">No reason chosen</option>
                  {NOT_GIVEN_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {NOT_GIVEN_REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {reasonRequired && (
              <div className="space-y-1">
                <Label htmlFor="cr">
                  Why are you {mode === "change" ? "changing this" : "reporting this late"}?
                </Label>
                <select
                  id="cr"
                  className={selectClass}
                  value={cr}
                  onChange={(e) => setCr(e.target.value as ChangeReason | "")}
                >
                  <option value="">Choose a reason</option>
                  {CHANGE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {CHANGE_REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[0.8235rem] text-muted-foreground">{REPORT_FOOTNOTE}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-2 font-medium text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !ready}
            onClick={() =>
              onSubmit({
                mode,
                status,
                notGivenReason: status === "not_given" && ngr ? ngr : null,
                changeReason: reasonRequired && cr ? cr : null,
                requestId,
              })
            }
          >
            {busy ? "Saving…" : mode === "flag" ? "Flag for review" : "Save report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
