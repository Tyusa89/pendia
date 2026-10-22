// Where a shift appears on the weekly calendar. A shift shows in EVERY (day, block) it overlaps, so a 1-4 PM shift is in
// both Morning and Afternoon, and an overnight shift is in the evening of one day and the morning of the next.
// Day and block edges are real instants computed in the family's zone, so 23- and 25-hour (daylight saving) days work.
import { BLOCKS, type BlockKey } from "@/lib/shifts";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Instant of a wall time on a day. If that wall time doesn't exist (clock change), the next hour that does. */
function at(day: string, hhmm: string, tz: string): number {
  let [h, m] = hhmm.split(":").map(Number) as [number, number];
  for (; h < 24; h++) {
    const iso = fromZonedInputValue(
      `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      tz,
    );
    if (iso) return Date.parse(iso);
    m = 0;
  }
  return Date.parse(fromZonedInputValue(`${addDays(day, 1)}T00:00`, tz)!);
}

/** [start, end) of each block on `day`: Morning runs from midnight, Evening to the next midnight, so every hour belongs to one block. */
export function blockEdges(day: string, tz: string): Record<BlockKey, [number, number]> {
  const midnight = at(day, "00:00", tz);
  const next = at(addDays(day, 1), "00:00", tz);
  const b14 = at(day, "14:00", tz);
  const b18 = at(day, "18:00", tz);
  return { morning: [midnight, b14], afternoon: [b14, b18], evening: [b18, next] };
}

/** [start, end) of the calendar day in `tz` as instants: 23, 24 or 25 real hours around a clock change. */
export function dayBounds(day: string, tz: string): [number, number] {
  return [at(day, "00:00", tz), at(addDays(day, 1), "00:00", tz)];
}

export type CellShift<T> = { shift: T; startsBefore: boolean; endsAfter: boolean };

/** Shifts that overlap `block` on `day`; `startsBefore`/`endsAfter` say the shift continues outside that day. */
export function shiftsInCell<T extends { start: string; end: string }>(
  shifts: T[],
  day: string,
  block: BlockKey,
  tz: string,
): CellShift<T>[] {
  const edges = blockEdges(day, tz);
  const [from, to] = edges[block];
  const dayStart = edges.morning[0];
  const dayEnd = edges.evening[1];
  return shifts
    .filter((s) => Date.parse(s.start) < to && Date.parse(s.end) > from)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((shift) => ({
      shift,
      startsBefore: Date.parse(shift.start) < dayStart,
      endsAfter: Date.parse(shift.end) > dayEnd,
    }));
}

/** True if any part of the shift falls on the calendar day `day` in `tz`. */
export function shiftOverlapsDay(
  s: { start: string; end: string },
  day: string,
  tz: string,
): boolean {
  const edges = blockEdges(day, tz);
  return Date.parse(s.start) < edges.evening[1] && Date.parse(s.end) > edges.morning[0];
}

const hm = (iso: string, tz: string) => {
  const w = toZonedInputValue(iso, tz).slice(11);
  return { h: Number(w.slice(0, 2)), m: Number(w.slice(3, 5)) };
};
const part = ({ h, m }: { h: number; m: number }, withSuffix: "a" | "p" | "") => {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${withSuffix}`;
};

/** Short exact hours for a small calendar cell: "12–2p", "8a–2p", "10p–6a", "12:30–2p". */
export function compactRange(startIso: string, endIso: string, tz: string): string {
  const s = hm(startIso, tz);
  const e = hm(endIso, tz);
  const sm = s.h < 12 ? "a" : "p";
  const em = e.h < 12 ? "a" : "p";
  return `${part(s, sm === em ? "" : sm)}–${part(e, em)}`;
}
