import { describe, expect, it } from "vitest";
import { blockOf, coverageSummary, mondayInZone, validateShift, type ShiftLike } from "@/lib/shifts";

const NY = "America/New_York";
const s = (id: string, start: string, end: string, who: string | null, status = "claimed"): ShiftLike => ({
  id, start, end, assigned_member_id: who, status,
});

describe("shift rules", () => {
  it("converts family wall time to instants", () => {
    const r = validateShift({ date: "2026-10-20", startTime: "08:00", endTime: "14:00" }, NY, []);
    expect(r).toEqual({ ok: true, start: "2026-10-20T12:00:00.000Z", end: "2026-10-20T18:00:00.000Z" });
  });
  it("rejects equal start and end", () => {
    expect(validateShift({ date: "2026-10-20", startTime: "08:00", endTime: "08:00" }, NY, []).ok).toBe(false);
  });
  it("treats an earlier end time as overnight", () => {
    const r = validateShift({ date: "2026-10-20", startTime: "22:00", endTime: "06:00" }, NY, []);
    expect(r.ok && r.end).toBe("2026-10-21T10:00:00.000Z");
  });
  it("rejects overlaps with active shifts but not canceled ones or itself", () => {
    const other = s("a", "2026-10-20T12:00:00Z", "2026-10-20T18:00:00Z", null, "open");
    const d = { date: "2026-10-20", startTime: "10:00", endTime: "12:00" };
    expect(validateShift(d, NY, [other]).ok).toBe(false);
    expect(validateShift(d, NY, [{ ...other, status: "canceled" }]).ok).toBe(true);
    expect(validateShift(d, NY, [other], "a").ok).toBe(true);
  });
  it("adjacent shifts are allowed", () => {
    const other = s("a", "2026-10-20T12:00:00Z", "2026-10-20T18:00:00Z", "m");
    expect(validateShift({ date: "2026-10-20", startTime: "14:00", endTime: "18:00" }, NY, [other]).ok).toBe(true);
  });
  it("never says covered when an active shift is unassigned", () => {
    expect(coverageSummary([s("a", "x", "y", "m"), s("b", "x", "y", null, "open")])).toBe("1 shift still need someone");
    expect(coverageSummary([s("a", "x", "y", "m"), s("b", "x", "y", null, "canceled")])).toBe("Every shift is covered");
    expect(coverageSummary([])).toBe("No shifts scheduled this week");
  });
  it("buckets by family-local start hour and finds Monday in the family zone", () => {
    expect(blockOf("2026-10-20T18:00:00Z", NY)).toBe("afternoon"); // 2 PM NY
    expect(blockOf("2026-10-20T22:00:00Z", NY)).toBe("evening");
    expect(mondayInZone(new Date("2026-10-26T02:00:00Z"), NY)).toBe("2026-10-19"); // still Sunday in NY
  });
});
