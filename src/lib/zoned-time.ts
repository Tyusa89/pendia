// Wall-clock <-> instant conversion in an explicit IANA timezone (the family's), so which day/time an appointment is on
// never depends on the timezone of whichever device is editing it. No external dependency: Intl only.

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function wallParts(utcMs: number, timeZone: string) {
  const o: Record<string, number> = {};
  for (const p of dtf(timeZone).formatToParts(new Date(utcMs)))
    if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(utcMs: number, timeZone: string): number {
  const w = wallParts(utcMs, timeZone);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) -
    Math.floor(utcMs / 1000) * 1000
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    dtf(timeZone);
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> "YYYY-MM-DDTHH:mm" wall time in `timeZone` (the value a datetime-local input expects). */
export function toZonedInputValue(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const w = wallParts(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * "YYYY-MM-DDTHH:mm" wall time in `timeZone` -> ISO instant. Returns null for blank/invalid input and for wall times
 * that do not exist (the hour skipped when clocks spring forward): a time is never silently shifted. For the repeated
 * hour when clocks fall back, the first (earlier) occurrence is used.
 */
export function fromZonedInputValue(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  if (new Date(naive).getUTCMonth() !== mo - 1) return null; // e.g. Feb 30
  const off1 = offsetMs(naive, timeZone);
  let utc = naive - off1;
  const off2 = offsetMs(utc, timeZone);
  if (off2 !== off1) utc = naive - off2;
  // Round-trip: if the wall time does not map back to itself it does not exist in this zone.
  if (toZonedInputValue(new Date(utc).toISOString(), timeZone) !== local.trim()) return null;
  // Repeated hour (fall back): prefer the earlier of the two valid instants.
  const earlier = utc - 3600_000;
  if (toZonedInputValue(new Date(earlier).toISOString(), timeZone) === local.trim()) utc = earlier;
  return new Date(utc).toISOString();
}

/** "YYYY-MM-DD" of the given instant in `timeZone`. */
export function dateInZone(instant: Date | string, timeZone: string): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  const w = wallParts(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function formatInZone(
  iso: string,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...opts }).format(new Date(iso));
}
