// Presentation math for the weekly/daily time-grid: one continuous event per shift per day, placed by real elapsed time
// in the family's zone. Pure; no I/O. A shift crossing local midnight is split into one event per day (marked as
// continuing), never repeated by time period. Nothing here knows about "required" hours: blank time is just unscheduled.
import { dayBounds } from "@/lib/calendar";
import { formatInZone, toZonedInputValue } from "@/lib/zoned-time";

export const HOUR_REM = 3; // height of one real hour in the grid

export interface TimelineEvent<T> {
  shift: T;
  /** Clipped to the day, as instants (ms). */
  start: number;
  end: number;
  startsBefore: boolean;
  endsAfter: boolean;
  /** 0-based lane among events that overlap each other, and how many lanes that overlapping group needs. */
  lane: number;
  lanes: number;
  /** Position within the day in rem, from the day's first real instant. */
  topRem: number;
  heightRem: number;
}

/** Events for one local day, side by side in lanes when they overlap (touching shifts do not overlap). */
export function timelineEvents<T extends { start: string; end: string }>(
  shifts: T[],
  day: string,
  tz: string,
): TimelineEvent<T>[] {
  const [d0, d1] = dayBounds(day, tz);
  const clipped = shifts
    .map((shift) => ({ shift, s: Date.parse(shift.start), e: Date.parse(shift.end) }))
    .filter((x) => x.s < d1 && x.e > d0)
    .sort((a, b) => a.s - b.s || a.e - b.e);

  const out: TimelineEvent<T>[] = [];
  let group: typeof clipped = [];
  let groupEnd = -Infinity;
  const flush = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map((x) => {
      const start = Math.max(x.s, d0);
      const end = Math.min(x.e, d1);
      let lane = laneEnds.findIndex((le) => le <= start);
      if (lane < 0) lane = laneEnds.push(end) - 1;
      else laneEnds[lane] = end;
      return { x, start, end, lane };
    });
    for (const p of placed)
      out.push({
        shift: p.x.shift,
        start: p.start,
        end: p.end,
        startsBefore: p.x.s < d0,
        endsAfter: p.x.e > d1,
        lane: p.lane,
        lanes: laneEnds.length,
        topRem: ((p.start - d0) / 3600000) * HOUR_REM,
        heightRem: ((p.end - p.start) / 3600000) * HOUR_REM,
      });
    group = [];
    groupEnd = -Infinity;
  };
  for (const c of clipped) {
    if (c.s >= groupEnd) flush();
    group.push(c);
    groupEnd = Math.max(groupEnd, c.e);
  }
  flush();
  return out;
}

/** Stretches of the day with no event at all (merged), for shading. Not a requirement and never called a gap. */
export function unscheduledIntervals(
  events: Array<{ start: number; end: number }>,
  day: string,
  tz: string,
): Array<[number, number]> {
  const [d0, d1] = dayBounds(day, tz);
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const out: Array<[number, number]> = [];
  let cursor = d0;
  for (const e of sorted) {
    if (e.start > cursor) out.push([cursor, e.start]);
    cursor = Math.max(cursor, e.end);
  }
  if (cursor < d1) out.push([cursor, d1]);
  return out;
}

export interface Tick {
  t: number;
  topRem: number;
  label: string;
}

/** Each real hour of the day at which the local clock reads :00, labelled in the family's zone. */
export function hourTicks(
  day: string,
  tz: string,
): { ticks: Tick[]; hours: number; clockChange: boolean } {
  const [d0, d1] = dayBounds(day, tz);
  const ticks: Tick[] = [];
  for (let t = d0; t < d1; t += 15 * 60000) {
    if (toZonedInputValue(new Date(t).toISOString(), tz).slice(14, 16) !== "00") continue;
    ticks.push({
      t,
      topRem: ((t - d0) / 3600000) * HOUR_REM,
      label: formatInZone(new Date(t).toISOString(), tz, { hour: "numeric" }),
    });
  }
  // A repeated hour (clocks fall back) would show the same label twice; say which one is which.
  const seen = new Map<string, number>();
  for (const tk of ticks) seen.set(tk.label, (seen.get(tk.label) ?? 0) + 1);
  for (const tk of ticks)
    if ((seen.get(tk.label) ?? 0) > 1)
      tk.label = formatInZone(new Date(tk.t).toISOString(), tz, {
        hour: "numeric",
        timeZoneName: "short",
      });
  const hours = (d1 - d0) / 3600000;
  return { ticks, hours, clockChange: hours !== 24 };
}
