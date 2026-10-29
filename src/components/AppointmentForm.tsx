import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  clean,
  isBlank,
  overlapsWithProposed,
  type Appointment,
  type AppointmentInput,
} from "@/lib/appointments";
import { formatInZone, fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

export type HintState = "extracted" | "unclear" | "missing";
export interface FormPrefill {
  provider_name?: string | null;
  office_address?: string | null;
  notes?: string | null;
  /** ISO instant; shown in the family's time zone. */
  scheduled_start?: string | null;
}
const HINT_TEXT: Record<HintState, string> = {
  extracted: "Read from your document. Please check it.",
  unclear: "Hard to read in the document. Please check it carefully.",
  missing: "Not found in the document. Fill it in if you know it.",
};
function Hint({ state }: { state: HintState | undefined }) {
  if (!state) return null;
  return (
    <p className="text-sm font-semibold text-muted-foreground" data-testid={`hint-${state}`}>
      {HINT_TEXT[state]}
    </p>
  );
}

interface Props {
  /** Present when editing. */
  initial?: Appointment | undefined;
  timeZone: string;
  /** Other appointments, for the live (non-blocking) overlap warning. */
  others: Appointment[];
  busy?: boolean;
  error?: string | null;
  submitLabel: string;
  /** Suggested values from a document. Only a starting point: the caregiver edits and must press the submit button. */
  prefill?: FormPrefill | undefined;
  /** Where each prefilled value came from (extracted / unclear / missing). */
  hints?: Partial<Record<"start" | "provider" | "address" | "notes", HintState>> | undefined;
  onSubmit: (input: AppointmentInput) => void;
  onCancel: () => void;
}

const NOT_SET = "Not set. This appointment will show as incomplete until it is filled in.";

/**
 * Create/edit form. Only the date and time are required: provider, address and phone may be left blank (the
 * appointment is then flagged incomplete) and are never filled in for the caregiver.
 */
export function AppointmentForm({
  initial,
  timeZone,
  others,
  busy = false,
  error,
  submitLabel,
  prefill,
  hints,
  onSubmit,
  onCancel,
}: Props) {
  const [provider, setProvider] = useState(initial?.provider_name ?? prefill?.provider_name ?? "");
  const [officeName, setOfficeName] = useState(initial?.office_name ?? "");
  const [address, setAddress] = useState(initial?.office_address ?? prefill?.office_address ?? "");
  const [phone, setPhone] = useState(initial?.office_phone ?? "");
  const [start, setStart] = useState(
    toZonedInputValue(initial?.scheduled_start ?? prefill?.scheduled_start, timeZone),
  );
  const [end, setEnd] = useState(toZonedInputValue(initial?.scheduled_end, timeZone));
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? prefill?.notes ?? "");
  const [confirmed, setConfirmed] = useState(initial?.confirmation_status === "confirmed");
  const [problem, setProblem] = useState<string | null>(null);

  const startIso = fromZonedInputValue(start, timeZone);
  const endIso = end ? fromZonedInputValue(end, timeZone) : null;
  const overlaps = useMemo(
    () => overlapsWithProposed(others, { start: startIso, end: endIso }, initial?.id),
    [others, startIso, endIso, initial?.id],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!start) return setProblem("Choose a date and time for the appointment.");
    if (!startIso)
      return setProblem(
        "That start time doesn't exist (clocks change that day). Please pick another time.",
      );
    if (end && !endIso)
      return setProblem("That end time isn't valid. Please check it or leave it blank.");
    if (endIso && Date.parse(endIso) < Date.parse(startIso))
      return setProblem("The end time can't be before the start time.");
    setProblem(null);
    onSubmit({
      provider_name: clean(provider),
      office_name: clean(officeName),
      office_address: clean(address),
      office_phone: clean(phone),
      scheduled_start: startIso,
      scheduled_end: endIso,
      reason: clean(reason),
      notes: clean(notes),
      confirmation_status: confirmed ? "confirmed" : "unconfirmed",
    });
  }

  const hint = (blank: boolean) =>
    blank ? <p className="text-sm text-muted-foreground">{NOT_SET}</p> : null;
  const field = "space-y-2";

  return (
    <form
      onSubmit={submit}
      className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0"
      noValidate
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-2">
        <div className={field}>
          <Label htmlFor="appt-start" className="text-base">
            Starts
          </Label>
          <Input
            id="appt-start"
            type="datetime-local"
            className="h-12 text-base"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
          <p className="text-sm text-muted-foreground">
            Times are in your family's timezone ({timeZone.replace(/_/g, " ")}).
          </p>
          <Hint state={hints?.start} />
        </div>
        <div className={field}>
          <Label htmlFor="appt-end" className="text-base">
            Ends (optional)
          </Label>
          <Input
            id="appt-end"
            type="datetime-local"
            className="h-12 text-base"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div className={field}>
        <Label htmlFor="appt-provider" className="text-base">
          Doctor or provider
        </Label>
        <Input
          id="appt-provider"
          className="h-12 text-base"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          autoComplete="off"
        />
        {hint(isBlank(provider))}
        <Hint state={hints?.provider} />
      </div>
      <div className={field}>
        <Label htmlFor="appt-office" className="text-base">
          Office or clinic name
        </Label>
        <Input
          id="appt-office"
          className="h-12 text-base"
          value={officeName}
          onChange={(e) => setOfficeName(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className={field}>
        <Label htmlFor="appt-address" className="text-base">
          Office address
        </Label>
        <Textarea
          id="appt-address"
          className="min-h-20 text-base"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        {hint(isBlank(address))}
        <Hint state={hints?.address} />
      </div>
      <div className={field}>
        <Label htmlFor="appt-phone" className="text-base">
          Office phone
        </Label>
        <Input
          id="appt-phone"
          type="tel"
          inputMode="tel"
          className="h-12 text-base"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
        />
        {hint(isBlank(phone))}
      </div>
      <div className={field}>
        <Label htmlFor="appt-reason" className="text-base">
          Reason for the visit
        </Label>
        <Input
          id="appt-reason"
          className="h-12 text-base"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className={`${field} lg:col-span-2`}>
        <Label htmlFor="appt-notes" className="text-base">
          Notes
        </Label>
        <Textarea
          id="appt-notes"
          className="min-h-24 text-base"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Hint state={hints?.notes} />
      </div>

      <label className="flex items-start gap-3 rounded-xl border p-3 lg:col-span-2">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          <span className="font-semibold">Confirmed with the office</span>
          <span className="block text-sm text-muted-foreground">
            Tick this once someone has confirmed the appointment with the office.
          </span>
        </span>
      </label>

      {overlaps.length > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-xl bg-unassigned p-3 text-unassigned-foreground lg:col-span-2"
          data-testid="form-overlap-warning"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Heads up: this overlaps with{" "}
            {overlaps
              .map(
                (o) =>
                  `${o.provider_name?.trim() || "another appointment"} (${o.scheduled_start ? formatInZone(o.scheduled_start, timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" }) : o.date})`,
              )
              .join(", ")}
            . You can still save it.
          </p>
        </div>
      )}
      {(problem || error) && (
        <p role="alert" className="rounded-xl bg-warning p-3 text-warning-foreground lg:col-span-2">
          {problem ?? error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:col-span-2">
        <Button type="submit" size="lg" className="h-14" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-14"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
