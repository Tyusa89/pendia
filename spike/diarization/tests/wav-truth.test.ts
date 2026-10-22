// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LEAK_PHRASES, parseScript, patientTurns, tokenize, TRAP_TURNS } from "../groundtruth.ts";
import { FRAME_BYTES } from "../protocol.ts";
import { makeToneWav, parseWav, toFrames } from "../wav.ts";
import { script } from "./helpers.ts";

describe("fixture ground truth", () => {
  const t = script();
  it("parses the 12 turns, doctor/patient roles and overlaps from the fixture", () => {
    expect(t).toHaveLength(12);
    expect(t.map((x) => x.who).join("")).toBe("DPDPDDPDDPDP");
    expect(patientTurns(t)).toEqual([2, 4, 7, 10, 12]);
    expect(t.filter((x) => x.overlap).map((x) => x.n)).toEqual([7, 8]);
    expect(t[6]!.text).not.toContain("~");
  });
  it("the trap turns and their leak phrases are really in the fixture", () => {
    expect([...TRAP_TURNS]).toEqual([2, 7, 10]);
    for (const n of TRAP_TURNS) {
      const turn = t.find((x) => x.n === n)!;
      expect(turn.who).toBe("P");
      expect(tokenize(turn.text).join(" ")).toContain(tokenize(LEAK_PHRASES[n]!).join(" "));
    }
  });
  it("rejects a file with no table", () => {
    expect(() => parseScript("# nothing")).toThrow();
  });
  it("normalises spoken-number variants", () => {
    expect(tokenize("10 mg of Lisinopril, 20 mg")).toEqual([
      "ten",
      "milligrams",
      "of",
      "lisinopril",
      "twenty",
      "milligrams",
    ]);
  });
});

describe("wav reading and framing", () => {
  it("reads a mono 16 kHz 16-bit WAV and reports its duration", () => {
    const p = parseWav(makeToneWav(1.5));
    expect(p.durationS).toBeCloseTo(1.5, 3);
  });
  it("rejects stereo, wrong rate, wrong depth, and non-WAV input", () => {
    const base = makeToneWav(0.2);
    const mod = (off: number, v: number, size: 2 | 4) => {
      const c = new Uint8Array(base);
      const dv = new DataView(c.buffer);
      if (size === 2) dv.setUint16(off, v, true);
      else dv.setUint32(off, v, true);
      return c;
    };
    expect(() => parseWav(mod(22, 2, 2))).toThrow(/mono/);
    expect(() => parseWav(mod(24, 44100, 4))).toThrow(/16000/);
    expect(() => parseWav(mod(34, 8, 2))).toThrow(/16-bit/);
    expect(() => parseWav(new Uint8Array(100))).toThrow(/Not a WAV/);
  });
  it("splits into exact 2560-byte frames and zero-pads only the last one", () => {
    const pcm = parseWav(makeToneWav(0.25)).data; // 4000 samples = 8000 bytes = 3.125 frames
    const frames = toFrames(pcm);
    expect(frames).toHaveLength(4);
    for (const f of frames) expect(f.byteLength).toBe(FRAME_BYTES);
    expect(frames[3]!.subarray(8000 - 3 * FRAME_BYTES).every((b) => b === 0)).toBe(true);
  });
});
