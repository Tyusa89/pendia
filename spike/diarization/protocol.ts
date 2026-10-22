// Proposed realtime protocol for the Meta Voice Transcribe diarization spike.
// SOURCE: a third-party spec supplied by Muse, NOT verified Meta documentation. Every constant below is an assumption
// until a real capture confirms it (see README.md in this folder). Nothing here talks to the network.

export const ENDPOINT = "wss://api.meta.ai/v1/asr/realtime";
export const ALLOWED_LIVE_HOST = "api.meta.ai";
export const MODEL = "muse-voice-transcribe-1.0";
export const SAMPLE_RATE = 16000;
export const BYTES_PER_SAMPLE = 2;
export const FRAME_MS = 80;
/** 16000 samples/s * 2 bytes * 0.080 s = 2560 bytes (arithmetic checked in the tests). */
export const FRAME_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * FRAME_MS) / 1000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface HandshakeOptions {
  apiKey: string;
  languageBias?: string[];
  keywords?: string[];
  emitAudioProgress?: boolean;
}

export interface Handshake {
  authorization: { accessToken: string };
  model: string;
  mode: "DIARIZATION";
  audioEncoding: "PCM_16KHZ";
  partialMode: "CUMULATIVE";
  emitAudioProgress?: boolean;
  languageBias?: string[];
  keywords?: string[];
}

/** Privacy rule from the project brief: Standard tier only, never a "-contributor" model. */
export function assertStandardModel(model: string) {
  if (/contributor/i.test(model))
    throw new Error("Refusing to use a -contributor model: it trains on inputs.");
}

const nonEmpty = (xs: string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean);

/** Builds the first text frame. Optional fields that are unused or empty are omitted entirely (the spec: "do not send empty values"). */
export function buildHandshake(o: HandshakeOptions): Handshake {
  if (!o.apiKey || !o.apiKey.trim())
    throw new Error("META_API_KEY is required (server-side only).");
  assertStandardModel(MODEL);
  const h: Handshake = {
    authorization: { accessToken: `Bearer ${o.apiKey.trim()}` },
    model: MODEL,
    mode: "DIARIZATION",
    audioEncoding: "PCM_16KHZ",
    partialMode: "CUMULATIVE",
  };
  if (o.emitAudioProgress === true) h.emitAudioProgress = true; // the spike sends false by omitting it
  const lang = nonEmpty(o.languageBias);
  if (lang.length) h.languageBias = lang;
  const kw = nonEmpty(o.keywords);
  if (kw.length) h.keywords = kw;
  return h;
}

/** The same handshake with the credential replaced, safe to log and store. */
export function redactHandshake(h: Handshake): Handshake {
  return { ...h, authorization: { accessToken: "Bearer ***" } };
}

/** Replaces every occurrence of the key (and its Bearer form) in any text, so a server echo can never reach a log. */
export function scrubSecret(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("***");
}

export function newSessionId(): string {
  // RFC 4122 version 4
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

export function sessionUrl(base: string, sessionId: string): string {
  const u = new URL(base);
  u.searchParams.set("sessionId", sessionId);
  return u.toString();
}

export const END_STREAM = JSON.stringify({ type: "endStream" });

export const KNOWN_EVENT_TYPES = [
  "transcript",
  "speechStart",
  "speechEnd",
  "speechComplete",
  "speaker",
  "error",
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** Close codes proposed by the spec. Unlisted codes are reported as unknown, never guessed. */
export function describeClose(code: number | null): {
  code: number | null;
  meaning: string;
  expected: boolean;
} {
  switch (code) {
    case 1000:
      return { code, meaning: "normal close", expected: true };
    case 1008:
      return {
        code,
        meaning: "policy or pacing violation (spec: audio pacing too far from real time)",
        expected: false,
      };
    case 1011:
      return { code, meaning: "server error", expected: false };
    case 1013:
      return {
        code,
        meaning: "rate limited (try again later; the spike does not retry)",
        expected: false,
      };
    case null:
      return { code, meaning: "no close frame received", expected: false };
    default:
      return { code, meaning: "UNLISTED close code (not in the spec)", expected: false };
  }
}

/** Classifies a parsed server message. Unknown types are kept (type "unknown") for investigation, never dropped. */
export function classifyEvent(msg: unknown): {
  type: KnownEventType | "unknown" | "nonobject";
  declared: string | null;
} {
  if (!msg || typeof msg !== "object" || Array.isArray(msg))
    return { type: "nonobject", declared: null };
  const o = msg as Record<string, unknown>;
  const declared =
    typeof o["type"] === "string"
      ? (o["type"] as string)
      : typeof o["event"] === "string"
        ? (o["event"] as string)
        : null;
  if (declared && (KNOWN_EVENT_TYPES as readonly string[]).includes(declared))
    return { type: declared as KnownEventType, declared };
  return { type: "unknown", declared };
}
