// Shared fixtures for the Care Agent tests. All names and records are INVENTED. No real data, no keys, no network.
import { vi } from "vitest";
import type { DoseOccurrence } from "@/lib/dose-administration";
import type { PackAccess, PackRows } from "@/lib/care-agent/pack";
import type { CareAgentEnv, FamilyRow, MemberRow, PackSource } from "@/server/care-agent.server";

export const NOW = new Date("2026-10-28T15:00:00Z"); // 10:00 AM in America/Chicago
export const TZ = "America/Chicago";
export const FAMILY = "11111111-1111-4111-8111-111111111111";
export const USER = "22222222-2222-4222-8222-222222222222";
export const CANARY_KEY = "CANARY-KEY-do-not-leak-1234567890";
export const ENV_ON: CareAgentEnv = {
  AGENT_LIVE_ENABLED: "true",
  AGENT_LIVE_USER_IDS: USER,
  META_API_KEY: CANARY_KEY,
};

export const ALL: PackAccess = { visits: true, meds: true, schedule: true };
export const MED_BLIND: PackAccess = { visits: true, meds: false, schedule: true };
export const SCHEDULE_BLIND: PackAccess = { visits: true, meds: true, schedule: false };
export const VISIT_BLIND: PackAccess = { visits: false, meds: true, schedule: true };

/** A unique medication name + dose that must never reach a medication-blind member. */
export const SENTINEL_NAME = "Zorvanex";
export const SENTINEL_DOSE = "77 mg";
export const SENTINEL = `${SENTINEL_NAME} ${SENTINEL_DOSE}`;

const iso = (offsetHours: number) =>
  new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString();

export function dose(over: Partial<DoseOccurrence> = {}): DoseOccurrence {
  return {
    schedule_id: "aaaaaaaa-0000-4000-8000-000000000001",
    medication_id: "bbbbbbbb-0000-4000-8000-000000000001",
    medication_name: "Lisinopril",
    dose_text: "10 mg",
    local_date: "2026-10-28",
    local_time: "08:00:00",
    tz: TZ,
    scheduled_at: iso(-2),
    time_state: "normal",
    status: "given",
    head_id: "cccccccc-0000-4000-8000-000000000001",
    reported_by: "m-jordan",
    reported_by_name: "Jordan Lee",
    reported_at: iso(-1.5),
    not_given_reason: null,
    change_reason: null,
    outside_window: false,
    reports_differ: false,
    open_disagreements: 0,
    history_count: 1,
    ...over,
  };
}

export function baseRows(over: Partial<PackRows> = {}): PackRows {
  return {
    recipient: { id: "r1", name: "Pat Sample" },
    members: [
      { id: "m-jordan", name: "Jordan Lee" },
      { id: "m-casey", name: "Casey Ng" },
    ],
    visits: [
      {
        id: "v-next",
        status: "scheduled",
        confirmation_status: "confirmed",
        scheduled_start: iso(72),
        scheduled_end: iso(73),
        provider_name: "Dr. Sample",
        office_name: "Example Clinic",
        reason: "Check-up",
        notes: "Bring the folder",
        summary: null,
      },
      {
        id: "v-last",
        status: "completed",
        confirmation_status: "confirmed",
        scheduled_start: iso(-240),
        scheduled_end: iso(-239),
        provider_name: "Dr. Sample",
        office_name: "Example Clinic",
        reason: "Follow-up",
        notes: null,
        summary: "Reviewed progress",
      },
    ],
    medChanges: [
      {
        id: "mc1",
        visit_id: "v-last",
        medication: "Lisinopril",
        before: "5 mg",
        after: "10 mg",
        confirmed_at: iso(-230),
        unclear: false,
      },
    ],
    followUpTasks: [
      {
        id: "t-fu",
        title: "Book the follow-up",
        status: "open",
        due_date: "2026-11-02",
        owner_member_id: "m-casey",
        source_visit_id: "v-last",
      },
    ],
    followUpWatch: [],
    medications: [
      {
        id: "med1",
        name: "Lisinopril",
        dose: "10 mg",
        schedule: "Once daily, morning",
        status: "active",
      },
      {
        id: "med2",
        name: "Metformin",
        dose: "500 mg",
        schedule: "Twice daily with meals",
        status: "active",
      },
    ],
    doses: [dose()],
    handoffs: [
      {
        id: "h1",
        created_at: iso(-20),
        author_member_id: "m-jordan",
        ate: true,
        meds_taken: true,
        note: "Quiet evening",
        unusual: null,
        watch_answers: {},
      } as never,
    ],
    shifts: [
      { id: "s1", start: iso(10), end: iso(18), assigned_member_id: "m-casey", status: "claimed" },
    ],
    tasks: [
      {
        id: "t1",
        title: "Refill the pill organizer",
        status: "open",
        due_date: "2026-10-30",
        owner_member_id: "m-jordan",
        source_visit_id: null,
      },
    ],
    watch: [
      { id: "w1", text: "Ankle swelling", status: "active", ends_on: null, source_visit_id: null },
    ],
    medNames: null,
    ...over,
  };
}

export const memberRow = (over: Partial<MemberRow> = {}): MemberRow => ({
  id: "m-self",
  name: "Test Organizer",
  role: "organizer",
  language: "en",
  can_see_meds: true,
  can_see_schedule: true,
  can_see_visits: true,
  ...over,
});
export const familyRow = (over: Partial<FamilyRow> = {}): FamilyRow => ({
  id: FAMILY,
  is_demo: true,
  timezone: TZ,
  ...over,
});

/** A PackSource double that counts every read. Set `fail` to make a method throw. */
export function fakeSource(
  opts: {
    member?: MemberRow | null;
    family?: FamilyRow | null;
    rows?: PackRows;
    fail?: Partial<Record<"getMember" | "getFamily" | "loadRows", boolean>>;
  } = {},
) {
  const calls = { getMember: 0, getFamily: 0, loadRows: 0, accessSeen: [] as PackAccess[] };
  const source: PackSource = {
    async getMember() {
      calls.getMember++;
      if (opts.fail?.getMember) throw new Error("db");
      return opts.member === undefined ? memberRow() : opts.member;
    },
    async getFamily() {
      calls.getFamily++;
      if (opts.fail?.getFamily) throw new Error("db");
      return opts.family === undefined ? familyRow() : opts.family;
    },
    async loadRows({ access }) {
      calls.loadRows++;
      calls.accessSeen.push(access);
      if (opts.fail?.loadRows) throw new Error("db");
      return opts.rows ?? baseRows();
    },
  };
  return { source, calls };
}

/** A Meta chat-completions reply whose content is the given string. */
export const providerReply = (content: string, init: { status?: number } = {}) =>
  new Response(
    JSON.stringify({
      model: "muse-spark-1.3",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    },
  );

export const answerJson = (a: {
  answer?: string;
  citations?: string[];
  missing?: string[];
  refusal?: "medical_advice" | "out_of_scope" | null;
}) =>
  JSON.stringify({
    answer: a.answer ?? "",
    citations: a.citations ?? [],
    missing: a.missing ?? [],
    refusal: a.refusal ?? null,
  });

export const mockFetch = (impl: () => Response | Promise<Response>) =>
  vi.fn(async (_url: string, _init: RequestInit) => impl());
