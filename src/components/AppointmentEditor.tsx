import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppointmentForm } from "@/components/AppointmentForm";
import { Empty } from "@/components/AppShell";
import type { AppointmentInput } from "@/lib/appointments";
import { visitService } from "@/services";

/** Loads what the form needs and saves. Organizer only; RLS enforces the same rule in the database. */
export function AppointmentEditor({
  familyId,
  timeZone,
  canWrite,
  appointmentId,
  onDone,
  onCancel,
}: {
  familyId: string;
  timeZone: string;
  canWrite: boolean;
  appointmentId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useQuery({
    queryKey: ["visits", familyId],
    queryFn: () => visitService.list(familyId),
  });
  const existing = appointmentId ? all.find((v) => v.id === appointmentId) : undefined;

  const save = useMutation({
    mutationFn: (input: AppointmentInput) =>
      appointmentId
        ? visitService.updateAppointment(appointmentId, input)
        : visitService.createAppointment(familyId, input),
    onSuccess: async (row) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["visits", familyId] }),
        qc.invalidateQueries({ queryKey: ["visit", row.id] }),
      ]);
      toast.success(appointmentId ? "Appointment updated" : "Appointment added");
      onDone(row.id);
    },
  });

  if (!canWrite) return <Empty>Only the organizer can add or change appointments.</Empty>;
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (appointmentId && !existing) return <Empty>That appointment couldn't be found.</Empty>;

  return (
    <AppointmentForm
      initial={existing}
      timeZone={timeZone}
      others={all}
      busy={save.isPending}
      error={save.error ? (save.error as Error).message : null}
      submitLabel={appointmentId ? "Save changes" : "Add appointment"}
      onSubmit={(input) => save.mutate(input)}
      onCancel={onCancel}
    />
  );
}
