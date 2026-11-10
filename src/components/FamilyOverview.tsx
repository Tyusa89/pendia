import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { CalendarPlus, ChevronRight, ClipboardCheck, Mic, Pill, Plus } from "lucide-react";
import { AppointmentFlags } from "@/components/AppointmentFlags";
import { Panel } from "@/components/AppShell";
import { classify, sortUpcoming, type Appointment } from "@/lib/appointments";
import { mondayOf } from "@/lib/week";
import { formatInZone } from "@/lib/zoned-time";
import { useMembers } from "@/hooks/use-family";
import { useNarrow } from "@/hooks/use-narrow";
import { familyService, handoffService, shiftService, visitService, type Handoff, type Member, type Shift } from "@/services";

export function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const initialOf = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("");
const AVATAR = ["bg-secondary text-secondary-foreground", "bg-accent text-primary", "bg-muted text-[#5e4f82]", "bg-[#e9dfd0] text-[#5a4310]"];

function Avatar({ name, i, size = "size-10" }: { name: string; i: number; size?: string }) {
  return <span aria-hidden className={`grid ${size} shrink-0 place-items-center rounded-full font-brand text-sm font-bold ${AVATAR[i % AVATAR.length]}`}>{initialOf(name)}</span>;
}

function CardHead({ title, link }: { title: string; link?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xl">{title}</h2>
      {link}
    </div>
  );
}
const linkCls = "inline-flex min-h-11 items-center rounded-lg px-1 font-brand text-sm font-bold text-primary underline-offset-4 hover:underline";

/**
 * The Dashboard body. Uses only data the app already has, and only the parts this person is allowed to see (the same
 * visibility flags the database enforces), so nothing hidden shows up as "none". Today's coverage is the shift calendar
 * (who is scheduled), never a presence or check-in claim.
 */
export function FamilyOverview({ me, timeZone }: { me: Member; timeZone: string }) {
  const organizer = me.role === "organizer";
  const seesVisits = organizer || me.can_see_visits;
  const seesSchedule = organizer || me.can_see_schedule;
  const seesMeds = organizer || me.can_see_meds;
  const fid = me.family_id;
  const narrow = useNarrow();
  const [segment, setSegment] = useState<"today" | "visits" | "week" | "family">("today");

  const recipient = useQuery({ queryKey: ["recipient", fid], queryFn: () => familyService.getRecipient(fid) });
  const members = useMembers(fid).data ?? [];
  const visits = useQuery({ queryKey: ["visits", fid], queryFn: () => visitService.list(fid), enabled: seesVisits });
  const weekStart = mondayOf(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const shifts = useQuery({
    queryKey: ["shifts", fid, weekStart.toISOString()],
    queryFn: () => shiftService.listRange(fid, weekStart.toISOString(), weekEnd.toISOString()),
    enabled: seesSchedule,
  });
  const handoffs = useQuery({ queryKey: ["handoffs", fid], queryFn: () => handoffService.list(fid), enabled: seesSchedule });

  const now = new Date();
  const upcoming = visits.data ? sortUpcoming(visits.data.filter((v) => classify(v, now, timeZone) === "upcoming")) : [];
  const next = upcoming[0];
  const sorted: Shift[] = [...(shifts.data ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const open = shifts.data?.filter((s) => !s.assigned_member_id).length;
  const dayKey = (iso: string) => formatInZone(iso, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const todayKey = dayKey(now.toISOString());
  const todays = sorted.filter((s) => dayKey(s.start) === todayKey);
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? "Someone") : null);
  const timeRange = (s: Shift) =>
    `${formatInZone(s.start, timeZone, { hour: "numeric", minute: "2-digit" })} – ${formatInZone(s.end, timeZone, { hour: "numeric", minute: "2-digit" })}`;
  const when = (v: Appointment, opts: Intl.DateTimeFormatOptions) => (v.scheduled_start ? formatInZone(v.scheduled_start, timeZone, opts) : v.date);
  const latest: Handoff | undefined = handoffs.data?.[0];
  const rName = recipient.data?.name;

  const facts = [
    seesVisits && {
      to: "/visits" as const,
      label: "Next visit",
      value: visits.isLoading ? "…" : next ? when(next, { weekday: "short", month: "short", day: "numeric" }) + (next.scheduled_start ? ` · ${when(next, { hour: "numeric", minute: "2-digit" })}` : "") : "None yet",
      sub: next ? next.provider_name || "Appointment" : "Coverage and visits stay in sync here",
    },
    seesSchedule && {
      to: "/coverage" as const,
      label: "Open this week",
      value: shifts.isLoading ? "…" : open === 0 ? (shifts.data?.length ? "None open" : "No shifts yet") : `${open} block${open === 1 ? "" : "s"}`,
      sub: "Coverage shifts",
    },
    seesSchedule && {
      to: "/coverage" as const,
      label: "Scheduled coverage today",
      value: shifts.isLoading ? "…" : todays[0] ? (nameOf(todays[0].assigned_member_id) ?? "Open") : "None scheduled",
      sub: todays[0] ? timeRange(todays[0]) : "Nothing on today's calendar",
    },
    seesSchedule && {
      to: "/handoffs" as const,
      label: "Latest handoff",
      value: latest ? new Date(latest.created_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "None yet",
      sub: latest ? [latest.ate && "Ate", latest.meds_taken && "Meds taken"].filter(Boolean).join(" · ") || "Saved" : "No handoffs saved",
    },
  ].filter(Boolean) as { to: "/visits" | "/coverage" | "/handoffs"; label: string; value: string; sub: string }[];

  const recipientCard = (
    <section aria-label="Care recipient" className="rounded-[var(--radius-card)] bg-[#1f2d4a] p-5 text-white shadow-card md:p-7">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center lg:gap-8">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-[#f5efe6] font-display text-xl font-semibold text-[#1f2d4a] md:size-20 md:text-3xl">{rName ? initialOf(rName) : "·"}</span>
          <div className="min-w-0">
            <p className="font-brand text-xs font-bold uppercase tracking-[0.08em] text-white/75">Caring for</p>
            <p className="break-words font-display text-[clamp(1.5rem,8vw,1.875rem)] font-semibold leading-tight md:text-5xl">{rName ?? (recipient.isLoading ? "…" : "No care recipient yet")}</p>
          </div>
        </div>
        {recipient.data?.notes && <p className="text-base text-white/90 lg:hidden">{recipient.data.notes}</p>}
        {facts.length > 0 && (
          <div className={narrow ? "-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" : "grid gap-3 sm:grid-cols-2"}>
            {facts.map((f) => (
              <Link key={f.label} to={f.to} className={`flex flex-col gap-0.5 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white hover:bg-white/15 ${narrow ? "min-w-[8.5rem] shrink-0" : ""}`}>
                <span className="font-brand text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-white/75">{f.label}</span>
                <span className="font-brand text-lg font-bold leading-tight">{f.value}</span>
                {!narrow && <span className="text-sm text-white/85">{f.sub}</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
      {recipient.data?.notes && <p className="mt-4 hidden max-w-2xl text-base text-white/90 lg:block">{recipient.data.notes}</p>}
    </section>
  );

  const quickHandoff = (
    <Panel aria-label="Quick handoff">
      <CardHead title="Quick handoff" />
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"><ClipboardCheck className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="font-brand font-bold">Quick check-in before you leave</p>
          <p className="text-muted-foreground">Answer two questions and add a note or a voice note. This opens the Handoffs page, where the saving and the recorder work as they do today.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/handoffs" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-brand font-semibold text-primary-foreground shadow-warm hover:bg-primary/90">Start a handoff <ChevronRight className="size-4" aria-hidden /></Link>
        <Link to="/handoffs" className="inline-flex min-h-12 items-center gap-2 rounded-xl border-[1.5px] border-input bg-card px-5 font-brand font-semibold text-primary hover:bg-accent"><Mic className="size-4" aria-hidden /> Voice note</Link>
      </div>
    </Panel>
  );
  const quickHandoffRow = (
    <Link to="/handoffs" className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-border-warm bg-card p-3 shadow-card">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"><ClipboardCheck className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1"><span className="block font-brand font-bold">Quick handoff</span><span className="block text-sm text-muted-foreground">Opens the Handoffs page</span></span>
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
    </Link>
  );

  const activity = seesSchedule && (
    <Panel aria-label="Family activity">
      <CardHead title="Family activity" link={<Link to="/handoffs" className={linkCls}>All handoffs</Link>} />
      {latest ? (
        <div className="flex items-start gap-3">
          <Avatar name={nameOf(latest.author_member_id) ?? "?"} i={1} />
          <div className="min-w-0">
            <p><span className="font-brand font-bold">{nameOf(latest.author_member_id) ?? "Someone"}</span> <span className="text-muted-foreground">· {new Date(latest.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></p>
            {(latest.note || latest.unusual) && <p className="mt-1 break-words text-lg">{latest.note || latest.unusual}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {latest.ate && <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Ate</span>}
              {latest.meds_taken && <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Meds taken</span>}
              {latest.unusual && latest.note && <span className="rounded-full bg-unassigned px-3 py-1 text-sm font-semibold text-unassigned-foreground">{latest.unusual}</span>}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">{handoffs.isLoading ? "Loading…" : "No handoffs saved yet."}</p>
      )}
    </Panel>
  );

  const week = seesSchedule && (
    <Panel aria-label="Scheduled coverage this week">
      <CardHead title="Scheduled coverage this week" link={open !== undefined && <span className={`rounded-full px-3 py-1 text-sm font-bold ${open ? "bg-unassigned text-unassigned-foreground" : "bg-secondary text-secondary-foreground"}`}>{open ? `${open} open` : "None open"}</span>} />
      {sorted.length === 0 ? (
        <p className="text-muted-foreground">{shifts.isLoading ? "Loading…" : "No shifts are scheduled this week."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((s, i) => {
            const who = nameOf(s.assigned_member_id);
            const isToday = dayKey(s.start) === todayKey;
            return (
              <li key={s.id} className="grid min-h-12 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
                <span className={`font-brand font-bold ${isToday ? "text-[#5e4f82]" : ""}`}>{formatInZone(s.start, timeZone, { weekday: "short" })}</span>
                <span className="flex min-w-0 items-center gap-2">{who ? <Avatar name={who} i={i} size="size-8" /> : <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-unassigned text-unassigned-foreground">?</span>}<span className={`truncate font-semibold ${who ? "" : "text-unassigned-foreground"}`}>{who ?? "Open"}</span></span>
                <span className="text-muted-foreground">{timeRange(s)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/coverage" className={`${linkCls} mt-2`}>Open Coverage for the full calendar</Link>
    </Panel>
  );

  const comingUp = (showCoverage: boolean, showVisits: boolean) => (
    <Panel aria-label="Coming up">
      <CardHead title={showCoverage && !showVisits ? "Today" : "Coming up"} link={showVisits ? <Link to="/visits" className={linkCls}>All visits</Link> : <span className="text-sm text-muted-foreground">{formatInZone(now.toISOString(), timeZone, { weekday: "short", month: "short", day: "numeric" })}</span>} />
      <ol className="relative space-y-4 border-l-2 border-border pl-5">
        {showCoverage && seesSchedule && (
          <li>
            <p className="font-brand text-xs font-bold uppercase tracking-[0.08em] text-[#5e4f82]">Today · scheduled coverage</p>
            {todays.length === 0 ? <p className="mt-1 text-muted-foreground">Nothing is on today's coverage calendar.</p> : todays.map((s) => (
              <div key={s.id} className="mt-1 rounded-2xl bg-secondary p-3">
                <p className="font-brand font-bold text-secondary-foreground">{nameOf(s.assigned_member_id) ?? "Open"} · {timeRange(s)}</p>
                <p className="text-sm text-muted-foreground">Shows who is on the calendar, not who is present.</p>
              </div>
            ))}
          </li>
        )}
        {showVisits && seesVisits && upcoming.slice(0, 3).map((v) => (
          <li key={v.id}>
            <p className="font-brand text-xs font-bold uppercase tracking-[0.08em] text-[#5e4f82]">{when(v, { weekday: "long", month: "short", day: "numeric" })}</p>
            <Link to="/visits/$id" params={{ id: v.id }} className="mt-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-accent p-3">
              <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-card font-brand text-xl font-extrabold text-primary">{v.scheduled_start ? formatInZone(v.scheduled_start, timeZone, { day: "numeric" }) : Number(v.date.slice(8))}</span>
              <span className="min-w-0">
                <span className="block font-brand font-bold">{v.provider_name || "Appointment"}</span>
                <span className="block text-muted-foreground">{[v.scheduled_start && when(v, { hour: "numeric", minute: "2-digit" }), v.reason || v.office_name].filter(Boolean).join(" · ")}</span>
                <span className="mt-1 block"><AppointmentFlags appointment={v} /></span>
              </span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
        {showVisits && seesVisits && (
          <li>
            <p className="font-brand text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">After that</p>
            <p className="mt-1 text-muted-foreground">
              {upcoming.length > 3 ? `${upcoming.length - 3} more upcoming.` : upcoming.length ? "No other upcoming visits." : visits.isLoading ? "Loading…" : "No upcoming visits."}{" "}
              {organizer && <Link to="/visits/new" className="inline-flex min-h-11 items-center font-brand font-bold text-primary underline-offset-4 hover:underline"><CalendarPlus className="mr-1 size-4" aria-hidden />Add appointment</Link>}
            </p>
          </li>
        )}
      </ol>
    </Panel>
  );

  const family = (
    <Panel aria-label="Our family">
      <CardHead title={narrow ? `Care team · ${members.length}` : "Our family"} link={<Link to="/members" className={linkCls}>{narrow ? "View care team" : "View care team"}</Link>} />
      {narrow ? (
        <ul className="divide-y divide-border">
          {members.map((m, i) => (
            <li key={m.id} className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2">
              <Avatar name={m.name} i={i} size="size-11" />
              <span className="min-w-0"><span className="block font-brand font-bold">{m.name}</span><span className="block truncate text-sm text-muted-foreground">{m.phone || "No phone"} · {m.language === "es" ? "Español" : "English"}</span></span>
              <span className={`rounded-full px-3 py-1 text-[0.8235rem] font-bold ${m.role === "organizer" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{m.role === "organizer" ? "Organizer" : "Member"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-wrap gap-4">
          {members.slice(0, 6).map((m, i) => (
            <li key={m.id} className="flex w-16 flex-col items-center gap-1 text-center"><Avatar name={m.name} i={i} size="size-12" /><span className="w-full truncate text-sm font-semibold">{m.name.split(/\s+/)[0]}</span></li>
          ))}
        </ul>
      )}
      {narrow && organizer && <Link to="/members" className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-input bg-card font-brand font-semibold text-primary"><Plus className="size-4" aria-hidden /> Invite a member</Link>}
    </Panel>
  );

  const meds = seesMeds && (
    <Panel aria-label="Medications summary">
      <CardHead title="Medications" link={<Link to="/meds" className={linkCls}>Open</Link>} />
      <p className="flex items-center gap-2 text-muted-foreground"><Pill className="size-4 text-primary" aria-hidden /> See today's doses and the dose schedule.</p>
    </Panel>
  );

  if (narrow) {
    const tabs = [["today", "Today"], ["visits", "Visits"], ["week", "Week"], ["family", "Family"]] as const;
    return (
      <div className="space-y-4" data-testid="family-overview">
        {recipientCard}
        {quickHandoffRow}
        <div role="tablist" aria-label="Dashboard sections" className="grid grid-cols-4 gap-1 rounded-full bg-accent p-1">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" id={`dash-tab-${k}`} aria-selected={segment === k} aria-controls="dash-panel" onClick={() => setSegment(k)} className={`min-h-11 rounded-full font-brand text-sm font-semibold ${segment === k ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>
          ))}
        </div>
        <div role="tabpanel" id="dash-panel" aria-labelledby={`dash-tab-${segment}`} className="space-y-4">
          {segment === "today" && <>{comingUp(true, false)}{activity}</>}
          {segment === "visits" && <>{comingUp(false, true)}{organizer && <Link to="/visits/new" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-input bg-card font-brand font-semibold text-primary"><Plus className="size-4" aria-hidden /> New appointment</Link>}</>}
          {segment === "week" && week}
          {segment === "family" && family}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="family-overview">
      {recipientCard}
      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-5">{quickHandoff}{activity}{week}</div>
        <div className="min-w-0 space-y-5">{comingUp(true, true)}{family}{meds}</div>
      </div>
    </div>
  );
}
