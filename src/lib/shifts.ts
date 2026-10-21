// Pure rules for coverage shifts, used by the service layer (so they hold even if the form is bypassed) and the UI.
import type { Tables } from "@/integrations/supabase/types";

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
