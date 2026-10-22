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

describe("review, follow-up and wrap-up", () => {
  const atReview: Action[] = [
    ...toVisit,
    { type: "skipToEnd" },
    { type: "toSpeakers" },
    { type: "confirmSpeakers" },
    { type: "extractionLoaded", extraction: DEMO_EXTRACTION, rejected: [] },
  ];
  const ids = { med: "med-1", task: "task-1", watch: "watch-1" };
  it("nothing starts decided", () => {
    expect(run(...atReview).decisions).toEqual({});
  });
  it("a follow-up cannot be confirmed without choosing who does it; rejecting needs no name", () => {
    expect(
      run(...atReview, { type: "decide", id: ids.task, decision: "confirmed" }).decisions,
    ).toEqual({});
    expect(
      run(...atReview, { type: "decide", id: ids.task, decision: "rejected" }).decisions,
    ).toEqual({ [ids.task]: "rejected" });
    const s = run(
      ...atReview,
      { type: "setOwner", taskId: ids.task, owner: "Carlos" },
      { type: "decide", id: ids.task, decision: "confirmed" },
    );
    expect(s.decisions[ids.task]).toBe("confirmed");
  });
  it("clearing the owner withdraws a confirmation that depended on it", () => {
    const s = run(
      ...atReview,
      { type: "setOwner", taskId: ids.task, owner: "Carlos" },
      { type: "decide", id: ids.task, decision: "confirmed" },
      { type: "setOwner", taskId: ids.task, owner: "" },
    );
    expect(s.decisions[ids.task]).toBeUndefined();
  });
  it("a person can change their answer before continuing; unknown items are ignored", () => {
    const s = run(
      ...atReview,
      { type: "decide", id: ids.med, decision: "confirmed" },
      { type: "decide", id: ids.med, decision: null },
      { type: "decide", id: "nope", decision: "confirmed" },
    );
    expect(s.decisions).toEqual({});
  });
  it("cannot continue until every item is decided", () => {
    expect(
      run(
        ...atReview,
        { type: "decide", id: ids.med, decision: "confirmed" },
        { type: "toFollowup" },
      ).step,
    ).toBe("summary");
  });
  const decideAll = (task: "confirmed" | "rejected"): Action[] => [
    { type: "setOwner", taskId: ids.task, owner: "Carlos" },
    { type: "decide", id: ids.med, decision: "confirmed" },
    { type: "decide", id: ids.task, decision: task },
    { type: "decide", id: ids.watch, decision: "rejected" },
  ];
  it("with a confirmed follow-up, continuing goes to follow-up; without one it goes straight to the wrap-up", () => {
    expect(run(...atReview, ...decideAll("confirmed"), { type: "toFollowup" }).step).toBe(
      "followup",
    );
    expect(run(...atReview, ...decideAll("rejected"), { type: "toFollowup" }).step).toBe("done");
  });
  it("decisions are frozen once the person has moved on", () => {
    const s = run(
      ...atReview,
      ...decideAll("confirmed"),
      { type: "toFollowup" },
      { type: "decide", id: ids.med, decision: null },
      { type: "setOwner", taskId: ids.task, owner: "Jenny" },
    );
    expect(s.decisions[ids.med]).toBe("confirmed");
    expect(s.owners[ids.task]).toBe("Carlos");
  });
  const delivery = {
    channel: "simulated",
    sent: false,
    preview: "x",
    to: "Carlos",
    at: "t",
  } as const;
  const reply = { channel: "simulated", from: "Carlos", text: "DONE", at: "t" } as const;
  it("a reply can only follow a prepared message, and only once; the wrap-up is reached from follow-up", () => {
    const base = [...atReview, ...decideAll("confirmed"), { type: "toFollowup" } as Action];
    expect(
      run(...base, { type: "replyReceived", taskId: ids.task, reply }).followUps[ids.task]!.reply,
    ).toBeNull();
    const s = run(
      ...base,
      { type: "deliveryReady", taskId: ids.task, delivery },
      { type: "replyReceived", taskId: ids.task, reply },
      { type: "replyReceived", taskId: ids.task, reply: { ...reply, text: "NO" } },
    );
    expect(s.followUps[ids.task]!.reply?.text).toBe("DONE");
    expect(run(...base, { type: "finish" }).step).toBe("done");
    expect(run(...atReview, { type: "finish" }).step).toBe("summary");
  });
});
