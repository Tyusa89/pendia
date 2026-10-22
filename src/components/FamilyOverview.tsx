import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, ClipboardCheck, Pill, ChevronRight } from "lucide-react";
import { classify, sortUpcoming } from "@/lib/appointments";
import { mondayOf } from "@/lib/week";
import { formatInZone } from "@/lib/zoned-time";
import { handoffService, shiftService, visitService, type Member } from "@/services";

export function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * "At a glance" tiles on the Family page. Uses only data the app already has, and only the tiles this person is
 * allowed to see (the same visibility flags the database enforces), so nothing hidden shows up as "none".
 */
export function FamilyOverview({ me, timeZone }: { me: Member; timeZone: string }) {
  const organizer = me.role === "organizer";
  const seesVisits = organizer || me.can_see_visits;
  const seesSchedule = organizer || me.can_see_schedule;
  const fid = me.family_id;

  const visits = useQuery({
    queryKey: ["visits", fid],
    queryFn: () => visitService.list(fid),
    enabled: seesVisits,
  });
  const weekStart = mondayOf(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const shifts = useQuery({
    queryKey: ["shifts", fid, weekStart.toISOString()],
    queryFn: () => shiftService.listRange(fid, weekStart.toISOString(), weekEnd.toISOString()),
    enabled: seesSchedule,
  });
  const handoffs = useQuery({
    queryKey: ["handoffs", fid],
    queryFn: () => handoffService.list(fid),
    enabled: seesSchedule,
  });

  const now = new Date();
  const next = visits.data
    ? sortUpcoming(visits.data.filter((v) => classify(v, now, timeZone) === "upcoming"))[0]
    : undefined;
  const open = shifts.data?.filter((s) => !s.assigned_member_id).length;

  const tiles = [
    seesVisits && {
      to: "/visits" as const,
      label: "Next visit",
      value: visits.isLoading
        ? "…"
        : next
          ? next.scheduled_start
            ? formatInZone(next.scheduled_start, timeZone, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : next.date
          : "None yet",
    },
    seesSchedule && {
      to: "/coverage" as const,
      label: "Open this week",
      value: shifts.isLoading
        ? "…"
        : open === 0
          ? "All covered"
          : `${open} block${open === 1 ? "" : "s"}`,
      alert: !!open,
    },
  ].filter(Boolean) as {
    to: "/visits" | "/coverage";
    label: string;
    value: string;
    alert?: boolean;
  }[];

  const quick = [
    { to: "/handoffs" as const, label: "Quick handoff", icon: ClipboardCheck, show: true },
    { to: "/visits/new" as const, label: "Add appointment", icon: CalendarPlus, show: organizer },
    { to: "/meds" as const, label: "Medications", icon: Pill, show: true },
  ].filter((q) => q.show);

  return (
    <div className="space-y-4" data-testid="family-overview">
      {tiles.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(8.5rem,100%),1fr))] gap-2">
          {tiles.map((t) => (
            <Link
              key={t.label}
              to={t.to}
              className="flex min-h-16 flex-col gap-0.5 rounded-[0.875rem] bg-card/80 px-3 py-2.5 text-foreground"
            >
              <span className="text-[0.9412rem] text-muted-foreground">{t.label}</span>
              <span className={`font-bold ${t.alert ? "text-unassigned-foreground" : ""}`}>
                {t.value}
              </span>
            </Link>
          ))}
        </div>
      )}
      <h2 className="text-xl font-semibold">Quick actions</h2>
      <nav
        aria-label="Quick actions"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(6.5rem,100%),1fr))] gap-2"
      >
        {quick.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-[5.25rem] flex-col items-center justify-center gap-1.5 rounded-2xl bg-card px-1 py-2 text-center text-[0.9412rem] font-semibold leading-tight text-foreground shadow-card"
          >
            <Icon className="size-6 text-primary" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))]">
      {seesVisits && next && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Coming up</h2>
            <Link to="/visits" className="text-primary">All visits</Link>
          </div>
          <Link to="/visits/$id" params={{ id: next.id }} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.25rem] bg-card p-5 shadow-card">
            <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-2xl font-semibold text-primary">
              {next.scheduled_start ? formatInZone(next.scheduled_start, timeZone, { day: "numeric" }) : Number(next.date.slice(8))}
            </span>
            <div className="min-w-0">
              <p className="font-bold">{next.provider_name || "Appointment"}</p>
              <p className="text-muted-foreground">{next.reason || next.office_name}</p>
              <p className="text-sm text-primary">{next.scheduled_start ? formatInZone(next.scheduled_start, timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" }) : next.date}</p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </section>
      )}
      {seesSchedule && handoffs.data?.[0] && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Latest handoff</h2>
            <Link to="/handoffs" className="text-primary">All handoffs</Link>
          </div>
          <Link to="/handoffs" className="block space-y-3 rounded-[1.25rem] bg-card p-5 shadow-card">
            <p className="text-sm text-muted-foreground">{new Date(handoffs.data[0].created_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</p>
            <div className="flex flex-wrap gap-2">
              {handoffs.data[0].ate && <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Ate</span>}
              {handoffs.data[0].meds_taken && <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Meds taken</span>}
            </div>
            {handoffs.data[0].unusual && <p className="rounded-xl bg-unassigned p-3 text-unassigned-foreground">{handoffs.data[0].unusual}</p>}
          </Link>
        </section>
      )}
      </div>
    </div>
  );
}
