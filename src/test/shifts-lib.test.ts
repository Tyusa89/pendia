import { describe, expect, it } from "vitest";
import {
  missingFromShift,
  needsCompletion,
  overlapsForMember,
  ShiftValidationError,
  validateShiftTimes,
} from "@/lib/shifts";

describe("validateShiftTimes", () => {
  it("accepts a normal range and an overnight range that crosses midnight", () => {
    expect(validateShiftTimes("2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z")).toEqual({
      start: "2026-10-27T12:00:00.000Z",
      end: "2026-10-27T18:00:00.000Z",
    });
    expect(() => validateShiftTimes("2026-10-27T00:00:00Z", "2026-10-27T12:00:00Z")).not.toThrow();
    // 8 PM to 8 AM next day (New York) is 24:00Z to 12:00Z next day: fine
    expect(() => validateShiftTimes("2026-10-28T00:00:00Z", "2026-10-28T12:00:00Z")).not.toThrow();
  });

  it.each([
    ["end equals start", "2026-10-27T12:00:00Z", "2026-10-27T12:00:00Z", /end must be after/],
    ["end before start", "2026-10-27T12:00:00Z", "2026-10-27T11:59:00Z", /end must be after/],
    ["start not a date", "garbage", "2026-10-27T12:00:00Z", /valid start/],
    ["end not a date", "2026-10-27T12:00:00Z", "", /valid end/],
    ["start missing", null, "2026-10-27T12:00:00Z", /valid start/],
    ["end missing", "2026-10-27T12:00:00Z", undefined, /valid end/],
  ])("rejects: %s", (_n, s, e, msg) => {
    expect(() => validateShiftTimes(s, e)).toThrow(ShiftValidationError);
    expect(() => validateShiftTimes(s, e)).toThrow(msg);
  });
});

describe("needs completion (computed, never stored)", () => {
  it("is flagged when the caregiver or end time is missing, and clears when they are filled in", () => {
    expect(missingFromShift({ end: "2026-10-27T18:00:00Z", assigned_member_id: null })).toEqual([
      "caregiver",
    ]);
    expect(missingFromShift({ end: null, assigned_member_id: "m1" })).toEqual(["end time"]);
    expect(missingFromShift({ end: null, assigned_member_id: null })).toEqual([
      "end time",
      "caregiver",
    ]);
    expect(needsCompletion({ end: "2026-10-27T18:00:00Z", assigned_member_id: "m1" })).toBe(false);
  });
});

describe("overlapsForMember", () => {
  const s = (id: string, who: string | null, start: string, end: string) => ({
    id,
    assigned_member_id: who,
    start,
    end,
  });
  const list = [
    s("a", "ana", "2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z"),
    s("b", "ben", "2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z"),
    s("n", "ana", "2026-10-28T00:00:00Z", "2026-10-28T12:00:00Z"), // overnight
  ];
  it("flags the same member's overlapping shift, but not another member's", () => {
    expect(
      overlapsForMember(list, "ana", "2026-10-27T15:00:00Z", "2026-10-27T20:00:00Z").map(
        (x) => x.id,
      ),
    ).toEqual(["a"]);
  });
  it("back-to-back is not an overlap", () => {
    expect(overlapsForMember(list, "ana", "2026-10-27T18:00:00Z", "2026-10-28T00:00:00Z")).toEqual(
      [],
    );
  });
  it("catches an overnight shift overlapped from the next morning, and ignores the shift being edited", () => {
    expect(
      overlapsForMember(list, "ana", "2026-10-28T10:00:00Z", "2026-10-28T14:00:00Z").map(
        (x) => x.id,
      ),
    ).toEqual(["n"]);
    expect(
      overlapsForMember(list, "ana", "2026-10-28T10:00:00Z", "2026-10-28T14:00:00Z", "n"),
    ).toEqual([]);
  });
  it("an open shift (no member) never overlaps", () => {
    expect(overlapsForMember(list, null, "2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z")).toEqual(
      [],
    );
  });
});
