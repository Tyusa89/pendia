// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROVAL_TOKEN, assertConnectAllowed } from "../guard.ts";
import {
  FRAME_BYTES,
  FRAME_MS,
  SAMPLE_RATE,
  assertStandardModel,
  buildHandshake,
  classifyEvent,
  describeClose,
  newSessionId,
  redactHandshake,
  scrubSecret,
  sessionUrl,
} from "../protocol.ts";

describe("handshake", () => {
  it("matches the proposed shape and keeps the key only in authorization.accessToken", () => {
    const h = buildHandshake({
      apiKey: "k-123",
      languageBias: ["English"],
      keywords: ["Lisinopril"],
    });
    expect(h).toEqual({
      authorization: { accessToken: "Bearer k-123" },
      model: "muse-voice-transcribe-1.0",
      mode: "DIARIZATION",
      audioEncoding: "PCM_16KHZ",
      partialMode: "CUMULATIVE",
      languageBias: ["English"],
      keywords: ["Lisinopril"],
    });
  });
  it("omits optional fields that are unused or empty (never sends empty values)", () => {
    const h = buildHandshake({ apiKey: "k", keywords: ["", "  "], languageBias: [] });
    expect(Object.keys(h).sort()).toEqual([
      "audioEncoding",
      "authorization",
      "mode",
      "model",
      "partialMode",
    ]);
    expect(JSON.stringify(h)).not.toMatch(/""|\[\]|null/);
  });
  it("emitAudioProgress is omitted (false) unless explicitly requested", () => {
    expect("emitAudioProgress" in buildHandshake({ apiKey: "k" })).toBe(false);
    expect(buildHandshake({ apiKey: "k", emitAudioProgress: true }).emitAudioProgress).toBe(true);
  });
  it("requires a key", () => {
    expect(() => buildHandshake({ apiKey: "" })).toThrow(/META_API_KEY/);
    expect(() => buildHandshake({ apiKey: "   " })).toThrow(/META_API_KEY/);
  });
  it("refuses any -contributor model", () => {
    expect(() => assertStandardModel("muse-voice-transcribe-1.0-contributor")).toThrow(
      /contributor/,
    );
    expect(() => assertStandardModel("muse-voice-transcribe-1.0")).not.toThrow();
  });
  it("redaction and scrubbing remove the key", () => {
    const h = buildHandshake({ apiKey: "super-secret" });
    expect(JSON.stringify(redactHandshake(h))).not.toContain("super-secret");
    expect(
      scrubSecret('{"echo":"Bearer super-secret","k":"super-secret"}', "super-secret"),
    ).not.toContain("super-secret");
  });
});

describe("audio framing arithmetic", () => {
  it("2560 bytes is exactly 80 ms of 16 kHz mono 16-bit PCM", () => {
    expect(SAMPLE_RATE * 2 * (FRAME_MS / 1000)).toBe(2560);
    expect(FRAME_BYTES).toBe(2560);
  });
});

describe("session id, urls, events, close codes", () => {
  it("session ids are RFC 4122 version 4 and unique", () => {
    const ids = new Set(Array.from({ length: 50 }, newSessionId));
    expect(ids.size).toBe(50);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("puts sessionId in the query string", () => {
    expect(sessionUrl("wss://api.meta.ai/v1/asr/realtime", "abc")).toBe(
      "wss://api.meta.ai/v1/asr/realtime?sessionId=abc",
    );
  });
  it("classifies known events and preserves unknown ones", () => {
    expect(classifyEvent({ type: "speaker" }).type).toBe("speaker");
    expect(classifyEvent({ type: "speechComplete" }).type).toBe("speechComplete");
    expect(classifyEvent({ type: "mystery" })).toEqual({ type: "unknown", declared: "mystery" });
    expect(classifyEvent([1]).type).toBe("nonobject");
    expect(classifyEvent("x").type).toBe("nonobject");
  });
  it("describes the proposed close codes and flags unlisted ones", () => {
    expect(describeClose(1000).expected).toBe(true);
    for (const c of [1008, 1011, 1013]) expect(describeClose(c).expected).toBe(false);
    expect(describeClose(4001).meaning).toMatch(/UNLISTED/);
    expect(describeClose(null).meaning).toMatch(/no close/);
  });
});

describe("the brake: no Meta connection without approval", () => {
  it("allows loopback with no approval", () => {
    expect(assertConnectAllowed("ws://127.0.0.1:9/x", {}).live).toBe(false);
    expect(assertConnectAllowed("ws://localhost:9/x", {}).live).toBe(false);
  });
  it("refuses api.meta.ai without the approval token", () => {
    expect(() => assertConnectAllowed("wss://api.meta.ai/v1/asr/realtime", {})).toThrow(/refused/);
    expect(() =>
      assertConnectAllowed("wss://api.meta.ai/v1/asr/realtime", { liveApproval: "yes" }),
    ).toThrow(/refused/);
  });
  it("with approval, still requires real-time pacing", () => {
    expect(
      assertConnectAllowed("wss://api.meta.ai/v1/asr/realtime", { liveApproval: APPROVAL_TOKEN })
        .live,
    ).toBe(true);
    expect(() =>
      assertConnectAllowed("wss://api.meta.ai/v1/asr/realtime", {
        liveApproval: APPROVAL_TOKEN,
        paceMultiplier: 5,
      }),
    ).toThrow(/real-time/);
  });
  it("refuses every other host and non-websocket URLs, even with approval", () => {
    expect(() =>
      assertConnectAllowed("wss://example.com/x", { liveApproval: APPROVAL_TOKEN }),
    ).toThrow(/only loopback/);
    expect(() =>
      assertConnectAllowed("wss://api.meta.ai.evil.com/x", { liveApproval: APPROVAL_TOKEN }),
    ).toThrow(/only loopback/);
    expect(() =>
      assertConnectAllowed("https://api.meta.ai/x", { liveApproval: APPROVAL_TOKEN }),
    ).toThrow(/ws:/);
  });
});
