import { describe, expect, it } from "vitest";
import { DoseError, type ScheduleInput } from "@/lib/dose-administration";
import {
  buildInputs,
  saveSchedules,
  type PersistedSchedule,
} from "@/lib/med-schedule-save";

const MED = "11111111-1111-1111-1111-111111111111";

function fakeDb(opts: { failTimes?: string[]; duplicateWithoutRow?: boolean } = {}) {
  const rows: PersistedSchedule[] = [];
  let inserts = 0;
  return {
    rows,
    get inserts() {
      return inserts;
    },
    deps: {
      list: async () => rows.map((r) => ({ ...r, local_time: `${r.local_time}:00` })),
      add: async (i: ScheduleInput) => {
        inserts++;
        if (opts.failTimes?.includes(i.local_time)) throw new DoseError("unknown", "boom");
        if (opts.duplicateWithoutRow)
          throw new DoseError("dose_duplicate_schedule", "dup");
        if (rows.some((r) => r.local_time === i.local_time))
          throw new DoseError("dose_duplicate_schedule", "dup");
        rows.push({ id: String(rows.length), ...i, ends_on: null });
      },
    },
  };
}

describe("saving medication dose times", () => {
  it("shares days and start date across multiple times", () => {
    const inputs = buildInputs(MED, ["20:00", "08:00", "08:00", ""], [3, 1], "2026-10-28");
    expect(inputs.map((i) => i.local_time)).toEqual(["08:00", "20:00"]);
    expect(inputs.every((i) => i.days_of_week.join() === "1,3" && i.starts_on === "2026-10-28")).toBe(true);
  });

  it("retry after a partial failure never inserts a schedule twice", async () => {
    const db = fakeDb({ failTimes: ["20:00"] });
    const inputs = buildInputs(MED, ["08:00", "20:00"], [1, 2, 3, 4, 5, 6, 7], "2026-10-28");
    await expect(saveSchedules(inputs, db.deps)).rejects.toThrow();
    expect(db.rows).toHaveLength(1);
    db.deps.add = fakeDb().deps.add.bind(null) as never; // replaced below
    const ok = fakeDb();
    ok.rows.push(...db.rows);
    await saveSchedules(inputs, ok.deps);
    expect(ok.rows.map((r) => r.local_time)).toEqual(["08:00", "20:00"]);
    expect(ok.inserts).toBe(1);
  });

  it("a duplicate error is not success unless the schedule is read back", async () => {
    const db = fakeDb({ duplicateWithoutRow: true });
    const inputs = buildInputs(MED, ["08:00"], [1], "2026-10-28");
    await expect(saveSchedules(inputs, db.deps)).rejects.toThrow();
  });
});
