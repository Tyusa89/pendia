// The time-grid math: one event per shift per local day, placed by real elapsed time in the family's zone.
import { describe, expect, it } from "vitest";
import { HOUR_REM, hourTicks, timelineEvents, unscheduledIntervals } from "@/lib/coverage-timeline";
import { fromZonedInputValue } from "@/lib/zoned-time";

const CHI = "America/Chicago";
const sh = (id: string, from: string, to: string, tz = CHI) => ({
  id,
  start: fromZonedInputValue(from, tz)!,
  end: fromZonedInputValue(to, tz)!,
});
const ids = (e: Array<{ shift: { id: string } }>) => e.map((x) => x.shift.id);
const hm = (t: number, tz = CHI) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(t);

// The confirmed example: Oct 22 2026, America/Chicago.
const OCT22 = [
  sh("a", "2026-10-22T10:00", "2026-10-22T12:00"),
  sh("b", "2026-10-22T12:00", "2026-10-22T15:00"),
  sh("c", "2026-10-22T16:00", "2026-10-23T00:00"),
];

describe("the Oct 22 example: three shifts are three events", () => {
  const ev = timelineEvents(OCT22, "2026-10-22", CHI);
  it("each shift appears exactly once, even though 12 PM and 4 PM cross old period boundaries", () => {
    expect(ids(ev)).toEqual(["a", "b", "c"]);
  });
  it("placement is proportional to real time: 10–12 is 2 h, 12–3 is 3 h and starts where the first ends", () => {
    const [a, b, c] = ev;
    expect(a!.topRem).toBe(10 * HOUR_REM);
    expect(a!.heightRem).toBe(2 * HOUR_REM);
    expect(b!.topRem).toBe(a!.topRem + a!.heightRem);
    expect(b!.heightRem).toBe(3 * HOUR_REM);
    expect(c!.topRem).toBe(16 * HOUR_REM);
    expect(c!.heightRem).toBe(8 * HOUR_REM);
  });
  it("adjacent shifts share no lane group: each uses the full width", () => {
    expect(ev.map((e) => [e.lane, e.lanes])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });
  it("4 PM–midnight ends exactly at midnight: it is not repeated on Oct 23 and does not claim to continue", () => {
    expect(ev[2]!.endsAfter).toBe(false);
    expect(timelineEvents(OCT22, "2026-10-23", CHI)).toEqual([]);
  });
  it("3–4 PM is unscheduled, as are midnight–10 AM", () => {
    const gaps = unscheduledIntervals(ev, "2026-10-22", CHI).map(([x, y]) => `${hm(x)}-${hm(y)}`);
    expect(gaps).toEqual(["00:00-10:00", "15:00-16:00"]);
  });
  it("a day with nothing is entirely unscheduled", () => {
    expect(unscheduledIntervals([], "2026-10-24", CHI)).toHaveLength(1);
  });
});

describe("overlapping shifts", () => {
  it("a shift contained inside a longer one does not make the rest of the long shift look unscheduled", () => {
    const ev = timelineEvents(
      [
        sh("long", "2026-10-22T09:00", "2026-10-22T17:00"),
        sh("in", "2026-10-22T11:00", "2026-10-22T12:00"),
      ],
      "2026-10-22",
      CHI,
    );
    const gaps = unscheduledIntervals(ev, "2026-10-22", CHI).map(([x, y]) => `${hm(x)}-${hm(y)}`);
    expect(gaps).toEqual(["00:00-09:00", "17:00-00:00"]);
  });
  it("partial overlap goes side by side, neither hidden", () => {
    const ev = timelineEvents(
      [
        sh("x", "2026-10-22T09:00", "2026-10-22T13:00"),
        sh("y", "2026-10-22T11:00", "2026-10-22T15:00"),
      ],
      "2026-10-22",
      CHI,
    );
    expect(ev.map((e) => [e.shift.id, e.lane, e.lanes])).toEqual([
      ["x", 0, 2],
      ["y", 1, 2],
    ]);
  });
  it("a lane is reused once its shift ends; a third overlapping shift gets its own lane", () => {
    const ev = timelineEvents(
      [
        sh("x", "2026-10-22T08:00", "2026-10-22T10:00"),
        sh("y", "2026-10-22T09:00", "2026-10-22T12:00"),
        sh("z", "2026-10-22T10:00", "2026-10-22T11:00"),
      ],
      "2026-10-22",
      CHI,
    );
    expect(ev.map((e) => [e.shift.id, e.lane, e.lanes])).toEqual([
      ["x", 0, 2],
      ["y", 1, 2],
      ["z", 0, 2],
    ]);
  });
  it("identical shifts both show", () => {
    expect(
      timelineEvents(
        [
          sh("x", "2026-10-22T09:00", "2026-10-22T10:00"),
          sh("y", "2026-10-22T09:00", "2026-10-22T10:00"),
        ],
        "2026-10-22",
        CHI,
      ),
    ).toHaveLength(2);
  });
  it("overlapping events are not shaded as unscheduled", () => {
    const ev = timelineEvents(
      [
        sh("x", "2026-10-22T09:00", "2026-10-22T13:00"),
        sh("y", "2026-10-22T11:00", "2026-10-22T15:00"),
      ],
      "2026-10-22",
      CHI,
    );
    expect(
      unscheduledIntervals(ev, "2026-10-22", CHI).map(([x, y]) => `${hm(x)}-${hm(y)}`),
    ).toEqual(["00:00-09:00", "15:00-24:00"].map((s) => s.replace("24:00", "00:00")));
  });
});

describe("overnight and week boundaries", () => {
  const night = [sh("n", "2026-10-22T22:00", "2026-10-23T06:00")];
  it("is split at local midnight: one event per day, each marked as continuing", () => {
    const d1 = timelineEvents(night, "2026-10-22", CHI)[0]!;
    const d2 = timelineEvents(night, "2026-10-23", CHI)[0]!;
    expect([d1.startsBefore, d1.endsAfter, d1.heightRem]).toEqual([false, true, 2 * HOUR_REM]);
    expect([d2.startsBefore, d2.endsAfter, d2.topRem, d2.heightRem]).toEqual([
      true,
      false,
      0,
      6 * HOUR_REM,
    ]);
  });
  it("Sunday night into the next week's Monday: Sunday's event continues, Monday's started the day before", () => {
    const wk = [sh("w", "2026-10-25T22:00", "2026-10-26T06:00")]; // Sunday -> Monday (next week)
    expect(timelineEvents(wk, "2026-10-25", CHI)[0]).toMatchObject({ endsAfter: true });
    expect(timelineEvents(wk, "2026-10-26", CHI)[0]).toMatchObject({
      startsBefore: true,
      endsAfter: false,
    });
  });
  it("a shift over 24 hours has full-height middle days", () => {
    const long = [sh("l", "2026-10-22T20:00", "2026-10-24T08:00")];
    const mid = timelineEvents(long, "2026-10-23", CHI)[0]!;
    expect([mid.startsBefore, mid.endsAfter, mid.heightRem]).toEqual([true, true, 24 * HOUR_REM]);
  });
});

describe("daylight saving", () => {
  it("fall back (Nov 1 2026): the day is 25 hours and a 10 PM–6 AM shift is 9 real hours across two days", () => {
    expect(hourTicks("2026-11-01", CHI).hours).toBe(25);
    const n = [sh("n", "2026-10-31T22:00", "2026-11-01T06:00")];
    const a = timelineEvents(n, "2026-10-31", CHI)[0]!;
    const b = timelineEvents(n, "2026-11-01", CHI)[0]!;
    expect((a.heightRem + b.heightRem) / HOUR_REM).toBe(9);
    expect(b.heightRem / HOUR_REM).toBe(7); // midnight -> 6 AM CST, through the repeated hour
  });
  it("fall back: 25 ticks, and the repeated 1 AM is told apart by its zone abbreviation", () => {
    const { ticks } = hourTicks("2026-11-01", CHI);
    expect(ticks).toHaveLength(25);
    const ones = ticks.filter((t) => /^1(\u202f| )AM/.test(t.label));
    expect(ones.map((t) => t.label.replace(/\u202f/g, " "))).toEqual(["1 AM CDT", "1 AM CST"]);
  });
  it("spring forward (Mar 8 2026): the day is 23 hours, there is no 2 AM tick, and an event after the jump is placed by real time", () => {
    const g = hourTicks("2026-03-08", CHI);
    expect(g.hours).toBe(23);
    expect(g.ticks).toHaveLength(23);
    expect(g.ticks.some((t) => t.label.replace(/\u202f/g, " ") === "2 AM")).toBe(false);
    const e = timelineEvents(
      [sh("s", "2026-03-08T03:00", "2026-03-08T05:00")],
      "2026-03-08",
      CHI,
    )[0]!;
    expect(e.topRem).toBe(2 * HOUR_REM); // 3 AM CDT is the 3rd real hour after midnight (midnight, 1 AM, then 3 AM)
    expect(e.heightRem).toBe(2 * HOUR_REM);
  });
  it("ordinary days have 24 ticks", () => {
    expect(hourTicks("2026-10-22", CHI).ticks).toHaveLength(24);
  });
});

describe("the family's zone, not the device's", () => {
  it("the same instants fall on different days in Chicago and New York", () => {
    const s = [{ id: "q", start: "2026-10-23T03:30:00.000Z", end: "2026-10-23T05:30:00.000Z" }]; // 10:30 PM-12:30 AM CDT / 11:30 PM-1:30 AM EDT
    expect(timelineEvents(s, "2026-10-22", CHI)[0]!.endsAfter).toBe(true);
    expect(timelineEvents(s, "2026-10-22", "America/New_York")[0]!.endsAfter).toBe(true);
    expect(timelineEvents(s, "2026-10-23", CHI)[0]!.heightRem / HOUR_REM).toBe(0.5);
    expect(timelineEvents(s, "2026-10-23", "America/New_York")[0]!.heightRem / HOUR_REM).toBe(1.5);
  });
  it("half-hour offset zones still get ticks on the local hour", () => {
    const { ticks, hours } = hourTicks("2026-10-22", "Asia/Kolkata");
    expect(hours).toBe(24);
    expect(ticks).toHaveLength(24);
  });
});
