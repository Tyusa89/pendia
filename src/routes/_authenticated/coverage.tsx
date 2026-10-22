import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  coverageSummary,
  isActive,
  isOpen,
  missingFromShift,
  mondayInZone,
  NO_REQUIREMENTS_NOTE,
  overlapsForMember,
  addDays,
  shiftWeek,
  validateShift,
  weekDays,
  weekRange,
} from "@/lib/shifts";
import { shiftOverlapsDay } from "@/lib/calendar";
import { CoverageTimeline } from "@/components/CoverageTimeline";
import { timeZoneLabel } from "@/lib/timezones";
import { NeedsCompletion, shiftRange } from "@/components/NeedsCompletion";
import { dateInZone, formatInZone, toZonedInputValue } from "@/lib/zoned-time";
import { shiftService, type Family, type Member, type Shift } from "@/services";

export const Route = createFileRoute("/_authenticated/coverage")({
  head: () => ({
    meta: [
      { title: "Coverage — Pendia" },
      { name: "description", content: "Who is with your loved one this week." }, { property: "og:title", content: "Coverage — Pendia" }, { property: "og:description", content: "Who is with your loved one this week." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
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
    .map((w) => w[0]?.toUpperCase() ?? "")
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
  const [layout, setLayout] = useState<"day" | "week">("week");
  const [selectedDay, setSelectedDay] = useState(() => dateInZone(new Date(), tz));
  // Phones start on the day view; larger screens on the week. Decided after mount so server and browser first render alike.
  useEffect(() => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches) setLayout("day");
  }, []);
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
  // The selected day always belongs to the shown week; moving the week keeps the same weekday.
  const selected = days.includes(selectedDay) ? selectedDay : days[0]!;
  const goToDay = (d: string) => {
    setSelectedDay(d);
    setMonday(mondayInZone(new Date(`${d}T12:00:00Z`), "UTC"));
  };
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
  // The general "Add shift" button passes no date: it means today in the family's zone, not the Monday of the week on screen.
  const newShift = (date?: string, block: { start: string; end: string } = BLOCKS[0]) => {
    setFormError("");
    setEditing({ date: date ?? dateInZone(new Date(), tz), startTime: block.start, endTime: block.end, memberId: "" });
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
  const today = dateInZone(new Date().toISOString(), tz);
  const todayShifts = shifts.filter((s) => shiftOverlapsDay(s, today, tz));

  return (
    <>
      <PageTitle title="Coverage" subtitle={coverageSummary(shifts)} action={organizer && <Button variant="outline" onClick={() => newShift()}><Plus /> Add shift</Button>} />
      <p className="-mt-2 mb-4 text-muted-foreground">{NO_REQUIREMENTS_NOTE}</p>
      {todayShifts.length > 0 && <section aria-label="Today's coverage" className="mb-5 space-y-3">
        <h2 className="font-sans text-sm font-bold uppercase text-muted-foreground">Today · {new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</h2>
        {todayShifts.map((s) => {
          const who = members.find((m) => m.id === s.assigned_member_id);
          const now = Date.now() >= Date.parse(s.start) && Date.now() < Date.parse(s.end);
          return <article key={s.id} className={`space-y-3 rounded-[1.25rem] p-5 shadow-card ${who ? "bg-card" : "border border-dashed border-unassigned-foreground/60 bg-unassigned text-unassigned-foreground"}`}>
            <div className="flex items-center justify-between gap-3"><p><strong>{time(s.start)}–{time(s.end)}</strong></p>{now && <span className="shrink-0 rounded-full bg-success px-3 py-1 text-sm font-bold text-success-foreground">Now</span>}</div>
            {who ? <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary font-bold text-secondary-foreground">{initials(who.name)}</span><p className="font-bold">{who.name}</p>{organizer && <Button variant="ghost" className="ml-auto text-primary" onClick={() => openShift(s)}>Edit</Button>}</div> : <><p className="font-bold">Nobody is covering yet</p><Button className="w-full" disabled={claim.isPending} onClick={() => claim.mutate(s.id)}>I'll cover it</Button></>}
          </article>;
        })}
      </section>}
      <section aria-label="Leaving soon" className="mb-5 space-y-2 rounded-[1.25rem] bg-primary/10 p-[1.125rem]">
        <h2 className="font-sans text-base font-bold">Leaving soon?</h2>
        <p>A quick handoff tells the next person how she's doing.</p>
        <Button asChild size="lg" className="w-full"><Link to="/handoffs">Hand off my shift</Link></Button>
      </section>
      <section aria-label="This week" className="space-y-4 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button size="icon" variant="ghost" onClick={() => { setMonday(shiftWeek(monday, -1)); setSelectedDay(addDays(selected, -7)); }} aria-label="Previous week">
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
        <Button size="icon" variant="ghost" onClick={() => { setMonday(shiftWeek(monday, 1)); setSelectedDay(addDays(selected, 7)); }} aria-label="Next week">
          <ChevronRight />
        </Button>
      </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.9412rem] text-muted-foreground">Times are in {timeZoneLabel(tz)}.</p>
          <div role="group" aria-label="Calendar view" className="flex gap-1">
            {(["day", "week"] as const).map((v) => (
              <Button key={v} size="sm" variant={layout === v ? "default" : "outline"} aria-pressed={layout === v} onClick={() => setLayout(v)}>
                {v === "day" ? "Day" : "Week"}
              </Button>
            ))}
          </div>
        </div>
        {layout === "day" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Button size="icon" variant="ghost" onClick={() => goToDay(addDays(selected, -1))} aria-label="Previous day">
                <ChevronLeft />
              </Button>
              <p className="text-center font-semibold">{dayLabel(selected, "long")}, {new Date(`${selected}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}</p>
              <Button size="icon" variant="ghost" onClick={() => goToDay(addDays(selected, 1))} aria-label="Next day">
                <ChevronRight />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === selected}
                  aria-label={`${dayLabel(d, "long")} ${Number(d.slice(8))}`}
                  onClick={() => setSelectedDay(d)}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-lg text-[0.8235rem] font-bold leading-tight ${d === selected ? "bg-primary text-primary-foreground" : d === today ? "bg-primary/10 text-primary" : "bg-muted"}`}
                >
                  {dayLabel(d, "short")}
                  <span className="font-medium">{Number(d.slice(8))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <CoverageTimeline
          days={layout === "day" ? [selected] : days}
          shifts={shifts}
          members={members}
          meId={me.id}
          tz={tz}
          organizer={organizer}
          today={today}
          claimPending={claim.isPending}
          onAddAt={(day, startTime, endTime) => newShift(day, { start: startTime, end: endTime })}
          onEdit={openShift}
          onClaim={(s) => claim.mutate(s.id)}
        />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9412rem] text-muted-foreground">
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded bg-primary" />You</li>
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded bg-secondary" />Family</li>
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned" />Open</li>
          <li className="flex items-center gap-1.5"><span className="size-3.5 rounded border border-border" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, var(--muted-foreground) 30%, transparent) 3px 4px)" }} />Nothing scheduled</li>
        </ul>
      {openList.length > 0 && (
        <section aria-label="Still open this week" className="mt-4 space-y-2 border-t border-border pt-4">
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
