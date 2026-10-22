// A LOCAL stand-in for the Meta realtime endpoint, so the capture tool, the scorer and the safety checks can be tested
// without any network access to Meta. It implements the proposed protocol (handshake frame first, 2560-byte binary
// frames, endStream, close codes) with a minimal RFC 6455 server. The speaker-event shapes it emits are FICTIONAL
// examples of what the real payload might look like; they prove our adapter plumbing, not Meta's behaviour.
import { createHash } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";
import type { Turn } from "./groundtruth.ts";
import { FRAME_BYTES, FRAME_MS, MODEL } from "./protocol.ts";

export type Scenario =
  | "perfect" // A = doctor, B = patient
  | "swapped" // labels reversed: still correct by best fit
  | "leak" // patient turn 7 labelled as the doctor
  | "two-wrong" // two turns wrong: 83%, must fail
  | "one-wrong" // one non-leaking error: 91.7%, passes
  | "unknown-event" // an unlisted event type is sent: must be preserved
  | "error-event" // an error event, then close 1011
  | "close-1008" // policy close right after the first frames
  | "rate-limit-1013" // close 1013 immediately after the handshake
  | "silent"; // accepts everything, never emits speaker events

export type Shape = "combined" | "nested" | "split";

export interface SimOptions {
  scenario: Scenario;
  script: Turn[];
  shape?: Shape;
  /** if set, close 1008 when the handshake has not arrived by then (default 10 000 like the spec) */
  handshakeTimeoutMs?: number;
  /** if true, close 1008 when audio arrives much faster than real time */
  enforcePacing?: boolean;
  pacingSlackMs?: number;
}

export interface Received {
  headers: http.IncomingHttpHeaders;
  path: string;
  handshakes: unknown[];
  textFrames: string[];
  binarySizes: number[];
  binaryArrivalMs: number[];
  endStreams: number;
  closedByClient: number | null;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function frame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head =
    n < 126
      ? Buffer.from([0x80 | opcode, n])
      : Buffer.from([0x80 | opcode, 126, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([head, payload]);
}
const textFrame = (s: string) => frame(0x1, Buffer.from(s));
const closeFrame = (code: number, reason = "") =>
  frame(0x8, Buffer.concat([Buffer.from([(code >> 8) & 0xff, code & 0xff]), Buffer.from(reason)]));

/** Parses client frames (always masked). Returns frames and the unconsumed remainder. */
function parse(buf: Buffer): { frames: Array<{ opcode: number; payload: Buffer }>; rest: Buffer } {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let o = 0;
  while (buf.length - o >= 2) {
    const opcode = buf[o]! & 0x0f;
    const masked = (buf[o + 1]! & 0x80) !== 0;
    let len = buf[o + 1]! & 0x7f;
    let p = o + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    const payload = Buffer.from(buf.subarray(p + maskLen, p + maskLen + len));
    if (masked)
      for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ buf[p + (i % 4)]!;
    frames.push({ opcode, payload });
    o = p + maskLen + len;
  }
  return { frames, rest: buf.subarray(o) };
}

/** Rejects empty values anywhere in the handshake (spec: "do not send empty values"). */
function hasEmpty(v: unknown): boolean {
  if (v === "" || v === null) return true;
  if (Array.isArray(v)) return v.length === 0 || v.some(hasEmpty);
  if (v && typeof v === "object") return Object.values(v).some(hasEmpty);
  return false;
}

function validateHandshake(h: unknown): string | null {
  if (!h || typeof h !== "object") return "handshake must be a JSON object";
  const o = h as Record<string, unknown>;
  const tok = (o["authorization"] as { accessToken?: unknown } | undefined)?.accessToken;
  if (typeof tok !== "string" || !/^Bearer \S+$/.test(tok))
    return "authorization.accessToken must be 'Bearer <key>'";
  if (o["model"] !== MODEL) return "unexpected model";
  if (o["mode"] !== "DIARIZATION") return "mode must be DIARIZATION";
  if (o["audioEncoding"] !== "PCM_16KHZ") return "audioEncoding must be PCM_16KHZ";
  if (hasEmpty(o)) return "empty values are not allowed";
  return null;
}

function eventsFor(opts: SimOptions): string[] {
  const out: string[] = [];
  const shape = opts.shape ?? "combined";
  let t = 0.5;
  const wrongTurns =
    opts.scenario === "leak"
      ? [7]
      : opts.scenario === "two-wrong"
        ? [4, 9]
        : opts.scenario === "one-wrong"
          ? [5]
          : [];
  const swap = opts.scenario === "swapped";
  for (const turn of opts.script) {
    let isDoctor = turn.who === "D";
    if (wrongTurns.includes(turn.n)) isDoctor = !isDoctor;
    if (swap) isDoctor = !isDoctor;
    const label = isDoctor ? "A" : "B";
    const dur = Math.max(1.5, turn.text.split(" ").length * 0.38);
    const start = t;
    const end = t + dur;
    t = end + 0.4;
    // cumulative partials first (no speaker information)
    const words = turn.text.split(" ");
    out.push(
      JSON.stringify({
        type: "transcript",
        final: false,
        text: words.slice(0, Math.ceil(words.length / 2)).join(" "),
      }),
    );
    if (shape === "combined")
      out.push(
        JSON.stringify({
          type: "speaker",
          speaker: label,
          text: turn.text,
          start,
          end,
          final: true,
        }),
      );
    else if (shape === "nested")
      out.push(
        JSON.stringify({
          type: "transcript",
          final: true,
          payload: {
            speaker: { id: `spk_${label}` },
            text: turn.text,
            startMs: Math.round(start * 1000),
            endMs: Math.round(end * 1000),
          },
        }),
      );
    else {
      out.push(JSON.stringify({ type: "speaker", speaker: label, start, end }));
      out.push(JSON.stringify({ type: "transcript", final: true, text: turn.text, start, end }));
    }
    out.push(JSON.stringify({ type: "speechEnd" }));
  }
  if (opts.scenario === "unknown-event")
    out.splice(2, 0, JSON.stringify({ type: "mysteryEvent", detail: { surprise: true } }));
  out.push(JSON.stringify({ type: "speechComplete" }));
  return out;
}

export async function startSimulator(
  opts: SimOptions,
): Promise<{ url: string; received: Received; close: () => Promise<void> }> {
  const received: Received = {
    headers: {},
    path: "",
    handshakes: [],
    textFrames: [],
    binarySizes: [],
    binaryArrivalMs: [],
    endStreams: 0,
    closedByClient: null,
  };
  const sockets = new Set<Socket>();
  const server = http.createServer((_req, res) => {
    res.writeHead(426).end("upgrade required");
  });
  server.on("upgrade", (req, socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    received.headers = req.headers;
    received.path = req.url ?? "";
    const key = req.headers["sec-websocket-key"] as string;
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash(
        "sha1",
      )
        .update(key + GUID)
        .digest("base64")}\r\n\r\n`,
    );
    const t0 = Date.now();
    let buf: Buffer = Buffer.alloc(0);
    let handshaken = false;
    let closed = false;
    const send = (b: Buffer) => !socket.destroyed && socket.write(b);
    const close = (code: number, reason = "") => {
      if (closed) return;
      closed = true;
      send(closeFrame(code, reason));
      setTimeout(() => socket.end(), 20);
    };
    const hsTimer = setTimeout(() => {
      if (!handshaken) close(1008, "handshake timeout");
    }, opts.handshakeTimeoutMs ?? 10_000);
    socket.on("close", () => clearTimeout(hsTimer));

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = parse(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) {
          received.closedByClient = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
          close(f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000);
        } else if (f.opcode === 0x9) send(frame(0xa, f.payload));
        else if (f.opcode === 0x1) {
          const text = f.payload.toString("utf8");
          received.textFrames.push(text);
          if (!handshaken) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              send(textFrame(JSON.stringify({ type: "error", message: "handshake is not JSON" })));
              return close(1008, "bad handshake");
            }
            received.handshakes.push(parsed);
            const bad = validateHandshake(parsed);
            if (bad) {
              send(textFrame(JSON.stringify({ type: "error", message: bad })));
              return close(1008, "bad handshake");
            }
            handshaken = true;
            clearTimeout(hsTimer);
            if (opts.scenario === "rate-limit-1013") return close(1013, "rate limited");
          } else if (text.includes('"endStream"')) {
            received.endStreams++;
            if (opts.scenario === "error-event") {
              send(
                textFrame(
                  JSON.stringify({ type: "error", code: "internal", message: "simulated failure" }),
                ),
              );
              return close(1011, "server error");
            }
            if (opts.scenario !== "silent") for (const e of eventsFor(opts)) send(textFrame(e));
            else send(textFrame(JSON.stringify({ type: "speechComplete" })));
            close(1000, "done");
          }
        } else if (f.opcode === 0x2) {
          received.binarySizes.push(f.payload.length);
          received.binaryArrivalMs.push(Date.now() - t0);
          if (!handshaken) return close(1008, "audio before handshake");
          if (f.payload.length !== FRAME_BYTES) {
            send(
              textFrame(
                JSON.stringify({ type: "error", message: `frame must be ${FRAME_BYTES} bytes` }),
              ),
            );
            return close(1008, "bad frame size");
          }
          if (received.binarySizes.length === 1)
            send(textFrame(JSON.stringify({ type: "speechStart" })));
          if (opts.scenario === "close-1008" && received.binarySizes.length === 3)
            return close(1008, "pacing");
          if (opts.enforcePacing) {
            const aheadMs = received.binarySizes.length * FRAME_MS - (Date.now() - t0);
            if (aheadMs > (opts.pacingSlackMs ?? 1500))
              return close(1008, "audio faster than real time");
          }
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}/v1/asr/realtime`,
    received,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
