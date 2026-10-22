// @vitest-environment node
// The capture tool against a LOCAL simulator (loopback only). No Meta connection is ever made.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { fromJsonl, runRealtimeCapture, toJsonl, type Capture } from "../capture.ts";
import { extractSegments } from "../events.ts";
import { FRAME_BYTES, FRAME_MS } from "../protocol.ts";
import { scoreSegments } from "../score.ts";
import { startSimulator, type Scenario, type Shape, type SimOptions } from "../simulator.ts";
import { makeToneWav, parseWav } from "../wav.ts";
import { script } from "./helpers.ts";

const KEY = "super-secret-key-123";
const truth = script();
const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (open.length) await open.pop()!();
});

async function run(
  opts: Partial<SimOptions> & { scenario: Scenario },
  cap: {
    seconds?: number;
    pace?: number;
    keywords?: string[] | undefined;
    languageBias?: string[] | undefined;
  } = {},
) {
  const sim = await startSimulator({ script: truth, ...opts });
  open.push(sim.close);
  const capture = await runRealtimeCapture({
    url: sim.url,
    apiKey: KEY,
    pcm: parseWav(makeToneWav(cap.seconds ?? 2)).data,
    paceMultiplier: cap.pace ?? 50,
    closeWaitMs: 3000,
    ...(cap.keywords !== undefined ? { keywords: cap.keywords } : {}),
    ...(cap.languageBias !== undefined ? { languageBias: cap.languageBias } : {}),
  });
  return { sim, capture };
}
const types = (c: Capture) => c.entries.filter((e) => e.dir === "recv").map((e) => e.type);

describe("protocol behavior over a real local WebSocket", () => {
  it("sends the handshake as the FIRST text frame, in-band (no Authorization header), then 2560-byte binary frames, then endStream", async () => {
    const { sim, capture } = await run(
      { scenario: "perfect" },
      { keywords: ["Lisinopril"], languageBias: ["English"] },
    );
    const r = sim.received;
    expect(r.handshakes).toHaveLength(1);
    expect(JSON.parse(r.textFrames[0]!).authorization.accessToken).toBe(`Bearer ${KEY}`); // the server did get the key, in the first frame
    expect(r.headers["authorization"]).toBeUndefined();
    expect(r.path).toMatch(/^\/v1\/asr\/realtime\?sessionId=[0-9a-f-]{36}$/);
    expect(r.binarySizes.length).toBe(25); // 2 s of audio
    expect(new Set(r.binarySizes)).toEqual(new Set([FRAME_BYTES]));
    expect(r.endStreams).toBe(1);
    expect(r.textFrames.at(-1)).toBe('{"type":"endStream"}'); // after all audio
    expect(capture.meta.handshakeSentAtMs).toBeLessThan(1000);
    expect(capture.meta.endStreamSent).toBe(true);
    expect(capture.meta.close.code).toBe(1000);
    expect(capture.meta.close.expected).toBe(true);
  });

  it("omits optional fields when unused: no empty values on the wire", async () => {
    const { sim } = await run({ scenario: "perfect" });
    const h = sim.received.handshakes[0] as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual([
      "audioEncoding",
      "authorization",
      "mode",
      "model",
      "partialMode",
    ]);
  });

  it("streams at real time: frames arrive ~80 ms apart and a clip takes about its own duration", async () => {
    const { sim, capture } = await run(
      { scenario: "perfect", enforcePacing: true },
      { seconds: 0.4, pace: 1 },
    );
    const a = sim.received.binaryArrivalMs;
    expect(a).toHaveLength(5);
    const gaps = a.slice(1).map((x, i) => x - a[i]!);
    for (const g of gaps) expect(Math.abs(g - FRAME_MS)).toBeLessThan(45);
    expect(a[4]! - a[0]!).toBeGreaterThanOrEqual(4 * FRAME_MS - 40);
    expect(capture.meta.close.code).toBe(1000);
    expect(capture.meta.maxPacingDriftMs).toBeLessThan(80);
  });

  it("a too-fast stream is closed by the (simulated) server with 1008 and reported", async () => {
    const { capture } = await run(
      { scenario: "perfect", enforcePacing: true, pacingSlackMs: 100 },
      { seconds: 4, pace: 200 },
    );
    expect(capture.meta.close.code).toBe(1008);
    expect(capture.meta.close.expected).toBe(false);
    expect(capture.meta.close.meaning).toMatch(/pacing/);
    expect(capture.meta.endStreamSent).toBe(false);
  });
});

describe("what is captured", () => {
  it("keeps every server frame verbatim, in order, including unknown event types", async () => {
    const { capture } = await run({ scenario: "unknown-event" });
    const t = types(capture);
    expect(t).toContain("unknown");
    expect(t).toContain("speechStart");
    expect(t).toContain("speaker");
    expect(t.at(-1)).toBe("speechComplete");
    const mystery = capture.entries.find((e) => e.raw?.includes("mysteryEvent"))!;
    expect(JSON.parse(mystery.raw!)).toEqual({ type: "mysteryEvent", detail: { surprise: true } });
  });

  it("never stores the API key: not in the handshake record, the events, or the saved file", async () => {
    const { capture } = await run({ scenario: "perfect" });
    const hs = capture.entries.find((e) => e.type === "handshake")!;
    expect(JSON.stringify(hs.json)).toContain("Bearer ***");
    expect(toJsonl(capture)).not.toContain(KEY);
  });

  it("scrubs the key even if a server echoes it", async () => {
    class EchoWS {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: ((e: { code: number; reason: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send(d: unknown) {
        if (typeof d === "string" && d.includes("endStream")) {
          this.onmessage?.({ data: JSON.stringify({ type: "error", message: `bad key ${KEY}` }) });
          this.onclose?.({ code: 1011, reason: `rejected ${KEY}` });
        }
      }
      close() {}
    }
    const capture = await runRealtimeCapture({
      url: "ws://127.0.0.1:9/x",
      apiKey: KEY,
      pcm: parseWav(makeToneWav(0.1)).data,
      paceMultiplier: 50,
      WebSocketImpl: EchoWS as unknown as typeof WebSocket,
    });
    expect(toJsonl(capture)).not.toContain(KEY);
    expect(capture.meta.close.reason).toBe("rejected ***");
    expect(capture.meta.close.code).toBe(1011);
  });

  it("round-trips through the saved JSONL format", async () => {
    const { capture } = await run({ scenario: "perfect" });
    const back = fromJsonl(toJsonl(capture));
    expect(back.entries.length).toBe(capture.entries.length);
    expect(back.meta.sessionId).toBe(capture.meta.sessionId);
  });
});

describe("failure modes are reported, never retried or hidden", () => {
  it("1013 rate limit", async () => {
    const { capture } = await run({ scenario: "rate-limit-1013" });
    expect(capture.meta.close.code).toBe(1013);
    expect(capture.meta.close.meaning).toMatch(/rate limited/);
  });
  it("1011 server error with its error event preserved", async () => {
    const { capture } = await run({ scenario: "error-event" });
    expect(capture.meta.close.code).toBe(1011);
    expect(types(capture)).toContain("error");
  });
  it("1008 policy close mid-stream stops the audio and says so", async () => {
    const { capture } = await run({ scenario: "close-1008" });
    expect(capture.meta.close.code).toBe(1008);
    expect(capture.entries.some((e) => e.note?.includes("socket closed after"))).toBe(true);
  });
  it("a silent server yields a capture that cannot be scored (fails closed)", async () => {
    const { capture } = await run({ scenario: "silent" });
    const r = scoreSegments(extractSegments(capture).segments, truth);
    expect(r.scorable).toBe(false);
    expect(r.verdict.pass).toBe(false);
  });
});

describe("simulator fidelity to the proposed spec", () => {
  async function raw(sim: { url: string }, send: (ws: WebSocket) => void) {
    return new Promise<{ code: number; messages: string[] }>((resolve) => {
      const ws = new WebSocket(sim.url);
      const messages: string[] = [];
      ws.onopen = () => send(ws);
      ws.onmessage = (e) => messages.push(String(e.data));
      ws.onclose = (e) => resolve({ code: e.code, messages });
    });
  }
  it("closes 1008 when no handshake arrives in time", async () => {
    const sim = await startSimulator({
      scenario: "perfect",
      script: truth,
      handshakeTimeoutMs: 150,
    });
    open.push(sim.close);
    expect((await raw(sim, () => {})).code).toBe(1008);
  });
  it("rejects a handshake containing empty values", async () => {
    const sim = await startSimulator({ scenario: "perfect", script: truth });
    open.push(sim.close);
    const r = await raw(sim, (ws) =>
      ws.send(
        JSON.stringify({
          authorization: { accessToken: "Bearer k" },
          model: "muse-voice-transcribe-1.0",
          mode: "DIARIZATION",
          audioEncoding: "PCM_16KHZ",
          keywords: [],
        }),
      ),
    );
    expect(r.code).toBe(1008);
    expect(r.messages.join()).toMatch(/empty values/);
  });
  it("rejects audio sent before the handshake", async () => {
    const sim = await startSimulator({ scenario: "perfect", script: truth });
    open.push(sim.close);
    expect((await raw(sim, (ws) => ws.send(new Uint8Array(FRAME_BYTES)))).code).toBe(1008);
  });
  it("rejects a wrong frame size", async () => {
    const sim = await startSimulator({ scenario: "perfect", script: truth });
    open.push(sim.close);
    const r = await raw(sim, (ws) => {
      ws.send(
        JSON.stringify({
          authorization: { accessToken: "Bearer k" },
          model: "muse-voice-transcribe-1.0",
          mode: "DIARIZATION",
          audioEncoding: "PCM_16KHZ",
        }),
      );
      ws.send(new Uint8Array(100));
    });
    expect(r.code).toBe(1008);
  });
});

describe("end to end: capture -> extract -> score", () => {
  const cases: Array<[Scenario, Shape, boolean, string]> = [
    ["perfect", "combined", true, "perfect labels"],
    ["swapped", "combined", true, "reversed anonymous labels"],
    ["one-wrong", "combined", true, "one non-leaking error"],
    ["two-wrong", "combined", false, "two errors"],
    ["leak", "combined", false, "a patient trap turn labelled as the doctor"],
    ["perfect", "split", true, "speaker and transcript events sent separately"],
  ];
  it.each(cases)("%s / %s => pass=%s (%s)", async (scenario, shape, pass) => {
    const { capture } = await run({ scenario, shape });
    const r = scoreSegments(extractSegments(capture).segments, truth);
    expect(r.scorable).toBe(true);
    expect(r.verdict.pass).toBe(pass);
  });
  it("a nested payload is only scorable with an adapter config (it is not guessed)", async () => {
    const { capture } = await run({ scenario: "perfect", shape: "nested" });
    expect(scoreSegments(extractSegments(capture).segments, truth).scorable).toBe(false);
    const ex = extractSegments(capture, {
      eventType: "transcript",
      speakerPath: "payload.speaker.id",
      textPath: "payload.text",
      startPath: "payload.startMs",
      endPath: "payload.endMs",
      finalPath: "final",
      unit: "ms",
    });
    expect(scoreSegments(ex.segments, truth).verdict.pass).toBe(true);
  });
});

describe("command line brake", () => {
  const cli = new URL("../cli.ts", import.meta.url).pathname;
  // The child process cannot open a WebSocket to anything but loopback, so even a broken guard cannot reach Meta.
  const preload = new URL("./no-network.mjs", import.meta.url).pathname;
  const node = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync("node", ["--import", preload, ...args], { env, encoding: "utf8" });
  it("capture refuses to run without the approval token, before any connection", () => {
    const wav = "/tmp/spike-test.wav";
    writeFileSync(wav, makeToneWav(0.2));
    const r = node([cli, "capture", "--wav", wav], {
      ...process.env,
      META_API_KEY: KEY,
      SPIKE_ALLOW_LIVE: "",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refused/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });
  it("capture without META_API_KEY refuses", () => {
    const env = { ...process.env };
    delete env["META_API_KEY"];
    const r = node([cli, "capture", "--wav", "/nonexistent"], env);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/META_API_KEY/);
  });
  it("plan makes no connection and prints a redacted handshake", () => {
    const r = node([cli, "plan"], { ...process.env, META_API_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Nothing was sent/);
    expect(r.stdout).not.toContain(KEY);
  });
});
