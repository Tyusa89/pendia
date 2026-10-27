// Feature C: the pure rules, types and words for medication ADMINISTRATION REPORTS. No network, no storage, no Supabase, no model.
//
// A report here is "a family member said this dose was given / not given". It is never presented as verified ingestion, never
// created by an AI model, transcript, reminder or acknowledgement, and it is separate from Feature A's value verification
// (src/lib/visit-pipeline/med-verifier.ts). The DATABASE is the authority on who may report (see
// supabase/migrations/20261027000001_dose_administration.sql); the functions here mirror its rules so the screens can explain them
// and so synthetic Demo Mode behaves the same way. Nothing here grants anything.
import { fromZonedInputValue, toZonedInputValue } from "@/lib/zoned-time";

export type DoseStatus = "given" | "not_given" | "not_confirmed";
export type TimeState = "normal" | "ambiguous" | "skipped";

export const NOT_GIVEN_REASONS = [
  "refused",
  "unwell",
  "unavailable",
  "skipped_on_purpose",
  "other",
] as const;
export type NotGivenReason = (typeof NOT_GIVEN_REASONS)[number];
export const CHANGE_REASONS = [
  "reported_by_mistake",
  "wrong_occurrence",
  "information_changed",
  "confirmed_after_review",
  "late_entry",
  "other",
] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];

export const REPORT_WINDOW_HOURS = 48;
export const REPORT_WINDOW_MS = REPORT_WINDOW_HOURS * 3600_000;

/** One computed occurrence, as returned by dose_occurrences(). `status` is "not_confirmed" whenever nobody has reported. */
export interface DoseOccurrence {
  schedule_id: string;
  medication_id: string;
  medication_name: string;
  dose_text: string | null;
  local_date: string; // YYYY-MM-DD in the family's zone
  local_time: string; // HH:MM:SS
  tz: string;
  scheduled_at: string | null; // ISO instant; null when the local time does not exist that day
  time_state: TimeState;
  status: DoseStatus;
  head_id: string | null;
  reported_by: string | null; // member id of the current report's author (null = no report)
  reported_by_name: string | null;
  reported_at: string | null;
  not_given_reason: NotGivenReason | null;
  change_reason: ChangeReason | null;
  outside_window: boolean;
  reports_differ: boolean;
  open_disagreements: number;
  history_count: number;
}

/** One row of an occurrence's history, as stored (append-only). */
export interface DoseHistoryEntry {
  id: string;
  seq: number;
  entry_kind: "report" | "disagreement";
  status: DoseStatus | null;
  not_given_reason: NotGivenReason | null;
  change_reason: ChangeReason | null;
  outside_window: boolean;
  supersedes: string | null;
  disputes: string | null;
  reporter_name: string;
  reported_at: string;
}

export interface ScheduleInput {
  medication_id: string;
  local_time: string; // HH:MM
  days_of_week: number[]; // ISO 1=Mon..7=Sun
  starts_on: string; // YYYY-MM-DD
  ends_on: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Words. Reports are described as reports; nothing here says "taken", "verified", "administered successfully" or "confirmed
// ingestion".
// ---------------------------------------------------------------------------------------------------------------------
export const STATUS_LABEL: Record<DoseStatus, string> = {
  given: "Given",
  not_given: "Not given",
  not_confirmed: "Not confirmed",
};
export const REPORT_FOOTNOTE =
  "A family member's report. Pendia does not check that the medication was taken.";
export const NOT_CONFIRMED_DETAIL = "No one has reported this dose.";

export const NOT_GIVEN_REASON_LABEL: Record<NotGivenReason, string> = {
  refused: "Refused",
  unwell: "Felt unwell",
  unavailable: "Medication not available",
  skipped_on_purpose: "Skipped on purpose",
  other: "Other reason",
};
export const CHANGE_REASON_LABEL: Record<ChangeReason, string> = {
  reported_by_mistake: "Reported by mistake",
  wrong_occurrence: "Wrong dose or day",
  information_changed: "New information",
  confirmed_after_review: "Confirmed after review",
  late_entry: "Late entry",
  other: "Other reason",
};

export const WEEKDAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "8:00 AM" from "08:00:00" / "08:00". Wall-clock text only; no zone maths. */
export function formatLocalTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Reported given by Carlos at 8:02 AM" or the plain "No one has reported this dose." */
export function reportLine(
  o: Pick<DoseOccurrence, "status" | "reported_by_name" | "reported_at" | "tz">,
): string {
  if (o.status === "not_confirmed" && !o.reported_by_name) return NOT_CONFIRMED_DETAIL;
  const when = o.reported_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: o.tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(o.reported_at))
    : "";
  const who = o.reported_by_name ?? "someone";
  if (o.status === "not_confirmed")
    return `Report withdrawn by ${who}${when ? ` at ${when}` : ""}. Not confirmed.`;
  return `Reported ${o.status === "given" ? "given" : "not given"} by ${who}${when ? ` at ${when}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors from the database functions
// ---------------------------------------------------------------------------------------------------------------------
export const DOSE_ERROR_TEXT = {
  dose_not_signed_in: "Sign in again to report a dose.",
  dose_not_found: "This dose is not available to you.",
  dose_no_such_occurrence: "That dose is not on this medication's schedule.",
  dose_time_skipped:
    "That time does not exist on this day because the clocks changed, so nothing can be reported for it.",
  dose_future_not_allowed: "That dose is not due yet.",
  dose_window_closed: `Reports can be made within ${REPORT_WINDOW_HOURS} hours of the scheduled time. An organizer can add a late entry.`,
  dose_reason_required: "Choose a reason first.",
  dose_conflict:
    "Someone else reported this dose while you were looking. Review the latest report first.",
  dose_correction_not_allowed:
    "Only the person who reported it, or an organizer, can change a report. You can flag a disagreement instead.",
  dose_no_change: "That is already the current report.",
  dose_nothing_to_retract: "There is no report to withdraw.",
  dose_nothing_to_dispute: "There is no report to flag.",
  dose_use_correction_instead: "You made this report. Change it instead of flagging it.",
  dose_idempotency_mismatch: "This request was already used for a different report. Try again.",
  dose_bad_request: "That request is not valid.",
  dose_window_too_large: "That is too many days at once.",
  dose_bad_timezone: "The family's time zone is not valid.",
  dose_duplicate_schedule:
    "A schedule with the same time and days already exists for this medication.",
  dose_schedule_frozen: "Reports exist for this schedule. End it and add a new one instead.",
  dose_organizer_only: "Only an organizer can change medication schedules.",
  dose_unavailable: "Dose reporting is not switched on yet.",
} as const;
export type DoseErrorCode = keyof typeof DOSE_ERROR_TEXT;

export class DoseError extends Error {
  readonly code: DoseErrorCode | "unknown";
  constructor(code: DoseErrorCode | "unknown", message: string) {
    super(message);
    this.name = "DoseError";
    this.code = code;
  }
}

/** Turns a database error message into a DoseError with plain words. Unknown messages are never shown raw. */
export function parseDoseError(message: string): DoseError {
  // the feature's tables and functions do not exist until its migration is applied
  if (/does not exist|schema cache|could not find the (table|function)/i.test(message))
    return new DoseError("dose_unavailable", DOSE_ERROR_TEXT.dose_unavailable);
  if (/row-level security|violates row-level/i.test(message))
    return new DoseError("dose_organizer_only", DOSE_ERROR_TEXT.dose_organizer_only);
  const code = (Object.keys(DOSE_ERROR_TEXT) as DoseErrorCode[]).find(
    (k) => message === k || message.startsWith(`${k}`),
  );
  if (code) return new DoseError(code, DOSE_ERROR_TEXT[code]);
  return new DoseError("unknown", "That could not be saved. Nothing was changed.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates, schedules and the daylight-saving rules (mirrors dose_scheduled_at() in SQL; parity is tested against vectors)
// ---------------------------------------------------------------------------------------------------------------------
/** ISO weekday 1=Mon..7=Sun of a YYYY-MM-DD date (calendar arithmetic, no zone involved). */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const isDateString = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  addDays(s, 0) === s;

/**
 * The instant a family-local wall time happens on a date, or null when it does not exist (clocks sprang forward). A repeated time
 * (clocks fell back) uses the earlier instant and is flagged "ambiguous". Never silently shifts a time.
 */
export function scheduledAtFor(
  date: string,
  time: string,
  tz: string,
): { at: string | null; state: TimeState } {
  const hhmm = time.slice(0, 5);
  const iso = fromZonedInputValue(`${date}T${hhmm}`, tz);
  if (!iso) return { at: null, state: "skipped" };
  const local = `${date}T${hhmm}`;
  const at = (ms: number) => toZonedInputValue(new Date(ms).toISOString(), tz) === local;
  // fromZonedInputValue only looks back a whole hour; Lord Howe repeats a half hour, so look back 30 minutes too.
  let ms = Date.parse(iso);
  const repeated =
    [3600_000, 1800_000].some((k) => at(ms - k)) || at(ms + 3600_000) || at(ms + 1800_000);
  for (const k of [3600_000, 1800_000]) if (at(ms - k)) ms -= k;
  return { at: new Date(ms).toISOString(), state: repeated ? "ambiguous" : "normal" };
}

export interface ScheduleLike {
  id: string;
  medication_id: string;
  local_time: string;
  days_of_week: number[];
  starts_on: string;
  ends_on: string | null;
}
export interface ScheduledOccurrence {
  schedule_id: string;
  medication_id: string;
  local_date: string;
  local_time: string;
  scheduled_at: string | null;
  time_state: TimeState;
}

/** schedule x date, in the family's zone. Occurrences are computed, never inferred from free text and never stored. */
export function computeOccurrences(
  schedules: ScheduleLike[],
  tz: string,
  from: string,
  to: string,
): ScheduledOccurrence[] {
  const out: ScheduledOccurrence[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const s of schedules) {
      if (d < s.starts_on || (s.ends_on !== null && d > s.ends_on)) continue;
      if (!s.days_of_week.includes(isoWeekday(d))) continue;
      const { at, state } = scheduledAtFor(d, s.local_time, tz);
      out.push({
        schedule_id: s.id,
        medication_id: s.medication_id,
        local_date: d,
        local_time: s.local_time,
        scheduled_at: at,
        time_state: state,
      });
    }
    if (d === to) break;
  }
  return out.sort((a, b) =>
    (a.local_date + a.local_time).localeCompare(b.local_date + b.local_time),
  );
}

export interface ScheduleProblems {
  local_time?: string;
  days_of_week?: string;
  starts_on?: string;
  ends_on?: string;
}
/** Checks a schedule the organizer typed in. Fixed time + weekdays only (no PRN, tapers or intervals). */
export function validateScheduleInput(i: ScheduleInput): ScheduleProblems {
  const p: ScheduleProblems = {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.local_time)) p.local_time = "Enter a time like 08:00.";
  const days = i.days_of_week;
  if (days.length === 0) p.days_of_week = "Choose at least one day.";
  else if (
    days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    new Set(days).size !== days.length
  )
    p.days_of_week = "Days must be Monday to Sunday, each once.";
  if (!isDateString(i.starts_on)) p.starts_on = "Choose a start date.";
  if (
    i.ends_on !== null &&
    (!isDateString(i.ends_on) || (isDateString(i.starts_on) && i.ends_on < i.starts_on))
  )
    p.ends_on = "The end date must be on or after the start date.";
  return p;
}
export const scheduleValid = (i: ScheduleInput) =>
  Object.keys(validateScheduleInput(i)).length === 0;

export function describeSchedule(s: Pick<ScheduleLike, "local_time" | "days_of_week">): string {
  const d = [...s.days_of_week].sort((a, b) => a - b);
  const days = d.length === 7 ? "Every day" : d.map((x) => WEEKDAY_LABEL[x]).join(", ");
  return `${formatLocalTime(s.local_time)} · ${days}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The reporting rules (mirror report_dose() / flag_dose_disagreement(); the database enforces them, this explains and tests them)
// ---------------------------------------------------------------------------------------------------------------------
export interface RuleHead {
  id: string;
  status: DoseStatus;
  reportedBy: string; // member id
}
export interface RuleContext {
  actorId: string;
  actorIsOrganizer: boolean;
  actorCanSeeMeds: boolean;
  scheduledAtMs: number | null; // null = the time does not exist that day
  nowMs: number;
  head: RuleHead | null;
  expectedHead: string | null;
}
export interface ReportRequest {
  status: DoseStatus;
  notGivenReason?: NotGivenReason | null;
  changeReason?: ChangeReason | null;
}

/** The first rule a report would break, in the same order as the database function, or null when it would be accepted. */
export function checkReport(ctx: RuleContext, r: ReportRequest): DoseErrorCode | null {
  if (!ctx.actorCanSeeMeds) return "dose_not_found";
  if (!["given", "not_given", "not_confirmed"].includes(r.status)) return "dose_bad_request";
  if (r.notGivenReason && r.status !== "not_given") return "dose_bad_request";
  if (r.notGivenReason && !NOT_GIVEN_REASONS.includes(r.notGivenReason)) return "dose_bad_request";
  if (r.changeReason && !CHANGE_REASONS.includes(r.changeReason)) return "dose_bad_request";
  if (ctx.scheduledAtMs === null) return "dose_time_skipped";
  if (ctx.scheduledAtMs > ctx.nowMs) return "dose_future_not_allowed";
  if ((ctx.head?.id ?? null) !== ctx.expectedHead) return "dose_conflict";
  const outside = ctx.nowMs - ctx.scheduledAtMs > REPORT_WINDOW_MS;
  if (outside && !ctx.actorIsOrganizer) return "dose_window_closed";
  if (outside && !r.changeReason) return "dose_reason_required";
  const head = ctx.head;
  if (!head) return r.status === "not_confirmed" ? "dose_nothing_to_retract" : null;
  if (head.status === "not_confirmed")
    return r.status === "not_confirmed" ? "dose_no_change" : null;
  if (head.reportedBy !== ctx.actorId && !ctx.actorIsOrganizer)
    return "dose_correction_not_allowed";
  if (!r.changeReason) return "dose_reason_required";
  if (r.status === head.status && r.changeReason !== "confirmed_after_review")
    return "dose_no_change";
  return null;
}

/** The first rule a disagreement flag would break, or null. */
export function checkDisagreement(
  ctx: Pick<RuleContext, "actorId" | "actorCanSeeMeds" | "scheduledAtMs" | "head" | "expectedHead">,
): DoseErrorCode | null {
  if (!ctx.actorCanSeeMeds) return "dose_not_found";
  if (ctx.scheduledAtMs === null) return "dose_time_skipped";
  if (!ctx.head || ctx.head.status === "not_confirmed") return "dose_nothing_to_dispute";
  if (ctx.head.id !== ctx.expectedHead) return "dose_conflict";
  if (ctx.head.reportedBy === ctx.actorId) return "dose_use_correction_instead";
  return null;
}

/** What the screen offers for an occurrence. Display only: the database decides. */
export interface Actions {
  report: boolean; // first report: Mark given / Mark not given
  change: boolean; // change or withdraw the current report (reporter or organizer)
  flag: boolean; // flag a disagreement (another caregiver)
  lateOnly: boolean; // only an organizer, with a reason
  why: string | null; // a plain reason when nothing is offered
}
export function actionsFor(
  o: Pick<DoseOccurrence, "status" | "head_id" | "reported_by" | "scheduled_at" | "time_state">,
  actor: { isOrganizer: boolean; canSeeMeds: boolean; memberId: string },
  nowMs: number,
): Actions {
  const none = (why: string): Actions => ({
    report: false,
    change: false,
    flag: false,
    lateOnly: false,
    why,
  });
  if (!actor.canSeeMeds) return none("You do not have access to medications.");
  if (o.time_state === "skipped" || !o.scheduled_at) return none(DOSE_ERROR_TEXT.dose_time_skipped);
  const at = Date.parse(o.scheduled_at);
  if (at > nowMs) return none("Not due yet.");
  const late = nowMs - at > REPORT_WINDOW_MS;
  if (late && !actor.isOrganizer) return none(DOSE_ERROR_TEXT.dose_window_closed);
  if (o.status === "not_confirmed")
    return { report: true, change: false, flag: false, lateOnly: late, why: null };
  const mine = o.reported_by === actor.memberId;
  if (mine || actor.isOrganizer)
    return { report: false, change: true, flag: false, lateOnly: late, why: null };
  return { report: false, change: false, flag: true, lateOnly: false, why: null };
}
