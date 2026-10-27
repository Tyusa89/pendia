// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { script } from "../../diarization/tests/helpers.ts";
import { observedShape, parseTranscribeResponse } from "../response.ts";
import { buildScorecard } from "../scorecard.ts";
import { validateWavForUpload } from "../wav-check.ts";
import { goodTurns, wavBytes } from "./helpers.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/documented-response.json", import.meta.url), "utf8"),
);
const code = (v: unknown) => {
  try {
    parseTranscribeResponse(v);
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "no error";
};
const turn = (over: Record<string, unknown> = {}) => ({
  turnId: "t1",
  startMs: 0,
  endMs: 1000,
  transcript: "hello",
  speaker: "A",
  ...over,
});
const reply = (over: Record<string, unknown> = {}, turns: unknown[] = [turn()]) => ({
  sessionId: "s1",
  transcript: "hello",
  audioDurationMs: 1000,
  turns,
  ...over,
});

describe("documented response contract", () => {
  it("reads sessionId, transcript, audioDurationMs and turns[] with turnId, startMs, endMs, transcript, speaker", () => {
    const r = parseTranscribeResponse(
      goodTurns([
        ["A", "hello there"],
        ["B", "good morning"],
      ]),
    );
    expect(r.turnCount).toBe(2);
    expect(r.speakerLabelCount).toBe(2);
    expect(r.reportedAudioSeconds).toBe(6);
    expect(r.segments[0]).toMatchObject({
      speaker: "A",
      text: "hello there",
      startS: 0,
      endS: 2.5,
    });
  });
  it("treats every timestamp as MILLISECONDS", () => {
    const r = parseTranscribeResponse(
      reply({ audioDurationMs: 61500 }, [turn({ startMs: 1500, endMs: 4200 })]),
    );
    expect(r.segments[0]).toMatchObject({ startS: 1.5, endS: 4.2 });
    expect(r.reportedAudioSeconds).toBe(61.5);
    // a value that would be a plausible number of SECONDS is still read as ms
    expect(
      parseTranscribeResponse(reply({}, [turn({ startMs: 3, endMs: 4 })])).segments[0],
    ).toMatchObject({
      startS: 0.003,
      endS: 0.004,
    });
  });
  it("accepts numeric speaker and turn ids, and ignores extra keys", () => {
    const r = parseTranscribeResponse(
      reply({ extra: 1 }, [turn({ speaker: 0, turnId: 7, confidence: 0.9 })]),
    );
    expect(r.segments[0]!.speaker).toBe("0");
  });
  it.each([
    ["no sessionId", reply({ sessionId: undefined })],
    ["no transcript", reply({ transcript: undefined })],
    ["a transcript that is not text", reply({ transcript: 5 })],
    ["no audioDurationMs", reply({ audioDurationMs: undefined })],
    ["audioDurationMs as text", reply({ audioDurationMs: "1000" })],
    ["audioDurationMs negative", reply({ audioDurationMs: -1 })],
    ["null", null],
    ["a list", []],
    ["a string", "hello"],
    ["no turns", reply({ turns: undefined })],
    ["empty turns", reply({}, [])],
    ["turns not a list", reply({ turns: "x" })],
    ["a turn that is not an object", reply({}, ["x"])],
    ["a turn without turnId", reply({}, [turn({ turnId: undefined })])],
    ["a turn without speaker", reply({}, [turn({ speaker: undefined })])],
    ["a blank speaker", reply({}, [turn({ speaker: " " })])],
    ["a turn without transcript", reply({}, [turn({ transcript: undefined })])],
    ["turn transcript that is not text", reply({}, [turn({ transcript: 5 })])],
    ["a turn without startMs", reply({}, [turn({ startMs: undefined })])],
    ["a turn without endMs", reply({}, [turn({ endMs: undefined })])],
    ["times as text", reply({}, [turn({ startMs: "0", endMs: "1000" })])],
    ["an end before the start", reply({}, [turn({ startMs: 3000, endMs: 1000 })])],
    ["a negative start", reply({}, [turn({ startMs: -1 })])],
    ["an impossible time", reply({}, [turn({ endMs: 1e12 })])],
    ["an infinite time", reply({}, [turn({ endMs: Infinity })])],
    ["only empty turns", reply({}, [turn({ transcript: " " })])],
  ])("rejects %s", (_n, v) => {
    expect(code(v)).toBe("malformed_response");
  });
  it("rejects the earlier assumed names instead of guessing: text/start/end, *_s, *_ms, speaker_id", () => {
    const old = (t: Record<string, unknown>) => reply({}, [t]);
    expect(code(old({ speaker: "A", text: "hi", start: 0, end: 1 }))).toBe("malformed_response");
    expect(code(old({ turnId: "1", speaker: "A", transcript: "hi", start_s: 0, end_s: 1 }))).toBe(
      "malformed_response",
    );
    expect(code(old({ turnId: "1", speaker: "A", transcript: "hi", start_ms: 0, end_ms: 1 }))).toBe(
      "malformed_response",
    );
    expect(
      code(old({ turnId: "1", speaker_id: "A", transcript: "hi", startMs: 0, endMs: 1 })),
    ).toBe("malformed_response");
  });
  it("rejects an implausibly long list", () => {
    expect(
      code(
        reply(
          {},
          Array.from({ length: 2001 }, () => turn()),
        ),
      ),
    ).toBe("malformed_response");
  });
  it("reports key names only, and only well-formed ones", () => {
    const s = observedShape({
      ...reply({}, [turn({ transcript: "SECRET WORDS", "bad key with spaces": 1 })]),
      transcript: "SECRET WORDS",
    });
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(s.top).toEqual(["audioDurationMs", "sessionId", "transcript", "turns"]);
    expect(s.turn).toEqual(["endMs", "speaker", "startMs", "transcript", "turnId"]);
    expect(observedShape("nope")).toEqual({ top: [], turn: [] });
  });
});

describe("offline fixture in the documented shape (synthetic script, no live call)", () => {
  const truth = script();
  it("parses and has exactly the documented keys", () => {
    expect(Object.keys(fixture).sort()).toEqual([
      "audioDurationMs",
      "sessionId",
      "transcript",
      "turns",
    ]);
    expect(Object.keys(fixture.turns[0]).sort()).toEqual([
      "endMs",
      "speaker",
      "startMs",
      "transcript",
      "turnId",
    ]);
    expect(parseTranscribeResponse(fixture).turnCount).toBe(12);
  });
  it("scores as a pass through the unchanged scorer, with the overlap present in the times", () => {
    const p = parseTranscribeResponse(fixture);
    const timings = Object.fromEntries(
      fixture.turns.map((t: { startMs: number; endMs: number }, i: number) => [
        String(i + 1),
        [t.startMs / 1000, t.endMs / 1000],
      ]),
    );
    const card = buildScorecard({
      live: false,
      audio: validateWavForUpload(wavBytes({ seconds: 58 })),
      http: { status: 200, elapsedMs: 0 },
      segments: p.segments,
      parseErrorCode: null,
      reportedAudioSeconds: p.reportedAudioSeconds,
      observed: observedShape(fixture),
      truth,
      timings,
    });
    expect(card.score.pass).toBe(true);
    expect(card.score.correctTurns).toBe(12);
    expect(card.wordErrorRate).toBe(0);
    expect(card.response.reportedAudioSeconds).toBe(58.2);
    // turns 7 and 8 overlap in the fixture (8 starts before 7 ends)
    expect(fixture.turns[7].startMs).toBeLessThan(fixture.turns[6].endMs);
  });
});

describe("live HTTP 200 reply (sanitized copy of the saved Meta response; sessionId replaced)", () => {
  const live = JSON.parse(
    readFileSync(new URL("./fixtures/live-200-sanitized.json", import.meta.url), "utf8"),
  );
  const truth = script();
  // Reference turn windows (seconds) of the synthetic clip, as written by `generate` to rest-synthetic.timings.json.
  const timings: Record<string, [number, number]> = {
    "1": [0.5, 5.075],
    "2": [5.761, 11.341],
    "3": [11.824, 21.434],
    "4": [22.133, 25.043],
    "5": [25.582, 28.807],
    "6": [29.528, 35.503],
    "7": [36.022, 40.437],
    "8": [39.237, 42.807],
    "9": [43.304, 48.229],
    "10": [48.698, 51.733],
    "11": [52.238, 55.228],
    "12": [55.818, 57.583],
  };

  it("contains the real quirk: one turn with an empty transcript and no speaker key", () => {
    const quirky = live.turns.filter((t: Record<string, unknown>) => !("speaker" in t));
    expect(quirky).toHaveLength(1);
    expect(quirky[0].transcript).toBe("");
  });
  it("parses, ignoring only the empty non-speech turn", () => {
    const p = parseTranscribeResponse(live);
    expect(live.turns).toHaveLength(12);
    expect(p.turnCount).toBe(11);
    expect(p.ignoredEmptyTurns).toBe(1);
    expect(p.speakerLabelCount).toBe(2);
    expect(p.reportedAudioSeconds).toBe(58.24);
    expect(p.segments.every((s) => s.text.trim() !== "")).toBe(true);
  });
  it("scores through the unchanged scorer: 12/12 speakers correct, no patient-to-doctor leakage", () => {
    const p = parseTranscribeResponse(live);
    const card = buildScorecard({
      live: true,
      audio: null,
      http: { status: 200, elapsedMs: 0 },
      segments: p.segments,
      parseErrorCode: null,
      reportedAudioSeconds: p.reportedAudioSeconds,
      observed: observedShape(live),
      truth,
      timings,
    });
    expect(card.score.scorable).toBe(true);
    expect(card.score.leakageTurns).toEqual([]);
    expect(card.score.correctTurns).toBe(12);
    expect(card.wordErrorRate).not.toBeNull();
  });
  it.each([
    ["a nonempty turn with no speaker", { transcript: "hello" }],
    ["a nonempty turn with a null speaker", { transcript: "hello", speaker: null }],
    [
      "a whitespace-only turn with a blank (non-missing) speaker",
      { transcript: " ", speaker: " " },
    ],
    ["an empty turn with no timestamps", { startMs: undefined, endMs: undefined }],
    ["an empty turn ending before it starts", { startMs: 5000, endMs: 1000 }],
    ["an empty turn with an impossible time", { endMs: 1e12 }],
    ["an empty turn without a turnId", { turnId: undefined }],
    ["an empty turn whose transcript is not text", { transcript: null }],
  ])("still rejects %s", (_n, over) => {
    const emptyNoSpeaker = { turnId: 9, startMs: 100, endMs: 200, transcript: "" };
    expect(code(reply({}, [turn(), { ...emptyNoSpeaker, ...over }]))).toBe("malformed_response");
  });
  it("still rejects a reply whose only turns are empty non-speech turns", () => {
    const e = { turnId: 1, startMs: 0, endMs: 100, transcript: "" };
    expect(code(reply({}, [e, { ...e, turnId: 2 }]))).toBe("malformed_response");
  });
  it("keeps an empty turn that DOES carry a speaker label as before (not counted as ignored)", () => {
    const p = parseTranscribeResponse(
      reply({}, [turn(), turn({ turnId: "t2", transcript: "", speaker: "B" })]),
    );
    expect(p.ignoredEmptyTurns).toBe(0);
    expect(p.turnCount).toBe(2);
  });
});
