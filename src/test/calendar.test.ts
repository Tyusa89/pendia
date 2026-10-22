// Phase 2: where a shift appears on the weekly calendar, and the exact hours shown. Pure rules, family time zone only.
import { describe, expect, it } from "vitest";
import { blockEdges, compactRange, shiftOverlapsDay, shiftsInCell } from "@/lib/calendar";
import { fromZonedInputValue } from "@/lib/zoned-time";

const CHI = "America/Chicago";
const z = (local: string, tz = CHI) => fromZonedInputValue(local, tz)!;
const sh = (id: string, from: string, to: string, tz = CHI) => ({
  id,
  start: z(from, tz),
  end: z(to, tz),
});
const ids = (r: Array<{ shift: { id?: string } }>) => r.map((c) => c.shift.id);

describe("compactRange: exact hours in a small cell", () => {
  it.each([
    ["2026-10-22T12:00", "2026-10-22T14:00", "12–2p"],
    ["2026-10-22T08:00", "2026-10-22T14:00", "8a–2p"],
    ["2026-10-22T22:00", "2026-10-23T06:00", "10p–6a"],
    ["2026-10-22T12:30", "2026-10-22T14:15", "12:30–2:15p"],
    ["2026-10-22T09:00", "2026-10-22T11:00", "9–11a"],
    ["2026-10-22T00:00", "2026-10-22T07:00", "12–7a"],
  ])("%s → %s is %s", (a, b, out) => expect(compactRange(z(a), z(b), CHI)).toBe(out));
  it("is read in the family's zone, not the device's", () => {
    expect(
      compactRange(z("2026-10-22T12:00", CHI), z("2026-10-22T14:00", CHI), "America/New_York"),
    ).toBe("1–3p");
  });
});

describe("shiftsInCell: a shift appears in every block it overlaps", () => {
  const day = "2026-10-22";
  it("12–2 PM is Morning only, and the 2 PM end does not leak into Afternoon", () => {
    const s = [sh("a", `${day}T12:00`, `${day}T14:00`)];
    expect(ids(shiftsInCell(s, day, "morning", CHI))).toEqual(["a"]);
    expect(ids(shiftsInCell(s, day, "afternoon", CHI))).toEqual([]);
  });
  it("1–4 PM appears in Morning and Afternoon", () => {
    const s = [sh("a", `${day}T13:00`, `${day}T16:00`)];
    expect(ids(shiftsInCell(s, day, "morning", CHI))).toEqual(["a"]);
    expect(ids(shiftsInCell(s, day, "afternoon", CHI))).toEqual(["a"]);
    expect(ids(shiftsInCell(s, day, "evening", CHI))).toEqual([]);
  });
  it("a full day shift appears in all three blocks", () => {
    const s = [sh("a", `${day}T08:00`, `${day}T22:00`)];
    for (const b of ["morning", "afternoon", "evening"] as const)
      expect(ids(shiftsInCell(s, day, b, CHI))).toEqual(["a"]);
  });
  it("overnight 10 PM–6 AM is Evening of the first day and Morning of the next, flagged as continuing", () => {
    const s = [sh("n", `${day}T22:00`, "2026-10-23T06:00")];
    const eve = shiftsInCell(s, day, "evening", CHI);
    expect(eve).toMatchObject([{ startsBefore: false, endsAfter: true }]);
    const morn = shiftsInCell(s, "2026-10-23", "morning", CHI);
    expect(morn).toMatchObject([{ startsBefore: true, endsAfter: false }]);
    expect(shiftsInCell(s, "2026-10-23", "afternoon", CHI)).toEqual([]);
    expect(shiftsInCell(s, "2026-10-21", "evening", CHI)).toEqual([]);
  });
  it("overlapping shifts both show, earliest first; touching shifts do not overlap a block they only border", () => {
    const s = [
      sh("late", `${day}T11:00`, `${day}T15:00`),
      sh("early", `${day}T09:00`, `${day}T12:00`),
    ];
    expect(ids(shiftsInCell(s, day, "morning", CHI))).toEqual(["early", "late"]);
    const t = [sh("x", `${day}T10:00`, `${day}T14:00`)];
    expect(ids(shiftsInCell(t, day, "afternoon", CHI))).toEqual([]);
  });
  it("uses the family's zone for the day: 11 PM Chicago is already tomorrow in UTC but stays on its Chicago day", () => {
    const s = [sh("late", `${day}T23:00`, "2026-10-23T01:00")];
    expect(ids(shiftsInCell(s, day, "evening", CHI))).toEqual(["late"]);
  });
  it("shiftOverlapsDay catches an overnight shift on the day it ends", () => {
    const s = sh("n", `${day}T22:00`, "2026-10-23T06:00");
    expect(shiftOverlapsDay(s, "2026-10-23", CHI)).toBe(true);
    expect(shiftOverlapsDay(s, "2026-10-24", CHI)).toBe(false);
  });
});

describe("daylight saving", () => {
  it("fall back (Nov 1 2026, 25-hour day): blocks still tile the whole day and an overnight shift spans the repeated hour", () => {
    const e = blockEdges("2026-11-01", CHI);
    expect(e.morning[1]).toBe(e.afternoon[0]);
    expect(e.afternoon[1]).toBe(e.evening[0]);
    expect((e.evening[1] - e.morning[0]) / 3600000).toBe(25);
    const s = [{ id: "n", start: z("2026-10-31T22:00"), end: z("2026-11-01T06:00") }];
    expect(ids(shiftsInCell(s, "2026-10-31", "evening", CHI))).toEqual(["n"]);
    expect(ids(shiftsInCell(s, "2026-11-01", "morning", CHI))).toEqual(["n"]);
    expect((Date.parse(s[0]!.end) - Date.parse(s[0]!.start)) / 3600000).toBe(9); // nine real hours, not eight
  });
  it("spring forward (Mar 8 2026, 23-hour day) tiles the day", () => {
    const e = blockEdges("2026-03-08", CHI);
    expect((e.evening[1] - e.morning[0]) / 3600000).toBe(23);
    expect(compactRange(z("2026-03-08T12:00"), z("2026-03-08T14:00"), CHI)).toBe("12–2p");
  });
});
