// @vitest-environment node
// Offline tests for the Meta Voice Transcribe integration: the pure contract and parser, and the server module with a MOCKED
// fetch. Nothing here can reach Meta: every network call goes to an injected fake.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  META_TRANSCRIBE_URL,
  MetaTranscribeError,
  assertEndpointAllowed,
  buildMultipartBody,
  buildTranscribeRequest,
  validateWavForUpload,
} from "@/lib/meta-transcribe/contract";
import { formatDraftText, parseTranscribeResponse } from "@/lib/meta-transcribe/response";
import { statusInputSchema, transcribeInputSchema } from "@/lib/meta-transcribe/input";
import {
  TRANSCRIBE_RATE_MAX,
  decodeBase64,
  metaTranscribeConfigured,
  resetTranscribeLimits,
  transcribeRecording,
  type FetchLike,
} from "@/server/meta-transcribe.server";
import {
  CANARY_KEY,
  ENV_ON,
  FAMILY,
  jsonResponse,
  liveFixture,
  toBase64,
  wavBytes,
} from "./meta-transcribe-helpers";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as MetaTranscribeError).code;
  }
  return "no error";
};

describe("WAV validation (the audio sent to Meta)", () => {
  it("accepts mono 16-bit PCM at 16 and 24 kHz", () => {
    expect(validateWavForUpload(wavBytes({ seconds: 2 }))).toMatchObject({ sampleRate: 16000 });
    expect(validateWavForUpload(wavBytes({ seconds: 2, rate: 24000 })).sampleRate).toBe(24000);
  });
  it.each([
    ["stereo", wavBytes({ channels: 2 }), "audio_not_mono"],
    ["8-bit", wavBytes({ bits: 8 }), "audio_not_16bit"],
    ["44.1 kHz", wavBytes({ rate: 44100 }), "audio_bad_rate"],
    ["too short", wavBytes({ seconds: 0.5 }), "audio_too_short"],
    ["too long", wavBytes({ seconds: 601 }), "audio_too_long"],
    ["not a WAV", new TextEncoder().encode("x".repeat(100)), "audio_not_wav"],
    ["tiny", new Uint8Array(10), "audio_not_wav"],
  ])("rejects %s", (_n, bytes, c) => {
    expect(code(() => validateWavForUpload(bytes))).toBe(c);
  });
  it("rejects a data chunk shorter than its header claims", () => {
    expect(code(() => validateWavForUpload(wavBytes({ seconds: 2 }).subarray(0, 1000)))).toBe(
      "audio_truncated",
    );
  });
});

describe("request: exactly Meta's documented multipart layout, with no credential", () => {
  it("writes a JSON `request` part without a filename, then the `audio` WAV part", () => {
    const wav = wavBytes({ seconds: 1 });
    const body = buildMultipartBody(wav, "BOUNDARY123");
    const text = new TextDecoder("latin1").decode(body);
    expect(text).toContain(
      'Content-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n' +
        '{"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"}\r\n',
    );
    expect(text).toMatch(/name="audio"; filename="[^"]+"\r\nContent-Type: audio\/wav\r\n\r\nRIFF/);
    expect(text.endsWith("\r\n--BOUNDARY123--\r\n")).toBe(true);
    expect(text.split('name="request"')[0]).not.toContain("filename");
  });
  it("refuses a boundary that occurs inside the audio", () => {
    const wav = wavBytes({ seconds: 1 });
    wav.set(new TextEncoder().encode("--B"), 100);
    expect(code(() => buildMultipartBody(wav, "B"))).toBe("bad_boundary");
  });
  it("carries no Authorization header and targets only the documented endpoint", () => {
    const r = buildTranscribeRequest(wavBytes({ seconds: 1 }));
    expect(r.url).toBe(META_TRANSCRIBE_URL);
    expect(Object.keys(r.headers).sort()).toEqual(["Accept", "Content-Type"]);
    for (const bad of [
      "http://api.meta.ai/v1/asr/transcribe",
      "https://api.meta.ai/v1/asr/transcribe?x=1",
      "https://api.meta.ai:8443/v1/asr/transcribe",
      "https://evil.example/v1/asr/transcribe",
      "https://api.meta.ai/v1/chat/completions",
      "https://user:pw@api.meta.ai/v1/asr/transcribe",
    ])
      expect(
        code(() => assertEndpointAllowed(bad)),
        bad,
      ).toBe("endpoint_refused");
    expect(code(() => assertEndpointAllowed(META_TRANSCRIBE_URL))).toBe("no error");
  });
});

describe("response parser with the sanitized HTTP 200 fixture from PR #50", () => {
  it("has the real quirk: a turn with an empty transcript and no speaker key", () => {
    const quirky = liveFixture.turns.filter((t) => !("speaker" in t));
    expect(quirky).toHaveLength(1);
    expect(quirky[0]!["transcript"]).toBe("");
  });
  it("parses 11 spoken turns, ignores the empty one, keeps the two anonymous speaker labels", () => {
    const p = parseTranscribeResponse(liveFixture);
    expect(liveFixture.turns).toHaveLength(12);
    expect(p.turns).toHaveLength(11);
    expect(p.ignoredEmptyTurns).toBe(1);
    expect(p.speakerCount).toBe(2);
    expect(p.audioSeconds).toBe(58.24);
    expect(new Set(p.turns.map((t) => t.speaker))).toEqual(new Set(["A", "B"]));
    expect(p.turns[0]).toMatchObject({ speaker: "A", startS: 0.46, endS: 5.74 });
    expect(p.turns.every((t) => t.text.trim() !== "")).toBe(true);
  });
  it("keeps the overlapping region as sequential labelled turns (turn 7 B ends where turn 8 A begins)", () => {
    const p = parseTranscribeResponse(liveFixture);
    const b7 = p.turns.find((t) => t.text.startsWith("My son Carlos"))!;
    const a8 = p.turns.find((t) => t.text.startsWith("Yes, the front desk"))!;
    expect([b7.speaker, a8.speaker]).toEqual(["B", "A"]);
    expect(a8.startS).toBeGreaterThanOrEqual(b7.endS);
    expect(a8.text).toMatch(/One more thing/); // reference turns 8 and 9 arrive merged; nothing is dropped
  });
  it("formats a reviewable draft with anonymous labels and m:ss timestamps", () => {
    const lines = formatDraftText(parseTranscribeResponse(liveFixture).turns).split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe(
      "Speaker A (0:00): Good morning, Rosa. How have you you been feeling since the last visit?",
    );
    expect(lines[1]).toMatch(/^Speaker B \(0:05\): Pretty good\./);
  });
});

describe("response parser stays strict", () => {
  const turn = (over: Record<string, unknown> = {}) => ({
    turnId: "t1",
    startMs: 0,
    endMs: 1000,
    transcript: "hello",
    speaker: "A",
    ...over,
  });
  const reply = (turns: unknown[] = [turn()], over: Record<string, unknown> = {}) => ({
    sessionId: "s1",
    transcript: "hello",
    audioDurationMs: 1000,
    turns,
    ...over,
  });
  const c = (v: unknown) => code(() => parseTranscribeResponse(v));
  it.each([
    ["a non-object", null],
    ["no sessionId", reply([turn()], { sessionId: undefined })],
    ["no audioDurationMs", reply([turn()], { audioDurationMs: undefined })],
    ["no turns", reply([turn()], { turns: undefined })],
    ["empty turns", reply([])],
    ["a nonempty turn without speaker", reply([turn({ speaker: undefined })])],
    ["a nonempty turn with null speaker", reply([turn({ speaker: null })])],
    ["a blank speaker", reply([turn({ speaker: " " })])],
    ["a turn without turnId", reply([turn({ turnId: undefined })])],
    ["a non-text transcript", reply([turn({ transcript: 5 })])],
    ["times as text", reply([turn({ startMs: "0" })])],
    ["an end before the start", reply([turn({ startMs: 5000, endMs: 1000 })])],
    ["an impossible time", reply([turn({ endMs: 1e12 })])],
    [
      "an empty speakerless turn with a bad time",
      reply([turn(), turn({ transcript: "", speaker: undefined, startMs: 9000, endMs: 1 })]),
    ],
    ["an old-shaped reply", reply([{ speaker: "A", text: "hi", start: 0, end: 1 }])],
  ])("rejects %s as malformed_response", (_n, v) => {
    expect(c(v)).toBe("malformed_response");
  });
  it("reports no_speech (not malformed) when the reply is well-formed but every turn is empty", () => {
    expect(c(reply([turn({ transcript: " ", speaker: undefined })]))).toBe("no_speech");
    expect(c(reply([turn({ transcript: "" })]))).toBe("no_speech");
  });
});

describe("input schemas", () => {
  it("accept only a family uuid and base64 audio, and nothing else", () => {
    expect(transcribeInputSchema.safeParse({ familyId: FAMILY, audioBase64: "AAAA" }).success).toBe(
      true,
    );
    for (const bad of [
      { familyId: "fam-1", audioBase64: "AAAA" },
      { familyId: FAMILY, audioBase64: "" },
      { familyId: FAMILY, audioBase64: "AAAA", transcript: "injected" },
      { audioBase64: "AAAA" },
      { familyId: FAMILY, audioBase64: "A".repeat(50 * 1024 * 1024) },
    ])
      expect(transcribeInputSchema.safeParse(bad).success).toBe(false);
    expect(statusInputSchema.safeParse({ familyId: FAMILY }).success).toBe(true);
    expect(statusInputSchema.safeParse({ familyId: FAMILY, x: 1 }).success).toBe(false);
  });
  it("decodeBase64 round-trips and rejects junk", () => {
    expect([...decodeBase64("AQID")!]).toEqual([1, 2, 3]);
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("A")).toBeNull();
  });
});

describe("server module with a mocked Meta", () => {
  const audioBase64 = toBase64(wavBytes({ seconds: 2 }));
  const organizer = async () => true;
  let fetchMock: ReturnType<typeof vi.fn>;
  const run = (over: Partial<Parameters<typeof transcribeRecording>[0]> = {}) =>
    transcribeRecording({
      env: ENV_ON,
      userId: "user-1",
      familyId: FAMILY,
      audioBase64,
      isOrganizer: organizer,
      fetchImpl: fetchMock as unknown as FetchLike,
      ...over,
    });
  beforeEach(() => {
    resetTranscribeLimits();
    fetchMock = vi.fn(async () => jsonResponse(liveFixture));
  });

  it("success: one POST to exactly the documented URL, key only in the Authorization header", async () => {
    const r = await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(META_TRANSCRIBE_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${CANARY_KEY}`);
    expect(new TextDecoder("latin1").decode(init.body as Uint8Array)).not.toContain(CANARY_KEY);
    expect(
      Object.entries(headers).filter(([k, v]) => k !== "Authorization" && v.includes(CANARY_KEY)),
    ).toEqual([]);
    expect(r).toMatchObject({ ok: true, speakerCount: 2, audioSeconds: 58.24 });
    if (r.ok) {
      expect(r.turns).toHaveLength(11);
      expect(JSON.stringify(r)).not.toContain(CANARY_KEY);
    }
  });

  describe("gates answer with a fixed code and make NO request", () => {
    it.each([
      ["flag missing", { META_API_KEY: CANARY_KEY }],
      ["flag not exactly true", { META_TRANSCRIBE_ENABLED: "TRUE", META_API_KEY: CANARY_KEY }],
      ["key missing", { META_TRANSCRIBE_ENABLED: "true" }],
      ["key blank", { META_TRANSCRIBE_ENABLED: "true", META_API_KEY: "  " }],
      ["key with whitespace inside", { META_TRANSCRIBE_ENABLED: "true", META_API_KEY: "ab cd" }],
    ])("%s -> not_available", async (_n, env) => {
      expect(await run({ env })).toEqual({ ok: false, code: "not_available" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("a non-organizer -> forbidden", async () => {
      expect(await run({ isOrganizer: async () => false })).toEqual({
        ok: false,
        code: "forbidden",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("a FAILED permission lookup is check_failed (retryable), never forbidden and never allowed", async () => {
      const isOrganizer = async () => {
        throw new Error("db down");
      };
      expect(await run({ isOrganizer })).toEqual({ ok: false, code: "check_failed" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("the permission check receives the requested family id", async () => {
      const isOrganizer = vi.fn(async () => true);
      await run({ isOrganizer });
      expect(isOrganizer).toHaveBeenCalledWith(FAMILY);
    });
    it.each([
      ["not base64", "!!!notbase64!!!", "audio_not_wav"],
      ["not a WAV", toBase64(new TextEncoder().encode("x".repeat(500))), "audio_not_wav"],
      ["too short", toBase64(wavBytes({ seconds: 0.4 })), "audio_too_short"],
      ["too long", toBase64(wavBytes({ seconds: 601 })), "audio_too_long"],
      ["stereo", toBase64(wavBytes({ channels: 2 })), "audio_not_mono"],
    ])("audio that is %s -> %s", async (_n, b64, c) => {
      expect(await run({ audioBase64: b64 })).toEqual({ ok: false, code: c });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rate limit: after the allowed calls the next is refused without a request", async () => {
    for (let i = 0; i < TRANSCRIBE_RATE_MAX; i++) expect((await run()).ok).toBe(true);
    expect(await run()).toEqual({ ok: false, code: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(TRANSCRIBE_RATE_MAX);
    expect((await run({ userId: "user-2" })).ok).toBe(true); // another caregiver is unaffected
  });

  describe("failures are safe, fixed codes; there is never a second request", () => {
    const BODY_CANARY = "REPLY-BODY-CANARY-secret-text";
    it.each([
      ["HTTP 401", () => jsonResponse({ error: { message: BODY_CANARY } }, 401), "http_401"],
      ["HTTP 429", () => jsonResponse({ error: BODY_CANARY }, 429), "http_429"],
      ["HTTP 500", () => jsonResponse(BODY_CANARY, 500), "http_500"],
      [
        "a redirect",
        () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
        "redirect_refused",
      ],
      ["non-JSON on 200", () => new Response(BODY_CANARY, { status: 200 }), "malformed_response"],
      ["JSON of the wrong shape", () => jsonResponse({ text: BODY_CANARY }), "malformed_response"],
      [
        "an oversized reply",
        () => new Response("x".repeat(2 * 1024 * 1024 + 10), { status: 200 }),
        "response_too_large",
      ],
      [
        "a reply with no speech",
        () =>
          jsonResponse({
            ...liveFixture,
            turns: [{ turnId: 0, startMs: 0, endMs: 5, transcript: "" }],
          }),
        "no_speech",
      ],
    ])("%s -> %s", async (_n, make, expected) => {
      fetchMock.mockImplementation(async () => make());
      const r = await run();
      expect(r).toEqual({ ok: false, code: expected });
      expect(JSON.stringify(r)).not.toContain(BODY_CANARY);
      expect(JSON.stringify(r)).not.toContain(CANARY_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("a timeout -> timeout, and the error text is not used", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error(`boom ${CANARY_KEY}`), { name: "TimeoutError" }),
      );
      const r = await run();
      expect(r).toEqual({ ok: false, code: "timeout" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("a transport error -> network_error, and the error text is not used", async () => {
      fetchMock.mockRejectedValue(new TypeError(`fetch failed ${CANARY_KEY}`));
      const r = await run();
      expect(r).toEqual({ ok: false, code: "network_error" });
      expect(JSON.stringify(r)).not.toContain(CANARY_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("a failed attempt still counts toward the rate limit (no free retries)", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      for (let i = 0; i < TRANSCRIBE_RATE_MAX; i++) await run();
      expect(await run()).toEqual({ ok: false, code: "rate_limited" });
    });
  });

  it("metaTranscribeConfigured needs both the flag and a key", () => {
    expect(metaTranscribeConfigured(ENV_ON)).toBe(true);
    expect(metaTranscribeConfigured({})).toBe(false);
    expect(metaTranscribeConfigured({ META_TRANSCRIBE_ENABLED: "true" })).toBe(false);
  });
});
