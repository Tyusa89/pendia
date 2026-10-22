// Minimal WAV reader for the spike: accepts only mono 16 kHz 16-bit PCM (what the project's own recorder produces) and
// splits it into the 80 ms frames the proposed protocol expects. Pure functions, no I/O.
import { BYTES_PER_SAMPLE, FRAME_BYTES, SAMPLE_RATE } from "./protocol.ts";

export interface Pcm {
  data: Uint8Array;
  durationS: number;
}

export function parseWav(bytes: Uint8Array): Pcm {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("Not a WAV file.");
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV has no fmt chunk before data.");
      if (fmt.format !== 1) throw new Error("Only uncompressed PCM WAV is supported.");
      if (fmt.channels !== 1) throw new Error(`Expected mono audio, got ${fmt.channels} channels.`);
      if (fmt.rate !== SAMPLE_RATE)
        throw new Error(`Expected ${SAMPLE_RATE} Hz, got ${fmt.rate} Hz. Resample first.`);
      if (fmt.bits !== 16) throw new Error(`Expected 16-bit samples, got ${fmt.bits}-bit.`);
      const end = Math.min(bytes.byteLength, body + size);
      const data = bytes.subarray(body, end - ((end - body) % BYTES_PER_SAMPLE));
      return { data, durationS: data.byteLength / (SAMPLE_RATE * BYTES_PER_SAMPLE) };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

/**
 * 80 ms frames of exactly FRAME_BYTES. The last partial frame is zero-padded to a full frame (ASSUMPTION: the server
 * wants fixed-size frames; at most 80 ms of silence is added at the very end).
 */
export function toFrames(pcm: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let o = 0; o < pcm.byteLength; o += FRAME_BYTES) {
    const f = new Uint8Array(FRAME_BYTES);
    f.set(pcm.subarray(o, Math.min(o + FRAME_BYTES, pcm.byteLength)));
    frames.push(f);
  }
  return frames;
}

/** Test helper: a WAV (mono 16 kHz 16-bit) of a sine tone. */
export function makeToneWav(seconds: number, hz = 220): Uint8Array {
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    dv.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 8000),
      true,
    );
  return out;
}
