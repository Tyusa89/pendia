// @vitest-environment node
// Feature A through the extraction contract: every accepted medication item carries an independent "value-verified" /
// "unverified" label; an unverified item is KEPT and visible; nothing about sourcing, evidence or confirmation changes.
import { describe, expect, it } from "vitest";
import {
  DEMO_EXTRACTION,
  ProviderOutputError,
  getVisitPipeline,
  guardExtraction,
  parseVisitExtraction,
} from "@/lib/visit-pipeline";
import { VERIFICATION_SCOPE } from "@/lib/visit-pipeline/med-verifier";
import { mapSparkOutput } from "@/lib/visit-pipeline/spark-contract";
import { _resetSparkRateForTests, runSyntheticExtraction } from "@/server/spark-synthetic.server";
import type { FetchLike } from "@/server/spark-live.server";
import {
  answer,
  medItem,
  speakerMap,
  taskItem,
  transcript,
  turnText,
  watchItem,
} from "./spark-fixtures";
import { ENV_ON, USER, fakeMeta } from "./spark-live-helpers";

const CTX = { generatedAt: "2026-10-27T00:00:00.000Z" };
const QUOTE =
  "I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow";
const live = (over: Record<string, unknown> = {}) =>
  medItem({ before: "ten milligrams", after: "twenty milligrams", quote: QUOTE, ...over });
const map = (raw: unknown) => mapSparkOutput(raw, transcript, speakerMap, CTX);

describe("the label on each accepted medication item", () => {
  it("value-verified when the quote independently supports the values", () => {
    const r = map(answer({ med_changes: [live()] }));
    expect(r.extraction.med_changes[0]!.verification).toEqual({
      status: "value-verified",
      reason: "verified",
      scope: VERIFICATION_SCOPE,
    });
  });
  it("unverified (with a reason) when the dose disagrees with the quote: the item is KEPT", () => {
    const r = map(answer({ med_changes: [live({ after: "thirty milligrams" })] }));
    expect(r.rejected).toEqual([]);
    expect(r.extraction.med_changes).toHaveLength(1);
    expect(r.extraction.med_changes[0]).toMatchObject({
      medication: "Lisinopril",
      after: "thirty milligrams",
      verification: { status: "unverified", reason: "value_mismatch" },
    });
  });
  it.each([
    ["wrong dose", { after: "thirty milligrams" }, "value_mismatch"],
    ["wrong unit", { after: "twenty micrograms" }, "unit_mismatch"],
    [
      "swapped direction",
      { before: "twenty milligrams", after: "ten milligrams" },
      "direction_mismatch",
    ],
    ["another medication", { medication: "Metformin" }, "medication_not_in_quote"],
    ["frequency the quote lacks", { after: "twenty milligrams once daily" }, "unsupported_detail"],
    ["a value that cannot be read", { after: "a higher dose" }, "unparseable_value"],
  ])("%s -> unverified (%s) and still visible for review", (_n, over, reason) => {
    const r = map(answer({ med_changes: [live(over)] }));
    expect(r.extraction.med_changes).toHaveLength(1);
    expect(r.extraction.med_changes[0]!.verification).toMatchObject({
      status: "unverified",
      reason,
    });
    expect(r.rejected).toEqual([]);
  });
  it("an ambiguous quotation (a hedge) is unverified but kept", () => {
    // the doctor's turn itself must contain the hedge, or the quote would be dropped as not-in-turn
    const hedged = structuredClone(transcript);
    hedged.segments[2]!.text =
      "Maybe we increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow.";
    const q = "Maybe we increase the Lisinopril from ten milligrams to twenty milligrams";
    const r = mapSparkOutput(
      answer({ med_changes: [live({ quote: q })] }),
      hedged,
      speakerMap,
      CTX,
    );
    expect(r.extraction.med_changes).toHaveLength(1);
    expect(r.extraction.med_changes[0]!.verification).toMatchObject({
      status: "unverified",
      reason: "hedged_quote",
    });
  });
  it("the numeric fixture answer adds a schedule the quote never said: unverified, not silently accepted", () => {
    const r = map(answer());
    expect(r.extraction.med_changes[0]!.verification).toMatchObject({
      status: "unverified",
      reason: "unsupported_detail",
    });
  });
  it("labels only medication items: tasks and watch items stay quotation-checked", () => {
    const r = map(answer({ med_changes: [live()] }));
    for (const t of r.extraction.tasks) expect(t).not.toHaveProperty("verification");
    for (const w of r.extraction.watch_items) expect(w).not.toHaveProperty("verification");
  });
  it("the label never changes anything else about the item", () => {
    const good = map(answer({ med_changes: [live()] })).extraction.med_changes[0]!;
    const bad = map(answer({ med_changes: [live({ after: "thirty milligrams" })] })).extraction
      .med_changes[0]!;
    const strip = ({ verification: _v, after: _a, ...rest }: typeof good) => rest;
    expect(strip(bad)).toEqual(strip(good));
  });
});

describe("existing safeguards are unchanged", () => {
  it("a patient turn is still rejected, even with perfectly matching values (no label is ever computed for it)", () => {
    const r = map(answer({ med_changes: [live({ turnId: "t4", quote: turnText(4) })] }));
    expect(r.extraction.med_changes).toHaveLength(0);
    expect(r.rejected[0]).toMatchObject({ reason: "not_doctor_turn" });
  });
  it("a fabricated quote is still dropped; correct values cannot rescue it", () => {
    const r = map(
      answer({ med_changes: [live({ quote: "stop all medication immediately please" })] }),
    );
    expect(r.extraction.med_changes).toHaveLength(0);
    expect(r.rejected[0]).toMatchObject({ reason: "quote_not_in_turn" });
  });
  it("an unknown turn is still dropped", () => {
    const r = map(answer({ med_changes: [live({ turnId: "t99" })] }));
    expect(r.rejected[0]).toMatchObject({ reason: "unknown_turn" });
  });
  it("the model cannot supply its own verification: an extra key rejects the whole answer", () => {
    const raw = answer({
      med_changes: [
        {
          ...live(),
          verification: { status: "value-verified", reason: "verified", scope: VERIFICATION_SCOPE },
        },
      ],
    });
    expect(() => map(raw)).toThrow(ProviderOutputError);
  });
  it("speaker and time still come from the transcript, and the summary is still built by code", () => {
    const r = map(
      answer({ med_changes: [live()], tasks: [taskItem()], watch_items: [watchItem()] }),
    );
    expect(r.extraction.med_changes[0]!.source).toMatchObject({ speaker: "A", start_s: 12.1 });
    expect(r.extraction.summary).toMatch(/^The doctor said:/);
  });
  it("the guard and the transcript check still accept the result", () => {
    const r = map(answer({ med_changes: [live(), live({ after: "thirty milligrams" })] }));
    const again = guardExtraction(r.extraction, transcript, speakerMap);
    expect(again.rejected).toEqual([]);
    expect(again.extraction.med_changes.map((m) => m.verification?.status)).toEqual([
      "value-verified",
      "unverified",
    ]);
  });
});

describe("the schema for the label", () => {
  const base = () => structuredClone(map(answer({ med_changes: [live()] })).extraction);
  it("accepts items with or without it (Demo Mode items have none)", () => {
    expect(() => parseVisitExtraction(base())).not.toThrow();
    expect(() => parseVisitExtraction(structuredClone(DEMO_EXTRACTION))).not.toThrow();
    for (const m of DEMO_EXTRACTION.med_changes) expect(m).not.toHaveProperty("verification");
  });
  it.each([
    [
      "value-verified with a failure reason",
      { status: "value-verified", reason: "value_mismatch" },
    ],
    ["unverified with the success reason", { status: "unverified", reason: "verified" }],
    ["an unknown reason", { status: "unverified", reason: "looks_fine" }],
    ["an unknown status", { status: "verified", reason: "verified" }],
    [
      "a different scope text",
      { status: "value-verified", reason: "verified", scope: "the whole instruction" },
    ],
    ["an extra key", { status: "value-verified", reason: "verified", note: "ok" }],
  ])("rejects %s", (_n, v) => {
    const x = base() as unknown as { med_changes: Array<Record<string, unknown>> };
    x.med_changes[0]!["verification"] = { scope: VERIFICATION_SCOPE, ...v };
    if ("scope" in v)
      (x.med_changes[0]!["verification"] as Record<string, unknown>)["scope"] = (
        v as { scope: string }
      ).scope;
    expect(() => parseVisitExtraction(x)).toThrow(ProviderOutputError);
  });
  it("Demo Mode is untouched: the pipeline is still demo-only and its items carry no label", async () => {
    const p = getVisitPipeline();
    expect(p.mode).toBe("demo");
    const e = await p.extract.extract({
      transcript: await p.transcribe.transcribe({ visitId: "x", keywords: [] }),
      speakerMap,
    });
    for (const m of e.med_changes) expect(m.verification).toBeUndefined();
  });
});

describe("through the gated handler with a fake Meta (no network)", () => {
  const run = (raw: unknown) => {
    _resetSparkRateForTests();
    return runSyntheticExtraction({
      env: ENV_ON,
      userId: USER,
      fetchImpl: fakeMeta(JSON.stringify(raw)) as unknown as FetchLike,
    });
  };
  it("the exact spelled-out live answer is value-verified", async () => {
    const r = await run(answer({ med_changes: [live()] }));
    expect(r.ok && r.check).toMatchObject({
      medVerified: 1,
      medUnverified: 0,
      itemCount: 3,
      rejectedCount: 0,
    });
  });
  it("an unverified item is counted, kept and returned to the page", async () => {
    const r = await run(answer({ med_changes: [live({ after: "thirty milligrams" })] }));
    expect(r.ok && r.check).toMatchObject({
      medVerified: 0,
      medUnverified: 1,
      itemCount: 3,
      rejectedCount: 0,
    });
    expect(r.ok && r.extraction.med_changes[0]?.verification).toMatchObject({
      status: "unverified",
    });
  });
  it("a verified item can never exceed what the contract accepted", async () => {
    const r = await run(
      answer({ med_changes: [live({ quote: "stop all medication immediately please" })] }),
    );
    expect(r.ok && r.check).toMatchObject({ medVerified: 0, medUnverified: 0, rejectedCount: 1 });
  });
});
