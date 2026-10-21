import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  missingFromShift,
  overlapsForMember,
  validateShiftTimes,
  type ShiftRow,
} from "@/lib/shifts";
import { formatInZone, fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";
import { shiftService, type Member } from "@/services";

export const shiftRange = (s: Pick<ShiftRow, "start" | "end">, tz: string) => {
  const day = (iso: string) =>
    formatInZone(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = (iso: string) => formatInZone(iso, tz, { hour: "numeric", minute: "2-digit" });
  const nextDay = day(s.start) !== day(s.end);
  return `${formatInZone(s.start, tz, { weekday: "short", month: "short", day: "numeric" })} · ${time(s.start)} – ${time(s.end)}${nextDay ? " (next day)" : ""}`;
};

export function NeedsCompletion({
  shift,
}: {
  shift: { end?: string | null; assigned_member_id?: string | null };
}) {
  const missing = missingFromShift(shift);
  if (!missing.length) return null;
  return (
    <span
      data-testid="needs-completion"
      className="inline-flex items-center gap-1.5 rounded-full bg-warning px-3 py-1 text-[0.8235rem] font-bold text-warning-foreground"
    >
      <AlertTriangle className="size-3.5" aria-hidden />
      Needs completion: no {missing.join(" or ")}
    </span>
  );
}

const OPEN = "__open__";

/**
 * Create or edit one coverage shift. Organizer only (the database refuses anyone else; the page also only offers this to
 * organizers). Times are typed in the family's timezone. Overlaps for the same person are flagged, never blocked.
 */
export function ShiftEditor({
  familyId,
  timeZone,
  members,
  weekShifts,
  shift,
  defaults,
  onClose,
  onSaved,
}: {
  familyId: string;
  timeZone: string;
  members: Pick<Member, "id" | "name">[];
  /** Shifts already loaded for the visible week, used for the live overlap hint. */
  weekShifts: ShiftRow[];
  /** Present when editing; absent when creating. */
  shift?: ShiftRow | undefined;
  /** Starting values when creating (datetime-local strings in the family timezone). */
  defaults?: { start: string; end: string } | undefined;
  onClose: () => void;
  onSaved: (saved: ShiftRow) => void;
}) {
  const qc = useQueryClient();
  const [start, setStart] = useState(
    shift ? toZonedInputValue(shift.start, timeZone) : (defaults?.start ?? ""),
  );
  const [end, setEnd] = useState(
    shift ? toZonedInputValue(shift.end, timeZone) : (defaults?.end ?? ""),
  );
  const [who, setWho] = useState(shift?.assigned_member_id ?? OPEN);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const startIso = fromZonedInputValue(start, timeZone);
  const endIso = fromZonedInputValue(end, timeZone);
  const memberId = who === OPEN ? null : who;
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Someone";

  const overlaps = useMemo(
    () =>
      startIso && endIso && Date.parse(endIso) > Date.parse(startIso)
        ? overlapsForMember(weekShifts, memberId, startIso, endIso, shift?.id)
        : [],
    [weekShifts, memberId, startIso, endIso, shift?.id],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["shifts", familyId] });

  const save = useMutation({
    mutationFn: async () => {
      // The service validates again; this just turns bad input into a friendly message before any request.
      const t = validateShiftTimes(startIso, endIso);
      const input = { ...t, assigned_member_id: memberId };
      return shift
        ? shiftService.updateShift(shift.id, input)
        : shiftService.createShift(familyId, input);
    },
    onSuccess: async ({ shift: saved, overlaps: found }) => {
      await refresh();
      toast.success(shift ? "Shift saved" : "Shift added");
      if (found.length)
        toast.warning(
          `${nameOf(saved.assigned_member_id)} is also scheduled ${shiftRange(found[0]!, timeZone)}. Saved anyway; please check.`,
        );
      onSaved(saved);
    },
    onError: (e) => setError((e as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () => shiftService.cancelShift(shift!.id),
    onSuccess: async () => {
      setConfirmCancel(false);
      await refresh();
      toast.success("Shift canceled");
      onClose();
    },
    onError: (e) => {
      setConfirmCancel(false);
      setError((e as Error).message);
    },
  });

  const draft = { end: endIso, assigned_member_id: memberId };

  return (
    <form
      aria-label={shift ? "Edit shift" : "Add shift"}
      className="mb-4 space-y-4 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="space-y-2">
        <h2 className="font-sans text-lg font-bold tracking-normal">
          {shift ? "Edit shift" : "Add shift"}
        </h2>
        {missingFromShift(draft).length > 0 && <NeedsCompletion shift={draft} />}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="shift-start" className="text-base">
          Starts
        </Label>
        <Input
          id="shift-start"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shift-end" className="text-base">
          Ends
        </Label>
        <Input
          id="shift-end"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <p className="text-[0.9412rem] text-muted-foreground">
          Times are in your family's time zone ({timeZone.replace(/_/g, " ")}). For a night shift,
          set the end on the next day.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shift-who" className="text-base">
          Caregiver
        </Label>
        <select
          id="shift-who"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="flex h-12 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 text-base"
        >
          <option value={OPEN}>Open (no one yet)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {overlaps.length > 0 && (
        <p
          data-testid="shift-overlap"
          role="status"
          className="flex gap-2 rounded-2xl bg-warning p-3.5 text-warning-foreground"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            {nameOf(memberId)} is already scheduled {shiftRange(overlaps[0]!, timeZone)}. You can
            still save this.
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={save.isPending}>
          {shift ? "Save shift" : "Add shift"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {shift && (
          <Button
            type="button"
            variant="outline"
            className="border-destructive text-destructive"
            onClick={() => setConfirmCancel(true)}
          >
            <Trash2 /> Cancel this shift
          </Button>
        )}
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              The shift is removed from the schedule. This does not notify anyone, so please let the
              caregiver know.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={(e) => {
                e.preventDefault();
                cancel.mutate();
              }}
            >
              Cancel shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
