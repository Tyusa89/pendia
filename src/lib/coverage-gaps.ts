// Required hours minus assigned shifts = what is uncovered. Pure; no I/O; the family's IANA zone decides every day and
// clock time. Rules (founder-approved):
//  * Nothing is assumed: with no requirements defined there is no required time, so nothing can be uncovered or "covered".
//  * Only ASSIGNED, non-canceled shifts cover. An open (unassigned) shift is unfilled, never coverage.
//  * A single-date override REPLACES the weekly pattern for that date; an override with no windows means nothing is
//    required that date.
//  * Overlapping shifts/windows merge, so time is never counted twice.
//  * A window belongs to the date it starts on; an overnight window's tail is required on the next date regardless of
//    that date's own override.
//  * Daylight saving is explicit: a wall time that does not exist (spring forward) or occurs twice (fall back) is
//    reported in `adjustments`, never silently altered.
import { dayBounds } from "@/lib/calendar";
import {
  parseWallTime,
  type DateOverride,
  type RequiredWindow,
  type WeeklyRequirement,
} from "@/lib/coverage-requirements";
import { addDays } from "@/lib/shifts";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

export interface Interval {
  start: number;
  end: number;
}
export interface CoverageShift {
  start: string;
  end: string;
  assigned_member_id: string | null;
  status: string;
}
export interface DstAdjustment {
  /** The date and wall time the organizer asked for. */
  day: string;
  time: string;
  /** nonexistent: skipped by the clock change, so the next valid time is used. repeated: occurs twice, the first is used. */
  kind: "nonexistent" | "repeated";
}
export interface DayRequirement {
  day: string;
  source: "override" | "weekly" | "none";
  intervals: Interval[];
}

const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

// ---- interval algebra (all [start, end) in ms) ----
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]!.start, b[j]!.start);
    const e = Math.min(a[i]!.end, b[j]!.end);
    if (e > s) out.push({ start: s, end: e });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return out;
}
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    let cur = x.start;
    for (const y of b) {
      if (y.end <= cur || y.start >= x.end) continue;
      if (y.start > cur) out.push({ start: cur, end: y.start });
      cur = Math.max(cur, y.end);
    }
    if (cur < x.end) out.push({ start: cur, end: x.end });
  }
  return out;
}
export const totalMs = (list: Interval[]) => list.reduce((n, i) => n + (i.end - i.start), 0);

// ---- wall time -> instant, with DST reported ----
function wallInstant(
  day: string,
  hhmm: string,
  tz: string,
  adjustments: DstAdjustment[],
): number | null {
  const iso = fromZonedInputValue(`${day}T${hhmm}`, tz);
  if (iso) {
    const again = toZonedInputValue(new Date(Date.parse(iso) + 3600000).toISOString(), tz);
    if (again === `${day}T${hhmm}`) adjustments.push({ day, time: hhmm, kind: "repeated" });
    return Date.parse(iso);
  }
  for (let m = parseWallTime(hhmm) + 15; m < 24 * 60; m += 15) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const next = fromZonedInputValue(`${day}T${t}`, tz);
    if (next) {
      adjustments.push({ day, time: hhmm, kind: "nonexistent" });
      return Date.parse(next);
    }
  }
  return null;
}

function windowIntervals(
  day: string,
  windows: RequiredWindow[],
  tz: string,
  adjustments: DstAdjustment[],
): Interval[] {
  const out: Interval[] = [];
  for (const w of windows) {
    const overnight = parseWallTime(w.end_time) <= parseWallTime(w.start_time);
    const start = wallInstant(day, w.start_time, tz, adjustments);
    const end = wallInstant(overnight ? addDays(day, 1) : day, w.end_time, tz, adjustments);
    if (start !== null && end !== null && end > start) out.push({ start, end });
  }
  return out;
}

/** What is required on the windows that START on `day`: the date's override if it has one, else the weekly pattern. */
export function requirementForDay(
  day: string,
  weekly: WeeklyRequirement[],
  overrides: DateOverride[],
  tz: string,
  adjustments: DstAdjustment[] = [],
): DayRequirement {
  const ov = overrides.find((o) => o.day === day);
  if (ov)
    return {
      day,
      source: "override",
      intervals: windowIntervals(day, ov.windows, tz, adjustments),
    };
  const wk = weekly.filter((w) => w.weekday === weekdayOf(day));
  if (wk.length)
    return { day, source: "weekly", intervals: windowIntervals(day, wk, tz, adjustments) };
  return { day, source: "none", intervals: [] };
}

export type CoverageState = "not-defined" | "none-required" | "defined";
export interface CoverageResult {
  /** not-defined: no requirement exists at all, so nothing is reported. none-required: defined, but none falls in this range. */
  state: CoverageState;
  required: Interval[];
  covered: Interval[];
  /** Required time with no assigned caregiver. */
  uncovered: Interval[];
  /** The part of `uncovered` that an open (unassigned) shift spans: scheduled but unfilled, still not covered. */
  unfilled: Interval[];
  requiredMs: number;
  coveredMs: number;
  uncoveredMs: number;
  days: DayRequirement[];
  adjustments: DstAdjustment[];
}

/** Coverage for the local days fromDay..toDay inclusive. */
export function computeCoverage(input: {
  fromDay: string;
  toDay: string;
  weekly: WeeklyRequirement[];
  overrides: DateOverride[];
  shifts: CoverageShift[];
  tz: string;
}): CoverageResult {
  const { fromDay, toDay, weekly, overrides, shifts, tz } = input;
  const adjustments: DstAdjustment[] = [];
  const empty = (state: CoverageState, days: DayRequirement[] = []): CoverageResult => ({
    state,
    required: [],
    covered: [],
    uncovered: [],
    unfilled: [],
    requiredMs: 0,
    coveredMs: 0,
    uncoveredMs: 0,
    days,
    adjustments: [],
  });
  if (!weekly.length && !overrides.length) return empty("not-defined");

  const range: Interval[] = [{ start: dayBounds(fromDay, tz)[0], end: dayBounds(toDay, tz)[1] }];
  const days: DayRequirement[] = [];
  const raw: Interval[] = [];
  // start one day early so an overnight window from the day before the range still counts its tail
  for (let d = addDays(fromDay, -1); d <= toDay; d = addDays(d, 1)) {
    const r = requirementForDay(d, weekly, overrides, tz, adjustments);
    if (d >= fromDay) days.push(r);
    raw.push(...r.intervals);
  }
  const required = intersectIntervals(mergeIntervals(raw), range);
  const seen = new Set<string>();
  const dedup = adjustments.filter((a) => {
    const k = `${a.day}|${a.time}|${a.kind}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  if (!required.length) return { ...empty("none-required", days), adjustments: dedup };

  const active = shifts.filter((s) => s.status !== "canceled");
  const toIv = (s: CoverageShift): Interval => ({
    start: Date.parse(s.start),
    end: Date.parse(s.end),
  });
  const assigned = mergeIntervals(active.filter((s) => s.assigned_member_id).map(toIv));
  const open = mergeIntervals(active.filter((s) => !s.assigned_member_id).map(toIv));
  const covered = intersectIntervals(required, assigned);
  const uncovered = subtractIntervals(required, assigned);
  return {
    state: "defined",
    required,
    covered,
    uncovered,
    unfilled: intersectIntervals(uncovered, open),
    requiredMs: totalMs(required),
    coveredMs: totalMs(covered),
    uncoveredMs: totalMs(uncovered),
    days,
    adjustments: dedup,
  };
}
