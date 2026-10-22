// Required caregiving hours: validation for what an organizer can define. Pure; the database repeats every rule
// (15-minute marks, start <> end, one override per date) so a client that skips this still cannot store junk.
// Times are wall-clock in the family's timezone. A window whose end is at or before its start runs into the next day.

export class CoverageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageValidationError";
  }
}

export interface RequiredWindow {
  start_time: string;
  end_time: string;
}
export interface WeeklyRequirement extends RequiredWindow {
  weekday: number; // 0 = Monday ... 6 = Sunday
}
export interface DateOverride {
  day: string; // "YYYY-MM-DD" in the family's timezone
  windows: RequiredWindow[]; // empty = nothing is required that date
}

export const STEP_MINUTES = 15;
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** "HH:MM" or "HH:MM:SS" (as the database returns it) -> minutes since midnight. Seconds must be zero. */
export function parseWallTime(v: unknown): number {
  const m = typeof v === "string" ? /^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(v) : null;
  if (!m) throw new CoverageValidationError("Use a time like 08:00 (hours and minutes only).");
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes % STEP_MINUTES !== 0)
    throw new CoverageValidationError(
      `Times must be on a ${STEP_MINUTES}-minute mark (:00, :15, :30, :45).`,
    );
  return minutes;
}

export const formatWallTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Validates one window and returns it as "HH:MM". */
export function normalizeWindow(w: unknown): RequiredWindow {
  const o = (w ?? {}) as Record<string, unknown>;
  const s = parseWallTime(o["start_time"]);
  const e = parseWallTime(o["end_time"]);
  if (s === e)
    throw new CoverageValidationError("A required window needs a start and a different end.");
  return { start_time: formatWallTime(s), end_time: formatWallTime(e) };
}

/** Validates a list: every window must be valid; exact duplicates collapse; result is sorted by start. Empty is allowed. */
export function normalizeWindows(list: unknown): RequiredWindow[] {
  if (!Array.isArray(list)) throw new CoverageValidationError("Provide the windows as a list.");
  const seen = new Set<string>();
  const out: RequiredWindow[] = [];
  for (const w of list) {
    const n = normalizeWindow(w);
    const k = `${n.start_time}-${n.end_time}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out.sort(
    (a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time),
  );
}

export function validateWeekday(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 6)
    throw new CoverageValidationError("Pick a day of the week.");
  return v;
}

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-30). */
export function validateDay(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new CoverageValidationError("Pick a date.");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new CoverageValidationError("That date doesn't exist.");
  return v;
}
