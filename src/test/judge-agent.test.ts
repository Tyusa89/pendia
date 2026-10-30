import { beforeEach, describe, expect, it, vi } from "vitest";
import { askCareAgent, careAgentStatus, resetCareAgentLimits } from "@/server/care-agent.server";
import { createJudgePackSource } from "@/server/judge-agent-source.server";
import { JUDGE_AGENT_RATE, takeJudgeRateSlot } from "@/server/judge-agent-limits.server";
import { JUDGE_DEMO_USER_ID, JUDGE_DEMO_FAMILY_ID } from "@/lib/judge-demo";
import { answerJson, fakeSource, providerReply, ENV_ON, NOW } from "./care-agent-helpers";

const session = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const env = { ...ENV_ON, JUDGE_AGENT_LIVE_ENABLED: "true", JUDGE_AGENT_REDIS_URL: "https://example.invalid", JUDGE_AGENT_REDIS_TOKEN: "fictional-test-token" };
const input = { familyId: JUDGE_DEMO_FAMILY_ID, question: "What medication is listed?", recentTurns: [] };
beforeEach(resetCareAgentLimits);

describe("judge uses the existing grounded agent, never live records", () => {
  it("returns validated Meta-path output and existing medication citations", async () => {
    const live = fakeSource();
    const fetchImpl = vi.fn(async () => providerReply(answerJson({ answer: "Lisinopril 10 mg is listed as an active medication.", citations: ["med:141481e0-54dc-4a0f-8e6e-354c8861d432"] })));
    const takeJudgeSlot = vi.fn(async () => true);
    const result = await askCareAgent({ env, userId: JUDGE_DEMO_USER_ID, judgeSessionId: session, input, source: live.source, fetchImpl, takeJudgeSlot, now: () => NOW.getTime() });
    expect(result).toMatchObject({ ok: true, sources: [{ id: "med:141481e0-54dc-4a0f-8e6e-354c8861d432", label: "Medication — Lisinopril" }] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(takeJudgeSlot).toHaveBeenCalledOnce();
    expect(live.calls).toMatchObject({ getMember: 0, getFamily: 0, loadRows: 0 });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])?.[1]?.body as string);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.messages[1].content).toContain("Grandma Rosa");
    expect(body.messages[1].content).not.toContain("Pat Sample");
  });
  for (const blocked of [
    { env: { ...env, JUDGE_AGENT_LIVE_ENABLED: undefined } },
    { env: { ...env, AGENT_LIVE_ENABLED: "false" } },
    { env: { ...env, JUDGE_AGENT_REDIS_TOKEN: undefined } },
    { judgeSessionId: undefined },
    { input: { ...input, familyId: "11111111-1111-4111-8111-111111111111" } },
  ]) it("fails closed before any family read or model call", async () => {
    const live = fakeSource();
    const fetchImpl = vi.fn();
    const result = await askCareAgent({ env, userId: JUDGE_DEMO_USER_ID, input, judgeSessionId: session, source: live.source, fetchImpl, ...blocked });
    expect(result).toMatchObject({ ok: false, code: "not_enabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(live.calls.loadRows).toBe(0);
  });
  it("keeps ordinary users outside the judge exception", async () => {
    const status = await careAgentStatus({ env: { ...env, AGENT_LIVE_USER_IDS: "" }, userId: ENV_ON.AGENT_LIVE_USER_IDS ?? "", familyId: JUDGE_DEMO_FAMILY_ID, judgeSessionId: session, source: fakeSource().source });
    expect(status.state).toBe("not_enabled");
  });
  it("does not pass audio, contact information, schedules or dose reports to the pack", async () => {
    const rows = await createJudgePackSource().loadRows({ familyId: JUDGE_DEMO_FAMILY_ID, now: NOW, timezone: "America/Chicago", access: { meds: true, visits: true, schedule: true } });
    expect(rows.doses).toEqual([]);
    expect(rows.medications[0]?.schedule).toBeNull();
    expect(JSON.stringify(rows)).not.toMatch(/audio_|transcript|consent_|phone/);
  });
  it("blocks unknown citations through existing validation", async () => {
    const result = await askCareAgent({ env, userId: JUDGE_DEMO_USER_ID, judgeSessionId: session, input, source: fakeSource().source, takeJudgeSlot: async () => true, fetchImpl: async () => providerReply(answerJson({ answer: "Lisinopril 10 mg.", citations: ["med:real-family-record"] })) });
    expect(result).toMatchObject({ ok: false, code: "unverified" });
  });
  for (const takeJudgeSlot of [async () => false, async () => { throw new Error("offline"); }]) it("never calls Meta when the usage guard refuses or fails", async () => {
    const fetchImpl = vi.fn();
    const result = await askCareAgent({ env, userId: JUDGE_DEMO_USER_ID, judgeSessionId: session, input, source: fakeSource().source, takeJudgeSlot, fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("durable judge usage guard", () => {
  it("reserves session, IP and global quotas together, with expiry and cooldown", async () => {
    let command: unknown[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      command = JSON.parse(init?.body as string);
      return Response.json({ result: 1 });
    };
    expect(await takeJudgeRateSlot(env, session, "192.0.2.1", fakeFetch)).toBe(true);
    expect(command[0]).toBe("EVAL");
    expect(command.slice(7)).toEqual(["10", "30", "100", "20", "3600", "3600", "86400"]);
    expect(command[4]).toBe(`pendia:judge:session:${session}`);
    expect(JSON.stringify(command)).not.toContain("192.0.2.1");
  });
  it("has a concrete session quota", () => expect(JUDGE_AGENT_RATE.sessionHourly).toBe(10));
  it("has a concrete IP quota", () => expect(JUDGE_AGENT_RATE.ipHourly).toBe(30));
  it("has a concrete global quota", () => expect(JUDGE_AGENT_RATE.globalDaily).toBe(100));
  it("has a concrete cooldown", () => expect(JUDGE_AGENT_RATE.cooldownSeconds).toBe(20));
  it("rejects missing trusted IP without touching a provider", async () => {
    const fetchImpl = vi.fn();
    await expect(takeJudgeRateSlot(env, session, undefined, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("handles durable quota denial", async () => {
    expect(await takeJudgeRateSlot(env, session, "::1", async () => Response.json({ result: 0 }))).toBe(false);
  });
  it("fails closed on Redis errors", async () => {
    await expect(takeJudgeRateSlot(env, session, "::1", async () => Response.json({ error: "denied" }))).rejects.toThrow();
  });
});