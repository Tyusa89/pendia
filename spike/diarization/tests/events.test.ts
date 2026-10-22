// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Capture } from "../capture.ts";
import { extractSegments, getPath, inspectCapture } from "../events.ts";

const cap = (events: unknown[]): Capture => ({
  meta: {
    sessionId: "s",
    url: "ws://x",
    model: "m",
    live: false,
    startedAt: "",
    handshakeSentAtMs: 1,
    framesSent: 1,
    audioSeconds: 1,
    maxPacingDriftMs: 0,
    close: { code: 1000, reason: "", meaning: "normal close", expected: true },
    endStreamSent: true,
  },
  entries: events.map((e, i) => ({
    t: i,
    dir: "recv" as const,
    kind: "text" as const,
    type: (e as { type?: string }).type ?? "?",
    raw: JSON.stringify(e),
    json: e,
  })),
});

describe("segment extraction (the speaker payload shape is unverified)", () => {
  it("recognises a combined speaker+text event, with times in seconds", () => {
    const x = extractSegments(
      cap([{ type: "speaker", speaker: "A", text: "hello", start: 1, end: 2 }]),
    );
    expect(x.segments).toEqual([
      { speaker: "A", text: "hello", startS: 1, endS: 2, source: "speaker" },
    ]);
  });
  it("reads millisecond fields by name", () => {
    const x = extractSegments(
      cap([
        {
          type: "transcript",
          payload: { speakerId: "s1", text: "hi", startMs: 1500, endMs: 2500 },
        },
      ]),
    );
    expect(x.segments[0]).toMatchObject({ speaker: "s1", startS: 1.5, endS: 2.5 });
  });
  it("uses only final events when any event is marked final (cumulative partials would repeat text)", () => {
    const x = extractSegments(
      cap([
        { type: "transcript", speaker: "A", text: "hel", final: false },
        { type: "transcript", speaker: "A", text: "hello there", final: true },
      ]),
    );
    expect(x.segments.map((s) => s.text)).toEqual(["hello there"]);
  });
  it("warns when nothing is marked final", () => {
    const x = extractSegments(cap([{ type: "transcript", speaker: "A", text: "hello" }]));
    expect(x.notes.join(" ")).toMatch(/final flag/);
  });
  it("joins separate speaker and transcript events by time overlap", () => {
    const x = extractSegments(
      cap([
        { type: "speaker", speaker: "A", start: 0, end: 2 },
        { type: "speaker", speaker: "B", start: 2, end: 4 },
        { type: "transcript", text: "first", start: 0.2, end: 1.8, final: true },
        { type: "transcript", text: "second", start: 2.1, end: 3.9, final: true },
      ]),
    );
    expect(x.segments.map((s) => `${s.speaker}:${s.text}`)).toEqual(["A:first", "B:second"]);
    expect(x.strategy).toMatch(/joined/);
  });
  it("an object-valued speaker needs an explicit config path; the config then works", () => {
    const events = [
      { type: "transcript", final: true, payload: { speaker: { id: "x" }, text: "hello" } },
    ];
    expect(extractSegments(cap(events)).strategy).toBeNull();
    const x = extractSegments(cap(events), {
      eventType: "transcript",
      speakerPath: "payload.speaker.id",
      textPath: "payload.text",
      finalPath: "final",
    });
    expect(x.segments).toEqual([{ speaker: "x", text: "hello", source: "transcript" }]);
  });
  it("says so (strategy null) when no event has a speaker label, instead of guessing", () => {
    const x = extractSegments(cap([{ type: "transcript", text: "hello" }, { type: "speechEnd" }]));
    expect(x.segments).toEqual([]);
    expect(x.strategy).toBeNull();
    expect(x.notes[0]).toMatch(/inspect/);
  });
  it("getPath walks dotted paths safely", () => {
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("inspect", () => {
  it("lists every event type, an example and each key path, and preserves unknown types", () => {
    const out = inspectCapture(
      cap([
        { type: "speaker", speaker: "A", text: "x" },
        { type: "mystery", detail: { deep: [1] } },
      ]),
    );
    expect(out).toMatch(/== speaker x1/);
    expect(out).toMatch(/== mystery x1|== unknown x1/);
    expect(out).toMatch(/detail\.deep: array/);
    expect(out).toMatch(/Adapter \(heuristic\)/);
  });
  it("reports an empty session plainly", () => {
    expect(inspectCapture(cap([]))).toMatch(/No server messages were received/);
  });
});
