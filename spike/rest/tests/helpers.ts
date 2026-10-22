import { vi } from "vitest";
import { MODE, MODEL } from "../config.ts";

/** Any global fetch in a unit test is a bug: every test injects its own fake. */
export const blockedFetch = vi.fn(() => {
  throw new Error("network blocked in tests");
});
export function blockNetwork() {
  blockedFetch.mockClear();
  vi.stubGlobal("fetch", blockedFetch);
}

export const FAKE_KEY = "sk-test-NOT-A-REAL-KEY-0123456789";

export function wavBytes(
  o: {
    seconds?: number;
    rate?: number;
    channels?: number;
    bits?: number;
    format?: number;
    dataBytes?: number;
    declaredData?: number;
  } = {},
): Uint8Array {
  const rate = o.rate ?? 16000;
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const dataBytes = o.dataBytes ?? Math.round((o.seconds ?? 2) * rate * channels * (bits / 8));
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  const w = (off: number, s: string) => [...s].forEach((c, i) => (out[off + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, o.format ?? 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, (rate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  w(36, "data");
  dv.setUint32(40, o.declaredData ?? dataBytes, true);
  // low-level noise so the file is not all zeros
  for (let i = 0; i < Math.min(dataBytes, 4000); i++) out[44 + i] = (i * 37) % 251;
  return out;
}

export const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

export const goodTurns = (texts: Array<[string, string]>) => ({
  transcript: texts.map((t) => t[1]).join(" "),
  turns: texts.map(([speaker, text], i) => ({ speaker, text, start: i * 3, end: i * 3 + 2.5 })),
});

export { MODE, MODEL };
