// Captures a realtime diarization session as an ordered log of raw frames, without interpreting speaker events (their
// payload shape is unverified). Runtime-agnostic: uses the global WebSocket (Node 22, Deno, Bun). The API key is only
// ever read from the caller, goes only into the first text frame, and is scrubbed from everything that is logged.
import { assertConnectAllowed } from "./guard.ts";
import {
  buildHandshake,
  classifyEvent,
  describeClose,
  END_STREAM,
  FRAME_MS,
  HANDSHAKE_TIMEOUT_MS,
  MODEL,
  newSessionId,
  redactHandshake,
  scrubSecret,
  sessionUrl,
} from "./protocol.ts";
import { toFrames } from "./wav.ts";

export interface CaptureEntry {
  /** milliseconds since the connection was started */
  t: number;
  dir: "open" | "send" | "recv" | "close" | "error" | "note";
  kind?: "text" | "binary";
  /** classified type for received JSON (a known type, "unknown", "nonobject", or "unparsable") */
  type?: string;
  bytes?: number;
  /** verbatim server text (scrubbed of the key). Present for every received text frame. */
  raw?: string;
  /** parsed JSON for received text frames; for the handshake it is the REDACTED handshake */
  json?: unknown;
  note?: string;
}

export interface Capture {
  meta: {
    sessionId: string;
    url: string;
    model: string;
    live: boolean;
    startedAt: string;
    handshakeSentAtMs: number | null;
    framesSent: number;
    audioSeconds: number;
    maxPacingDriftMs: number;
    close: { code: number | null; reason: string; meaning: string; expected: boolean };
    endStreamSent: boolean;
  };
  entries: CaptureEntry[];
}

export interface CaptureOptions {
  url: string;
  apiKey: string;
  pcm: Uint8Array;
  keywords?: string[];
  languageBias?: string[];
  /** 1 = real time (required for live runs). Larger values only speed up local tests. */
  paceMultiplier?: number;
  liveApproval?: string | undefined;
  /** how long to keep reading after endStream before giving up (ms) */
  closeWaitMs?: number;
  WebSocketImpl?: typeof WebSocket;
  sessionId?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export async function runRealtimeCapture(o: CaptureOptions): Promise<Capture> {
  const pace = o.paceMultiplier ?? 1;
  const { live } = assertConnectAllowed(o.url, {
    liveApproval: o.liveApproval,
    paceMultiplier: pace,
  });
  const handshake = buildHandshake({
    apiKey: o.apiKey,
    ...(o.languageBias ? { languageBias: o.languageBias } : {}),
    ...(o.keywords ? { keywords: o.keywords } : {}),
  });
  const frames = toFrames(o.pcm);
  const sessionId = o.sessionId ?? newSessionId();
  const url = sessionUrl(o.url, sessionId);
  const WS = o.WebSocketImpl ?? globalThis.WebSocket;
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const entries: CaptureEntry[] = [];
  const log = (e: Omit<CaptureEntry, "t">) => entries.push({ t: now(), ...e });
  const scrub = (s: string) => scrubSecret(s, o.apiKey);

  const meta: Capture["meta"] = {
    sessionId,
    url,
    model: MODEL,
    live,
    startedAt: new Date(t0).toISOString(),
    handshakeSentAtMs: null,
    framesSent: 0,
    audioSeconds: (frames.length * FRAME_MS) / 1000,
    maxPacingDriftMs: 0,
    close: { reason: "", ...describeClose(null) },
    endStreamSent: false,
  };

  await new Promise<void>((resolve) => {
    const ws = new WS(url);
    ws.binaryType = "arraybuffer";
    let finished = false;
    let streamer: Promise<void> | null = null;
    // eslint-disable-next-line prefer-const -- assigned after `done` is defined
    let guard: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (finished) return;
      finished = true;
      if (guard) clearTimeout(guard);
      resolve();
    };

    ws.onopen = () => {
      log({ dir: "open" });
      // The handshake must be the first text frame, within 10 s of the connection (spec). We send it immediately.
      ws.send(JSON.stringify(handshake));
      meta.handshakeSentAtMs = now();
      log({
        dir: "send",
        kind: "text",
        type: "handshake",
        json: redactHandshake(handshake),
        bytes: JSON.stringify(handshake).length,
      });
      if (meta.handshakeSentAtMs > HANDSHAKE_TIMEOUT_MS)
        log({ dir: "note", note: "handshake sent later than the 10 s window" });
      streamer = (async () => {
        const start = Date.now();
        for (let i = 0; i < frames.length; i++) {
          const due = start + (i * FRAME_MS) / pace; // absolute schedule: no cumulative drift
          await sleep(due - Date.now());
          if (ws.readyState !== WS.OPEN) {
            log({
              dir: "note",
              note: `socket closed after ${meta.framesSent} of ${frames.length} frames`,
            });
            return;
          }
          ws.send(frames[i]!);
          meta.framesSent++;
          meta.maxPacingDriftMs = Math.max(meta.maxPacingDriftMs, Math.abs(Date.now() - due));
        }
        log({
          dir: "send",
          kind: "binary",
          type: "audio",
          bytes: frames.length * (frames[0]?.byteLength ?? 0),
          note: `${frames.length} frames`,
        });
        if (ws.readyState === WS.OPEN) {
          ws.send(END_STREAM);
          meta.endStreamSent = true;
          log({ dir: "send", kind: "text", type: "endStream", raw: END_STREAM });
        }
      })();
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        const raw = scrub(ev.data);
        let json: unknown;
        let type: string;
        try {
          json = JSON.parse(raw);
          type = classifyEvent(json).type;
        } catch {
          type = "unparsable";
        }
        log({ dir: "recv", kind: "text", type, raw, ...(json !== undefined ? { json } : {}) });
      } else {
        const n = (ev.data as ArrayBuffer).byteLength ?? 0;
        log({
          dir: "recv",
          kind: "binary",
          type: "binary",
          bytes: n,
          note: "unexpected binary frame from server (contents not stored)",
        });
      }
    };
    ws.onerror = () => log({ dir: "error", note: "websocket error event" });
    ws.onclose = (ev: CloseEvent) => {
      meta.close = { reason: scrub(ev.reason ?? ""), ...describeClose(ev.code ?? null) };
      log({ dir: "close", note: `${meta.close.code} ${meta.close.meaning}` });
      void (streamer ?? Promise.resolve()).finally(done);
    };

    // overall guard: audio duration (scaled) + closeWait. Only fires if the server never closes.
    guard = setTimeout(
      () => {
        if (finished) return;
        log({ dir: "note", note: "server did not close in time; closing from the client" });
        try {
          ws.close(1000, "spike timeout");
        } catch {
          /* ignore */
        }
        setTimeout(done, 500);
      },
      (meta.audioSeconds * 1000) / pace + (o.closeWaitMs ?? 30_000),
    );
  });
  return { meta, entries };
}

export const toJsonl = (c: Capture) =>
  [JSON.stringify({ meta: c.meta }), ...c.entries.map((e) => JSON.stringify(e))].join("\n") + "\n";

export function fromJsonl(text: string): Capture {
  const lines = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const head = lines.shift();
  if (!head?.meta) throw new Error("Not a capture file (first line must be {meta}).");
  return { meta: head.meta, entries: lines as CaptureEntry[] };
}
