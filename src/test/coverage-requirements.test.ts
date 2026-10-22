// Phase 4A-1: what an organizer may define, and that the service never lets invalid input reach the database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  deletes: [] as Array<Record<string, unknown>>,
  rpcError: null as null | { message: string },
  deleteRows: [{ id: "o1" }] as unknown[],
  tables: {} as Record<string, unknown[]>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args });
      return { data: db.rpcError ? null : "ok", error: db.rpcError };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const done = {
        then: (r: (v: unknown) => unknown) => r({ data: db.tables[table] ?? [], error: null }),
      };
      const chain = new Proxy(q, {
        get: (_t, prop) => {
          if (prop === "then") return done.then;
          if (prop === "delete")
            return () => ({
              eq: (c: string, v: unknown) => {
                const f: Record<string, unknown> = { [c]: v };
                return {
                  eq: (c2: string, v2: unknown) => ({
                    select: async () => {
                      db.deletes.push({ ...f, [c2]: v2, table });
                      return { data: db.deleteRows, error: null };
                    },
                  }),
                };
              },
            });
          return () => chain;
        },
      });
      return chain;
    },
  },
}));

import {
  CoverageValidationError,
  normalizeWindow,
  normalizeWindows,
  parseWallTime,
  validateDay,
  validateWeekday,
} from "@/lib/coverage-requirements";
import { coverageRequirementService } from "@/services";

beforeEach(() => {
  db.rpc = [];
  db.deletes = [];
  db.rpcError = null;
  db.deleteRows = [{ id: "o1" }];
  db.tables = {};
});

describe("times", () => {
  it.each([
    ["08:00", 480],
    ["08:15", 495],
    ["23:45", 1425],
    ["00:00", 0],
    ["08:30:00", 510],
  ])("accepts %s", (t, m) => expect(parseWallTime(t)).toBe(m));
  it.each(["08:10", "08:01", "8:00", "24:00", "08:60", "08:00:30", "", null, 800, "noon"])(
    "refuses %j",
    (t) => expect(() => parseWallTime(t)).toThrow(CoverageValidationError),
  );
  it("a window needs two different times; overnight and midnight ends are fine", () => {
    expect(() => normalizeWindow({ start_time: "08:00", end_time: "08:00" })).toThrow(
      /different end/,
    );
    expect(normalizeWindow({ start_time: "22:00", end_time: "06:00" })).toEqual({
      start_time: "22:00",
      end_time: "06:00",
    });
    expect(normalizeWindow({ start_time: "22:00:00", end_time: "00:00:00" })).toEqual({
      start_time: "22:00",
      end_time: "00:00",
    });
  });
  it("lists: sorted, exact duplicates collapse, overlapping windows are kept (they merge when calculated), empty is allowed", () => {
    expect(
      normalizeWindows([
        { start_time: "18:00", end_time: "22:00" },
        { start_time: "08:00", end_time: "12:00" },
        { start_time: "08:00", end_time: "12:00" },
        { start_time: "10:00", end_time: "14:00" },
      ]),
    ).toEqual([
      { start_time: "08:00", end_time: "12:00" },
      { start_time: "10:00", end_time: "14:00" },
      { start_time: "18:00", end_time: "22:00" },
    ]);
    expect(normalizeWindows([])).toEqual([]);
    expect(() => normalizeWindows("08:00-12:00")).toThrow(CoverageValidationError);
    expect(() => normalizeWindows([{ start_time: "08:00", end_time: "12:05" }])).toThrow(
      /15-minute/,
    );
  });
  it("weekday is 0-6 (Monday = 0) and a date must exist", () => {
    expect(validateWeekday(0)).toBe(0);
    expect(validateWeekday(6)).toBe(6);
    for (const bad of [-1, 7, 1.5, "1", null]) expect(() => validateWeekday(bad)).toThrow();
    expect(validateDay("2026-11-01")).toBe("2026-11-01");
    for (const bad of ["2026-02-30", "2026-13-01", "11/01/2026", "", null])
      expect(() => validateDay(bad)).toThrow();
  });
});

describe("coverageRequirementService writes", () => {
  it("replaceWeekly sends the normalized windows once, as one call", async () => {
    await coverageRequirementService.replaceWeekly("f1", 2, [
      { start_time: "18:00:00", end_time: "22:00:00" },
      { start_time: "08:00", end_time: "12:00" },
    ]);
    expect(db.rpc).toEqual([
      {
        fn: "replace_weekly_coverage",
        args: {
          _family_id: "f1",
          _weekday: 2,
          _windows: [
            { start_time: "08:00", end_time: "12:00" },
            { start_time: "18:00", end_time: "22:00" },
          ],
        },
      },
    ]);
  });
  it("setOverride with no windows is sent as an explicit empty list (nothing required that date)", async () => {
    await coverageRequirementService.setOverride("f1", "2026-11-03", []);
    expect(db.rpc).toEqual([
      { fn: "set_coverage_override", args: { _family_id: "f1", _day: "2026-11-03", _windows: [] } },
    ]);
  });
  it("invalid input never reaches the database", async () => {
    await expect(coverageRequirementService.replaceWeekly("f1", 7, [])).rejects.toThrow(
      /day of the week/,
    );
    await expect(
      coverageRequirementService.replaceWeekly("f1", 1, [
        { start_time: "08:10", end_time: "12:00" },
      ]),
    ).rejects.toThrow(/15-minute/);
    await expect(coverageRequirementService.setOverride("f1", "2026-02-30", [])).rejects.toThrow(
      /doesn't exist/,
    );
    await expect(
      coverageRequirementService.setOverride("f1", "2026-11-03", [
        { start_time: "09:00", end_time: "09:00" },
      ]),
    ).rejects.toThrow();
    await expect(coverageRequirementService.clearOverride("f1", "nope")).rejects.toThrow();
    expect(db.rpc).toHaveLength(0);
    expect(db.deletes).toHaveLength(0);
  });
  it("a refused write (not an organizer) becomes a clear message", async () => {
    db.rpcError = {
      message: 'new row violates row-level security policy for table "coverage_override"',
    };
    await expect(coverageRequirementService.setOverride("f1", "2026-11-03", [])).rejects.toThrow(
      /Only an organizer/,
    );
    db.rpcError = { message: "permission denied for function replace_weekly_coverage" };
    await expect(coverageRequirementService.replaceWeekly("f1", 0, [])).rejects.toThrow(
      /Only an organizer/,
    );
  });
  it("a database check failure is passed through, not disguised as a permissions problem", async () => {
    db.rpcError = { message: "boom" };
    await expect(coverageRequirementService.replaceWeekly("f1", 0, [])).rejects.toThrow("boom");
  });
  it("clearOverride deletes only that family's date; when nothing was deleted it says so", async () => {
    await coverageRequirementService.clearOverride("f1", "2026-11-03");
    expect(db.deletes).toEqual([
      { family_id: "f1", day: "2026-11-03", table: "coverage_override" },
    ]);
    db.deleteRows = [];
    await expect(coverageRequirementService.clearOverride("f1", "2026-11-03")).rejects.toThrow(
      /No date override/,
    );
  });
});

describe("coverageRequirementService.get", () => {
  it("assembles weekly windows and per-date overrides (with their windows) as HH:MM, nothing invented", async () => {
    db.tables = {
      coverage_requirement: [{ weekday: 0, start_time: "08:00:00", end_time: "12:00:00" }],
      coverage_override: [
        { id: "o1", day: "2026-11-02" },
        { id: "o2", day: "2026-11-03" },
      ],
      coverage_override_window: [
        { override_id: "o1", start_time: "09:00:00", end_time: "11:00:00" },
      ],
    };
    expect(await coverageRequirementService.get("f1")).toEqual({
      weekly: [{ weekday: 0, start_time: "08:00", end_time: "12:00" }],
      overrides: [
        { day: "2026-11-02", windows: [{ start_time: "09:00", end_time: "11:00" }] },
        { day: "2026-11-03", windows: [] },
      ],
    });
  });
  it("with no rows, returns nothing defined", async () => {
    expect(await coverageRequirementService.get("f1")).toEqual({ weekly: [], overrides: [] });
  });
});
