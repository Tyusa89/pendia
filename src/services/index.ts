// Service layer: every Lovable Cloud call goes through here so features can grow incrementally.
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { AppointmentInput } from "@/lib/appointments";
import { overlapsForMember, validateShiftTimes, ShiftValidationError, type ShiftInput } from "@/lib/shifts";
import { normalizePhone } from "@/lib/format";

export type Family = Tables<"family">;
export type Member = Tables<"member">;
export type CareRecipient = Tables<"care_recipient">;
export type Visit = Tables<"visit">;
export type Medication = Tables<"medication">;
export type MedChange = Tables<"med_change">;
export type Task = Tables<"task">;
export type WatchItem = Tables<"watch_item">;
export type Shift = Tables<"shift">;
export type Handoff = Tables<"handoff">;
export type Digest = Tables<"digest">;
/** One diarized turn. `speaker` is the anonymous session-scoped label ("A", "B", …). */
export type TranscriptLine = { speaker: string; start_s: number; end_s: number; text: string; unclear?: boolean };

function ok<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/** Phones are stored as E.164; reject anything we can't normalise rather than saving junk. */
function withPhone<T extends { phone?: string | null }>(m: T): T {
  if (m.phone == null || m.phone === "") return { ...m, phone: null };
  const phone = normalizePhone(m.phone);
  if (!phone) throw new Error("Enter a valid phone number, like (212) 555-0102.");
  return { ...m, phone };
}

// ---------- Auth ----------
export const authService = {
  async currentUserId() {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  },
  signIn: (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email: string, password: string) =>
    supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }),
  signOut: () => supabase.auth.signOut(),
};

// ---------- Family ----------
export const familyService = {
  /** The user's family (first membership), or null. */
  async getMyFamily(): Promise<{ family: Family; me: Member } | null> {
    const uid = await authService.currentUserId();
    if (!uid) return null;
    const rows = ok(
      await supabase.from("member").select("*, family(*)").eq("user_id", uid).order("created_at").limit(1),
    );
    const row = rows[0] as (Member & { family: Family }) | undefined;
    if (!row) return null;
    const { family, ...me } = row;
    return { family, me };
  },
  async createFamily(name: string, myName: string) {
    const uid = await authService.currentUserId();
    if (!uid) throw new Error("Not signed in");
    const fam = ok(await supabase.from("family").insert({ name, created_by: uid }).select().single()) as Family;
    ok(await supabase.from("member").insert({ family_id: fam.id, user_id: uid, name: myName, role: "organizer" }));
    return fam;
  },
  async joinDemo() {
    return ok(await supabase.rpc("join_demo_family"));
  },
  async listMembers(familyId: string) {
    return ok(await supabase.from("member").select("*").eq("family_id", familyId).order("created_at"));
  },
  async addMember(m: TablesInsert<"member">) {
    return ok(await supabase.from("member").insert(withPhone(m)).select().single());
  },
  async updateMember(id: string, patch: TablesUpdate<"member">) {
    return ok(await supabase.from("member").update(withPhone(patch)).eq("id", id).select().single());
  },
  async getRecipient(familyId: string) {
    const rows = ok(await supabase.from("care_recipient").select("*").eq("family_id", familyId).limit(1));
    return rows[0] ?? null;
  },
  async saveRecipient(familyId: string, name: string, notes: string, id?: string) {
    if (id) return ok(await supabase.from("care_recipient").update({ name, notes }).eq("id", id).select().single());
    return ok(await supabase.from("care_recipient").insert({ family_id: familyId, name, notes }).select().single());
  },
};

// ---------- Visits ----------
export const visitService = {
  async list(familyId: string) {
    return ok(await supabase.from("visit").select("*").eq("family_id", familyId).order("date", { ascending: false }));
  },
  async get(id: string) {
    const visit = ok(await supabase.from("visit").select("*").eq("id", id).single()) as Visit;
    const [changes, tasks, watch] = await Promise.all([
      supabase.from("med_change").select("*").eq("visit_id", id).order("created_at"),
      supabase.from("task").select("*").eq("source_visit_id", id).order("due_date"),
      supabase.from("watch_item").select("*").eq("source_visit_id", id).order("created_at"),
    ]);
    return { visit, changes: ok(changes), tasks: ok(tasks), watch: ok(watch) };
  },
  // ---- appointments (V1): the same `visit` rows; RLS is unchanged (organizer writes, members read per can_see_visits) ----
  async createAppointment(familyId: string, a: AppointmentInput) {
    // `date` is NOT NULL on the table; the database re-derives it from scheduled_start in the family's timezone.
    return ok(
      await supabase.from("visit").insert({ ...a, family_id: familyId, date: a.scheduled_start.slice(0, 10) }).select().single(),
    ) as Visit;
  },
  async updateAppointment(id: string, a: AppointmentInput) {
    return ok(await supabase.from("visit").update({ ...a }).eq("id", id).select().single()) as Visit;
  },
  async cancelAppointment(id: string) {
    return ok(await supabase.from("visit").update({ status: "canceled" }).eq("id", id).select().single()) as Visit;
  },
  /** Only changes `status`. Details, recordings, transcript and consent are untouched. Organizer-only via RLS. */
  async completeAppointment(id: string) {
    return ok(await supabase.from("visit").update({ status: "completed" }).eq("id", id).select().single()) as Visit;
  },
  async archiveAppointment(id: string) {
    return ok(await supabase.from("visit").update({ archived_at: new Date().toISOString() }).eq("id", id).select().single()) as Visit;
  },
  async unarchiveAppointment(id: string) {
    return ok(await supabase.from("visit").update({ archived_at: null }).eq("id", id).select().single()) as Visit;
  },
  /** The database stamps confirmed_by / confirmed_at from the signed-in member; the client cannot set them. */
  async confirmChange(id: string) {
    return ok(await supabase.from("med_change").update({ status: "confirmed" }).eq("id", id).select().single());
  },
};

// ---------- Medications ----------
export const medicationService = {
  async list(familyId: string) {
    return ok(await supabase.from("medication").select("*").eq("family_id", familyId).order("name"));
  },
  async add(m: TablesInsert<"medication">) {
    return ok(await supabase.from("medication").insert(m).select().single());
  },
};

// ---------- Coverage ----------
export const shiftService = {
  async listRange(familyId: string, fromIso: string, toIso: string) {
    return ok(
      await supabase.from("shift").select("*").eq("family_id", familyId).gte("start", fromIso).lt("start", toIso).order("start"),
    );
  },
  async claim(id: string, memberId: string) {
    // Only claims a shift that is still open, so two people tapping at once can't overwrite each other.
    const rows = ok(
      await supabase
        .from("shift")
        .update({ assigned_member_id: memberId, status: "claimed" })
        .eq("id", id)
        .is("assigned_member_id", null)
        .select(),
    );
    if (!rows.length) throw new Error("Someone already took this shift, or you can't change the schedule.");
    return rows[0];
  },
  // ---- coverage editing (C1): organizer-only by the database's row-level rules; the checks here make bad input fail early ----

  /** The assignee must be a member of the same family (the database also enforces this). */
  async assertAssignee(familyId: string, memberId: string | null) {
    if (!memberId) return;
    const { data, error } = await supabase
      .from("member")
      .select("id")
      .eq("id", memberId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ShiftValidationError("That person isn't a member of this family.");
  },
  /** Other shifts of the same member that overlap this one. Flagged to the caller, never a reason to refuse. */
  async overlapsFor(
    familyId: string,
    memberId: string | null,
    start: string,
    end: string,
    ignoreId?: string,
  ) {
    if (!memberId) return [];
    const rows = ok(
      await supabase
        .from("shift")
        .select("*")
        .eq("family_id", familyId)
        .eq("assigned_member_id", memberId)
        .lt("start", end)
        .gt("end", start),
    );
    return overlapsForMember(rows, memberId, start, end, ignoreId);
  },
  async createShift(familyId: string, input: ShiftInput) {
    const t = validateShiftTimes(input.start, input.end);
    await shiftService.assertAssignee(familyId, input.assigned_member_id);
    const rows = ok(
      await supabase
        .from("shift")
        .insert({
          family_id: familyId,
          start: t.start,
          end: t.end,
          assigned_member_id: input.assigned_member_id,
          status: input.assigned_member_id ? "claimed" : "open",
        })
        .select(),
    );
    const shift = rows[0];
    if (!shift) throw new Error("You don't have permission to schedule coverage for this family.");
    const overlaps = await shiftService.overlapsFor(
      familyId,
      shift.assigned_member_id,
      t.start,
      t.end,
      shift.id,
    );
    return { shift, overlaps };
  },
  async updateShift(id: string, input: ShiftInput) {
    const t = validateShiftTimes(input.start, input.end);
    const found = ok(await supabase.from("shift").select("*").eq("id", id));
    const current = found[0];
    if (!current) throw new Error("That shift wasn't found, or you don't have access to it.");
    await shiftService.assertAssignee(current.family_id, input.assigned_member_id);
    const rows = ok(
      await supabase
        .from("shift")
        .update({
          start: t.start,
          end: t.end,
          assigned_member_id: input.assigned_member_id,
          status: input.assigned_member_id ? "claimed" : "open",
        })
        .eq("id", id)
        .select(),
    );
    const shift = rows[0];
    // Row-level security hides rows a person may not change, so a refused update matches nothing instead of erroring.
    if (!shift) throw new Error("You don't have permission to change this shift.");
    const overlaps = await shiftService.overlapsFor(
      current.family_id,
      shift.assigned_member_id,
      t.start,
      t.end,
      id,
    );
    return { shift, overlaps };
  },
  /**
   * Cancel = delete the shift. `shift.status` only allows open / claimed / swap (checked against the live database), so
   * there is no "canceled" status to set, and adding one would be a schema change. Handoffs that point at the shift keep working (their shift_id becomes null).
   */
  async cancelShift(id: string) {
    const rows = ok(await supabase.from("shift").delete().eq("id", id).select());
    if (!rows[0])
      throw new Error("You don't have permission to cancel this shift, or it was already removed.");
    return rows[0];
  },
};

// ---------- Handoffs ----------
export const handoffService = {
  async list(familyId: string) {
    return ok(await supabase.from("handoff").select("*").eq("family_id", familyId).order("created_at", { ascending: false }));
  },
  async create(h: TablesInsert<"handoff">) {
    return ok(await supabase.from("handoff").insert(h).select().single());
  },
  async activeWatchItems(familyId: string) {
    const today = new Date().toISOString().slice(0, 10);
    return ok(
      await supabase.from("watch_item").select("*").eq("family_id", familyId).or(`ends_on.is.null,ends_on.gte.${today}`),
    );
  },
};

// ---------- Digest ----------
export const digestService = {
  async latest(familyId: string) {
    return ok(await supabase.from("digest").select("*").eq("family_id", familyId).order("week", { ascending: false }).limit(10));
  },
};

export * from "./recordings";
