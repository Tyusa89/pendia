// Pure coverage rules: shift validation, calendar bucketing and coverage status. No I/O.
import { dateInZone, fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

export type ShiftLike = {
  id: string;
  start: string;
  end: string;
  assigned_member_id: string | null;
  status: string;
};

export const BLOCKS = [
  { key: "morning", label: "Morning", short: "Morn", hint: "8a–2p", start: "08:00", end: "14:00" },
  { key: "afternoon", label: "Afternoon", short: "Aft", hint: "2p–6p", start: "14:00", end: "18:00" },
  { key: "evening", label: "Evening", short: "Eve", hint: "6p–10p", start: "18:00", end: "22:00" },
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
 * Turns a date + start/end wall time into instants, rejecting invalid ranges and overlaps with other active shifts.
 * An end time at or before the start time means the shift runs past midnight into the next day.
 */
export function validateShift(
  d: ShiftDraft,
  tz: string,
  others: ShiftLike[],
  selfId?: string,
): { ok: true; start: string; end: string } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { ok: false, error: "Pick a date." };
  if (!/^\d{2}:\d{2}$/.test(d.startTime) || !/^\d{2}:\d{2}$/.test(d.endTime))
    return { ok: false, error: "Pick a start and end time." };
  if (d.startTime === d.endTime) return { ok: false, error: "End time must be after the start time." };
  const start = fromZonedInputValue(`${d.date}T${d.startTime}`, tz);
  const endDate = d.endTime < d.startTime ? addDays(d.date, 1) : d.date;
  const end = fromZonedInputValue(`${endDate}T${d.endTime}`, tz);
  if (!start || !end) return { ok: false, error: "That time doesn't exist on this date (clock change)." };
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (e <= s) return { ok: false, error: "End time must be after the start time." };
  const clash = others.find(
    (o) => o.id !== selfId && isActive(o) && Date.parse(o.start) < e && Date.parse(o.end) > s,
  );
  if (clash) return { ok: false, error: "This overlaps another shift. Edit that one instead." };
  return { ok: true, start, end };
}

export function coverageSummary(shifts: ShiftLike[]): string {
  const active = shifts.filter(isActive);
  const open = active.filter(isOpen).length;
  if (active.length === 0) return "No shifts scheduled this week";
  if (open) return `${open} shift${open > 1 ? "s" : ""} still need someone`;
  return "Every shift is covered";
}
