// Pure coverage rules: shift validation, calendar bucketing and coverage status. No I/O.
import type { Tables } from "@/integrations/supabase/types";
import { dateInZone, fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

export type ShiftLike = {
  id: string;
  start: string;
  end: string;
  assigned_member_id: string | null;
  status: string;
};

export const BLOCKS = [
  { key: "morning", label: "Morning", short: "Morn", hint: "to 2p", start: "08:00", end: "14:00" },
  {
    key: "afternoon",
    label: "Afternoon",
    short: "Aft",
    hint: "2p–6p",
    start: "14:00",
    end: "18:00",
  },
  { key: "evening", label: "Evening", short: "Eve", hint: "6p on", start: "18:00", end: "22:00" },
] as const;
export type BlockKey = (typeof BLOCKS)[number]["key"];

export const isActive = (s: ShiftLike) => s.status !== "canceled";
export const isOpen = (s: ShiftLike) => isActive(s) && !s.assigned_member_id;

/** Which calendar row a shift belongs in, from its start hour in the family's timezone. */
export function blockOf(startIso: string, tz: string): BlockKey {
  const h = Number(toZonedInputValue(startIso, tz).slice(11, 13));
  return h < 14 ? "morning" : h < 18 ? "afternoon" : "evening";
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday ("YYYY-MM-DD") of the week containing `instant`, in the family's timezone. */
export function mondayInZone(instant: Date, tz: string): string {
  const ymd = dateInZone(instant, tz);
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const shiftWeek = (monday: string, n: number) => addDays(monday, n * 7);
export function weekRange(monday: string, tz: string) {
  return {
    from: fromZonedInputValue(`${monday}T00:00`, tz)!,
    to: fromZonedInputValue(`${addDays(monday, 7)}T00:00`, tz)!,
  };
}

export type ShiftDraft = { date: string; startTime: string; endTime: string };

/**
 * Turns a date + start/end wall time into instants, rejecting invalid ranges. An end time at or before the start time
 * means the shift runs past midnight into the next day (equal times are rejected).
 * Overlaps are NOT rejected here: overlapping shifts for the same member are flagged on save (see shiftService), never
 * blocked, consistent with the appointments rule.
 */
export function validateShift(
  d: ShiftDraft,
  tz: string,
): { ok: true; start: string; end: string } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { ok: false, error: "Pick a date." };
  if (!/^\d{2}:\d{2}$/.test(d.startTime) || !/^\d{2}:\d{2}$/.test(d.endTime))
    return { ok: false, error: "Pick a start and end time." };
  if (d.startTime === d.endTime) return { ok: false, error: "The end must be after the start." };
  const start = fromZonedInputValue(`${d.date}T${d.startTime}`, tz);
  const endDate = d.endTime < d.startTime ? addDays(d.date, 1) : d.date;
  const end = fromZonedInputValue(`${endDate}T${d.endTime}`, tz);
  if (!start || !end)
    return { ok: false, error: "That time doesn't exist on this date (clock change)." };
  if (Date.parse(end) <= Date.parse(start))
    return { ok: false, error: "The end must be after the start." };
  return { ok: true, start, end };
}

export function coverageSummary(shifts: ShiftLike[]): string {
  const active = shifts.filter(isActive);
  const open = active.filter(isOpen).length;
  if (active.length === 0) return "No shifts scheduled this week";
  if (open) return `${open} shift${open > 1 ? "s" : ""} still need someone`;
  return "Every shift is covered";
}

// ---- Coverage C1: service-layer rules (validation, "needs completion", overlap flagging) ----

export type ShiftRow = Tables<"shift">;

/** What an organizer can set. `start`/`end` are instants (ISO strings); `assigned_member_id` null means open. */
export interface ShiftInput {
  start: string;
  end: string;
  assigned_member_id: string | null;
}

/** A write that is refused for a reason the person can fix. The message is safe to show. */
export class ShiftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShiftValidationError";
  }
}

const parse = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/** Throws ShiftValidationError unless both times parse and the end is after the start. Returns normalized ISO strings. */
export function validateShiftTimes(start: unknown, end: unknown): { start: string; end: string } {
  const s = parse(start);
  const e = parse(end);
  if (Number.isNaN(s)) throw new ShiftValidationError("Pick a valid start date and time.");
  if (Number.isNaN(e)) throw new ShiftValidationError("Pick a valid end date and time.");
  if (e <= s) throw new ShiftValidationError("The end must be after the start.");
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
}

/**
 * What is missing from a shift, computed from its fields (never stored): a shift with no end time or no caregiver
 * "needs completion". It clears the moment those are filled in.
 */
export function missingFromShift(s: {
  end?: string | null;
  assigned_member_id?: string | null;
}): Array<"end time" | "caregiver"> {
  const out: Array<"end time" | "caregiver"> = [];
  if (!s.end) out.push("end time");
  if (!s.assigned_member_id) out.push("caregiver");
  return out;
}
export const needsCompletion = (s: Parameters<typeof missingFromShift>[0]) =>
  missingFromShift(s).length > 0;

/** Other shifts of the same member that overlap [start, end). Touching end-to-start is not an overlap. */
export function overlapsForMember<
  T extends Pick<ShiftRow, "id" | "start" | "end" | "assigned_member_id">,
>(shifts: T[], memberId: string | null, start: string, end: string, ignoreId?: string): T[] {
  if (!memberId) return [];
  const s = Date.parse(start);
  const e = Date.parse(end);
  return shifts.filter(
    (x) =>
      x.id !== ignoreId &&
      x.assigned_member_id === memberId &&
      Date.parse(x.start) < e &&
      Date.parse(x.end) > s,
  );
}
