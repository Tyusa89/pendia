// Feature C pure rules: words, schedule maths and daylight-saving parity with the database function, the reporting rules, errors.
// Synthetic data only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHANGE_REASON_LABEL,
  CHANGE_REASONS,
  DOSE_ERROR_TEXT,
  NOT_CONFIRMED_DETAIL,
  NOT_GIVEN_REASON_LABEL,
  NOT_GIVEN_REASONS,
  REPORT_FOOTNOTE,
  STATUS_LABEL,
  actionsFor,
  addDays,
  checkDisagreement,
  checkReport,
  computeOccurrences,
  describeSchedule,
  formatLocalTime,
  isoWeekday,
  parseDoseError,
  reportLine,
  scheduledAtFor,
  validateScheduleInput,
  type DoseErrorCode,
  type DoseOccurrence,
  type RuleContext,
} from "@/lib/dose-administration";

const H = 3600_000;
const NOW = Date.parse("2026-10-28T15:00:00Z");
const base = (over: Partial<RuleContext> = {}): RuleContext => ({
  actorId: "carlos",
  actorIsOrganizer: false,
  actorCanSeeMeds: true,
  scheduledAtMs: NOW - 2 * H,
  nowMs: NOW,
  head: null,
  expectedHead: null,
  ...over,
});

describe("the words never claim more than a report", () => {
  it("states are Given / Not given / Not confirmed", () => {
    expect(STATUS_LABEL).toEqual({
      given: "Given",
      not_given: "Not given",
      not_confirmed: "Not confirmed",
    });
  });
  it("no label, reason or error text says taken, verified, administered or confirmed ingestion", () => {
    const all = [
      ...Object.values(STATUS_LABEL),
      ...Object.values(NOT_GIVEN_REASON_LABEL),
      ...Object.values(CHANGE_REASON_LABEL),
      ...Object.values(DOSE_ERROR_TEXT),
      NOT_CONFIRMED_DETAIL,
    ].join("\n");
    expect(all).not.toMatch(
      /\btaken\b|verif|administered|ingest|swallow|proof|confirmed (the )?(dose|medication) (was|were)/i,
    );
    expect(REPORT_FOOTNOTE).toMatch(/does not check that the medication was taken/);
  });
  it("reasons for Not given are predefined, with no free text", () => {
    expect([...NOT_GIVEN_REASONS]).toEqual([
      "refused",
      "unwell",
      "unavailable",
      "skipped_on_purpose",
      "other",
    ]);
    expect(Object.keys(NOT_GIVEN_REASON_LABEL).sort()).toEqual([...NOT_GIVEN_REASONS].sort());
    expect(Object.keys(CHANGE_REASON_LABEL).sort()).toEqual([...CHANGE_REASONS].sort());
  });
  it("formats local times and report lines", () => {
    expect(formatLocalTime("08:00:00")).toBe("8:00 AM");
    expect(formatLocalTime("00:15")).toBe("12:15 AM");
    expect(formatLocalTime("12:30")).toBe("12:30 PM");
    expect(formatLocalTime("20:05:00")).toBe("8:05 PM");
    const o = {
      status: "given",
      reported_by_name: "Carlos",
      reported_at: "2026-10-28T13:02:00Z",
      tz: "America/Chicago",
    } as const;
    expect(reportLine(o)).toBe("Reported given by Carlos at 8:02 AM");
    expect(reportLine({ ...o, status: "not_given" })).toBe(
      "Reported not given by Carlos at 8:02 AM",
    );
    expect(
      reportLine({ status: "not_confirmed", reported_by_name: null, reported_at: null, tz: "UTC" }),
    ).toBe(NOT_CONFIRMED_DETAIL);
    expect(reportLine({ ...o, status: "not_confirmed" })).toMatch(
      /withdrawn by Carlos.*Not confirmed/,
    );
  });
});

describe("dates and schedules", () => {
  it("ISO weekdays and day arithmetic", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("validates what an organizer types: fixed time + weekdays only", () => {
    const ok = {
      medication_id: "m",
      local_time: "08:00",
      days_of_week: [1, 3, 5],
      starts_on: "2026-10-27",
      ends_on: null,
    };
    expect(validateScheduleInput(ok)).toEqual({});
    expect(validateScheduleInput({ ...ok, local_time: "8am" }).local_time).toBeTruthy();
    expect(validateScheduleInput({ ...ok, local_time: "24:00" }).local_time).toBeTruthy();
    expect(validateScheduleInput({ ...ok, days_of_week: [] }).days_of_week).toBeTruthy();
    expect(validateScheduleInput({ ...ok, days_of_week: [8] }).days_of_week).toBeTruthy();
    expect(validateScheduleInput({ ...ok, days_of_week: [1, 1] }).days_of_week).toBeTruthy();
    expect(validateScheduleInput({ ...ok, starts_on: "2026-02-30" }).starts_on).toBeTruthy();
    expect(validateScheduleInput({ ...ok, ends_on: "2026-10-01" }).ends_on).toBeTruthy();
    expect(validateScheduleInput({ ...ok, ends_on: "2026-10-27" })).toEqual({});
  });
  it("describes a schedule in words", () => {
    expect(describeSchedule({ local_time: "08:00:00", days_of_week: [1, 2, 3, 4, 5, 6, 7] })).toBe(
      "8:00 AM · Every day",
    );
    expect(describeSchedule({ local_time: "20:00", days_of_week: [5, 1, 3] })).toBe(
      "8:00 PM · Mon, Wed, Fri",
    );
  });
  it("occurrences are computed from structured schedules only, per weekday, within the start and end dates", () => {
    const s = [
      {
        id: "a",
        medication_id: "m1",
        local_time: "08:00",
        days_of_week: [1, 3],
        starts_on: "2026-10-26",
        ends_on: null,
      },
      {
        id: "b",
        medication_id: "m1",
        local_time: "20:00",
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        starts_on: "2026-10-28",
        ends_on: "2026-10-29",
      },
    ];
    const o = computeOccurrences(s, "America/Chicago", "2026-10-26", "2026-10-30");
    expect(o.map((x) => `${x.local_date} ${x.local_time} ${x.schedule_id}`)).toEqual([
      "2026-10-26 08:00 a",
      "2026-10-28 08:00 a",
      "2026-10-28 20:00 b",
      "2026-10-29 20:00 b",
    ]);
    expect(computeOccurrences(s, "America/Chicago", "2026-10-27", "2026-10-27")).toEqual([]);
    expect(computeOccurrences([], "UTC", "2026-10-26", "2026-10-30")).toEqual([]);
  });
});

describe("daylight saving: the same answers as the database function", () => {
  const vectors = JSON.parse(
    readFileSync(join(process.cwd(), "src/test/fixtures/dose-dst-vectors.json"), "utf8"),
  ) as Array<[string, string, string, string | null, string]>;
  it("the vectors were generated from dose_scheduled_at() and cover skipped and repeated times", () => {
    expect(vectors.length).toBeGreaterThan(400);
    expect(vectors.filter((v) => v[4] === "skipped").length).toBeGreaterThan(8);
    expect(vectors.filter((v) => v[4] === "ambiguous").length).toBeGreaterThan(8);
  });
  it("agrees with every one of them (16 zone-days across 12 zones, 30-minute steps from midnight)", () => {
    const bad: string[] = [];
    for (const [zone, date, time, at, state] of vectors) {
      const r = scheduledAtFor(date, time, zone);
      const got = r.at === null ? null : r.at.replace(/\.\d{3}Z$/, "Z");
      if (got !== at || r.state !== state)
        bad.push(`${zone} ${date} ${time}: sql=${at}/${state} ts=${got}/${r.state}`);
    }
    expect(bad).toEqual([]);
  });
  it("named cases: a skipped time is never shifted, a repeated time uses the earlier instant", () => {
    expect(scheduledAtFor("2026-03-08", "02:30", "America/Chicago")).toEqual({
      at: null,
      state: "skipped",
    });
    expect(scheduledAtFor("2026-03-08", "03:30", "America/Chicago")).toEqual({
      at: "2026-03-08T08:30:00.000Z",
      state: "normal",
    });
    expect(scheduledAtFor("2026-11-01", "01:30", "America/Chicago")).toEqual({
      at: "2026-11-01T06:30:00.000Z",
      state: "ambiguous",
    });
    expect(scheduledAtFor("2026-11-01", "02:30", "America/Chicago").state).toBe("normal");
  });
  it("a repeated hour is one occurrence, a skipped time is listed and flagged", () => {
    const s = [
      {
        id: "x",
        medication_id: "m",
        local_time: "01:30",
        days_of_week: [7],
        starts_on: "2026-01-01",
        ends_on: null,
      },
    ];
    const o = computeOccurrences(s, "America/Chicago", "2026-11-01", "2026-11-01");
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({
      time_state: "ambiguous",
      scheduled_at: "2026-11-01T06:30:00.000Z",
    });
    const t = [
      {
        id: "y",
        medication_id: "m",
        local_time: "02:30",
        days_of_week: [7],
        starts_on: "2026-01-01",
        ends_on: null,
      },
    ];
    expect(computeOccurrences(t, "America/Chicago", "2026-03-08", "2026-03-08")[0]).toMatchObject({
      time_state: "skipped",
      scheduled_at: null,
    });
  });
});

describe("the reporting rules (mirror of report_dose)", () => {
  const given = { id: "h1", status: "given" as const, reportedBy: "carlos" };
  it.each<[string, Partial<RuleContext>, Parameters<typeof checkReport>[1], DoseErrorCode | null]>([
    ["a first report is accepted", {}, { status: "given" }, null],
    [
      "a first Not given with a predefined reason",
      {},
      { status: "not_given", notGivenReason: "refused" },
      null,
    ],
    ["no meds visibility", { actorCanSeeMeds: false }, { status: "given" }, "dose_not_found"],
    [
      "a reason only goes with Not given",
      {},
      { status: "given", notGivenReason: "refused" },
      "dose_bad_request",
    ],
    [
      "an unknown reason",
      {},
      { status: "not_given", notGivenReason: "because" as never },
      "dose_bad_request",
    ],
    ["an unknown status", {}, { status: "taken" as never }, "dose_bad_request"],
    [
      "a time that does not exist",
      { scheduledAtMs: null },
      { status: "given" },
      "dose_time_skipped",
    ],
    [
      "a dose that is not due yet",
      { scheduledAtMs: NOW + H },
      { status: "given" },
      "dose_future_not_allowed",
    ],
    [
      "a stale view (someone reported meanwhile)",
      { head: given, expectedHead: null },
      { status: "not_given" },
      "dose_conflict",
    ],
    [
      "outside 48 h, a member",
      { scheduledAtMs: NOW - 49 * H },
      { status: "given" },
      "dose_window_closed",
    ],
    [
      "outside 48 h, an organizer without a reason",
      { actorIsOrganizer: true, scheduledAtMs: NOW - 49 * H },
      { status: "given" },
      "dose_reason_required",
    ],
    [
      "outside 48 h, an organizer with a reason",
      { actorIsOrganizer: true, scheduledAtMs: NOW - 49 * H },
      { status: "given", changeReason: "late_entry" },
      null,
    ],
    ["exactly 48 h is still inside", { scheduledAtMs: NOW - 48 * H }, { status: "given" }, null],
    ["nothing to withdraw", {}, { status: "not_confirmed" }, "dose_nothing_to_retract"],
    [
      "the reporter corrects with a reason",
      { head: given, expectedHead: "h1" },
      { status: "not_given", changeReason: "reported_by_mistake" },
      null,
    ],
    [
      "a correction without a reason",
      { head: given, expectedHead: "h1" },
      { status: "not_given" },
      "dose_reason_required",
    ],
    [
      "restating the same status",
      { head: given, expectedHead: "h1" },
      { status: "given", changeReason: "other" },
      "dose_no_change",
    ],
    [
      "confirming after review",
      { head: given, expectedHead: "h1" },
      { status: "given", changeReason: "confirmed_after_review" },
      null,
    ],
    [
      "another member may not change it",
      { actorId: "rita", head: given, expectedHead: "h1" },
      { status: "not_given", changeReason: "other" },
      "dose_correction_not_allowed",
    ],
    [
      "an organizer may",
      { actorId: "olive", actorIsOrganizer: true, head: given, expectedHead: "h1" },
      { status: "not_given", changeReason: "information_changed" },
      null,
    ],
    [
      "a withdrawal",
      { head: given, expectedHead: "h1" },
      { status: "not_confirmed", changeReason: "reported_by_mistake" },
      null,
    ],
    [
      "anyone may report again after a withdrawal",
      {
        actorId: "rita",
        head: { id: "h2", status: "not_confirmed", reportedBy: "carlos" },
        expectedHead: "h2",
      },
      { status: "given" },
      null,
    ],
    [
      "nothing to withdraw twice",
      { head: { id: "h2", status: "not_confirmed", reportedBy: "carlos" }, expectedHead: "h2" },
      { status: "not_confirmed" },
      "dose_no_change",
    ],
  ])("%s", (_n, ctx, req, expected) => {
    expect(checkReport(base(ctx), req)).toBe(expected);
  });

  it("disagreement flags: only another caregiver, only on a current report, never a status change", () => {
    const d = (o: Partial<Parameters<typeof checkDisagreement>[0]> = {}) =>
      checkDisagreement({
        actorId: "rita",
        actorCanSeeMeds: true,
        scheduledAtMs: NOW - H,
        head: given,
        expectedHead: "h1",
        ...o,
      });
    expect(d()).toBeNull();
    expect(d({ actorCanSeeMeds: false })).toBe("dose_not_found");
    expect(d({ head: null, expectedHead: null })).toBe("dose_nothing_to_dispute");
    expect(d({ head: { ...given, status: "not_confirmed" } })).toBe("dose_nothing_to_dispute");
    expect(d({ expectedHead: "old" })).toBe("dose_conflict");
    expect(d({ actorId: "carlos" })).toBe("dose_use_correction_instead");
    expect(d({ scheduledAtMs: null })).toBe("dose_time_skipped");
    expect(d({ scheduledAtMs: NOW + H, nowMs: NOW })).toBe("dose_future_not_allowed");
    expect(d({ scheduledAtMs: NOW - H, nowMs: NOW })).toBeNull();
  });
});

describe("what the screen offers (display only)", () => {
  const occ = (over: Partial<DoseOccurrence> = {}) => ({
    status: "not_confirmed" as const,
    head_id: null,
    reported_by: null,
    scheduled_at: new Date(NOW - 2 * H).toISOString(),
    time_state: "normal" as const,
    ...over,
  });
  const member = { isOrganizer: false, canSeeMeds: true, memberId: "carlos" };
  it("an unreported, due dose offers the first report", () => {
    expect(actionsFor(occ(), member, NOW)).toMatchObject({
      report: true,
      change: false,
      flag: false,
    });
  });
  it("the reporter and organizers may change a report; another caregiver may only flag a disagreement", () => {
    const reported = occ({ status: "given", head_id: "h1", reported_by: "carlos" });
    expect(actionsFor(reported, member, NOW)).toMatchObject({
      report: false,
      change: true,
      flag: false,
    });
    expect(actionsFor(reported, { ...member, memberId: "rita" }, NOW)).toMatchObject({
      change: false,
      flag: true,
    });
    expect(
      actionsFor(reported, { ...member, memberId: "olive", isOrganizer: true }, NOW),
    ).toMatchObject({ change: true, flag: false });
  });
  it("a dose that is not due, a skipped time, a closed window and a missing permission offer nothing, with a reason", () => {
    expect(
      actionsFor(occ({ scheduled_at: new Date(NOW + H).toISOString() }), member, NOW),
    ).toMatchObject({ report: false, why: "Not due yet." });
    expect(actionsFor(occ({ scheduled_at: null, time_state: "skipped" }), member, NOW).why).toMatch(
      /clocks changed/,
    );
    expect(
      actionsFor(occ({ scheduled_at: new Date(NOW - 50 * H).toISOString() }), member, NOW),
    ).toMatchObject({ report: false });
    expect(
      actionsFor(
        occ({ scheduled_at: new Date(NOW - 50 * H).toISOString() }),
        { ...member, isOrganizer: true },
        NOW,
      ),
    ).toMatchObject({ report: true, lateOnly: true });
    expect(actionsFor(occ(), { ...member, canSeeMeds: false }, NOW)).toMatchObject({
      report: false,
      change: false,
      flag: false,
    });
  });
});

describe("database errors become plain words, never raw text", () => {
  it.each(
    Object.keys(DOSE_ERROR_TEXT).filter(
      (k) => !["dose_unavailable", "dose_organizer_only"].includes(k),
    ) as DoseErrorCode[],
  )("%s", (code) => {
    const e = parseDoseError(code);
    expect(e.code).toBe(code);
    expect(e.message).toBe(DOSE_ERROR_TEXT[code]);
  });
  it("a missing table or function means the feature is not switched on yet", () => {
    expect(parseDoseError('relation "public.medication_schedule" does not exist').code).toBe(
      "dose_unavailable",
    );
    expect(
      parseDoseError("Could not find the function public.report_dose(...) in the schema cache")
        .code,
    ).toBe("dose_unavailable");
  });
  it("a refused schedule write says organizers only", () => {
    expect(
      parseDoseError('new row violates row-level security policy for table "medication_schedule"')
        .code,
    ).toBe("dose_organizer_only");
  });
  it("anything unknown is shown as a calm generic message, not the raw text", () => {
    const e = parseDoseError("duplicate key value violates unique constraint secret_internal_name");
    expect(e.code).toBe("unknown");
    expect(e.message).not.toMatch(/secret_internal_name|constraint/);
  });
});
