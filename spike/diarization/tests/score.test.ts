// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MIN_TURN_ACCURACY, formatReport, scoreSegments } from "../score.ts";
import { byRole, script, segmentsFor } from "./helpers.ts";

const truth = script();

describe("acceptance criteria", () => {
  it("perfect separation passes: 100% and zero leakage", () => {
    const r = scoreSegments(segmentsFor(truth, byRole), truth);
    expect(r.turnAccuracy).toBe(1);
    expect(r.leaks).toEqual([]);
    expect(r.verdict.pass).toBe(true);
  });

  it("anonymous labels are matched by best fit, so reversed labels still pass", () => {
    const r = scoreSegments(
      segmentsFor(truth, (t) => (t.who === "D" ? "spk_1" : "spk_0")),
      truth,
    );
    expect(r.mapping).toEqual({ spk_0: "P", spk_1: "D" });
    expect(r.verdict.pass).toBe(true);
  });

  it("one non-leaking error (11/12 = 91.7%) still passes the 90% threshold", () => {
    const r = scoreSegments(
      segmentsFor(truth, (t) => (t.n === 5 ? "B" : byRole(t))),
      truth,
    ); // doctor turn 5 given to the patient
    expect(r.correctTurns).toBe(11);
    expect(r.turnAccuracy).toBeGreaterThanOrEqual(MIN_TURN_ACCURACY);
    expect(r.leaks).toEqual([]);
    expect(r.verdict.pass).toBe(true);
  });

  it("two errors (10/12 = 83%) fails on accuracy", () => {
    const r = scoreSegments(
      segmentsFor(truth, (t) => (t.n === 5 || t.n === 9 ? "B" : byRole(t))),
      truth,
    );
    expect(r.turnAccuracy).toBeCloseTo(10 / 12);
    expect(r.verdict.accuracyOk).toBe(false);
    expect(r.verdict.pass).toBe(false);
    expect(r.verdict.failures.join(" ")).toMatch(/below 90%/);
  });
});

describe("patient-to-doctor leakage (zero tolerance)", () => {
  it("a patient turn labelled as the doctor is a leak, even when accuracy is 11/12", () => {
    const r = scoreSegments(
      segmentsFor(truth, (t) => (t.n === 7 ? "A" : byRole(t))),
      truth,
    );
    expect(r.turnAccuracy).toBeGreaterThanOrEqual(MIN_TURN_ACCURACY);
    expect(r.leaks.some((l) => l.turn === 7 && l.kind === "turn")).toBe(true);
    expect(r.verdict.leakageZero).toBe(false);
    expect(r.verdict.pass).toBe(false);
  });

  it("catches the instruction words alone being attributed to the doctor, inside a turn that is otherwise the patient's", () => {
    const t2 = truth.find((t) => t.n === 2)!;
    const segs = segmentsFor(
      truth.filter((t) => t.n !== 2),
      byRole,
    );
    // turn 2 split: the dose phrase gets the doctor's label, the rest the patient's
    const head = "Pretty good. I take the Lisinopril,";
    const dose = "ten milligrams, every morning";
    const tail = "with my coffee.";
    expect(t2.text).toContain("ten milligrams, every morning");
    const withSplit = [
      ...segs.slice(0, 1),
      { speaker: "B", text: head, source: "t" },
      { speaker: "A", text: dose, source: "t" },
      { speaker: "B", text: tail, source: "t" },
      ...segs.slice(1),
    ];
    const r = scoreSegments(withSplit, truth);
    expect(r.turns.find((x) => x.n === 2)!.predicted).toBe("P"); // turn majority is still the patient
    expect(r.leaks.find((l) => l.turn === 2)?.kind).toBe("phrase");
    expect(r.verdict.pass).toBe(false);
  });

  it("each of the three trap turns (2, 7, 10) fails the run when given to the doctor", () => {
    for (const n of [2, 7, 10]) {
      const r = scoreSegments(
        segmentsFor(truth, (t) => (t.n === n ? "A" : byRole(t))),
        truth,
      );
      expect(r.verdict.leakageZero, `turn ${n}`).toBe(false);
    }
  });
});

describe("fails closed", () => {
  it("no segments means not scorable and FAIL", () => {
    const r = scoreSegments([], truth);
    expect(r.scorable).toBe(false);
    expect(r.verdict.pass).toBe(false);
    expect(formatReport(r)).toMatch(/NOT SCORABLE/);
  });
  it("turns missing from the transcript count as wrong", () => {
    const r = scoreSegments(segmentsFor(truth.slice(0, 9), byRole), truth);
    expect(r.turns.filter((t) => !t.correct).map((t) => t.n)).toEqual([10, 11, 12]);
    expect(r.verdict.pass).toBe(false);
  });
  it("everything attributed to a single speaker cannot pass", () => {
    const r = scoreSegments(
      segmentsFor(truth, () => "A"),
      truth,
    );
    expect(r.verdict.pass).toBe(false);
  });
});

describe("robust to ordinary transcription differences", () => {
  it("tolerates word errors, numerals, punctuation and casing", () => {
    const noisy = (t: { text: string }) =>
      t.text
        .replace("ten milligrams", "10 mg")
        .replace("twenty milligrams", "20 mg")
        .toUpperCase()
        .replace(/Lisinopril/i, "Lysinopril");
    const r = scoreSegments(segmentsFor(truth, byRole, noisy), truth);
    expect(r.turnAccuracy).toBe(1);
  });
  it("reports accuracy excluding the deliberate overlap turns", () => {
    const r = scoreSegments(
      segmentsFor(truth, (t) => (t.n === 8 ? "B" : byRole(t))),
      truth,
    );
    expect(r.turnAccuracy).toBeCloseTo(11 / 12);
    expect(r.turnAccuracyExcludingOverlaps).toBe(1);
  });
});

describe("seconds-weighted accuracy (optional)", () => {
  it("is computed only when timings are provided", () => {
    const segs = segmentsFor(truth, byRole);
    expect(scoreSegments(segs, truth).secondsAccuracy).toBeNull();
    const timings = Object.fromEntries(
      segs.map((s, i) => [String(i + 1), [s.startS!, s.endS!] as [number, number]]),
    );
    expect(scoreSegments(segs, truth, timings).secondsAccuracy).toBe(1);
    const wrong = segmentsFor(truth, (t) => (t.n === 3 ? "B" : byRole(t)));
    const sa = scoreSegments(wrong, truth, timings).secondsAccuracy!;
    expect(sa).toBeLessThan(1);
    expect(sa).toBeGreaterThan(0.8);
  });
});
