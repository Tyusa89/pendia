// Demo Mode for medication reports: SYNTHETIC people, SYNTHETIC medications, a fixed virtual clock. It reads no family
// data, writes nothing and never calls a service, network, microphone, SMS or AI provider. It follows the same reporting
// rules as the real feature by calling the pure rule functions (the same ones the database function is tested against).
// No AI model marks any dose; every status here comes from a person pressing a button.
import {
  checkDisagreement,
  checkReport,
  computeOccurrences,
  type ChangeReason,
  type DoseErrorCode,
  type DoseHistoryEntry,
  type DoseOccurrence,
  type DoseStatus,
  type NotGivenReason,
  type ScheduleLike,
} from "@/lib/dose-administration";

export const DEMO_TZ = "America/Chicago";
export const DEMO_DATE = "2026-10-28";
/** 9:15 PM on the demo day, family time. The virtual clock never moves. */
export const DEMO_NOW_MS = Date.parse("2026-10-29T02:15:00Z");

export const DEMO_MEMBERS = [
  { id: "elena", name: "Elena", role: "organizer" },
  { id: "carlos", name: "Carlos", role: "member" },
  { id: "lucia", name: "Lucía", role: "member" },
] as const;
export type DemoMemberId = (typeof DEMO_MEMBERS)[number]["id"];

export const DEMO_MEDS = [
  { id: "med-alpha", name: "Medication Alpha", dose: "1 tablet" },
  { id: "med-beta", name: "Medication Beta", dose: "2 capsules" },
] as const;

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
export const DEMO_SCHEDULES: ScheduleLike[] = [
  {
    id: "sch-1",
    medication_id: "med-alpha",
    local_time: "08:00",
    days_of_week: EVERY_DAY,
    starts_on: "2026-10-01",
    ends_on: null,
  },
  {
    id: "sch-2",
    medication_id: "med-beta",
    local_time: "12:00",
    days_of_week: EVERY_DAY,
    starts_on: "2026-10-01",
    ends_on: null,
  },
  {
    id: "sch-3",
    medication_id: "med-alpha",
    local_time: "20:00",
    days_of_week: EVERY_DAY,
    starts_on: "2026-10-01",
    ends_on: null,
  },
  {
    id: "sch-4",
    medication_id: "med-beta",
    local_time: "22:00",
    days_of_week: EVERY_DAY,
    starts_on: "2026-10-01",
    ends_on: null,
  },
];

export interface DemoEntry {
  id: string;
  scheduleId: string;
  kind: "report" | "disagreement";
  status: DoseStatus | null;
  notGivenReason: NotGivenReason | null;
  changeReason: ChangeReason | null;
  by: DemoMemberId;
  atMs: number;
  /** the report this entry disputes */
  disputes: string | null;
}
export interface DemoState {
  actor: DemoMemberId;
  entries: DemoEntry[];
}

/** Carlos reported the morning dose at 8:02 AM. Nothing else has been reported. */
export const initialState = (): DemoState => ({
  actor: "elena",
  entries: [
    {
      id: "e-1",
      scheduleId: "sch-1",
      kind: "report",
      status: "given",
      notGivenReason: null,
      changeReason: null,
      by: "carlos",
      atMs: Date.parse("2026-10-28T13:02:00Z"),
      disputes: null,
    },
  ],
});

const nameOf = (id: string) => DEMO_MEMBERS.find((m) => m.id === id)?.name ?? "Someone";
const reports = (s: DemoState, scheduleId: string) =>
  s.entries.filter((e) => e.scheduleId === scheduleId && e.kind === "report");
const headOf = (s: DemoState, scheduleId: string) => reports(s, scheduleId).at(-1) ?? null;

export function occurrencesOf(s: DemoState): DoseOccurrence[] {
  return computeOccurrences(DEMO_SCHEDULES, DEMO_TZ, DEMO_DATE, DEMO_DATE).map((c) => {
    const med = DEMO_MEDS.find((m) => m.id === c.medication_id)!;
    const head = headOf(s, c.schedule_id);
    const flags = s.entries.filter(
      (e) => e.scheduleId === c.schedule_id && e.kind === "disagreement" && e.disputes === head?.id,
    );
    const all = s.entries.filter((e) => e.scheduleId === c.schedule_id);
    return {
      ...c,
      medication_name: med.name,
      dose_text: med.dose,
      tz: DEMO_TZ,
      status: head?.status ?? "not_confirmed",
      head_id: head?.id ?? null,
      reported_by: head?.by ?? null,
      reported_by_name: head ? nameOf(head.by) : null,
      reported_at: head ? new Date(head.atMs).toISOString() : null,
      not_given_reason: head?.notGivenReason ?? null,
      change_reason: head?.changeReason ?? null,
      outside_window: false,
      reports_differ: false,
      open_disagreements: flags.length,
      history_count: all.length,
    };
  });
}

export function historyOf(s: DemoState, scheduleId: string): DoseHistoryEntry[] {
  return s.entries
    .filter((e) => e.scheduleId === scheduleId)
    .map((e, i) => ({
      id: e.id,
      seq: i + 1,
      entry_kind: e.kind,
      status: e.status,
      not_given_reason: e.notGivenReason,
      change_reason: e.changeReason,
      outside_window: false,
      supersedes: null,
      disputes: e.disputes,
      reporter_name: nameOf(e.by),
      reported_at: new Date(e.atMs).toISOString(),
    }));
}

export type Action =
  | { type: "actor"; actor: DemoMemberId }
  | {
      type: "report";
      scheduleId: string;
      expectedHead: string | null;
      status: DoseStatus;
      notGivenReason: NotGivenReason | null;
      changeReason: ChangeReason | null;
    }
  | { type: "flag"; scheduleId: string; expectedHead: string | null }
  | { type: "reset" };

export interface Outcome {
  state: DemoState;
  error: DoseErrorCode | null;
}

export function reduce(s: DemoState, a: Action): Outcome {
  if (a.type === "reset") return { state: initialState(), error: null };
  if (a.type === "actor") return { state: { ...s, actor: a.actor }, error: null };
  const occ = occurrencesOf(s).find((o) => o.schedule_id === a.scheduleId);
  const head = headOf(s, a.scheduleId);
  if (!occ) return { state: s, error: "dose_not_found" };
  const scheduledAtMs = occ.scheduled_at ? Date.parse(occ.scheduled_at) : null;
  const actor = DEMO_MEMBERS.find((m) => m.id === s.actor)!;
  const rule = {
    actorId: actor.id,
    actorCanSeeMeds: true,
    scheduledAtMs,
    head: head ? { id: head.id, status: head.status!, reportedBy: head.by } : null,
    expectedHead: a.expectedHead,
  };
  const error =
    a.type === "flag"
      ? checkDisagreement(rule)
      : checkReport(
          { ...rule, actorIsOrganizer: actor.role === "organizer", nowMs: DEMO_NOW_MS },
          a,
        );
  if (error) return { state: s, error };
  const entry: DemoEntry =
    a.type === "flag"
      ? {
          id: `e-${s.entries.length + 1}`,
          scheduleId: a.scheduleId,
          kind: "disagreement",
          status: null,
          notGivenReason: null,
          changeReason: null,
          by: actor.id,
          atMs: DEMO_NOW_MS,
          disputes: head!.id,
        }
      : {
          id: `e-${s.entries.length + 1}`,
          scheduleId: a.scheduleId,
          kind: "report",
          status: a.status,
          notGivenReason: a.status === "not_given" ? a.notGivenReason : null,
          changeReason: a.changeReason,
          by: actor.id,
          atMs: DEMO_NOW_MS,
          disputes: null,
        };
  return { state: { ...s, entries: [...s.entries, entry] }, error: null };
}
