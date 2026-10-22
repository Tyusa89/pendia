import { useEffect, useRef } from "react";
import { compactRange, dayBounds } from "@/lib/calendar";
import {
  HOUR_REM,
  hourTicks,
  timelineEvents,
  unscheduledIntervals,
  type TimelineEvent,
} from "@/lib/coverage-timeline";
import { formatInZone } from "@/lib/zoned-time";
import type { Shift } from "@/services";

type Person = { id: string; name: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
const dayName = (ymd: string, weekday: "short" | "long") =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday, timeZone: "UTC" });
const dayLong = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const HATCH =
  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--muted-foreground) 14%, transparent) 6px 7px)";

/**
 * A real time grid: one continuous event per shift (per day it touches), placed by actual start and end in the family's
 * time zone. Shaded stretches are simply unscheduled; the grid never claims anything about required coverage.
 * Presentation only: data, permissions and the dialogs stay in the Coverage page.
 */
export function CoverageTimeline({
  days,
  shifts,
  members,
  meId,
  tz,
  organizer,
  today,
  claimPending,
  onAddAt,
  onEdit,
  onClaim,
}: {
  days: string[];
  shifts: Shift[];
  members: Person[];
  meId: string;
  tz: string;
  organizer: boolean;
  today: string;
  claimPending: boolean;
  onAddAt: (day: string, startTime: string, endTime: string) => void;
  onEdit: (s: Shift) => void;
  onClaim: (s: Shift) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const perDay = days.map((d) => ({
    day: d,
    events: timelineEvents(shifts, d, tz),
    grid: hourTicks(d, tz),
  }));
  const ref = perDay.find((p) => p.grid.hours === 24) ?? perDay[0]!; // gutter labels follow an ordinary day when there is one
  const heightRem = (hours: number) => hours * HOUR_REM;
  const cols = `3.25rem repeat(${days.length}, minmax(0, 1fr))`;

  // Open the view near the first scheduled hour (or 7 AM) so a short window is not hidden at the top of a 24-hour grid.
  const firstTop = Math.min(
    ...perDay.flatMap((p) => p.events.filter((e) => !e.startsBefore).map((e) => e.topRem)),
    7 * HOUR_REM,
  );
  const first = days.join();
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (firstTop - HOUR_REM) * 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  const label = (e: TimelineEvent<Shift>, day: string, who?: Person) => {
    const s = e.shift;
    const range = `${formatInZone(s.start, tz, { hour: "numeric", minute: "2-digit" })}–${formatInZone(s.end, tz, { hour: "numeric", minute: "2-digit" })}`;
    const name = !who ? "open" : who.id === meId ? "you" : who.name;
    return `${dayLong(day)} ${range}: ${name}${e.startsBefore ? ", started the day before" : ""}${e.endsAfter ? ", continues the next day" : ""}`;
  };

  return (
    <div
      role="group"
      aria-label="Coverage timeline"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div ref={scroller} className="max-h-[36rem] overflow-y-auto overflow-x-hidden">
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-card"
          style={{ gridTemplateColumns: cols }}
        >
          <span aria-hidden />
          {perDay.map(({ day, grid }) => {
            const head = (
              <>
                <span>{dayName(day, "short")}</span>
                <span className="font-medium text-muted-foreground">{Number(day.slice(8))}</span>
                {grid.clockChange && (
                  <span
                    className="text-[0.6875rem] font-medium text-warning-foreground"
                    title={`Clocks change: this day has ${grid.hours} hours`}
                  >
                    {grid.hours}h day
                  </span>
                )}
              </>
            );
            const cls = `flex min-w-0 flex-col items-center justify-center gap-0 py-1.5 text-[0.8235rem] font-bold leading-tight ${day === today ? "bg-primary/10 text-primary" : ""}`;
            return organizer ? (
              <button
                key={day}
                type="button"
                className={`${cls} hover:bg-accent`}
                aria-label={`Add a shift on ${dayLong(day)}`}
                onClick={() => onAddAt(day, "08:00", "14:00")}
              >
                {head}
              </button>
            ) : (
              <span key={day} className={cls}>
                {head}
              </span>
            );
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div
            aria-hidden
            className="relative"
            style={{ height: `${heightRem(ref.grid.hours)}rem` }}
          >
            {ref.grid.ticks.map((tk) => (
              <span
                key={tk.t}
                className="absolute right-1.5 -translate-y-1/2 text-[0.6875rem] text-muted-foreground"
                style={{ top: `${tk.topRem}rem` }}
              >
                {tk.topRem === 0 ? "" : tk.label}
              </span>
            ))}
          </div>
          {perDay.map(({ day, events, grid }) => (
            <div
              key={day}
              data-day={day}
              className={`relative border-l border-border ${day === today ? "bg-primary/5" : ""}`}
              style={{ height: `${heightRem(grid.hours)}rem` }}
            >
              {unscheduledIntervals(events, day, tz).map(([a, b]) => (
                <div
                  key={a}
                  data-unscheduled={`${hhmm(a, tz)}-${hhmm(b, tz)}`}
                  aria-hidden
                  className="absolute inset-x-0"
                  style={{
                    top: `${((a - dayBounds(day, tz)[0]) / 3600000) * HOUR_REM}rem`,
                    height: `${((b - a) / 3600000) * HOUR_REM}rem`,
                    backgroundImage: HATCH,
                  }}
                />
              ))}
              {grid.clockChange && ref.day !== day && (
                // Real hours no longer line up with the shared hour labels on a 23/25-hour day, so label this column itself.
                <div
                  aria-hidden
                  data-own-hours
                  className="pointer-events-none absolute inset-0 z-0"
                >
                  {grid.ticks.map((tk) => (
                    <span
                      key={tk.t}
                      className="absolute left-0.5 -translate-y-1/2 rounded bg-card/80 px-0.5 text-[0.625rem] text-muted-foreground"
                      style={{ top: `${tk.topRem}rem` }}
                    >
                      {tk.topRem === 0 ? "" : tk.label}
                    </span>
                  ))}
                </div>
              )}
              {grid.ticks.map((tk) => (
                <div
                  key={tk.t}
                  aria-hidden
                  data-slot={organizer ? `${day}T${hhmm(tk.t, tz)}` : undefined}
                  className={`absolute inset-x-0 border-t border-border/60 ${organizer ? "cursor-pointer hover:bg-accent/40" : ""}`}
                  style={{ top: `${tk.topRem}rem`, height: `${HOUR_REM}rem` }}
                  onClick={
                    organizer
                      ? () => onAddAt(day, hhmm(tk.t, tz), hhmm(tk.t + 3600000, tz))
                      : undefined
                  }
                />
              ))}
              {events.map((e) => {
                const s = e.shift;
                const who = members.find((m) => m.id === s.assigned_member_id);
                const mine = who?.id === meId;
                const range = `${e.startsBefore ? "◂ " : ""}${compactRange(s.start, s.end, tz)}${e.endsAfter ? " ▸" : ""}`;
                const action = organizer ? () => onEdit(s) : !who ? () => onClaim(s) : undefined;
                const cls = `absolute z-10 flex min-w-0 flex-col justify-start overflow-hidden rounded-lg px-1.5 py-1 text-left text-[0.75rem] font-bold leading-tight md:text-[0.8125rem] ${
                  !who
                    ? "border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned text-unassigned-foreground"
                    : mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                }`;
                const style = {
                  top: `${e.topRem}rem`,
                  height: `${e.heightRem}rem`,
                  left: `calc(${(e.lane / e.lanes) * 100}% + 1px)`,
                  width: `calc(${100 / e.lanes}% - 2px)`,
                };
                const content = (
                  <>
                    {!who && (
                      <span
                        aria-hidden
                        data-testid="needs-completion-dot"
                        className="absolute right-1 top-1 size-2.5 rounded-full bg-warning ring-1 ring-warning-foreground/40"
                      />
                    )}
                    <span className="truncate">{!who ? "Open" : mine ? "You" : who.name}</span>
                    <span data-testid="shift-hours" className="truncate font-medium">
                      {range}
                    </span>
                  </>
                );
                const common = {
                  "data-testid": "timeline-event",
                  "data-shift-id": s.id,
                  "data-lane": e.lane,
                  className: cls,
                  style,
                  title: who?.name ?? "Open shift",
                  "aria-label": label(e, day, who),
                };
                return action ? (
                  <button
                    key={`${s.id}-${day}`}
                    type="button"
                    {...common}
                    disabled={claimPending}
                    aria-label={`${common["aria-label"]}. ${organizer ? "Tap to edit" : "Tap to cover it"}`}
                    onClick={action}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={`${s.id}-${day}`} role="img" {...common}>
                    {content}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const hhmm = (t: number, tz: string) =>
  formatInZone(new Date(t).toISOString(), tz, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
