// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { script } from "../../diarization/tests/helpers.ts";
import {
  encodeWav,
  ffmpegFliteTts,
  generateConversation,
  layoutTurns,
  SAMPLE_RATE,
  VOICES,
} from "../synth.ts";
import { validateWavForUpload } from "../wav-check.ts";

const truth = script();
/** A fake synthesizer: a tone whose length follows the word count, so no ffmpeg is needed. */
const fakeTts = vi.fn(async (text: string, voice: string) => {
  const n = Math.round(text.split(/\s+/).length * 0.35 * SAMPLE_RATE);
  const hz = voice === VOICES.D ? 120 : 220;
  return Int16Array.from({ length: n }, (_, i) =>
    Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)),
  );
});

describe("synthetic conversation", () => {
  it("uses the script as ground truth: 12 turns, speakers D and P, overlap on turns 7 and 8 only", () => {
    expect(truth).toHaveLength(12);
    expect(truth.filter((t) => t.overlap).map((t) => t.n)).toEqual([7, 8]);
    expect(new Set(truth.map((t) => t.who))).toEqual(new Set(["D", "P"]));
  });
  it("speaks each role with its own distinct voice and the ground-truth text (no markers)", async () => {
    fakeTts.mockClear();
    await generateConversation(truth, fakeTts);
    expect(fakeTts).toHaveBeenCalledTimes(12);
    expect(VOICES.D).not.toBe(VOICES.P);
    truth.forEach((t, i) => {
      expect(fakeTts.mock.calls[i]![0]).toBe(t.text);
      expect(fakeTts.mock.calls[i]![0]).not.toContain("~");
      expect(fakeTts.mock.calls[i]![1]).toBe(VOICES[t.who]);
    });
  });
  it("produces a valid upload: mono 16-bit 16 kHz WAV under two minutes", async () => {
    const g = await generateConversation(truth, fakeTts);
    const info = validateWavForUpload(g.wav);
    expect(info.sampleRate).toBe(16000);
    expect(info.seconds).toBeLessThan(120);
    expect(info.seconds).toBeCloseTo(g.seconds, 1);
  });
  it("really overlaps turns 7 and 8 (by at most 1.2 s) and separates every other pair", async () => {
    const { timings } = await generateConversation(truth, fakeTts);
    const t = (n: number) => timings[String(n)]!;
    const overlap = t(7)[1] - t(8)[0];
    expect(overlap).toBeGreaterThan(0.3);
    expect(overlap).toBeLessThanOrEqual(1.2 + 0.001);
    for (let n = 1; n < 12; n++) {
      if (n === 7) continue;
      const gap = t(n + 1)[0] - t(n)[1];
      expect(gap).toBeGreaterThanOrEqual(0.4 - 0.002);
      expect(gap).toBeLessThanOrEqual(0.8 + 0.002);
    }
  });
  it("is deterministic: the same inputs give byte-identical audio and timings", async () => {
    const a = await generateConversation(truth, fakeTts);
    const b = await generateConversation(truth, fakeTts);
    expect(Buffer.from(a.wav).equals(Buffer.from(b.wav))).toBe(true);
    expect(a.timings).toEqual(b.timings);
  });
  it("sums overlapping samples without wrapping around", () => {
    const loud = Int16Array.from({ length: SAMPLE_RATE * 3 }, () => 30000);
    const two = truth.slice(6, 8); // turns 7 and 8
    const l = layoutTurns(two, [loud, loud]);
    expect(Math.max(...l.pcm)).toBe(32767);
    expect(Math.min(...l.pcm)).toBeGreaterThanOrEqual(0);
  });
  it("rejects a mismatch between turns and clips", () => {
    expect(() => layoutTurns(truth, [new Int16Array(10)])).toThrow();
  });
  it("writes a standard 44-byte RIFF header", () => {
    const w = encodeWav(new Int16Array(16000));
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe("RIFF");
    expect(w.byteLength).toBe(44 + 32000);
  });
});

const hasFlite = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).includes(
      "flite",
    );
  } catch {
    return false;
  }
})();

describe("local synthesizer (ffmpeg flite)", () => {
  it.runIf(hasFlite)("speaks a short line to 16 kHz mono samples, locally", async () => {
    const pcm = await ffmpegFliteTts("Good morning, Rosa.", VOICES.D);
    expect(pcm.length / SAMPLE_RATE).toBeGreaterThan(0.5);
    expect(pcm.some((v) => v !== 0)).toBe(true);
  });
  it("refuses an unexpected voice name without running anything", async () => {
    await expect(ffmpegFliteTts("hi", "x;rm -rf /")).rejects.toThrow();
  });
});
