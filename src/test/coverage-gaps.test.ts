// Phase 4A-1: uncovered = required windows minus assigned, non-canceled shifts. Pure rules, family time zone only.
import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  intersectIntervals,
  mergeIntervals,
  requirementForDay,
  subtractIntervals,
  type CoverageShift,
} from "@/lib/coverage-gaps";
import type { DateOverride, WeeklyRequirement } from "@/lib/coverage-requirements";
import { fromZonedInputValue } from "@/lib/zoned-time";

const CHI = "America/Chicago";
const NY = "America/New_York";
const H = 3600000;
const z = (local: string, tz = CHI) => Date.parse(fromZonedInputValue(local, tz)!);
const iso = (local: string, tz = CHI) => fromZonedInputValue(local, tz)!;
const shift = (
  from: string,
  to: string,
  who: string | null = "m1",
  status?: string,
  tz = CHI,
): CoverageShift => ({
  start: iso(from, tz),
  end: iso(to, tz),
  assigned_member_id: who,
  status: status ?? (who ? "claimed" : "open"),
});
const wk = (weekday: number, start_time: string, end_time: string): WeeklyRequirement => ({
  weekday,
  start_time,
  end_time,
});
const run = (o: {
  from: string;
  to: string;
  weekly?: WeeklyRequirement[];
  overrides?: DateOverride[];
  shifts?: CoverageShift[];
  tz?: string;
}) =>
  computeCoverage({
    fromDay: o.from,
    toDay: o.to,
    weekly: o.weekly ?? [],
    overrides: o.overrides ?? [],
    shifts: o.shifts ?? [],
    tz: o.tz ?? CHI,
  });
const span = (a: string, b: string, tz = CHI) => ({ start: z(a, tz), end: z(b, tz) });

// Oct 22 2026 is a Thursday = weekday 3.
describe("nothing is assumed", () => {
  it("with no requirements anywhere, nothing is required, uncovered or covered, whatever the shifts", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-22",
      shifts: [shift("2026-10-22T10:00", "2026-10-22T12:00")],
    });
    expect(r).toMatchObject({
      state: "not-defined",
      required: [],
      covered: [],
      uncovered: [],
      requiredMs: 0,
      uncoveredMs: 0,
      coveredMs: 0,
    });
  });
  it("requirements that exist but not in the range: none-required, still no gaps", () => {
    const r = run({ from: "2026-10-22", to: "2026-10-22", weekly: [wk(0, "08:00", "12:00")] });
    expect(r.state).toBe("none-required");
    expect(r.uncovered).toEqual([]);
  });
});

describe("the Oct 22 example", () => {
  const weekly = [wk(3, "08:00", "18:00")];
  const shifts = [
    shift("2026-10-22T10:00", "2026-10-22T12:00"),
    shift("2026-10-22T12:00", "2026-10-22T15:00"),
    shift("2026-10-22T16:00", "2026-10-23T00:00"),
  ];
  const r = run({ from: "2026-10-22", to: "2026-10-22", weekly, shifts });
  it("uncovered is exactly 8-10 AM and 3-4 PM", () => {
    expect(r.state).toBe("defined");
    expect(r.uncovered).toEqual([
      span("2026-10-22T08:00", "2026-10-22T10:00"),
      span("2026-10-22T15:00", "2026-10-22T16:00"),
    ]);
  });
  it("adjacent shifts leave no sliver at the join; totals add up", () => {
    expect(r.covered).toEqual([
      span("2026-10-22T10:00", "2026-10-22T15:00"),
      span("2026-10-22T16:00", "2026-10-22T18:00"),
    ]);
    expect([r.requiredMs, r.coveredMs, r.uncoveredMs]).toEqual([10 * H, 7 * H, 3 * H]);
  });
  it("shift time outside the required window is simply not counted", () => {
    expect(r.required).toEqual([span("2026-10-22T08:00", "2026-10-22T18:00")]);
  });
});

describe("who counts as coverage", () => {
  const weekly = [wk(3, "08:00", "12:00")];
  const day = { from: "2026-10-22", to: "2026-10-22", weekly };
  it("an open (unassigned) shift is unfilled, not covered", () => {
    const r = run({ ...day, shifts: [shift("2026-10-22T08:00", "2026-10-22T10:00", null)] });
    expect(r.coveredMs).toBe(0);
    expect(r.uncoveredMs).toBe(4 * H);
    expect(r.unfilled).toEqual([span("2026-10-22T08:00", "2026-10-22T10:00")]);
  });
  it("a canceled shift counts for nothing, assigned or not", () => {
    const r = run({
      ...day,
      shifts: [shift("2026-10-22T08:00", "2026-10-22T12:00", "m1", "canceled")],
    });
    expect(r.coveredMs).toBe(0);
    expect(r.unfilled).toEqual([]);
  });
  it("an assigned shift in any live status (claimed, swap) covers", () => {
    expect(
      run({ ...day, shifts: [shift("2026-10-22T08:00", "2026-10-22T12:00", "m1", "swap")] })
        .uncoveredMs,
    ).toBe(0);
  });
  it("overlapping shifts are not counted twice, and a contained shift changes nothing", () => {
    const r = run({
      ...day,
      shifts: [
        shift("2026-10-22T08:00", "2026-10-22T11:00", "m1"),
        shift("2026-10-22T09:00", "2026-10-22T10:00", "m2"),
        shift("2026-10-22T10:30", "2026-10-22T11:30", "m3"),
      ],
    });
    expect(r.coveredMs).toBe(3.5 * H);
    expect(r.uncovered).toEqual([span("2026-10-22T11:30", "2026-10-22T12:00")]);
  });
  it("an open shift beside an assigned one: only the uncovered part it spans is unfilled", () => {
    const r = run({
      ...day,
      shifts: [
        shift("2026-10-22T08:00", "2026-10-22T09:00", "m1"),
        shift("2026-10-22T08:30", "2026-10-22T10:00", null),
      ],
    });
    expect(r.uncovered).toEqual([span("2026-10-22T09:00", "2026-10-22T12:00")]);
    expect(r.unfilled).toEqual([span("2026-10-22T09:00", "2026-10-22T10:00")]);
  });
  it("overlapping or duplicate required windows are one requirement", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-22",
      weekly: [wk(3, "08:00", "12:00"), wk(3, "10:00", "14:00")],
    });
    expect(r.requiredMs).toBe(6 * H);
  });
});

describe("overnight requirements and shifts", () => {
  const weekly = [wk(3, "22:00", "06:00")]; // starts Thursday night
  it("an overnight shift covers an overnight window across midnight", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-23",
      weekly,
      shifts: [shift("2026-10-22T22:00", "2026-10-23T06:00")],
    });
    expect(r.requiredMs).toBe(8 * H);
    expect(r.uncovered).toEqual([]);
  });
  it("a shift that ends early leaves the tail uncovered on the next day", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-23",
      weekly,
      shifts: [shift("2026-10-22T22:00", "2026-10-23T04:00")],
    });
    expect(r.uncovered).toEqual([span("2026-10-23T04:00", "2026-10-23T06:00")]);
  });
  it("a window ending at midnight (00:00) is not carried into the next day", () => {
    const r = run({ from: "2026-10-22", to: "2026-10-23", weekly: [wk(3, "20:00", "00:00")] });
    expect(r.required).toEqual([span("2026-10-22T20:00", "2026-10-23T00:00")]);
  });
  it("two consecutive nights both count", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-24",
      weekly: [wk(3, "22:00", "06:00"), wk(4, "22:00", "06:00")],
    });
    expect(r.requiredMs).toBe(16 * H);
  });
});

describe("week boundaries", () => {
  const weekly = [wk(6, "22:00", "06:00")]; // Sunday night into Monday
  const sun = "2026-10-25";
  const mon = "2026-10-26";
  it("looking only at Monday still shows the tail of Sunday night's window", () => {
    const r = run({ from: mon, to: mon, weekly });
    expect(r.required).toEqual([span(`${mon}T00:00`, `${mon}T06:00`)]);
    expect(r.uncoveredMs).toBe(6 * H);
  });
  it("looking only at Sunday clips the window at midnight", () => {
    expect(run({ from: sun, to: sun, weekly }).required).toEqual([
      span(`${sun}T22:00`, `${mon}T00:00`),
    ]);
  });
  it("a shift crossing the boundary covers both sides", () => {
    const shifts = [shift(`${sun}T23:00`, `${mon}T03:00`)];
    expect(run({ from: sun, to: sun, weekly, shifts }).uncovered).toEqual([
      span(`${sun}T22:00`, `${sun}T23:00`),
    ]);
    expect(run({ from: mon, to: mon, weekly, shifts }).uncovered).toEqual([
      span(`${mon}T03:00`, `${mon}T06:00`),
    ]);
    expect(run({ from: sun, to: mon, weekly, shifts }).uncoveredMs).toBe(4 * H);
  });
});

describe("single-date overrides replace the weekly pattern", () => {
  const weekly = [wk(3, "08:00", "18:00")];
  it("the override's windows are required instead, not in addition", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-22",
      weekly,
      overrides: [{ day: "2026-10-22", windows: [{ start_time: "10:00", end_time: "12:00" }] }],
    });
    expect(r.required).toEqual([span("2026-10-22T10:00", "2026-10-22T12:00")]);
    expect(r.days[0]).toMatchObject({ source: "override" });
  });
  it("an empty override means nothing is required that date", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-22",
      weekly,
      overrides: [{ day: "2026-10-22", windows: [] }],
    });
    expect(r.state).toBe("none-required");
    expect(r.uncovered).toEqual([]);
    expect(r.days[0]).toMatchObject({ source: "override", intervals: [] });
  });
  it("only that date changes; the next Thursday follows the weekly pattern", () => {
    const o = [{ day: "2026-10-22", windows: [] }];
    expect(run({ from: "2026-10-29", to: "2026-10-29", weekly, overrides: o }).requiredMs).toBe(
      10 * H,
    );
  });
  it("an override that exists but the weekly has nothing for that weekday still defines the date", () => {
    const r = run({
      from: "2026-10-23",
      to: "2026-10-23",
      overrides: [{ day: "2026-10-23", windows: [{ start_time: "09:00", end_time: "10:00" }] }],
    });
    expect(r.state).toBe("defined");
    expect(r.requiredMs).toBe(1 * H);
  });
  it("a next-day override does not cancel the tail of the previous night's window", () => {
    const r = run({
      from: "2026-10-22",
      to: "2026-10-23",
      weekly: [wk(3, "22:00", "06:00")],
      overrides: [{ day: "2026-10-23", windows: [] }],
    });
    expect(r.requiredMs).toBe(8 * H);
  });
  it("requirementForDay reports where the day's hours came from", () => {
    expect(requirementForDay("2026-10-22", weekly, [], CHI).source).toBe("weekly");
    expect(requirementForDay("2026-10-21", weekly, [], CHI).source).toBe("none");
  });
});

describe("daylight saving", () => {
  it("fall back (Nov 1 2026): a 10 PM-6 AM requirement is 9 real hours, and a shift over the same wall hours covers all of it", () => {
    const weekly = [wk(5, "22:00", "06:00")]; // Saturday Oct 31 night
    const r = run({
      from: "2026-10-31",
      to: "2026-11-01",
      weekly,
      shifts: [shift("2026-10-31T22:00", "2026-11-01T06:00")],
    });
    expect(r.requiredMs).toBe(9 * H);
    expect(r.uncoveredMs).toBe(0);
  });
  it("fall back: a shift that ends at 5 AM wall time leaves one real hour uncovered", () => {
    const r = run({
      from: "2026-10-31",
      to: "2026-11-01",
      weekly: [wk(5, "22:00", "06:00")],
      shifts: [shift("2026-10-31T22:00", "2026-11-01T05:00")],
    });
    expect(r.uncoveredMs).toBe(1 * H);
  });
  it("fall back: a requirement starting inside the repeated hour is reported, using the first occurrence", () => {
    const r = run({ from: "2026-11-01", to: "2026-11-01", weekly: [wk(6, "01:00", "03:00")] });
    expect(r.requiredMs).toBe(3 * H); // 1 AM CDT -> 3 AM CST
    expect(r.adjustments).toEqual([{ day: "2026-11-01", time: "01:00", kind: "repeated" }]);
  });
  it("spring forward (Mar 8 2026): a 10 PM-6 AM requirement is 7 real hours", () => {
    const r = run({ from: "2026-03-07", to: "2026-03-08", weekly: [wk(5, "22:00", "06:00")] });
    expect(r.requiredMs).toBe(7 * H);
    expect(r.adjustments).toEqual([]);
  });
  it("spring forward: a start inside the skipped hour is not silently moved; it is reported and resolved to the next valid time", () => {
    const r = run({ from: "2026-03-08", to: "2026-03-08", weekly: [wk(6, "02:30", "04:00")] });
    expect(r.adjustments).toEqual([{ day: "2026-03-08", time: "02:30", kind: "nonexistent" }]);
    expect(r.required).toEqual([{ start: z("2026-03-08T03:00"), end: z("2026-03-08T04:00") }]);
  });
  it("an ordinary day has no adjustments", () => {
    expect(
      run({ from: "2026-10-22", to: "2026-10-22", weekly: [wk(3, "08:00", "12:00")] }).adjustments,
    ).toEqual([]);
  });
});

describe("the family's zone decides everything", () => {
  const weekly = [wk(3, "08:00", "12:00")];
  const s = [
    {
      start: "2026-10-22T13:00:00.000Z",
      end: "2026-10-22T17:00:00.000Z",
      assigned_member_id: "m1",
      status: "claimed",
    },
  ]; // 8 AM-12 PM CDT, 9 AM-1 PM EDT
  it("the same shift fully covers the Chicago requirement but not the New York one", () => {
    expect(
      run({ from: "2026-10-22", to: "2026-10-22", weekly, shifts: s, tz: CHI }).uncoveredMs,
    ).toBe(0);
    const ny = run({ from: "2026-10-22", to: "2026-10-22", weekly, shifts: s, tz: NY });
    expect(ny.uncovered).toEqual([span("2026-10-22T08:00", "2026-10-22T09:00", NY)]);
  });
});

describe("interval algebra", () => {
  it("merge, intersect and subtract behave on edges", () => {
    expect(
      mergeIntervals([
        { start: 5, end: 8 },
        { start: 1, end: 3 },
        { start: 3, end: 5 },
        { start: 9, end: 9 },
      ]),
    ).toEqual([{ start: 1, end: 8 }]);
    expect(
      intersectIntervals(
        [{ start: 0, end: 10 }],
        [
          { start: 3, end: 5 },
          { start: 8, end: 20 },
        ],
      ),
    ).toEqual([
      { start: 3, end: 5 },
      { start: 8, end: 10 },
    ]);
    expect(
      subtractIntervals(
        [{ start: 0, end: 10 }],
        [
          { start: 0, end: 2 },
          { start: 4, end: 6 },
          { start: 9, end: 12 },
        ],
      ),
    ).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 9 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [])).toEqual([{ start: 0, end: 10 }]);
    expect(subtractIntervals([{ start: 2, end: 4 }], [{ start: 0, end: 10 }])).toEqual([]);
  });
});
