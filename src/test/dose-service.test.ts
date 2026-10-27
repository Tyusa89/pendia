// Feature C service: exact database calls, nothing client-supplied that the server must decide, row validation, error mapping.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown?]> = [];
  const state = { reply: { data: [] as unknown, error: null as { message: string } | null } };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "insert", "update", "delete", "single"]) {
    builder[m] = (arg?: unknown) => {
      calls.push([m, arg]);
      return builder;
    };
  }
  builder["then"] = (res: (v: unknown) => unknown) => Promise.resolve(state.reply).then(res);
  const rpc = vi.fn();
  const from = vi.fn((t: string) => {
    calls.push(["from", t]);
    return builder;
  });
  return { calls, state, rpc, from };
});
const { calls, rpc, from } = h;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { doseService } from "@/services";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const occ = {
  schedule_id: U(1),
  medication_id: U(2),
  medication_name: "Synthetic A",
  dose_text: "1 tablet",
  local_date: "2026-10-28",
  local_time: "08:00:00",
  tz: "America/Chicago",
  scheduled_at: "2026-10-28T13:00:00Z",
  time_state: "normal",
  status: "not_confirmed",
  head_id: null,
  reported_by: null,
  reported_by_name: null,
  reported_at: null,
  not_given_reason: null,
  change_reason: null,
  outside_window: false,
  reports_differ: false,
  open_disagreements: 0,
  history_count: 0,
};

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  calls.length = 0;
  h.state.reply = { data: [], error: null };
});

describe("reporting goes through the database functions only", () => {
  it("sends exactly the documented arguments: no reporter, time or family", async () => {
    rpc.mockResolvedValue({ data: "x", error: null });
    await doseService.report({
      scheduleId: U(1),
      localDate: "2026-10-28",
      status: "given",
      expectedHead: null,
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith("report_dose", {
      _schedule_id: U(1),
      _local_date: "2026-10-28",
      _status: "given",
      _expected_head: null,
      _client_request_id: "req-1",
      _not_given_reason: null,
      _change_reason: null,
    });
    const keys = Object.keys(rpc.mock.calls[0]![1] as object).join(" ");
    expect(keys).not.toMatch(/reporter|reported_by|reported_at|family|member|scheduled_at/);
    expect(from).not.toHaveBeenCalled(); // never writes the table directly
  });
  it("only sends a Not given reason with Not given", async () => {
    rpc.mockResolvedValue({ data: "x", error: null });
    await doseService.report({
      scheduleId: U(1),
      localDate: "2026-10-28",
      status: "given",
      expectedHead: U(3),
      requestId: "r",
      notGivenReason: "refused",
      changeReason: "other",
    });
    expect((rpc.mock.calls[0]![1] as Record<string, unknown>)["_not_given_reason"]).toBeNull();
    await doseService.report({
      scheduleId: U(1),
      localDate: "2026-10-28",
      status: "not_given",
      expectedHead: null,
      requestId: "r2",
      notGivenReason: "refused",
    });
    expect((rpc.mock.calls[1]![1] as Record<string, unknown>)["_not_given_reason"]).toBe("refused");
  });
  it("a retry reuses the caller's request id unchanged", async () => {
    rpc.mockResolvedValue({ data: "x", error: null });
    const a = {
      scheduleId: U(1),
      localDate: "2026-10-28",
      status: "given" as const,
      expectedHead: null,
      requestId: "same",
    };
    await doseService.report(a);
    await doseService.report(a);
    expect(
      rpc.mock.calls.map((c) => (c[1] as Record<string, unknown>)["_client_request_id"]),
    ).toEqual(["same", "same"]);
  });
  it("flags a disagreement through its own function", async () => {
    rpc.mockResolvedValue({ data: "x", error: null });
    await doseService.flagDisagreement({
      scheduleId: U(1),
      localDate: "2026-10-28",
      expectedHead: U(3),
      requestId: "f1",
    });
    expect(rpc).toHaveBeenCalledWith("flag_dose_disagreement", {
      _schedule_id: U(1),
      _local_date: "2026-10-28",
      _expected_head: U(3),
      _client_request_id: "f1",
    });
  });
  it.each([
    ["dose_conflict", "dose_conflict"],
    ["dose_window_closed", "dose_window_closed"],
    ['relation "public.dose_administration" does not exist', "dose_unavailable"],
  ])("maps %s", async (msg, code) => {
    rpc.mockResolvedValue({ data: null, error: { message: msg } });
    await expect(
      doseService.report({
        scheduleId: U(1),
        localDate: "2026-10-28",
        status: "given",
        expectedHead: null,
        requestId: "r",
      }),
    ).rejects.toMatchObject({ code });
  });
});

describe("reading validates what comes back", () => {
  it("returns well-formed occurrences", async () => {
    rpc.mockResolvedValue({ data: [occ], error: null });
    const r = await doseService.occurrences(U(9), "2026-10-28", "2026-10-28");
    expect(rpc).toHaveBeenCalledWith("dose_occurrences", {
      _family_id: U(9),
      _from: "2026-10-28",
      _to: "2026-10-28",
    });
    expect(r[0]!.status).toBe("not_confirmed");
  });
  it("rejects a row with an invented status", async () => {
    rpc.mockResolvedValue({ data: [{ ...occ, status: "taken" }], error: null });
    await expect(doseService.occurrences(U(9), "2026-10-28", "2026-10-28")).rejects.toMatchObject({
      code: "unknown",
    });
  });
  it("reads history oldest first for one dose", async () => {
    h.state.reply = { data: [], error: null };
    await doseService.history(U(1), "2026-10-28");
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "dose_administration"],
        ["eq", "schedule_id"],
        ["order", "seq"],
      ]),
    );
  });
});

describe("schedules", () => {
  const input = {
    medication_id: U(2),
    local_time: "08:00",
    days_of_week: [5, 1],
    starts_on: "2026-10-27",
    ends_on: null,
  };
  it("refuses an invalid schedule before calling the database", async () => {
    await expect(
      doseService.addSchedule(U(9), { ...input, local_time: "8am" }),
    ).rejects.toMatchObject({ code: "dose_bad_request" });
    expect(from).not.toHaveBeenCalled();
  });
  it("inserts fixed time and sorted weekdays, with the family id", async () => {
    h.state.reply = { data: { id: U(5) }, error: null };
    await doseService.addSchedule(U(9), input);
    const ins = calls.find((c) => c[0] === "insert")![1] as Record<string, unknown>;
    expect(ins).toMatchObject({ family_id: U(9), local_time: "08:00", days_of_week: [1, 5] });
  });
  it("a row-level refusal says organizers only", async () => {
    h.state.reply = {
      data: null,
      error: {
        message: 'new row violates row-level security policy for table "medication_schedule"',
      },
    };
    await expect(doseService.addSchedule(U(9), input)).rejects.toMatchObject({
      code: "dose_organizer_only",
    });
  });
});
