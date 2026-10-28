// SERVER ONLY. The Care Agent's database reads. Every read uses the CALLER'S OWN session (`context.supabase` from
// requireSupabaseAuth), so row-level security applies to every row; there is no service-role client here and none may be added.
//   * Explicit column lists only: no select("*"), and the lists below are the complete set of columns the agent can ever receive.
//   * Amendment A at QUERY time: a medication-blind member's handoff query uses HANDOFF_COLUMNS_METADATA, a different string that
//     does not name meds_taken, note, unusual or watch_answers, so those columns never leave the database for that member.
//   * Never selected for anyone: visit transcript, audio paths/URLs/MIME, consent fields, speaker maps, phone numbers, handoff
//     recording metadata, care-recipient notes.
//   * Every query is scoped with .eq("family_id", familyId). Any error throws; nothing is ever returned partially.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DoseOccurrence } from "@/lib/dose-administration";
import { AGENT_LIMITS } from "@/lib/care-agent/contract";
import type {
  HandoffFullRow,
  HandoffMetaRow,
  MedChangeRow,
  MedicationRow,
  MemberNameRow,
  PackRows,
  RecipientRow,
  ShiftRow,
  TaskRow,
  VisitRow,
  WatchRow,
} from "@/lib/care-agent/pack";
import type { FamilyRow, MemberRow, PackSource } from "@/server/care-agent.server";

export const MEMBER_COLUMNS =
  "id, name, role, language, can_see_meds, can_see_schedule, can_see_visits";
export const FAMILY_COLUMNS = "id, is_demo, timezone";
export const RECIPIENT_COLUMNS = "id, name";
export const MEMBER_NAME_COLUMNS = "id, name";
export const VISIT_COLUMNS =
  "id, status, confirmation_status, scheduled_start, scheduled_end, provider_name, office_name, reason, notes, summary";
export const MEDCHANGE_COLUMNS = "id, visit_id, medication, before, after, confirmed_at, unclear";
export const TASK_COLUMNS = "id, title, status, due_date, owner_member_id, source_visit_id";
export const WATCH_COLUMNS = "id, text, status, ends_on, source_visit_id";
export const MEDICATION_COLUMNS = "id, name, dose, schedule, status";
export const MEDICATION_NAME_COLUMNS = "name";
export const SHIFT_COLUMNS = "id, start, end, assigned_member_id, status";
/** Both handoff tiers. The metadata list is the ONLY one a medication-blind member's query may use. */
export const HANDOFF_COLUMNS_FULL =
  "id, created_at, author_member_id, ate, meds_taken, note, unusual, watch_answers";
export const HANDOFF_COLUMNS_METADATA = "id, created_at, author_member_id, ate";

type Client = Pick<SupabaseClient<Database>, "from" | "rpc">;
type Reply = { data: unknown; error: unknown };
/** The slice of the query builder this module uses. Awaiting it yields { data, error }. */
interface Query extends PromiseLike<Reply> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  is(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(count: number): Query;
}

function must<T>(res: Reply): T[] {
  if (res.error) throw new Error("care_agent_read_failed");
  return ((res.data as T[] | null) ?? []) as T[];
}

const ymd = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

export function createSupabasePackSource(supabase: Client, userId: string): PackSource {
  // Loosely typed view of the query builder: the column lists are string constants (see above), so the typed select parser cannot
  // be used; every result is checked for `error` and cast to the row type it was selected for.
  const db = supabase as unknown as {
    from(table: string): Query;
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<Reply>;
  };

  return {
    async getMember(familyId): Promise<MemberRow | null> {
      const res = (await db
        .from("member")
        .select(MEMBER_COLUMNS)
        .eq("family_id", familyId)
        .eq("user_id", userId)
        .limit(1)) as Reply;
      return must<MemberRow>(res)[0] ?? null;
    },
    async getFamily(familyId): Promise<FamilyRow | null> {
      const res = (await db
        .from("family")
        .select(FAMILY_COLUMNS)
        .eq("id", familyId)
        .limit(1)) as Reply;
      return must<FamilyRow>(res)[0] ?? null;
    },
    async loadRows({ familyId, access, now, timezone }): Promise<PackRows> {
      const nowIso = now.toISOString();
      const horizon = new Date(
        now.getTime() + AGENT_LIMITS.coordinationDays * 86_400_000,
      ).toISOString();
      const rec = db
        .from("care_recipient")
        .select(RECIPIENT_COLUMNS)
        .eq("family_id", familyId)
        .limit(1);
      const mem = db.from("member").select(MEMBER_NAME_COLUMNS).eq("family_id", familyId);

      // visits first: the visit-associated reads need their ids
      let visits: VisitRow[] = [];
      if (access.visits) {
        const [up, recent] = await Promise.all([
          db
            .from("visit")
            .select(VISIT_COLUMNS)
            .eq("family_id", familyId)
            .eq("status", "scheduled")
            .is("archived_at", null)
            .gte("scheduled_start", nowIso)
            .order("scheduled_start", { ascending: true })
            .limit(1),
          db
            .from("visit")
            .select(VISIT_COLUMNS)
            .eq("family_id", familyId)
            .eq("status", "completed")
            .is("archived_at", null)
            .not("scheduled_start", "is", null)
            .order("scheduled_start", { ascending: false })
            .limit(1),
        ]);
        visits = [...must<VisitRow>(up as Reply), ...must<VisitRow>(recent as Reply)];
      }
      const visitIds = visits.map((v) => v.id);

      const wants = {
        medChanges: access.visits && access.meds && visitIds.length > 0,
        followUps: access.visits && visitIds.length > 0,
      };
      const medChangesQ = wants.medChanges
        ? db
            .from("med_change")
            .select(MEDCHANGE_COLUMNS)
            .eq("family_id", familyId)
            .in("visit_id", visitIds)
            .eq("status", "confirmed")
        : null;
      const fuTaskQ = wants.followUps
        ? db
            .from("task")
            .select(TASK_COLUMNS)
            .eq("family_id", familyId)
            .in("source_visit_id", visitIds)
            .eq("status", "open")
        : null;
      const fuWatchQ = wants.followUps
        ? db
            .from("watch_item")
            .select(WATCH_COLUMNS)
            .eq("family_id", familyId)
            .in("source_visit_id", visitIds)
            .eq("status", "active")
        : null;

      const medsQ = access.meds
        ? db
            .from("medication")
            .select(MEDICATION_COLUMNS)
            .eq("family_id", familyId)
            .eq("status", "active")
            .order("name")
            .limit(AGENT_LIMITS.medicationSectionMax)
        : null;
      const from = ymd(
        new Date(now.getTime() - AGENT_LIMITS.doseWindowHours * 3_600_000),
        timezone,
      );
      const dosesQ = access.meds
        ? db.rpc("dose_occurrences", { _family_id: familyId, _from: from, _to: ymd(now, timezone) })
        : null;
      // Q1: the medication-name set, loaded ONLY to screen free text for a member without medication visibility. Under that
      // member's own RLS session it comes back empty, which the pack builder treats as "cannot screen" and fails closed.
      const namesQ = !access.meds
        ? db.from("medication").select(MEDICATION_NAME_COLUMNS).eq("family_id", familyId)
        : null;

      const handoffsQ = access.schedule
        ? db
            .from("handoff")
            .select(access.meds ? HANDOFF_COLUMNS_FULL : HANDOFF_COLUMNS_METADATA)
            .eq("family_id", familyId)
            .order("created_at", { ascending: false })
            .limit(AGENT_LIMITS.handoffsMax)
        : null;
      const shiftsQ = access.schedule
        ? db
            .from("shift")
            .select(SHIFT_COLUMNS)
            .eq("family_id", familyId)
            .gt("end", nowIso)
            .lt("start", horizon)
            .order("start", { ascending: true })
            .limit(20)
        : null;
      const tasksQ = access.schedule
        ? db
            .from("task")
            .select(TASK_COLUMNS)
            .eq("family_id", familyId)
            .is("source_visit_id", null)
            .eq("status", "open")
            .limit(10)
        : null;
      const watchQ = access.schedule
        ? db
            .from("watch_item")
            .select(WATCH_COLUMNS)
            .eq("family_id", familyId)
            .is("source_visit_id", null)
            .eq("status", "active")
            .limit(10)
        : null;

      const [r, m, mc, ft, fw, md, ds, nm, ho, sh, tk, wa] = (await Promise.all([
        rec,
        mem,
        medChangesQ,
        fuTaskQ,
        fuWatchQ,
        medsQ,
        dosesQ,
        namesQ,
        handoffsQ,
        shiftsQ,
        tasksQ,
        watchQ,
      ])) as Array<Reply | null>;
      const rows = (x: Reply | null | undefined) => (x ? must<never>(x) : []);
      return {
        recipient: (rows(r)[0] as RecipientRow | undefined) ?? null,
        members: rows(m) as MemberNameRow[],
        visits,
        medChanges: rows(mc) as MedChangeRow[],
        followUpTasks: rows(ft) as TaskRow[],
        followUpWatch: rows(fw) as WatchRow[],
        medications: rows(md) as MedicationRow[],
        doses: rows(ds) as DoseOccurrence[],
        handoffs: rows(ho) as Array<HandoffMetaRow | HandoffFullRow>,
        shifts: rows(sh) as ShiftRow[],
        tasks: rows(tk) as TaskRow[],
        watch: rows(wa) as WatchRow[],
        medNames: access.meds ? null : (rows(nm) as Array<{ name: string }>).map((x) => x.name),
      };
    },
  };
}
