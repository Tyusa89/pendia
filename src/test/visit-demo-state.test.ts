// The Demo Mode state machine: nothing can be skipped, and every move is ignored unless the person is at the right step.
import { describe, expect, it } from "vitest";
import {
  initialState,
  reducer,
  rolesComplete,
  type Action,
  type DemoState,
} from "@/lib/visit-demo/state";
import { DEMO_EXTRACTION, DEMO_SPEAKER_SUGGESTION, DEMO_TRANSCRIPT } from "@/lib/visit-pipeline";

const run = (...actions: Action[]): DemoState => actions.reduce(reducer, initialState);
const toVisit: Action[] = [
  { type: "begin" },
  { type: "setConsent", value: true },
  { type: "startVisit" },
  { type: "transcriptLoaded", transcript: DEMO_TRANSCRIPT, suggestion: DEMO_SPEAKER_SUGGESTION },
];
const revealAll: Action[] = DEMO_TRANSCRIPT.segments.map(() => ({ type: "reveal" }) as Action);

describe("consent cannot be skipped", () => {
  it("the visit does not start without consent, or from the wrong step", () => {
    expect(run({ type: "startVisit" }).step).toBe("intro");
    expect(run({ type: "begin" }, { type: "startVisit" }).busy).toBe(false);
    expect(
      run(
        { type: "begin" },
        { type: "setConsent", value: true },
        { type: "setConsent", value: false },
        { type: "startVisit" },
      ).busy,
    ).toBe(false);
    expect(run({ type: "setConsent", value: true }).consent).toBe(false); // consent is only given on the consent step
  });
  it("a transcript arriving without a started visit is ignored", () => {
    const s = run(
      { type: "begin" },
      {
        type: "transcriptLoaded",
        transcript: DEMO_TRANSCRIPT,
        suggestion: DEMO_SPEAKER_SUGGESTION,
      },
    );
    expect(s.step).toBe("consent");
    expect(s.transcript).toBeNull();
  });
});

describe("playing the visit", () => {
  it("starts at the first line, reveals one line at a time, and cannot run past the end", () => {
    let s = run(...toVisit);
    expect([s.step, s.revealed, s.playing]).toEqual(["visit", 0, true]);
    s = run(...toVisit, ...revealAll, { type: "reveal" }, { type: "reveal" });
    expect(s.revealed).toBe(12);
  });
  it("skip shows everything and stops playback; speakers cannot be reached before the end", () => {
    expect(run(...toVisit, { type: "toSpeakers" }).step).toBe("visit");
    const s = run(...toVisit, { type: "skipToEnd" }, { type: "toSpeakers" });
    expect([s.step, s.revealed, s.playing]).toEqual(["speakers", 12, false]);
  });
});

describe("speakers must be confirmed before anything is read", () => {
  const atSpeakers = [
    ...toVisit,
    { type: "skipToEnd" } as Action,
    { type: "toSpeakers" } as Action,
  ];
  it("the suggestion is pre-filled but NOT confirmed", () => {
    const s = run(...atSpeakers);
    expect(s.roles).toEqual({ A: "doctor", B: "patient" });
    expect(s.speakersConfirmed).toBe(false);
    expect(rolesComplete(s)).toBe(true);
  });
  it("cannot confirm without a doctor or with a speaker unassigned", () => {
    expect(
      run(
        ...atSpeakers,
        { type: "setRole", label: "A", role: "patient" },
        { type: "confirmSpeakers" },
      ).busy,
    ).toBe(false);
    expect(
      run(...atSpeakers, { type: "setRole", label: "B", role: "" }, { type: "confirmSpeakers" })
        .busy,
    ).toBe(false);
  });
  it("changing a role after confirming withdraws the confirmation", () => {
    const s = run(
      ...atSpeakers,
      { type: "confirmSpeakers" },
      { type: "failed", message: "x" },
      { type: "setRole", label: "B", role: "family" },
    );
    expect(s.speakersConfirmed).toBe(false);
  });
  it("the summary arrives only for a confirmed map, and only once", () => {
    const loaded: Action = { type: "extractionLoaded", extraction: DEMO_EXTRACTION, rejected: [] };
    expect(run(...atSpeakers, loaded).step).toBe("speakers"); // not confirmed
    const s = run(...atSpeakers, { type: "confirmSpeakers" }, loaded);
    expect(s.step).toBe("summary");
    expect(s.extraction).toEqual(DEMO_EXTRACTION);
  });
  it("a failure keeps the person on the step with the message and a withdrawn confirmation", () => {
    const s = run(
      ...atSpeakers,
      { type: "confirmSpeakers" },
      { type: "failed", message: "That didn't work" },
    );
    expect([s.step, s.busy, s.error, s.speakersConfirmed]).toEqual([
      "speakers",
      false,
      "That didn't work",
      false,
    ]);
  });
});

describe("reset", () => {
  it("returns to the start and forgets everything", () => {
    const s = run(...toVisit, { type: "skipToEnd" }, { type: "reset" });
    expect(s).toEqual(initialState);
  });
});
