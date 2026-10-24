// @vitest-environment node
// The known-answer dose check of the dev page: equivalent spellings of 10 mg / 20 mg, and what must NOT match.
// The check is separate from acceptance: the contract still decides which items exist.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isLisinoprilTenToTwenty, parseDoseMg } from "@/lib/spark/dose-match";
import { _resetSparkRateForTests, runSyntheticExtraction } from "@/server/spark-synthetic.server";
import type { FetchLike } from "@/server/spark-live.server";
import { answer, medItem, turnText } from "./spark-fixtures";
import { ENV_ON, USER, fakeMeta } from "./spark-live-helpers";

beforeEach(() => _resetSparkRateForTests());

describe("parseDoseMg", () => {
  it.each([
    ["20 mg", 20],
    ["20mg", 20],
    ["20 MG", 20],
    ["20 milligrams", 20],
    ["20-mg", 20],
    ["twenty milligrams", 20],
    ["Twenty mg", 20],
    ["Twenty (20) mg", 20],
    ["twenty-mg", 20],
    ["20 mg, once a day in the morning", 20],
    ["ten milligrams", 10],
    ["10 mg", 10],
    ["Ten (10) milligrams", 10],
    ["10mg every morning", 10],
    ["twenty milligrams, twenty mg", 20],
  ])("%j -> %s", (text, dose) => {
    expect(parseDoseMg(text)).toBe(dose);
  });
  it.each([
    "0.20 mg",
    "20.0 mg",
    "1,20 mg",
    "20:00",
    "20:00 mg",
    "at 20:00 daily",
    "x20mg",
    "20",
    "twenty",
    "twenty tablets",
    "20 mcg",
    "20 g",
    "Twenty (10) mg",
    "10 mg to 20 mg",
    "ten milligrams to twenty milligrams",
    "",
    "increase the dose",
  ])("%j -> null (no single dose)", (text) => {
    expect(parseDoseMg(text)).toBeNull();
  });
});

describe("other whole-number doses are read as themselves, never as 20", () => {
  it.each([
    ["120 mg", 120],
    ["200 mg", 200],
    ["2 mg", 2],
    ["thirty milligrams", null],
  ])("%j -> %s", (text, dose) => {
    expect(parseDoseMg(text)).toBe(dose);
  });
});

describe("isLisinoprilTenToTwenty", () => {
  const ok = { medication: "Lisinopril", before: "ten milligrams", after: "twenty milligrams" };
  it("accepts the spelled-out change from the live test, and digit forms", () => {
    expect(isLisinoprilTenToTwenty(ok)).toBe(true);
    expect(
      isLisinoprilTenToTwenty({
        medication: "Lisinopril",
        before: "10 mg, once a day in the morning",
        after: "20 mg, once a day in the morning",
      }),
    ).toBe(true);
    expect(
      isLisinoprilTenToTwenty({
        medication: "lisinopril",
        before: "10mg",
        after: "Twenty (20) mg",
      }),
    ).toBe(true);
    expect(isLisinoprilTenToTwenty({ ...ok, medication: "Lisinopril (Zestril)" })).toBe(true);
  });
  it("rejects a wrong direction, wrong doses, wrong units and ambiguous values", () => {
    expect(
      isLisinoprilTenToTwenty({ ...ok, before: "twenty milligrams", after: "ten milligrams" }),
    ).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "ten milligrams" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, before: "twenty milligrams" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "0.20 mg" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "120 mg" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "20:00" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "20" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, after: "20 mcg" })).toBe(false);
    expect(isLisinoprilTenToTwenty({ ...ok, before: "the usual dose" })).toBe(false);
  });
  it("rejects other medications, including look-alikes", () => {
    for (const medication of [
      "Metformin",
      "Amlodipine",
      "Lisinopril-HCTZ",
      "Lisinopril/HCTZ",
      "",
      "20 mg",
    ])
      expect(isLisinoprilTenToTwenty({ ...ok, medication })).toBe(false);
  });
});

// the exact surface form of the first live test: the model copied the doctor's spelled-out words
const spelled = (over: Record<string, unknown> = {}) =>
  medItem({
    before: "ten milligrams",
    after: "twenty milligrams",
    timing: "starting tomorrow",
    quote:
      "I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow.",
    ...over,
  });
const run = (raw: unknown) =>
  runSyntheticExtraction({
    env: ENV_ON,
    userId: USER,
    fetchImpl: fakeMeta(JSON.stringify(raw)) as unknown as FetchLike,
  });

describe("the dev check on the fictional visit with a fake Meta (no network)", () => {
  it("the spelled-out live answer is accepted by the contract and found by the check", async () => {
    const r = await run(answer({ med_changes: [spelled()] }));
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
    expect(r.extraction.med_changes[0]).toMatchObject({
      before: "ten milligrams",
      after: "twenty milligrams",
      source: { speaker: "A" },
    });
  });
  it("the digit form still passes", async () => {
    const r = await run(answer());
    expect(r.ok && r.check.medChange).toBe(true);
  });
  it("a wrong dose with a real quote is kept by the contract but NOT counted as the known answer", async () => {
    const r = await run(answer({ med_changes: [spelled({ after: "thirty milligrams" })] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.check.medChange).toBe(false);
    expect(r.extraction.med_changes).toHaveLength(1); // acceptance is unchanged by the checker
  });
  it("a correct dose cannot rescue bad evidence: fabricated quote and patient-turn items are still dropped", async () => {
    const fabricated = await run(
      answer({ med_changes: [spelled({ quote: "stop all medication immediately please" })] }),
    );
    expect(fabricated.ok && fabricated.check).toMatchObject({ medChange: false, rejectedCount: 1 });
    const patient = await run(
      answer({ med_changes: [spelled({ turnId: "t4", quote: turnText(4) })] }),
    );
    expect(patient.ok && patient.check).toMatchObject({
      medChange: false,
      nonDoctorItems: 0,
      rejectedCount: 1,
    });
    expect(patient.ok && patient.rejected[0]).toMatchObject({ reason: "not_doctor_turn" });
  });
});

describe("the helper stays separate", () => {
  const src = (p: string) =>
    readFileSync(join(process.cwd(), p), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
  it("has no imports and touches no environment, network or storage", () => {
    const s = src("src/lib/spark/dose-match.ts");
    expect(s).not.toMatch(/^\s*import\s/m);
    expect(s).not.toMatch(/process\.env|fetch\(|localStorage|supabase|META_API_KEY/);
  });
  it("is used only by the dev checker, never by the contract or Demo Mode", () => {
    expect(src("src/server/spark-synthetic.server.ts")).toMatch(/isLisinoprilTenToTwenty/);
    for (const p of [
      "src/lib/visit-pipeline/spark-contract.ts",
      "src/lib/visit-pipeline/index.ts",
      "src/lib/spark/spark-http.ts",
    ])
      expect(src(p)).not.toMatch(/dose-match/);
  });
});
