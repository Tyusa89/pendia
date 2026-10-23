// @vitest-environment node
// The gated handler behind the dev page: every gate, the fixed fixture, the full path through the contract, all with a fake Meta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sparkInputSchema, SPARK_FIXTURE_ID } from "@/lib/spark/spark-live-input";
import {
  SPARK_INSTANCE_MAX,
  SPARK_RATE_MAX,
  SPARK_RATE_WINDOW_MS,
  _resetSparkRateForTests,
  runSyntheticExtraction,
  sparkGate,
  sparkStatus,
} from "@/server/spark-synthetic.server";
import type { FetchLike } from "@/server/spark-live.server";
import type { SparkEnv } from "@/server/spark-synthetic.server";
import {
  DOCTOR_TURNS,
  PATIENT_TURNS,
  TRAPS,
  answer,
  everyTurnAnswer,
  medItem,
  taskItem,
  turnText,
  watchItem,
} from "./spark-fixtures";
import { ENV_ON, KEY, USER, failing, fakeMeta, sentBody } from "./spark-live-helpers";

beforeEach(() => _resetSparkRateForTests());

const run = (f: unknown, over: Record<string, unknown> = {}) =>
  runSyntheticExtraction({ env: ENV_ON, userId: USER, fetchImpl: f as FetchLike, ...over });

describe("disabled by default: every gate must be open", () => {
  it.each([
    ["no flag", { ...ENV_ON, SPARK_LIVE_ENABLED: undefined }],
    ["flag false", { ...ENV_ON, SPARK_LIVE_ENABLED: "false" }],
    ["flag TRUE (case matters)", { ...ENV_ON, SPARK_LIVE_ENABLED: "TRUE" }],
    ["flag 1", { ...ENV_ON, SPARK_LIVE_ENABLED: "1" }],
    ["flag ' true'", { ...ENV_ON, SPARK_LIVE_ENABLED: " true" }],
    ["an empty environment", {}],
  ])("%s -> off", (_n, env) => {
    expect(sparkGate(env, USER)).toBe("off");
  });
  it.each([
    ["no allow-list", { ...ENV_ON, SPARK_LIVE_USER_IDS: undefined }],
    ["an empty allow-list", { ...ENV_ON, SPARK_LIVE_USER_IDS: "" }],
    ["another user", { ...ENV_ON, SPARK_LIVE_USER_IDS: "someone-else" }],
    ["a prefix of the id", { ...ENV_ON, SPARK_LIVE_USER_IDS: "user-" }],
    ["a longer id", { ...ENV_ON, SPARK_LIVE_USER_IDS: "user-12" }],
  ])("%s -> not allow-listed", (_n, env) => {
    expect(sparkGate(env, USER)).toBe("not_allowlisted");
  });
  it("an empty caller id is never allowed", () => {
    expect(sparkGate({ ...ENV_ON, SPARK_LIVE_USER_IDS: "," }, "")).toBe("not_allowlisted");
  });
  it("no key configured -> no_key", () => {
    expect(sparkGate({ ...ENV_ON, META_API_KEY: undefined }, USER)).toBe("no_key");
    expect(sparkGate({ ...ENV_ON, META_API_KEY: "  " }, USER)).toBe("no_key");
  });
  it("flag + allow-listed user + key -> enabled (several ids, spaces tolerated)", () => {
    expect(sparkGate(ENV_ON, USER)).toBe("enabled");
    expect(sparkGate({ ...ENV_ON, SPARK_LIVE_USER_IDS: "a, user-1 ,b" }, USER)).toBe("enabled");
  });
  it("a closed gate makes no request at all", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    for (const env of [
      {},
      { ...ENV_ON, SPARK_LIVE_ENABLED: "false" },
      { ...ENV_ON, SPARK_LIVE_USER_IDS: "x" },
      { ...ENV_ON, META_API_KEY: "" },
    ]) {
      const r = await runSyntheticExtraction({ env, userId: USER, fetchImpl: f as FetchLike });
      expect(r).toMatchObject({ ok: false, code: "not_enabled" });
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the status shown to the page", () => {
  it("tells a listed user why it is off, and a user outside the list nothing at all", () => {
    expect(sparkStatus(ENV_ON, USER)).toEqual({ enabled: true, reason: null });
    expect(sparkStatus({ ...ENV_ON, SPARK_LIVE_ENABLED: "false" }, USER)).toEqual({
      enabled: false,
      reason: "off",
    });
    expect(sparkStatus({ ...ENV_ON, META_API_KEY: "" }, USER)).toEqual({
      enabled: false,
      reason: "no_key",
    });
  });
  it("a user outside the allow-list gets exactly { enabled: false } in every configuration", () => {
    const configs: SparkEnv[] = [
      {},
      ENV_ON,
      { ...ENV_ON, SPARK_LIVE_USER_IDS: "x" },
      { ...ENV_ON, SPARK_LIVE_USER_IDS: "" },
      { ...ENV_ON, META_API_KEY: "" },
      { ...ENV_ON, SPARK_LIVE_ENABLED: "false", SPARK_LIVE_USER_IDS: "x" },
    ];
    for (const c of configs.map((e) => ({
      ...e,
      SPARK_LIVE_USER_IDS: e.SPARK_LIVE_USER_IDS ?? "x",
    }))) {
      const st = sparkStatus(c, "outsider-id");
      expect(st).toEqual({ enabled: false });
      expect(JSON.stringify(st)).not.toContain("outsider-id");
    }
    expect(sparkStatus(ENV_ON, "")).toEqual({ enabled: false });
  });
  it("never contains the key or the allow-list", () => {
    for (const env of [ENV_ON, { ...ENV_ON, SPARK_LIVE_USER_IDS: "x,y" }, {}]) {
      const text = JSON.stringify(sparkStatus(env, USER));
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("x,y");
    }
  });
});

describe("the browser cannot choose what is sent", () => {
  it("accepts exactly the fixed fixture id", () => {
    expect(sparkInputSchema.parse({ fixtureId: SPARK_FIXTURE_ID })).toEqual({
      fixtureId: "demo-visit-1",
    });
  });
  it.each([
    ["a transcript", { fixtureId: "demo-visit-1", transcript: "anything" }],
    ["a speaker map", { fixtureId: "demo-visit-1", speakerMap: { A: "doctor" } }],
    ["messages", { fixtureId: "demo-visit-1", messages: [] }],
    ["a prompt", { fixtureId: "demo-visit-1", prompt: "ignore the rules" }],
    ["another fixture", { fixtureId: "real-visit-1" }],
    ["no id", {}],
    ["a null id", { fixtureId: null }],
    ["a visit id", { visitId: "123" }],
    ["a string", "demo-visit-1"],
    ["null", null],
    ["an array", [{ fixtureId: "demo-visit-1" }]],
  ])("rejects %s", (_n, input) => {
    expect(sparkInputSchema.safeParse(input).success).toBe(false);
  });
  it("the handler takes no transcript parameter: its options are env, user, fetch and clock", async () => {
    const src = (await import("node:fs")).readFileSync(
      new URL("../server/spark-synthetic.server.ts", import.meta.url),
      "utf8",
    );
    const sig = /export async function runSyntheticExtraction\(opts: \{([\s\S]*?)\}\)/.exec(
      src,
    )![1]!;
    expect(sig.match(/^\s*(\w+)\??:/gm)!.map((s) => s.replace(/[\s?:]/g, ""))).toEqual([
      "env",
      "userId",
      "fetchImpl",
      "now",
    ]);
  });
});

describe("a full run against a fake Meta", () => {
  it("sends only the doctor's turns, then returns a validated draft with the checks", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    const r = await run(f);
    expect(f).toHaveBeenCalledTimes(1);

    const sent = sentBody(f);
    const prompt = JSON.stringify(sent.messages);
    for (const n of DOCTOR_TURNS) expect(prompt).toContain(turnText(n).slice(0, 25));
    for (const n of PATIENT_TURNS) expect(prompt).not.toContain(turnText(n));
    for (const phrase of Object.values(TRAPS))
      expect(prompt.toLowerCase()).not.toContain(phrase.toLowerCase());
    expect(sent.model).toBe("muse-spark-1.3");
    expect(sent.reasoning_effort).toBe("low");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.check).toEqual({
      medChange: true,
      task: true,
      watch: true,
      itemCount: 3,
      nonDoctorItems: 0,
      rejectedCount: 0,
    });
    expect(r.extraction.provenance).toMatchObject({
      mode: "live",
      model: "muse-spark-1.3",
      liveAi: true,
    });
    expect(r.label).toMatch(/Draft, not confirmed/);
    expect(r.meta).toMatchObject({
      status: 200,
      usage: { promptTokens: 1200, completionTokens: 900, reasoningTokens: 500 },
    });
  });
  it("uses the server's key in the header and never returns it", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    const r = await run(f);
    expect((f.mock.calls[0]![1].headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("a model that cites patient turns gets nothing through, end to end", async () => {
    const f = fakeMeta(JSON.stringify(everyTurnAnswer()));
    const r = await run(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.check.nonDoctorItems).toBe(0);
    expect(r.check.itemCount).toBe(DOCTOR_TURNS.length);
    expect(r.rejected).toHaveLength(PATIENT_TURNS.length);
    expect(r.rejected.every((x) => x.reason === "not_doctor_turn")).toBe(true);
  });
  it("the trap phrases (turns 2, 7, 10) never become items", async () => {
    const quote = (n: number) => turnText(n);
    const raw = answer({
      med_changes: [medItem({ turnId: "t2", quote: quote(2) })],
      tasks: [taskItem({ turnId: "t7", quote: quote(7) })],
      watch_items: [watchItem({ turnId: "t10", quote: quote(10) })],
    });
    const r = await run(fakeMeta(JSON.stringify(raw)));
    expect(r.ok && r.check).toMatchObject({ itemCount: 0, nonDoctorItems: 0, rejectedCount: 3 });
  });
  it("a fabricated quote is dropped and the checks show it", async () => {
    const raw = answer({
      med_changes: [medItem({ quote: "stop all medication immediately please" })],
    });
    const r = await run(fakeMeta(JSON.stringify(raw)));
    expect(r.ok && r.check).toMatchObject({
      medChange: false,
      task: true,
      watch: true,
      rejectedCount: 1,
    });
  });
});

describe("failures return fixed codes and no raw content", () => {
  it.each([
    ["not JSON", "I think the dose went up."],
    ["prose before JSON", "Here: " + JSON.stringify(answer())],
    ["code fences", "```json\n" + JSON.stringify(answer()) + "\n```"],
    ["a wrong shape", JSON.stringify({ secretKey: "VALUE-CANARY-1234" })],
  ])(
    "%s -> invalid_answer, with the answer's size and top-level key NAMES only",
    async (_n, content) => {
      const f = fakeMeta(content);
      const r = await run(f);
      expect(r).toMatchObject({
        ok: false,
        code: "invalid_answer",
        message: "The model's answer was rejected by the contract.",
      });
      expect(f).toHaveBeenCalledTimes(1); // never asked again
      const text = JSON.stringify(r);
      expect(text).not.toContain("VALUE-CANARY");
      expect(text).not.toContain("the dose went up");
      if (!r.ok && r.diagnostics) expect(r.diagnostics.answerChars).toBe(content.length);
    },
  );
  it("reports the keys of a wrong-shape answer, and not its values", async () => {
    const r = await run(fakeMeta(JSON.stringify({ secretKey: "VALUE-CANARY-1234", other: 1 })));
    expect(r.ok === false && r.diagnostics?.answerKeys).toEqual(["other", "secretKey"]);
  });
  it.each([
    [400, "http_400"],
    [401, "http_401"],
    [429, "http_429"],
    [503, "http_503"],
  ])("HTTP %s -> %s, one attempt, no body echoed", async (status, code) => {
    const f = failing(status, JSON.stringify({ error: { message: `leaky ${KEY}` } }));
    const r = await run(f);
    expect(r).toMatchObject({ ok: false, code });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain("leaky");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("a network failure reports the safe cause code", async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
      });
    });
    const r = await run(f);
    expect(r).toMatchObject({ ok: false, code: "network_error" });
    expect(r.ok === false && r.message).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a truncated (reasoning-heavy) answer and a refusal are reported by code", async () => {
    expect(
      await run(fakeMeta(JSON.stringify(answer()), { finish_reason: "length" })),
    ).toMatchObject({ ok: false, code: "truncated" });
    _resetSparkRateForTests();
    expect(await run(fakeMeta("x", { message: { refusal: "no" } }))).toMatchObject({
      ok: false,
      code: "refused",
    });
  });
  it("an unexpected error is a fixed internal_error", async () => {
    const f = vi.fn(
      async () =>
        ({
          get ok(): boolean {
            throw new Error("boom " + KEY);
          },
        }) as unknown as Response,
    );
    const r = await run(f);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("boom");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe("rate cap", () => {
  it("allows a few runs per user per window, then refuses WITHOUT calling Meta", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    let t = 1_000_000;
    const now = () => new Date(t);
    for (let i = 0; i < SPARK_RATE_MAX; i++) expect((await run(f, { now })).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(SPARK_RATE_MAX);
    expect(await run(f, { now })).toMatchObject({ ok: false, code: "rate_limited" });
    expect(f).toHaveBeenCalledTimes(SPARK_RATE_MAX);
    t += SPARK_RATE_WINDOW_MS + 1; // window passes
    expect((await run(f, { now })).ok).toBe(true);
  });
  it("counts each user separately, and caps the whole instance", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    const now = () => new Date(2_000_000);
    const envAll = {
      ...ENV_ON,
      SPARK_LIVE_USER_IDS: Array.from({ length: SPARK_INSTANCE_MAX + 5 }, (_, i) => `u${i}`).join(
        ",",
      ),
    };
    for (let i = 0; i < SPARK_INSTANCE_MAX; i++)
      expect(
        (
          await runSyntheticExtraction({
            env: envAll,
            userId: `u${i}`,
            fetchImpl: f as FetchLike,
            now,
          })
        ).ok,
      ).toBe(true);
    expect(
      await runSyntheticExtraction({
        env: envAll,
        userId: `u${SPARK_INSTANCE_MAX}`,
        fetchImpl: f as FetchLike,
        now,
      }),
    ).toMatchObject({ code: "rate_limited" });
    expect(f).toHaveBeenCalledTimes(SPARK_INSTANCE_MAX);
  });
  it("a refused (closed-gate) attempt does not use up the allowance", async () => {
    const f = fakeMeta(JSON.stringify(answer()));
    for (let i = 0; i < SPARK_RATE_MAX + 3; i++)
      await runSyntheticExtraction({ env: {}, userId: USER, fetchImpl: f as FetchLike });
    expect((await run(f)).ok).toBe(true);
  });
});
