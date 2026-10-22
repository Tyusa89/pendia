// @vitest-environment node
import { describe, expect, it } from "vitest";
import { observedShape, parseTranscribeResponse } from "../response.ts";
import { goodTurns } from "./helpers.ts";

const code = (v: unknown) => {
  try {
    parseTranscribeResponse(v);
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "no error";
};

describe("response parsing", () => {
  it("turns a well-formed reply into speaker segments with times", () => {
    const r = parseTranscribeResponse(
      goodTurns([
        ["A", "hello there"],
        ["B", "good morning"],
      ]),
    );
    expect(r.turnCount).toBe(2);
    expect(r.speakerLabelCount).toBe(2);
    expect(r.segments[0]).toMatchObject({
      speaker: "A",
      text: "hello there",
      startS: 0,
      endS: 2.5,
    });
  });
  it("accepts numeric speaker ids and millisecond keys", () => {
    const r = parseTranscribeResponse({
      turns: [{ speaker_id: 0, text: "hi", start_ms: 1500, end_ms: 2500 }],
    });
    expect(r.segments[0]).toMatchObject({ speaker: "0", startS: 1.5, endS: 2.5 });
  });
  it.each([
    ["null", null],
    ["a list", []],
    ["a string", "hello"],
    ["no turns", { transcript: "x" }],
    ["empty turns", { turns: [] }],
    ["turns not a list", { turns: "x" }],
    ["a turn that is not an object", { turns: ["x"] }],
    ["a turn without a speaker", { turns: [{ text: "a", start: 0, end: 1 }] }],
    ["a turn without text", { turns: [{ speaker: "A", start: 0, end: 1 }] }],
    ["a turn without times", { turns: [{ speaker: "A", text: "a" }] }],
    ["text that is not text", { turns: [{ speaker: "A", text: 5, start: 0, end: 1 }] }],
    ["times that are strings", { turns: [{ speaker: "A", text: "a", start: "0", end: "1" }] }],
    ["an end before the start", { turns: [{ speaker: "A", text: "a", start: 3, end: 1 }] }],
    ["a negative start", { turns: [{ speaker: "A", text: "a", start: -1, end: 1 }] }],
    ["an impossible time", { turns: [{ speaker: "A", text: "a", start: 0, end: 1e9 }] }],
    ["an infinite time", { turns: [{ speaker: "A", text: "a", start: 0, end: Infinity }] }],
    ["a blank speaker", { turns: [{ speaker: " ", text: "a", start: 0, end: 1 }] }],
    [
      "a transcript that is not text",
      { transcript: 5, turns: [{ speaker: "A", text: "a", start: 0, end: 1 }] },
    ],
    ["only empty turns", { turns: [{ speaker: "A", text: " ", start: 0, end: 1 }] }],
  ])("rejects %s", (_n, v) => {
    expect(code(v)).toBe("malformed_response");
  });
  it("rejects an implausibly long list", () => {
    const turns = Array.from({ length: 2001 }, () => ({
      speaker: "A",
      text: "a",
      start: 0,
      end: 1,
    }));
    expect(code({ turns })).toBe("malformed_response");
  });
  it("reports key names only, and only well-formed ones", () => {
    const s = observedShape({
      turns: [{ speaker: "A", text: "SECRET WORDS", start: 0, end: 1, "bad key with spaces": 1 }],
      transcript: "SECRET WORDS",
    });
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(s.top).toEqual(["transcript", "turns"]);
    expect(s.turn).toEqual(["end", "speaker", "start", "text"]);
    expect(observedShape("nope")).toEqual({ top: [], turn: [] });
  });
});
