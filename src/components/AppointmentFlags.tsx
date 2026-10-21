import { AlertTriangle, CalendarClock } from "lucide-react";
import { missingFields, type Appointment, type MissingField } from "@/lib/appointments";

const LABEL: Record<MissingField, string> = {
  provider: "provider",
  address: "address",
  phone: "phone number",
};

/** Status + incomplete + overlap indicators. Everything shown here is computed from the row; nothing is stored. */
export function AppointmentFlags({
  appointment,
  overlapCount = 0,
}: {
  appointment: Appointment;
  overlapCount?: number;
}) {
  const missing = missingFields(appointment);
  const chip = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold";
  return (
    <div className="flex flex-wrap gap-2">
      {appointment.status === "canceled" && (
        <span className={`${chip} bg-destructive text-destructive-foreground`}>Canceled</span>
      )}
      {appointment.status === "completed" && (
        <span className={`${chip} bg-muted text-muted-foreground`}>Completed</span>
      )}
      {appointment.archived_at && (
        <span className={`${chip} bg-muted text-muted-foreground`}>Archived</span>
      )}
      {appointment.status === "scheduled" && (
        <span
          className={`${chip} ${appointment.confirmation_status === "confirmed" ? "bg-success text-success-foreground" : "bg-secondary text-secondary-foreground"}`}
        >
          {appointment.confirmation_status === "confirmed"
            ? "Confirmed with the office"
            : "Not confirmed yet"}
        </span>
      )}
      {missing.length > 0 && (
        <span
          className={`${chip} bg-warning text-warning-foreground`}
          data-testid="incomplete-flag"
        >
          <AlertTriangle className="size-4" aria-hidden /> Incomplete: missing{" "}
          {missing.map((m) => LABEL[m]).join(", ")}
        </span>
      )}
      {overlapCount > 0 && (
        <span
          className={`${chip} bg-unassigned text-unassigned-foreground`}
          data-testid="overlap-flag"
        >
          <CalendarClock className="size-4" aria-hidden /> Overlaps with{" "}
          {overlapCount === 1 ? "another appointment" : `${overlapCount} other appointments`}
        </span>
      )}
    </div>
  );
}
