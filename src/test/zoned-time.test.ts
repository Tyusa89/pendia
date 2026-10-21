import { describe, expect, it } from "vitest";
import {
  dateInZone,
  formatInZone,
  fromZonedInputValue,
  isValidTimeZone,
  toZonedInputValue,
} from "@/lib/zoned-time";

const NY = "America/New_York";

describe("zoned time", () => {
  it("converts New York wall time to the right UTC instant (EST and EDT)", () => {
    expect(fromZonedInputValue("2026-12-01T10:00", NY)).toBe("2026-12-01T15:00:00.000Z"); // EST, UTC-5
    expect(fromZonedInputValue("2026-07-01T10:00", NY)).toBe("2026-07-01T14:00:00.000Z"); // EDT, UTC-4
  });

  it("round-trips: what a caregiver types is what they see again", () => {
    for (const tz of [NY, "Europe/Madrid", "Pacific/Auckland", "Asia/Kolkata", "UTC"]) {
      for (const local of ["2026-01-15T09:30", "2026-07-15T23:45", "2026-12-31T00:00"]) {
        expect(toZonedInputValue(fromZonedInputValue(local, tz), tz)).toBe(local);
      }
    }
  });

  it("does not depend on the device's own timezone: the same wall time maps to different instants per family zone", () => {
    expect(fromZonedInputValue("2026-12-01T10:00", "Europe/Madrid")).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(fromZonedInputValue("2026-12-01T10:00", NY)).not.toBe(
      fromZonedInputValue("2026-12-01T10:00", "Europe/Madrid"),
    );
  });

  it("refuses a wall time that does not exist (the hour skipped when clocks spring forward) instead of shifting it", () => {
    expect(fromZonedInputValue("2026-03-08T02:30", NY)).toBeNull();
    expect(fromZonedInputValue("2026-03-08T01:59", NY)).not.toBeNull();
    expect(fromZonedInputValue("2026-03-08T03:00", NY)).toBe("2026-03-08T07:00:00.000Z");
  });

  it("uses the earlier occurrence of the repeated hour when clocks fall back", () => {
    expect(fromZonedInputValue("2026-11-01T01:30", NY)).toBe("2026-11-01T05:30:00.000Z"); // 1:30 EDT, not 1:30 EST (06:30Z)
  });

  it("rejects blank, malformed and impossible dates", () => {
    for (const bad of ["", "tomorrow", "2026-02-30T10:00", "2026-13-01T10:00", "2026-12-01 10:00"])
      expect(fromZonedInputValue(bad, NY)).toBeNull();
  });

  it("returns an empty input value for a missing or invalid instant", () => {
    expect(toZonedInputValue(null, NY)).toBe("");
    expect(toZonedInputValue("not a date", NY)).toBe("");
  });

  it("dateInZone gives the calendar day in the family's zone, not UTC", () => {
    expect(dateInZone("2026-11-03T02:30:00Z", NY)).toBe("2026-11-02");
    expect(dateInZone("2026-11-03T02:30:00Z", "Pacific/Auckland")).toBe("2026-11-03");
  });

  it("formats in the given zone and validates zone names", () => {
    expect(
      formatInZone("2026-12-01T15:00:00Z", NY, {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }),
    ).toBe("10:00");
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone("Mars/Phobos")).toBe(false);
  });
});
