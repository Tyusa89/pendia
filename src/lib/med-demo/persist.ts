// Session-scoped recovery for the medication demo (sessionStorage, this tab only). Stores only choices made in the demo
// (who is acting and which synthetic reports were entered), re-checked against the fixtures on restore.
import { z } from "zod";
import { CHANGE_REASONS, NOT_GIVEN_REASONS } from "@/lib/dose-administration";
import { DEMO_MEMBERS, DEMO_SCHEDULES, initialState, type DemoState } from "@/lib/med-demo/state";

export const STORAGE_KEY = "pendia.demo.meds";
export const STORAGE_VERSION = 1;
export const MAX_STORED_BYTES = 6144;

const ids = DEMO_MEMBERS.map((m) => m.id) as [string, ...string[]];
const scheduleIds = DEMO_SCHEDULES.map((s) => s.id) as [string, ...string[]];
const schema = z
  .object({
    v: z.literal(STORAGE_VERSION),
    actor: z.enum(ids),
    entries: z
      .array(
        z
          .object({
            id: z.string().regex(/^e-[0-9]{1,3}$/),
            scheduleId: z.enum(scheduleIds),
            kind: z.enum(["report", "disagreement"]),
            status: z.enum(["given", "not_given", "not_confirmed"]).nullable(),
            notGivenReason: z.enum(NOT_GIVEN_REASONS).nullable(),
            changeReason: z.enum(CHANGE_REASONS).nullable(),
            by: z.enum(ids),
            atMs: z.number().int(),
            disputes: z
              .string()
              .regex(/^e-[0-9]{1,3}$/)
              .nullable(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

export function save(s: DemoState, store: Storage | undefined = safeStore()): void {
  try {
    store?.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: STORAGE_VERSION, actor: s.actor, entries: s.entries }),
    );
  } catch {
    /* storage unavailable: the demo still works for this page view */
  }
}

export function restore(store: Storage | undefined = safeStore()): DemoState {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_STORED_BYTES) return initialState();
    const r = schema.safeParse(JSON.parse(raw));
    return r.success
      ? ({ actor: r.data.actor, entries: r.data.entries } as DemoState)
      : initialState();
  } catch {
    return initialState();
  }
}

export function clear(store: Storage | undefined = safeStore()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function safeStore(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
