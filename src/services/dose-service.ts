// Feature C data access: medication schedules, computed dose occurrences and the append-only administration reports.
// Every call goes to a database function or table that enforces its own rules (supabase/migrations/20261027000001_dose_administration.sql);
// nothing here supplies a reporter, a clock or a family: the database derives them. Re-exported from src/services/index.ts.
//
// The generated database types do not know the new tables/functions until the migration is applied and the types regenerate, so the
// client is used through a small structural type here and every row coming back is validated before it reaches the screens.
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  CHANGE_REASONS,
  DoseError,
  NOT_GIVEN_REASONS,
  parseDoseError,
  scheduleValid,
  validateScheduleInput,
  isDateString,
  type ChangeReason,
  type DoseHistoryEntry,
  type DoseOccurrence,
  type DoseStatus,
  type NotGivenReason,
  type ScheduleInput,
} from "@/lib/dose-administration";

type Reply = { data: unknown; error: { message: string } | null };
interface Builder extends PromiseLike<Reply> {
  select(columns?: string): Builder;
  eq(column: string, value: unknown): Builder;
  order(column: string, opts?: { ascending: boolean }): Builder;
  insert(values: unknown): Builder;
  update(values: unknown): Builder;
  delete(): Builder;
  single(): Builder;
}
interface Loose {
  from(table: string): Builder;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Reply>;
}
const db = () => supabase as unknown as Loose;

function unwrap(res: Reply): unknown {
  if (res.error) throw parseDoseError(res.error.message);
  return res.data;
}

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const statusZ = z.enum(["given", "not_given", "not_confirmed"]);
const occurrenceZ = z.object({
  schedule_id: uuid,
  medication_id: uuid,
  medication_name: z.string(),
  dose_text: z.string().nullable(),
  local_date: dateStr,
  local_time: z.string(),
  tz: z.string(),
  scheduled_at: z.string().nullable(),
  time_state: z.enum(["normal", "ambiguous", "skipped"]),
  status: statusZ,
  head_id: uuid.nullable(),
  reported_by: uuid.nullable(),
  reported_by_name: z.string().nullable(),
  reported_at: z.string().nullable(),
  not_given_reason: z.enum(NOT_GIVEN_REASONS).nullable(),
  change_reason: z.enum(CHANGE_REASONS).nullable(),
  outside_window: z.boolean(),
  reports_differ: z.boolean(),
  open_disagreements: z.number().int().min(0),
  history_count: z.number().int().min(0),
});
const historyZ = z.object({
  id: uuid,
  seq: z.coerce.number(),
  entry_kind: z.enum(["report", "disagreement"]),
  status: statusZ.nullable(),
  not_given_reason: z.enum(NOT_GIVEN_REASONS).nullable(),
  change_reason: z.enum(CHANGE_REASONS).nullable(),
  outside_window: z.boolean(),
  supersedes: uuid.nullable(),
  disputes: uuid.nullable(),
  reporter_name: z.string(),
  reported_at: z.string(),
});
const scheduleZ = z.object({
  id: uuid,
  family_id: uuid,
  medication_id: uuid,
  local_time: z.string(),
  days_of_week: z.array(z.number().int().min(1).max(7)),
  starts_on: dateStr,
  ends_on: dateStr.nullable(),
  created_at: z.string(),
});
export type ScheduleRow = z.infer<typeof scheduleZ>;

const parseRows = <T>(schema: z.ZodType<T>, data: unknown, what: string): T[] => {
  const r = z.array(schema).safeParse(data ?? []);
  if (!r.success) throw new DoseError("unknown", `The ${what} could not be read.`);
  return r.data;
};

export interface ReportArgs {
  scheduleId: string;
  localDate: string;
  status: DoseStatus;
  /** the head the screen was showing (null = it showed "no report yet"); a mismatch is a conflict, never an overwrite */
  expectedHead: string | null;
  /** one id per submission attempt: resending the same id never adds a second report */
  requestId: string;
  notGivenReason?: NotGivenReason | null;
  changeReason?: ChangeReason | null;
}

export const doseService = {
  // ---------- schedules (organizer writes; visible to people who may see medications)
  async listSchedules(familyId: string): Promise<ScheduleRow[]> {
    const data = unwrap(
      await db()
        .from("medication_schedule")
        .select("*")
        .eq("family_id", familyId)
        .order("local_time"),
    );
    return parseRows(scheduleZ, data, "dose times");
  },
  async addSchedule(familyId: string, input: ScheduleInput) {
    if (!scheduleValid(input)) {
      const first = Object.values(validateScheduleInput(input))[0];
      throw new DoseError("dose_bad_request", first ?? "That schedule is not valid.");
    }
    return unwrap(
      await db()
        .from("medication_schedule")
        .insert({
          family_id: familyId,
          medication_id: input.medication_id,
          local_time: input.local_time,
          days_of_week: [...input.days_of_week].sort((a, b) => a - b),
          starts_on: input.starts_on,
          ends_on: input.ends_on,
        })
        .select()
        .single(),
    );
  },
  async endSchedule(id: string, endsOn: string) {
    if (!isDateString(endsOn)) throw new DoseError("dose_bad_request", "Choose a valid end date.");
    return unwrap(
      await db()
        .from("medication_schedule")
        .update({ ends_on: endsOn })
        .eq("id", id)
        .select()
        .single(),
    );
  },
  async deleteSchedule(id: string) {
    return unwrap(await db().from("medication_schedule").delete().eq("id", id));
  },

  // ---------- reading
  async occurrences(familyId: string, from: string, to: string): Promise<DoseOccurrence[]> {
    const data = unwrap(
      await db().rpc("dose_occurrences", { _family_id: familyId, _from: from, _to: to }),
    );
    return parseRows(occurrenceZ, data, "doses") as DoseOccurrence[];
  },
  async history(scheduleId: string, localDate: string): Promise<DoseHistoryEntry[]> {
    const data = unwrap(
      await db()
        .from("dose_administration")
        .select("*")
        .eq("schedule_id", scheduleId)
        .eq("local_date", localDate)
        .order("seq"),
    );
    return parseRows(historyZ, data, "history") as DoseHistoryEntry[];
  },

  // ---------- reporting (database functions only: the reporter, time and family are decided there)
  async report(a: ReportArgs) {
    return unwrap(
      await db().rpc("report_dose", {
        _schedule_id: a.scheduleId,
        _local_date: a.localDate,
        _status: a.status,
        _expected_head: a.expectedHead,
        _client_request_id: a.requestId,
        _not_given_reason: a.status === "not_given" ? (a.notGivenReason ?? null) : null,
        _change_reason: a.changeReason ?? null,
      }),
    );
  },
  async flagDisagreement(
    a: Pick<ReportArgs, "scheduleId" | "localDate" | "expectedHead" | "requestId">,
  ) {
    return unwrap(
      await db().rpc("flag_dose_disagreement", {
        _schedule_id: a.scheduleId,
        _local_date: a.localDate,
        _expected_head: a.expectedHead,
        _client_request_id: a.requestId,
      }),
    );
  },
};
