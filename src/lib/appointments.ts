// Pure appointment logic. Everything here is COMPUTED from the stored columns: nothing is persisted, nothing is
// invented or filled in, and a flag clears the moment the underlying field has a real value.
import type { Tables } from "@/integrations/supabase/types";
import { dateInZone } from "@/lib/zoned-time";

export type Appointment = Tables<"visit">;
export type AppointmentView = "upcoming" | "past" | "archived";
export type MissingField = "provider" | "address" | "phone";

/** Blank or whitespace-only text is "not provided". */
export const isBlank = (v: string | null | undefined): boolean => v == null || v.trim() === "";

type ForFlags = Pick<
  Appointment,
  "provider_name" | "office_address" | "office_phone" | "status" | "archived_at"
>;

/** An appointment is "active" while it is scheduled and not archived; only active appointments are flagged. */
export const isActive = (a: Pick<Appointment, "status" | "archived_at">): boolean =>
  a.status === "scheduled" && !a.archived_at;

/** Which of provider / address / phone are missing. Empty for canceled, completed or archived appointments. */
export function missingFields(a: ForFlags): MissingField[] {
  if (!isActive(a)) return [];
  const out: MissingField[] = [];
  if (isBlank(a.provider_name)) out.push("provider");
  if (isBlank(a.office_address)) out.push("address");
  if (isBlank(a.office_phone)) out.push("phone");
  return out;
}

export const isIncomplete = (a: ForFlags): boolean => missingFields(a).length > 0;

/**
 * Which list an appointment belongs in. Upcoming = scheduled and not over yet (an appointment in progress counts).
 * Rows with no scheduled time (legacy visits) fall back to their calendar date.
 */
export function classify(a: Appointment, now: Date, timeZone: string): AppointmentView {
  if (a.archived_at) return "archived";
  if (a.status !== "scheduled") return "past";
  const end = a.scheduled_end ?? a.scheduled_start;
  if (end) return Date.parse(end) >= now.getTime() ? "upcoming" : "past";
  return a.date >= dateInZone(now, timeZone) ? "upcoming" : "past";
}

const startMs = (a: Pick<Appointment, "scheduled_start">) =>
  a.scheduled_start ? Date.parse(a.scheduled_start) : null;

type Interval = { id: string; start: number; end: number };

function intervalOf(
  a: Pick<Appointment, "id" | "scheduled_start" | "scheduled_end">,
): Interval | null {
  const s = startMs(a);
  if (s == null) return null;
  // No end time: treat it as a point in time. We never assume a duration.
  const e = a.scheduled_end ? Date.parse(a.scheduled_end) : s;
  return { id: a.id, start: s, end: Math.max(e, s) };
}

/** Back-to-back appointments (one ends when the next starts) do not overlap. */
export function intervalsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  const aPoint = a.start === a.end;
  const bPoint = b.start === b.end;
  if (aPoint && bPoint) return a.start === b.start;
  if (aPoint) return b.start <= a.start && a.start < b.end;
  if (bPoint) return a.start <= b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

/**
 * Overlaps among active appointments, as id -> ids it overlaps with. Flag only: nothing is blocked or changed.
 * Canceled, completed, archived and unscheduled rows are ignored.
 */
export function findOverlaps(list: Appointment[]): Map<string, string[]> {
  const items = list
    .filter(isActive)
    .map(intervalOf)
    .filter((x): x is Interval => x !== null);
  const out = new Map<string, string[]>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (intervalsOverlap(a, b)) {
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
        out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
      }
    }
  }
  return out;
}

/** Appointments (other than `selfId`) that a proposed time range would overlap: used for a live, non-blocking warning. */
export function overlapsWithProposed(
  others: Appointment[],
  proposed: { start: string | null; end: string | null },
  selfId?: string,
): Appointment[] {
  const mine = intervalOf({
    id: "proposed",
    scheduled_start: proposed.start,
    scheduled_end: proposed.end,
  });
  if (!mine) return [];
  return others
    .filter((o) => o.id !== selfId && isActive(o))
    .filter((o) => {
      const theirs = intervalOf(o);
      return theirs !== null && intervalsOverlap(mine, theirs);
    });
}

const sortKey = (a: Appointment) => startMs(a) ?? Date.parse(`${a.date}T12:00:00Z`);
export const sortUpcoming = (list: Appointment[]) =>
  [...list].sort((a, b) => sortKey(a) - sortKey(b));
export const sortPast = (list: Appointment[]) => [...list].sort((a, b) => sortKey(b) - sortKey(a));

export interface AppointmentInput {
  provider_name: string | null;
  office_name: string | null;
  office_address: string | null;
  office_phone: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  reason: string | null;
  notes: string | null;
  confirmation_status: "unconfirmed" | "confirmed";
}

/** Trim text; blank becomes null (so "not provided" is stored as absent, never as an empty string or a made-up value). */
export const clean = (v: string | null | undefined): string | null =>
  isBlank(v) ? null : v!.trim();
