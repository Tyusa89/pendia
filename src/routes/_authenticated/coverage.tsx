import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { useMembers } from "@/hooks/use-family";
import {
  BLOCKS,
  blockOf,
  coverageSummary,
  isActive,
  isOpen,
  missingFromShift,
  mondayInZone,
  overlapsForMember,
  shiftWeek,
  validateShift,
  weekDays,
  weekRange,
} from "@/lib/shifts";
import { NeedsCompletion, shiftRange } from "@/components/NeedsCompletion";
import { dateInZone, formatInZone, toZonedInputValue } from "@/lib/zoned-time";
import { shiftService, type Family, type Member, type Shift } from "@/services";

export const Route = createFileRoute("/_authenticated/coverage")({
  head: () => ({
    meta: [
      { title: "Coverage — Pendia" },
      { name: "description", content: "Who is with your loved one this week." },
    ],
  }),
  component: () => (
    <WithFamily>{({ me, family }) => <Coverage me={me} family={family} />}</WithFamily>
  ),
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const dayLabel = (ymd: string, weekday: "short" | "long") =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday, timeZone: "UTC" });

type Editing = { id?: string; date: string; startTime: string; endTime: string; memberId: string };

function Coverage({ me, family }: { me: Member; family: Family }) {
  const tz = family.timezone || "America/New_York";
  const organizer = me.role === "organizer";
  const qc = useQueryClient();
  const [monday, setMonday] = useState(() => mondayInZone(new Date(), tz));
  const { from, to } = weekRange(monday, tz);
  const key = ["shifts", me.family_id, monday];
  const { data: all = [] } = useQuery({
    queryKey: key,
    queryFn: () => shiftService.listRange(me.family_id, from, to),
  });
  const shifts = all.filter(isActive);
  const { data: members = [] } = useMembers(me.family_id);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["shifts", me.family_id] });

  const claim = useMutation({
    mutationFn: (id: string) => shiftService.claim(id, me.id),
    onSuccess: () => toast.success("You're covering it — thank you"),
    onError: (e) => toast.error((e as Error).message),
    onSettled: refresh,
  });
  const save = useMutation({
    mutationFn: async (e: Editing) => {
      const v = validateShift(e, tz); // time rules; the service validates again and checks the assignee's family
      if (!v.ok) throw new Error(v.error);
      const input = { start: v.start, end: v.end, assigned_member_id: e.memberId || null };
      return e.id ? shiftService.updateShift(e.id, input) : shiftService.createShift(me.family_id, input);
    },
    onSuccess: ({ shift: saved, overlaps }) => {
      toast.success("Shift saved");
      // Overlaps for the same person are flagged, never blocked.
      if (overlaps.length)
        toast.warning(
          `${members.find((m) => m.id === saved.assigned_member_id)?.name ?? "Someone"} is also scheduled ${shiftRange(overlaps[0]!, tz)}. Saved anyway; please check.`,
        );
      setEditing(null);
    },
    onError: (e) => setFormError((e as Error).message),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => shiftService.cancelShift(id),
    onSuccess: () => {
      toast.success("Shift canceled");
      setConfirmCancel(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: refresh,
  });

  const days = weekDays(monday);
  const inCell = (day: string, block: string) =>
    shifts.filter((s) => dateInZone(s.start, tz) === day && blockOf(s.start, tz) === block);
  const time = (iso: string) => formatInZone(iso, tz, { hour: "numeric", minute: "2-digit" });
  const openShift = (s: Shift) => {
    setFormError("");
    setEditing({
      id: s.id,
      date: dateInZone(s.start, tz),
      startTime: toZonedInputValue(s.start, tz).slice(11),
      endTime: toZonedInputValue(s.end, tz).slice(11),
      memberId: s.assigned_member_id ?? "",
    });
  };
  const newShift = (date = days[0]!, block: (typeof BLOCKS)[number] = BLOCKS[0]) => {
    setFormError("");
    setEditing({ date, startTime: block.start, endTime: block.end, memberId: "" });
  };
  const openList = shifts.filter(isOpen);
  const draftRange = editing ? validateShift(editing, tz) : null;
  const liveOverlap =
    editing && draftRange?.ok
      ? overlapsForMember(shifts, editing.memberId || null, draftRange.start, draftRange.end, editing.id)
      : [];
  const draftMissing = editing
    ? missingFromShift({ end: editing.endTime || null, assigned_member_id: editing.memberId || null })
    : [];
  const current = editing?.id ? shifts.find((s) => s.id === editing.id) : undefined;

  return (
    <>
      <PageTitle title="Coverage" subtitle={coverageSummary(shifts)} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button size="icon" variant="ghost" onClick={() => setMonday(shiftWeek(monday, -1))} aria-label="Previous week">
          <ChevronLeft />
        </Button>
        <p className="text-center font-semibold">
          Week of{" "}
          {new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>
        <Button size="icon" variant="ghost" onClick={() => setMonday(shiftWeek(monday, 1))} aria-label="Next week">
          <ChevronRight />
        </Button>
      </div>
      {organizer && (
        <Button className="mb-3 w-full" onClick={() => newShift()}>
          <Plus /> Add shift
        </Button>
      )}
      <section aria-label="This week" className="space-y-4 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card">
        <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-1 md:grid-cols-[5rem_repeat(7,minmax(0,1fr))] md:gap-1.5">
          <span />
          {days.map((d) => (
            <span key={d} className="flex flex-col items-center justify-center rounded-lg py-1 text-[0.8235rem] font-bold leading-tight">
              {dayLabel(d, "short")}
              <span className="font-medium text-muted-foreground">{Number(d.slice(8))}</span>
            </span>
          ))}
          {BLOCKS.map((b) => (
            <Row key={b.key} label={b.label} short={b.short} hint={b.hint}>
              {days.map((d) => {
                const cell = inCell(d, b.key);
                const where = `${dayLabel(d, "long")} ${b.label}`;
                if (!cell.length)
                  return organizer ? (
                    <button
                      key={d}
                      type="button"
                      onClick={() => newShift(d, b)}
                      aria-label={`${where}: no shift. Tap to add one`}
                      className="min-h-12 rounded-lg bg-muted transition-colors hover:bg-accent md:min-h-14"
                    />
                  ) : (
                    <span key={d} className="min-h-12 rounded-lg bg-muted md:min-h-14" aria-label={`${where}, no shift`} />
                  );
                return (
                  <div key={d} className="flex min-w-0 flex-col gap-1">
                    {cell.map((s) => {
                      const who = members.find((m) => m.id === s.assigned_member_id);
                      const mine = who?.id === me.id;
                      const range = `${time(s.start)}–${time(s.end)}`;
                      const onClick = organizer ? () => openShift(s) : !who ? () => claim.mutate(s.id) : undefined;
                      const cls = `relative flex min-h-12 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg p-0.5 text-center text-[0.8235rem] font-bold leading-tight md:min-h-14 md:text-[0.9412rem] ${
                        !who
                          ? "border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned text-unassigned-foreground"
                          : mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground"
                      }`;
                      const content = (
                        <>
                          {!who && (
                            <span
                              aria-hidden
                              data-testid="needs-completion-dot"
                              className="absolute right-1 top-1 size-2.5 rounded-full bg-warning ring-1 ring-warning-foreground/40"
                            />
                          )}
                          <span aria-hidden className="md:hidden">{!who ? "+" : mine ? "You" : initials(who.name)}</span>
                          <span aria-hidden className="hidden truncate md:inline">{!who ? "Open" : mine ? "You" : who.name.split(" ")[0]}</span>
                        </>
                      );
                      const label = `${where} ${range}: ${!who ? "open" : mine ? "you" : who.name}`;
                      return onClick ? (
                        <button
                          key={s.id}
                          type="button"
                          onClick={onClick}
                          disabled={claim.isPending}
                          title={who?.name}
                          aria-label={organizer ? `${label}. Tap to edit` : `${label}. Tap to cover it`}
                          className={`${cls} cursor-pointer`}
                        >
                          {content}
                        </button>
                      ) : (
                        <span key={s.id} title={who?.name} aria-label={label} className={cls}>
                          {content}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </Row>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9412rem] text-muted-foreground">
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded bg-primary" />You</li>
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded bg-secondary" />Family</li>
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned" />Open</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warning ring-1 ring-warning-foreground/40" />Needs completion</li>
        </ul>
      </section>
      {shifts.length > 0 && (
        <section aria-label="Shifts this week" className="mt-4 space-y-3 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card">
          <h2 className="font-sans text-base font-bold tracking-normal">Shifts this week</h2>
          <ul className="divide-y">
            {shifts.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 space-y-1">
                  <p className="font-bold">{shiftRange(s, tz)}</p>
                  <p className="text-muted-foreground">
                    {s.assigned_member_id ? (members.find((m) => m.id === s.assigned_member_id)?.name ?? "A family member") : "Open"}
                  </p>
                  <NeedsCompletion shift={s} />
                </div>
                {organizer && (
                  <Button variant="outline" onClick={() => openShift(s)} aria-label={`Edit ${shiftRange(s, tz)}`}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {openList.length > 0 && (
        <section aria-label="Still open this week" className="mt-4 space-y-2 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card">
          <h2 className="font-sans text-base font-bold tracking-normal">Still open this week</h2>
          {openList.map((s) => {
            const label = `${dayLabel(dateInZone(s.start, tz), "short")} · ${time(s.start)}–${time(s.end)}`;
            return (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <p className="min-w-0">{label}</p>
                <Button variant="outline" disabled={claim.isPending} onClick={() => claim.mutate(s.id)} aria-label={`Cover ${label}`}>
                  Cover it
                </Button>
              </div>
            );
          })}
        </section>
      )}
      <section aria-label="Leaving soon" className="mt-4 space-y-2 rounded-[1.25rem] bg-primary/10 p-[1.125rem]">
        <h2 className="font-sans text-base font-bold tracking-normal">Leaving soon?</h2>
        <p>A quick handoff tells the next person how she's doing.</p>
        <Button asChild size="lg" className="w-full">
          <Link to="/handoffs">Hand off my shift</Link>
        </Button>
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setFormError("");
                save.mutate(editing);
              }}
            >
              <DialogHeader>
                <DialogTitle>{editing.id ? "Edit shift" : "Add shift"}</DialogTitle>
                <DialogDescription>Times are in the family's time zone ({tz}). For a night shift, set the end earlier than the start and it ends the next day.</DialogDescription>
                {draftMissing.length > 0 && <NeedsCompletion shift={{ end: editing.endTime || null, assigned_member_id: editing.memberId || null }} />}
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="shift-date">Date</Label>
                <Input id="shift-date" type="date" required value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="shift-start">Start</Label>
                  <Input id="shift-start" type="time" required value={editing.startTime} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shift-end">End</Label>
                  <Input id="shift-end" type="time" required value={editing.endTime} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-who">Caregiver</Label>
                <select
                  id="shift-who"
                  value={editing.memberId}
                  onChange={(e) => setEditing({ ...editing, memberId: e.target.value })}
                  className="h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Leave open</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>
                  ))}
                </select>
              </div>
              {liveOverlap.length > 0 && (
                <p data-testid="shift-overlap" role="status" className="rounded-2xl bg-warning p-3.5 text-warning-foreground">
                  {members.find((m) => m.id === editing.memberId)?.name ?? "This person"} is already scheduled {shiftRange(liveOverlap[0]!, tz)}. You can still save this.
                </p>
              )}
              {formError && <p role="alert" className="font-semibold text-destructive">{formError}</p>}
              <DialogFooter className="gap-2">
                {current && (
                  <Button type="button" variant="outline" className="text-destructive" onClick={() => setConfirmCancel(true)}>
                    Cancel shift
                  </Button>
                )}
                <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {current ? `${dayLabel(dateInZone(current.start, tz), "long")}, ${time(current.start)}–${time(current.end)}. ` : ""}
              It will be removed from the calendar. This does not notify anyone, so please let the caregiver know.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (current) cancel.mutate(current.id); }} disabled={cancel.isPending}>
              Cancel shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ label, short, hint, children }: { label: string; short: string; hint: string; children: React.ReactNode }) {
  return (
    <>
      <span className="flex flex-col justify-center text-[0.8235rem] font-bold leading-tight">
        <span className="md:hidden">{short}</span>
        <span className="hidden md:inline">{label}</span>
        <span className="font-medium text-muted-foreground">{hint}</span>
      </span>
      {children}
    </>
  );
}
