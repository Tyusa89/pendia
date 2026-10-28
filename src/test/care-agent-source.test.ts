// @vitest-environment node
// The Care Agent's database reads with a RECORDING fake client: explicit column lists, family scoping on every query, query-time
// handoff column separation (Amendment A), per-category gating of the queries themselves, and fail-on-any-error. No network.
import { describe, expect, it } from "vitest";
import {
  createSupabasePackSource,
  FAMILY_COLUMNS,
  HANDOFF_COLUMNS_FULL,
  HANDOFF_COLUMNS_METADATA,
  MEDCHANGE_COLUMNS,
  MEDICATION_COLUMNS,
  MEMBER_COLUMNS,
  MEMBER_NAME_COLUMNS,
  RECIPIENT_COLUMNS,
  SHIFT_COLUMNS,
  TASK_COLUMNS,
  VISIT_COLUMNS,
  WATCH_COLUMNS,
} from "@/server/care-agent-source.server";
import {
  ALL,
  FAMILY,
  MED_BLIND,
  NOW,
  SCHEDULE_BLIND,
  TZ,
  USER,
  VISIT_BLIND,
} from "./care-agent-helpers";

type Op = [string, ...unknown[]];
interface Recorded {
  table: string;
  ops: Op[];
}
function fakeClient(
  opts: {
    data?: Record<string, unknown[]>;
    errors?: Record<string, boolean>;
    rpcData?: unknown[];
    rpcError?: boolean;
  } = {},
) {
  const queries: Recorded[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const rec: Recorded = { table, ops: [] };
    queries.push(rec);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "not", "gt", "gte", "lt", "order", "limit"])
      q[m] = (...a: unknown[]) => (rec.ops.push([m, ...a]), q);
    q["then"] = (res: (v: unknown) => unknown) =>
      res({
        data: opts.data?.[table] ?? [],
        error: opts.errors?.[table] ? { message: "boom" } : null,
      });
    return q;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    return Promise.resolve({
      data: opts.rpcData ?? [],
      error: opts.rpcError ? { message: "boom" } : null,
    });
  };
  return { client: { from, rpc } as never, queries, rpcs };
}
const load = async (access = ALL, o: Parameters<typeof fakeClient>[0] = {}) => {
  const f = fakeClient(o);
  const rows = await createSupabasePackSource(f.client, USER).loadRows({
    familyId: FAMILY,
    access,
    now: NOW,
    timezone: TZ,
  });
  return { ...f, rows };
};
const selects = (qs: Recorded[]) =>
  qs.map((q) => ({ table: q.table, cols: String(q.ops.find((o) => o[0] === "select")![1]) }));
const tables = (qs: Recorded[]) => qs.map((q) => q.table);

describe("every query is explicit and family-scoped", () => {
  it("never uses select('*') or an empty/wildcard column list", async () => {
    const { queries } = await load(ALL, { data: { visit: [{ id: "v1" }] } });
    for (const { cols } of selects(queries)) {
      expect(cols).not.toMatch(/\*/);
      expect(cols.trim()).not.toBe("");
    }
  });
  it("every record query is scoped with .eq('family_id', familyId) (the family itself by id)", async () => {
    const { queries } = await load(ALL, { data: { visit: [{ id: "v1" }] } });
    for (const q of queries) expect(q.ops).toContainEqual(["eq", "family_id", FAMILY]);
    const f = fakeClient();
    await createSupabasePackSource(f.client, USER).getFamily(FAMILY);
    expect(f.queries[0]!.ops).toContainEqual(["eq", "id", FAMILY]);
    const m = fakeClient();
    await createSupabasePackSource(m.client, USER).getMember(FAMILY);
    expect(m.queries[0]!.ops).toContainEqual(["eq", "family_id", FAMILY]);
    expect(m.queries[0]!.ops).toContainEqual(["eq", "user_id", USER]);
  });
  it("the complete column lists exclude everything the agent must never receive", () => {
    const all = [
      MEMBER_COLUMNS,
      FAMILY_COLUMNS,
      RECIPIENT_COLUMNS,
      MEMBER_NAME_COLUMNS,
      VISIT_COLUMNS,
      MEDCHANGE_COLUMNS,
      TASK_COLUMNS,
      WATCH_COLUMNS,
      MEDICATION_COLUMNS,
      SHIFT_COLUMNS,
      HANDOFF_COLUMNS_FULL,
      HANDOFF_COLUMNS_METADATA,
    ].join(", ");
    for (const banned of [
      "transcript",
      "audio",
      "mime",
      "consent",
      "speaker_map",
      "phone",
      "office_address",
      "office_phone",
      "duration",
      "wav",
      "url",
    ])
      expect(all).not.toContain(banned);
    // care_recipient.notes is excluded; visit.notes is a screened free-text field and IS listed
    expect(RECIPIENT_COLUMNS).toBe("id, name");
    expect(VISIT_COLUMNS).toContain("notes");
  });
  it("only the member's own row is read for access flags", () => {
    expect(MEMBER_COLUMNS).toBe(
      "id, name, role, language, can_see_meds, can_see_schedule, can_see_visits",
    );
  });
});

describe("Amendment A at QUERY time: handoff columns", () => {
  const PROTECTED = ["meds_taken", "note", "unusual", "watch_answers"];
  it("a MEDICATION-BLIND member's handoff query selects only id, created_at, author_member_id, ate", async () => {
    const { queries } = await load(MED_BLIND);
    const h = selects(queries).find((s) => s.table === "handoff")!;
    expect(h.cols).toBe(HANDOFF_COLUMNS_METADATA);
    expect(h.cols).toBe("id, created_at, author_member_id, ate");
    for (const p of PROTECTED) expect(h.cols).not.toContain(p);
  });
  it("a medication-visible member's handoff query includes the full field set (and still no audio fields)", async () => {
    const { queries } = await load(ALL);
    const h = selects(queries).find((s) => s.table === "handoff")!;
    expect(h.cols).toBe(HANDOFF_COLUMNS_FULL);
    for (const p of PROTECTED) expect(h.cols).toContain(p);
    expect(h.cols).not.toMatch(/audio|mime|wav|duration|shift_id/);
  });
  it("a SCHEDULE-BLIND member issues no handoff query at all", async () => {
    const { queries } = await load(SCHEDULE_BLIND);
    expect(tables(queries)).not.toContain("handoff");
  });
  it("the metadata list shares no protected column name with the full list's protected part", () => {
    for (const p of PROTECTED) expect(HANDOFF_COLUMNS_METADATA.includes(p)).toBe(false);
  });
  it("only the 3 most recent handoffs are requested, newest first", async () => {
    const { queries } = await load(ALL);
    const h = queries.find((q) => q.table === "handoff")!;
    expect(h.ops).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(h.ops).toContainEqual(["limit", 3]);
  });
});

describe("the queries themselves follow the category gates", () => {
  it("visits=false: no visit, medication-change or follow-up query", async () => {
    const { queries, rows } = await load(VISIT_BLIND, { data: { visit: [{ id: "v1" }] } });
    expect(tables(queries)).not.toContain("visit");
    expect(tables(queries)).not.toContain("med_change");
    expect(rows.visits).toEqual([]);
    // coordination tasks/watch still load for a schedule-visible member, but none are visit follow-ups
    expect(
      queries
        .filter((q) => q.table === "task")
        .every((q) => q.ops.some((o) => o[0] === "is" && o[1] === "source_visit_id")),
    ).toBe(true);
  });
  it("meds=false: no medication-list, dose or medication-change read; only the name set for the free-text screen", async () => {
    const { queries, rpcs } = await load(MED_BLIND, {
      data: { medication: [{ name: "Zorvanex" }] },
    });
    expect(rpcs).toEqual([]);
    expect(tables(queries)).not.toContain("med_change");
    const med = selects(queries).filter((s) => s.table === "medication");
    expect(med).toEqual([{ table: "medication", cols: "name" }]);
  });
  it("schedule=false: no shift, coordination task, watch-item or handoff query", async () => {
    const { queries } = await load(SCHEDULE_BLIND);
    for (const t of ["shift", "handoff", "watch_item"]) expect(tables(queries)).not.toContain(t);
    expect(queries.filter((q) => q.table === "task")).toEqual([]);
  });
  it("meds=true: the medication-name screening query is NOT issued", async () => {
    const { queries, rows } = await load(ALL);
    expect(selects(queries).filter((s) => s.table === "medication" && s.cols === "name")).toEqual(
      [],
    );
    expect(rows.medNames).toBeNull();
  });
  it("visit queries: next upcoming and most recent completed, excluding archived", async () => {
    const { queries } = await load(ALL);
    const v = queries.filter((q) => q.table === "visit");
    expect(v).toHaveLength(2);
    for (const q of v) expect(q.ops).toContainEqual(["is", "archived_at", null]);
    expect(v[0]!.ops).toContainEqual(["eq", "status", "scheduled"]);
    expect(v[0]!.ops).toContainEqual(["gte", "scheduled_start", NOW.toISOString()]);
    expect(v[1]!.ops).toContainEqual(["eq", "status", "completed"]);
    for (const q of v) expect(q.ops).toContainEqual(["limit", 1]);
  });
  it("follow-ups and medication changes are read only for the chosen visits, confirmed/open/active only", async () => {
    const { queries } = await load(ALL, { data: { visit: [{ id: "v-x" }] } });
    const mc = queries.find((q) => q.table === "med_change")!;
    expect(mc.ops).toContainEqual(["in", "visit_id", ["v-x", "v-x"]]);
    expect(mc.ops).toContainEqual(["eq", "status", "confirmed"]);
    const fu = queries.filter((q) => q.table === "task" && q.ops.some((o) => o[0] === "in"))[0]!;
    expect(fu.ops).toContainEqual(["eq", "status", "open"]);
    const fw = queries.find((q) => q.table === "watch_item" && q.ops.some((o) => o[0] === "in"))!;
    expect(fw.ops).toContainEqual(["eq", "status", "active"]);
  });
  it("with no visits there are no follow-up or medication-change queries at all", async () => {
    const { queries } = await load(ALL);
    expect(queries.some((q) => q.table === "med_change")).toBe(false);
    expect(queries.filter((q) => q.ops.some((o) => o[0] === "in"))).toEqual([]);
  });
  it("shifts are bounded to the next 7 days; tasks and watch items exclude visit follow-ups", async () => {
    const { queries } = await load(ALL);
    const s = queries.find((q) => q.table === "shift")!;
    expect(s.ops).toContainEqual(["gt", "end", NOW.toISOString()]);
    expect(s.ops).toContainEqual([
      "lt",
      "start",
      new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
    ]);
    for (const t of ["task", "watch_item"]) {
      const q = queries.filter((x) => x.table === t).pop()!;
      expect(q.ops).toContainEqual(["is", "source_visit_id", null]);
    }
  });
  it("dose reports use the dose_occurrences RPC for the last 48 hours (local dates in the family's zone)", async () => {
    const { rpcs } = await load(ALL);
    expect(rpcs).toEqual([
      {
        fn: "dose_occurrences",
        args: { _family_id: FAMILY, _from: "2026-10-26", _to: "2026-10-28" },
      },
    ]);
  });
  it("medications are active only, capped at the section cap", async () => {
    const { queries } = await load(ALL);
    const m = queries.find((q) => q.table === "medication")!;
    expect(m.ops).toContainEqual(["eq", "status", "active"]);
    expect(m.ops).toContainEqual(["limit", 12]);
  });
});

describe("any error fails the whole read (never a partial pack)", () => {
  for (const table of [
    "care_recipient",
    "member",
    "visit",
    "medication",
    "handoff",
    "shift",
    "task",
    "watch_item",
  ])
    it(`an error on ${table} rejects loadRows`, async () => {
      await expect(
        load(ALL, { errors: { [table]: true }, data: { visit: [{ id: "v1" }] } }),
      ).rejects.toThrow("care_agent_read_failed");
    });
  it("an error from the dose RPC rejects", async () => {
    await expect(load(ALL, { rpcError: true })).rejects.toThrow("care_agent_read_failed");
  });
  it("eligibility reads throw on error too (so the caller reports lookup_failed, never a denial)", async () => {
    const a = fakeClient({ errors: { member: true } });
    await expect(createSupabasePackSource(a.client, USER).getMember(FAMILY)).rejects.toThrow();
    const b = fakeClient({ errors: { family: true } });
    await expect(createSupabasePackSource(b.client, USER).getFamily(FAMILY)).rejects.toThrow();
  });
  it("no row is null (membership/family absent), not an error", async () => {
    expect(await createSupabasePackSource(fakeClient().client, USER).getMember(FAMILY)).toBeNull();
    expect(await createSupabasePackSource(fakeClient().client, USER).getFamily(FAMILY)).toBeNull();
  });
});

describe("read-only", () => {
  it("the fake client has no write methods and the source never needs one", async () => {
    const { queries } = await load(ALL, { data: { visit: [{ id: "v1" }] } });
    const methods = new Set(queries.flatMap((q) => q.ops.map((o) => o[0])));
    for (const m of methods)
      expect(["select", "eq", "in", "is", "not", "gt", "gte", "lt", "order", "limit"]).toContain(m);
  });
});
