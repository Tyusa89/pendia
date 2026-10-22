// Cross-midnight and daylight-saving behavior of shift entry in the family's zone (Chicago), independent of the device.
import { describe, expect, it } from "vitest";
import { validateShift } from "@/lib/shifts";

const CHI = "America/Chicago";
const hours = (r: { start: string; end: string }) =>
  (Date.parse(r.end) - Date.parse(r.start)) / 3600000;
const ok = (date: string, startTime: string, endTime: string) => {
  const r = validateShift({ date, startTime, endTime }, CHI);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("cross-midnight shifts", () => {
  it("an earlier end time ends the next day: 10 PM–6 AM is 8 hours", () => {
    const r = ok("2026-10-22", "22:00", "06:00");
    expect(hours(r)).toBe(8);
    expect(r.start).toBe("2026-10-23T03:00:00.000Z"); // 10 PM CDT
    expect(r.end).toBe("2026-10-23T11:00:00.000Z"); // 6 AM CDT
  });
  it("12 PM–2 PM on Oct 22 is 17:00–19:00 UTC, the same whatever the device's zone", () => {
    const r = ok("2026-10-22", "12:00", "14:00");
    expect([r.start, r.end]).toEqual(["2026-10-22T17:00:00.000Z", "2026-10-22T19:00:00.000Z"]);
  });
  it("equal start and end is refused rather than read as 24 hours", () => {
    expect(
      validateShift({ date: "2026-10-22", startTime: "08:00", endTime: "08:00" }, CHI).ok,
    ).toBe(false);
  });
});

describe("daylight saving", () => {
  it("fall back (Nov 1 2026): an overnight shift is 9 real hours, not 8", () => {
    expect(hours(ok("2026-10-31", "22:00", "06:00"))).toBe(9);
  });
  it("spring forward (Mar 8 2026): an overnight shift is 7 real hours, not 8", () => {
    expect(hours(ok("2026-03-07", "22:00", "06:00"))).toBe(7);
  });
  it("spring forward: a start time inside the skipped hour is refused with a clear message", () => {
    const r = validateShift({ date: "2026-03-08", startTime: "02:30", endTime: "05:00" }, CHI);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/doesn't exist/) });
  });
  it("the same wall hours map to different UTC hours either side of the change", () => {
    expect(ok("2026-10-31", "12:00", "14:00").start).toBe("2026-10-31T17:00:00.000Z"); // CDT
    expect(ok("2026-11-02", "12:00", "14:00").start).toBe("2026-11-02T18:00:00.000Z"); // CST
  });
});
