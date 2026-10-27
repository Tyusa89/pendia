// Shared fixtures for the Meta transcription tests. Synthetic audio and the sanitized PR #50 reply only; no real speech or keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Byte-identical copy of the sanitized fixture from PR #50: the real HTTP 200 reply (sessionId replaced), 12 turns, one empty with no speaker key. */
export const liveFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/meta-live-200-sanitized.json"), "utf8"),
) as {
  sessionId: string;
  transcript: string;
  audioDurationMs: number;
  turns: Array<Record<string, unknown>>;
};

/** A valid mono 16-bit PCM WAV of silence. */
export function wavBytes(
  opts: { seconds?: number; rate?: number; channels?: number; bits?: number } = {},
) {
  const rate = opts.rate ?? 16000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const dataLen = Math.round((opts.seconds ?? 2) * rate * 2) & ~1;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, bits, true);
  tag(36, "data");
  dv.setUint32(40, dataLen, true);
  return out;
}

export const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

export const FAMILY = "11111111-1111-4111-8111-111111111111";
export const CANARY_KEY = "CANARY-KEY-do-not-leak-1234567890";
export const ENV_ON = { META_TRANSCRIBE_ENABLED: "true", META_API_KEY: CANARY_KEY };

export const jsonResponse = (body: unknown, status = 200, init: ResponseInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
