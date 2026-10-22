// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MIN_TURN_ACCURACY } from "../../diarization/score.ts";
import { byRole, script, segmentsFor } from "../../diarization/tests/helpers.ts";
import { observedShape, parseTranscribeResponse } from "../response.ts";
import { buildScorecard, wordErrorRate } from "../scorecard.ts";
import { validateWavForUpload } from "../wav-check.ts";
import { wavBytes } from "./helpers.ts";

const truth = script();
const audio = validateWavForUpload(wavBytes({ seconds: 58 }));
const asResponse = (segs: ReturnType<typeof segmentsFor>) => ({
  sessionId: "s-1",
  transcript: segs.map((s) => s.text).join(" "),
  audioDurationMs: 58000,
  turns: segs.map((s, i) => ({
    turnId: `t${i}`,
    speaker: s.speaker,
    transcript: s.text,
    startMs: Math.round(s.startS! * 1000),
    endMs: Math.round(s.endS! * 1000),
  })),
});
const card = (segs: ReturnType<typeof segmentsFor>) => {
  const json = asResponse(segs);
  return buildScorecard({
    live: true,
    audio,
    http: { status: 200, elapsedMs: 1234 },
    segments: parseTranscribeResponse(json).segments,
    reportedAudioSeconds: parseTranscribeResponse(json).reportedAudioSeconds,
    parseErrorCode: null,
    observed: observedShape(json),
    truth,
  });
};

describe("scoring reuses the existing thresholds", () => {
  it("keeps the 90% turn-accuracy threshold", () => {
    expect(MIN_TURN_ACCURACY).toBe(0.9);
  });
  it("a perfect, correctly separated reply passes with zero word errors", () => {
    const c = card(segmentsFor(truth, byRole));
    expect(c.score.pass).toBe(true);
    expect(c.score.correctTurns).toBe(12);
    expect(c.score.leakageTurns).toEqual([]);
    expect(c.wordErrorRate).toBe(0);
  });
  it("11 of 12 passes and 10 of 12 fails", () => {
    const wrong = (n: number[]) => (t: (typeof truth)[number]) =>
      n.includes(t.n) ? (t.who === "D" ? "B" : "A") : byRole(t);
    // keep the wrong turns away from the leakage traps (2, 7, 10) so only accuracy is tested
    expect(card(segmentsFor(truth, wrong([5]))).score.pass).toBe(true);
    const ten = card(segmentsFor(truth, wrong([5, 11])));
    expect(ten.score.correctTurns).toBe(10);
    expect(ten.score.pass).toBe(false);
    expect(ten.score.failureCodes).toContain("accuracy_below_threshold");
  });
  it("any patient-to-doctor leakage fails even at high accuracy", () => {
    const c = card(segmentsFor(truth, (t) => (t.n === 7 ? "A" : byRole(t))));
    expect(c.score.pass).toBe(false);
    expect(c.score.leakageTurns).toContain(7);
    expect(c.score.failureCodes).toContain("patient_to_doctor_leakage");
  });
});

describe("the scorecard is sanitized", () => {
  it("contains no transcript text, even when the reply is full of it", () => {
    const segs = segmentsFor(truth, byRole, (t) => `CANARY-${t.n} ${t.text}`);
    const text = JSON.stringify(card(segs));
    for (const t of truth) {
      expect(text).not.toContain(t.text);
      expect(text).not.toContain(`CANARY-${t.n}`);
    }
    for (const w of ["Lisinopril", "Rosa", "milligrams", "Patel", "ankles"])
      expect(text).not.toContain(w);
    expect(text).not.toMatch(/Bearer|sk-/);
  });
  it("only holds numbers, booleans, turn numbers, fixed codes and key names", () => {
    const c = card(segmentsFor(truth, byRole));
    expect(Object.keys(c).sort()).toEqual(
      [
        "audio",
        "endpointHost",
        "http",
        "kind",
        "live",
        "model",
        "notes",
        "response",
        "schema",
        "score",
        "wordErrorRate",
      ].sort(),
    );
    expect(c.endpointHost).toBe("api.meta.ai");
    expect(c.score.perTurn).toHaveLength(12);
  });
  it("a reply that could not be parsed is not scorable and reports key names only", () => {
    const c = buildScorecard({
      live: true,
      audio,
      http: { status: 200, elapsedMs: 5 },
      segments: null,
      parseErrorCode: "malformed_response",
      observed: observedShape({ words: [{ w: "SECRET" }] }),
      truth,
    });
    expect(c.score.pass).toBe(false);
    expect(c.score.failureCodes).toEqual(["not_scorable"]);
    expect(c.response).toMatchObject({ parsed: false, errorCode: "malformed_response" });
    expect(JSON.stringify(c)).not.toContain("SECRET");
    expect(c.response.observedKeys.top).toEqual(["words"]);
  });
});

describe("word error rate", () => {
  it("is 0 for identical text and counts substitutions, insertions and deletions", () => {
    expect(wordErrorRate("one two three four", "one two three four")).toBe(0);
    expect(wordErrorRate("one two three four", "one two three five")).toBe(0.25);
    expect(wordErrorRate("one two three four", "one two three")).toBe(0.25);
    expect(wordErrorRate("one two", "one two three four")).toBe(1);
    expect(wordErrorRate("", "")).toBe(0);
  });
});
