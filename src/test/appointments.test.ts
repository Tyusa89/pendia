import { describe, expect, it } from "vitest";
import {
  classify,
  clean,
  findOverlaps,
  intervalsOverlap,
  isIncomplete,
  missingFields,
  overlapsWithProposed,
  sortPast,
  sortUpcoming,
  type Appointment,
} from "@/lib/appointments";

const NY = "America/New_York";
const NOW = new Date("2026-11-10T15:00:00Z");

let n = 0;
const appt = (o: Partial<Appointment> = {}): Appointment => ({
  id: `a${++n}`,
  family_id: "f",
  date: "2026-11-20",
  doctor: o.provider_name ?? null,
  document_path: null,
  provider_name: "Dr. Example",
  office_name: null,
  office_address: "1 Example Rd",
  office_phone: "555-0100",
  scheduled_start: "2026-11-20T15:00:00Z",
  scheduled_end: null,
  reason: null,
  notes: null,
  status: "scheduled",
  confirmation_status: "unconfirmed",
  reminder_prefs: {},
  archived_at: null,
  created_at: "2026-11-01T00:00:00Z",
  audio_path: null,
  audio_url: null,
  consent_at: null,
  consent_by: null,
  consent_text: null,
  duration_seconds: null,
  speaker_map: {},
  speaker_map_confirmed_at: null,
  speaker_map_confirmed_by: null,
  summary: null,
  transcript: [],
  ...o,
});

describe("incomplete-information flag (computed, never stored)", () => {
  it("a complete appointment has no flag", () => {
    expect(missingFields(appt())).toEqual([]);
    expect(isIncomplete(appt())).toBe(false);
  });

  it.each([
    ["provider", { provider_name: null }],
    ["address", { office_address: null }],
    ["phone", { office_phone: null }],
  ] as const)("flags a missing %s", (field, patch) => {
    expect(missingFields(appt(patch))).toEqual([field]);
  });

  it("reports every missing field, in a stable order", () => {
    expect(
      missingFields(appt({ provider_name: null, office_address: null, office_phone: null })),
    ).toEqual(["provider", "address", "phone"]);
  });

  it("treats empty and whitespace-only text as missing (a blank is not a value)", () => {
    expect(
      missingFields(appt({ provider_name: "", office_address: "   ", office_phone: "\n" })),
    ).toEqual(["provider", "address", "phone"]);
  });

  it("the flag clears the moment the field is filled, and returns if it is cleared again", () => {
    const missing = appt({ office_phone: null });
    expect(isIncomplete(missing)).toBe(true);
    expect(isIncomplete({ ...missing, office_phone: "555-0123" })).toBe(false);
    expect(isIncomplete({ ...missing, office_phone: "555-0123", provider_name: "" })).toBe(true);
  });

  it("never invents or fills a value: detection returns names only and leaves the appointment untouched", () => {
    const a = appt({ provider_name: null, office_phone: null });
    const snapshot = JSON.stringify(a);
    missingFields(a);
    isIncomplete(a);
    expect(JSON.stringify(a)).toBe(snapshot);
    expect(a.provider_name).toBeNull();
  });

  it("only active (scheduled, not archived) appointments are flagged; history is not nagged", () => {
    const gaps = { provider_name: null, office_address: null, office_phone: null };
    expect(isIncomplete(appt({ ...gaps, status: "canceled" }))).toBe(false);
    expect(isIncomplete(appt({ ...gaps, status: "completed" }))).toBe(false);
    expect(isIncomplete(appt({ ...gaps, archived_at: "2026-11-02T00:00:00Z" }))).toBe(false);
    expect(isIncomplete(appt({ ...gaps }))).toBe(true);
  });

  it("clean() trims and turns blank into null, never into a placeholder", () => {
    expect(clean("  Dr. Patel ")).toBe("Dr. Patel");
    expect(clean("   ")).toBeNull();
    expect(clean("")).toBeNull();
    expect(clean(null)).toBeNull();
  });
});

describe("overlap flag (never blocks)", () => {
  const at = (id: string, start: string, end: string | null, patch: Partial<Appointment> = {}) =>
    appt({ id, scheduled_start: start, scheduled_end: end, ...patch });

  it("flags partial overlap, containment and identical times, on both appointments", () => {
    const m = findOverlaps([
      at("a", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z"),
      at("b", "2026-12-01T15:30:00Z", "2026-12-01T16:30:00Z"),
      at("c", "2026-12-01T15:10:00Z", "2026-12-01T15:20:00Z"),
      at("d", "2026-12-02T09:00:00Z", "2026-12-02T10:00:00Z"),
    ]);
    expect(m.get("a")?.sort()).toEqual(["b", "c"]);
    expect(m.get("b")?.sort()).toEqual(["a"]);
    expect(m.get("c")).toEqual(["a"]);
    expect(m.has("d")).toBe(false);
  });

  it("back-to-back appointments do not overlap", () => {
    expect(
      findOverlaps([
        at("a", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z"),
        at("b", "2026-12-01T16:00:00Z", "2026-12-01T17:00:00Z"),
      ]).size,
    ).toBe(0);
  });

  it("never assumes a duration: an appointment with no end is a point in time", () => {
    // 15:00 start with no end must NOT be assumed to run until 16:00, so a 15:30 appointment does not overlap it
    expect(
      findOverlaps([
        at("a", "2026-12-01T15:00:00Z", null),
        at("b", "2026-12-01T15:30:00Z", "2026-12-01T16:00:00Z"),
      ]).size,
    ).toBe(0);
    // ... but a point inside another's range, or the same instant, does overlap
    expect(
      findOverlaps([
        at("a", "2026-12-01T15:45:00Z", null),
        at("b", "2026-12-01T15:30:00Z", "2026-12-01T16:00:00Z"),
      ]).get("a"),
    ).toEqual(["b"]);
    expect(
      findOverlaps([
        at("a", "2026-12-01T15:00:00Z", null),
        at("b", "2026-12-01T15:00:00Z", null),
      ]).get("a"),
    ).toEqual(["b"]);
    expect(
      findOverlaps([
        at("a", "2026-12-01T15:00:00Z", null),
        at("b", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z"),
      ]).get("a"),
    ).toEqual(["b"]);
  });

  it("ignores canceled, completed, archived and unscheduled appointments", () => {
    const base = at("a", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z");
    for (const patch of [
      { status: "canceled" },
      { status: "completed" },
      { archived_at: "2026-11-02T00:00:00Z" },
      { scheduled_start: null },
    ] as Partial<Appointment>[]) {
      expect(
        findOverlaps([base, at("b", "2026-12-01T15:30:00Z", "2026-12-01T16:30:00Z", patch)]).size,
      ).toBe(0);
    }
  });

  it("does not modify its input", () => {
    const list = [
      at("a", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z"),
      at("b", "2026-12-01T15:30:00Z", null),
    ];
    const snapshot = JSON.stringify(list);
    findOverlaps(list);
    expect(JSON.stringify(list)).toBe(snapshot);
  });

  it("warns about a proposed time live, excluding the appointment being edited", () => {
    const existing = [
      at("a", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z"),
      at("b", "2026-12-05T15:00:00Z", "2026-12-05T16:00:00Z"),
    ];
    expect(
      overlapsWithProposed(existing, {
        start: "2026-12-01T15:30:00Z",
        end: "2026-12-01T16:30:00Z",
      }).map((x) => x.id),
    ).toEqual(["a"]);
    expect(
      overlapsWithProposed(
        existing,
        { start: "2026-12-01T15:30:00Z", end: "2026-12-01T16:30:00Z" },
        "a",
      ),
    ).toEqual([]);
    expect(overlapsWithProposed(existing, { start: null, end: null })).toEqual([]);
  });

  it("interval helper edge cases", () => {
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 9, end: 20 })).toBe(true);
    expect(intervalsOverlap({ start: 5, end: 5 }, { start: 5, end: 5 })).toBe(true);
    expect(intervalsOverlap({ start: 5, end: 5 }, { start: 6, end: 6 })).toBe(false);
  });
});

describe("views", () => {
  it("classifies upcoming, past (completed / canceled / time passed) and archived", () => {
    expect(classify(appt({ scheduled_start: "2026-11-20T15:00:00Z" }), NOW, NY)).toBe("upcoming");
    expect(classify(appt({ scheduled_start: "2026-11-01T15:00:00Z" }), NOW, NY)).toBe("past");
    expect(classify(appt({ status: "completed" }), NOW, NY)).toBe("past");
    expect(classify(appt({ status: "canceled" }), NOW, NY)).toBe("past");
    expect(classify(appt({ archived_at: "2026-11-05T00:00:00Z" }), NOW, NY)).toBe("archived");
    expect(
      classify(appt({ status: "canceled", archived_at: "2026-11-05T00:00:00Z" }), NOW, NY),
    ).toBe("archived");
  });

  it("an appointment in progress still counts as upcoming until it ends", () => {
    const a = appt({
      scheduled_start: "2026-11-10T14:30:00Z",
      scheduled_end: "2026-11-10T15:30:00Z",
    });
    expect(classify(a, NOW, NY)).toBe("upcoming");
    expect(classify(a, new Date("2026-11-10T15:31:00Z"), NY)).toBe("past");
  });

  it("legacy rows with no scheduled time fall back to their calendar date in the family's zone", () => {
    expect(
      classify(appt({ scheduled_start: null, status: "scheduled", date: "2026-11-10" }), NOW, NY),
    ).toBe("upcoming");
    expect(
      classify(appt({ scheduled_start: null, status: "scheduled", date: "2026-11-09" }), NOW, NY),
    ).toBe("past");
  });

  it("sorts upcoming soonest-first and past newest-first, without mutating", () => {
    const list = [
      appt({ id: "x", scheduled_start: "2026-12-05T10:00:00Z" }),
      appt({ id: "y", scheduled_start: "2026-12-01T10:00:00Z" }),
    ];
    expect(sortUpcoming(list).map((a) => a.id)).toEqual(["y", "x"]);
    expect(sortPast(list).map((a) => a.id)).toEqual(["x", "y"]);
    expect(list.map((a) => a.id)).toEqual(["x", "y"]);
  });
});
