import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarCheck,
  CalendarX,
  MapPin,
  Pencil,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { AppointmentFlags } from "@/components/AppointmentFlags";
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
import { Button } from "@/components/ui/button";
import { isBlank, type Appointment } from "@/lib/appointments";
import { formatInZone } from "@/lib/zoned-time";
import { visitService } from "@/services";

type Confirm = "cancel" | "complete" | "archive" | null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-lg">{children}</div>
    </div>
  );
}
const NotSet = () => <span className="italic text-muted-foreground">Not set</span>;

/** The appointment part of a visit page: details, computed flags, and (organizer only) edit / cancel / archive. */
export function AppointmentSummary({
  visit,
  timeZone,
  canWrite,
  overlapCount,
}: {
  visit: Appointment;
  timeZone: string;
  canWrite: boolean;
  overlapCount: number;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["visits", visit.family_id] }),
      qc.invalidateQueries({ queryKey: ["visit", visit.id] }),
    ]);
  const run = useMutation({
    mutationFn: async (action: "cancel" | "complete" | "archive" | "unarchive") =>
      action === "cancel"
        ? visitService.cancelAppointment(visit.id)
        : action === "complete"
          ? visitService.completeAppointment(visit.id)
          : action === "archive"
            ? visitService.archiveAppointment(visit.id)
            : visitService.unarchiveAppointment(visit.id),
    onSuccess: async (_d, action) => {
      setConfirm(null);
      await refresh();
      toast.success(
        action === "cancel"
          ? "Appointment canceled"
          : action === "complete"
            ? "Marked as completed"
            : action === "archive"
              ? "Appointment archived"
              : "Appointment restored",
      );
    },
    onError: (e) => {
      setConfirm(null);
      toast.error((e as Error).message);
    },
  });

  const start = visit.scheduled_start;
  const when = start
    ? `${formatInZone(start, timeZone, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}${
        visit.scheduled_end
          ? ` to ${formatInZone(visit.scheduled_end, timeZone, { hour: "numeric", minute: "2-digit" })}`
          : ""
      }`
    : new Date(`${visit.date}T12:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
  const phoneDigits = visit.office_phone?.replace(/[^\d+]/g, "") ?? "";

  return (
    <section
      aria-label="Appointment details"
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-card"
    >
      <AppointmentFlags appointment={visit} overlapCount={overlapCount} />
      <Row label="When">{when}</Row>
      <Row label="Doctor or provider">
        {isBlank(visit.provider_name) ? <NotSet /> : visit.provider_name}
      </Row>
      {!isBlank(visit.office_name) && <Row label="Office">{visit.office_name}</Row>}
      <Row label="Address">
        {isBlank(visit.office_address) ? (
          <NotSet />
        ) : (
          <span className="inline-flex items-start gap-2">
            <MapPin className="mt-1 size-5 shrink-0" aria-hidden />
            <span className="whitespace-pre-line">{visit.office_address}</span>
          </span>
        )}
      </Row>
      <Row label="Phone">
        {isBlank(visit.office_phone) ? (
          <NotSet />
        ) : phoneDigits ? (
          <a
            href={`tel:${phoneDigits}`}
            className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline"
          >
            <Phone className="size-5" aria-hidden />
            {visit.office_phone}
          </a>
        ) : (
          visit.office_phone
        )}
      </Row>
      {!isBlank(visit.reason) && <Row label="Reason">{visit.reason}</Row>}
      {!isBlank(visit.notes) && (
        <Row label="Notes">
          <span className="whitespace-pre-line">{visit.notes}</span>
        </Row>
      )}

      {canWrite && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button asChild variant="outline" className="h-12">
            <Link to="/visits/edit/$id" params={{ id: visit.id }}>
              <Pencil /> Edit appointment
            </Link>
          </Button>
          {visit.status === "scheduled" && !visit.archived_at && (
            <Button type="button" className="h-12" onClick={() => setConfirm("complete")}>
              <CalendarCheck /> Mark visit completed
            </Button>
          )}
          {visit.status === "scheduled" && !visit.archived_at && (
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => setConfirm("cancel")}
            >
              <CalendarX /> Cancel appointment
            </Button>
          )}
          {visit.archived_at ? (
            <Button
              type="button"
              variant="outline"
              className="h-12"
              disabled={run.isPending}
              onClick={() => run.mutate("unarchive")}
            >
              <ArchiveRestore /> Restore from archive
            </Button>
          ) : visit.status !== "scheduled" ? (
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => setConfirm("archive")}
            >
              <Archive /> Archive
            </Button>
          ) : null}
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "cancel"
                ? "Cancel this appointment?"
                : confirm === "complete"
                  ? "Mark this visit as completed?"
                  : "Archive this appointment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "complete"
                ? "It moves to Past as completed. All its details stay as they are, and nothing is recorded or summarized automatically."
                : confirm === "cancel"
                  ? "It stays in your records, marked as canceled. This does not contact the office, so please cancel with them directly too."
                  : "It moves out of Upcoming and Past into Archived. Nothing is deleted, and you can restore it any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={run.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={run.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) run.mutate(confirm);
              }}
            >
              {confirm === "cancel"
                ? "Cancel appointment"
                : confirm === "complete"
                  ? "Mark completed"
                  : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
