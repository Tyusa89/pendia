import { describe, expect, it } from "vitest";
import { blobBytes } from "./recorder-fakes";
import {
  encodeWav,
  floatToInt16,
  readWavHeader,
  StreamingResampler,
  TARGET_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  wavDurationSeconds,
} from "@/lib/pcm-wav";

const tone = (freq: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate),
  );

/** Amplitude of a single frequency in a signal (Goertzel-style correlation), ignoring the filter's edge transients. */
function amplitudeAt(signal: Float32Array, freq: number, rate: number): number {
  const skip = Math.floor(signal.length * 0.1);
  let re = 0,
    im = 0,
    n = 0;
  for (let i = skip; i < signal.length - skip; i++, n++) {
    const a = (2 * Math.PI * freq * i) / rate;
    re += (signal[i] ?? 0) * Math.cos(a);
    im += (signal[i] ?? 0) * Math.sin(a);
  }
  return (2 * Math.hypot(re, im)) / n;
}

const run = (input: Float32Array, inRate: number, chunk = input.length) => {
  const r = new StreamingResampler(inRate);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(r.process(input.slice(i, i + chunk)));
  parts.push(r.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("StreamingResampler", () => {
  it.each([48000, 44100, 32000, 24000])(
    "keeps a 1 kHz tone at the same frequency and amplitude going %i -> 16 kHz",
    (rate) => {
      const out = run(tone(1000, rate, 1.5), rate);
      expect(amplitudeAt(out, 1000, TARGET_SAMPLE_RATE)).toBeGreaterThan(0.48); // input amplitude 0.5
      expect(amplitudeAt(out, 1000, TARGET_SAMPLE_RATE)).toBeLessThan(0.52);
      expect(amplitudeAt(out, 1300, TARGET_SAMPLE_RATE)).toBeLessThan(0.02); // nothing leaks to a neighbouring frequency
    },
  );

  it("anti-aliases: a 12 kHz tone (above the 8 kHz output Nyquist) is attenuated, not folded down to 4 kHz", () => {
    const out = run(tone(12000, 48000, 1.5), 48000);
    expect(amplitudeAt(out, 4000, TARGET_SAMPLE_RATE)).toBeLessThan(0.025); // 12 kHz would alias to 4 kHz (16k - 12k)
  });

  it("output length matches the duration (within one sample) at the target rate", () => {
    const out = run(tone(440, 44100, 2), 44100);
    expect(Math.abs(out.length - 2 * TARGET_SAMPLE_RATE)).toBeLessThanOrEqual(2);
  });

  it("is independent of how the input is chunked (browsers deliver 128-frame blocks)", () => {
    const input = tone(700, 48000, 0.75);
    const whole = run(input, 48000);
    for (const chunk of [128, 1000, 4096, 777]) {
      const parts = run(input, 48000, chunk);
      expect(parts.length).toBe(whole.length);
      let maxDiff = 0;
      for (let i = 0; i < whole.length; i++)
        maxDiff = Math.max(maxDiff, Math.abs((whole[i] ?? 0) - (parts[i] ?? 0)));
      expect(maxDiff).toBeLessThan(1e-5);
    }
  });

  it("passes silence through as silence and rejects invalid rates", () => {
    expect(Math.max(...run(new Float32Array(48000), 48000).map(Math.abs))).toBe(0);
    expect(() => new StreamingResampler(0)).toThrow();
  });

  it("handles input that is already 16 kHz without changing it materially", () => {
    const out = run(tone(1000, 16000, 1), 16000);
    expect(amplitudeAt(out, 1000, 16000)).toBeGreaterThan(0.48);
  });
});

describe("WAV encoding", () => {
  it("writes a valid mono 16 kHz 16-bit PCM header and exactly 44 + 2 x samples bytes", async () => {
    const chunks = [Int16Array.from([0, 1000, -1000]), Int16Array.from([32767, -32768])];
    const blob = encodeWav(chunks);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(WAV_HEADER_BYTES + 5 * 2);
    const bytes = await blobBytes(blob);
    expect(readWavHeader(bytes)).toEqual({
      channels: 1,
      sampleRate: 16000,
      bits: 16,
      dataBytes: 10,
    });
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(4, true)).toBe(36 + 10); // RIFF size
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(1000);
    expect(v.getInt16(WAV_HEADER_BYTES + 8, true)).toBe(-32768);
  });

  it("an empty recording is still a valid (header-only) file", async () => {
    const bytes = await blobBytes(encodeWav([]));
    expect(readWavHeader(bytes)?.dataBytes).toBe(0);
    expect(bytes.length).toBe(WAV_HEADER_BYTES);
  });

  it("10 minutes at 16 kHz mono 16-bit is about 19.2 MB, under the 32 MB transcription limit", () => {
    const bytes = WAV_HEADER_BYTES + 600 * TARGET_SAMPLE_RATE * 2;
    expect(bytes).toBe(19_200_044);
    expect(bytes).toBeLessThan(32 * 1024 * 1024);
  });

  it("floatToInt16 clamps and scales", () => {
    expect([...floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))]).toEqual([
      0, 32767, -32768, 32767, -32768, 16384,
    ]);
  });

  it("duration helper", () => {
    expect(wavDurationSeconds(32000)).toBe(2);
  });

  it("rejects a non-WAV buffer", () => {
    expect(readWavHeader(new Uint8Array(60))).toBeNull();
  });
});
