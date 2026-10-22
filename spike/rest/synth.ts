// Builds the synthetic two-voice conversation locally. No network, no paid service, no real recording:
//   * the 12 lines come from fixtures/spike/two-voice-script.md (the same ground truth the scorer reads);
//   * each line is spoken by ffmpeg's built-in "flite" synthesizer, one voice for Dr. Patel and a different one for Rosa;
//   * the lines are placed on a timeline with small, fixed (seeded) pauses, and the lines marked "~" in the script overlap
//     for real (their samples are summed), so the clip contains genuine simultaneous speech;
//   * the layout is written to a timings file so seconds-weighted scoring has exact ground truth.
// The result is deterministic for a given ffmpeg/flite build. flite voices are robotic: a pass here shows the plumbing and
// scoring work, not how real doctors and patients will sound.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role, Turn } from "../diarization/groundtruth.ts";

export const SAMPLE_RATE = 16000;
/** Distinct synthetic voices (ffmpeg flite): a male voice for the doctor and a female voice for the patient. */
export const VOICES: Record<Role, string> = { D: "rms", P: "slt" };
export const LEAD_IN_S = 0.5;
export const TAIL_S = 0.6;
export const OVERLAP_S = 1.2;
const PEAK = 0.5 * 32767;

export type Tts = (text: string, voice: string) => Promise<Int16Array>;

/** ffmpeg's `flite` source, text passed through a temp file (no shell, no escaping problems). */
export const ffmpegFliteTts: Tts = async (text, voice) => {
  if (!/^[a-z0-9]{2,12}$/.test(voice)) throw new Error("Unexpected voice name.");
  const dir = await mkdtemp(join(tmpdir(), "pendia-tts-"));
  try {
    if (!/^[A-Za-z0-9_/.-]+$/.test(dir)) throw new Error("Unexpected temp path.");
    const file = join(dir, "line.txt");
    await writeFile(file, text, { mode: 0o600 });
    const out = await new Promise<Buffer>((resolve, reject) =>
      execFile(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `flite=textfile=${file}:voice=${voice}`,
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "1",
          "-f",
          "s16le",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
        (err, stdout) =>
          err ? reject(new Error("ffmpeg/flite failed (is libflite available?)")) : resolve(stdout),
      ),
    );
    if (out.byteLength < 2) throw new Error("The synthesizer produced no audio.");
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength - (out.byteLength % 2));
    const pcm = new Int16Array(view.byteLength / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
    return pcm;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Small deterministic generator so the pauses are the same on every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function normalize(a: Int16Array): Int16Array {
  let peak = 0;
  for (const v of a) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return a;
  const k = PEAK / peak;
  const out = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i]! * k);
  return out;
}

export interface Layout {
  pcm: Int16Array;
  /** turn number -> [start, end] seconds */
  timings: Record<string, [number, number]>;
  seconds: number;
}

/**
 * Places the lines in order. Two consecutive lines by different speakers that are BOTH marked "~" in the script overlap
 * by up to OVERLAP_S (never more than half of the shorter line); every other pair is separated by a 0.4-0.8 s pause.
 */
export function layoutTurns(turns: Turn[], audio: Int16Array[], seed = 1234): Layout {
  if (turns.length !== audio.length) throw new Error("One audio clip per turn is required.");
  const rand = lcg(seed);
  const starts: number[] = [];
  const ends: number[] = [];
  let latestEnd = LEAD_IN_S;
  turns.forEach((t, i) => {
    const dur = audio[i]!.length / SAMPLE_RATE;
    let start = LEAD_IN_S;
    if (i > 0) {
      const prev = turns[i - 1]!;
      const prevDur = audio[i - 1]!.length / SAMPLE_RATE;
      if (t.overlap && prev.overlap && t.who !== prev.who) {
        start = ends[i - 1]! - Math.min(OVERLAP_S, 0.5 * Math.min(prevDur, dur));
      } else {
        start = latestEnd + 0.4 + 0.4 * rand();
      }
    }
    starts.push(start);
    ends.push(start + dur);
    latestEnd = Math.max(latestEnd, start + dur);
  });
  const total = Math.ceil((latestEnd + TAIL_S) * SAMPLE_RATE);
  const acc = new Int32Array(total);
  audio.forEach((a, i) => {
    const off = Math.round(starts[i]! * SAMPLE_RATE);
    for (let k = 0; k < a.length; k++) acc[off + k] = acc[off + k]! + a[k]!;
  });
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) pcm[i] = Math.max(-32768, Math.min(32767, acc[i]!));
  const timings: Record<string, [number, number]> = {};
  turns.forEach((t, i) => {
    timings[String(t.n)] = [
      Math.round(starts[i]! * 1000) / 1000,
      Math.round(ends[i]! * 1000) / 1000,
    ];
  });
  return { pcm, timings, seconds: total / SAMPLE_RATE };
}

/** Mono 16-bit PCM WAV with a 44-byte header. */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i]!, true);
  return out;
}

export async function generateConversation(turns: Turn[], tts: Tts = ffmpegFliteTts) {
  const clips: Int16Array[] = [];
  for (const t of turns) clips.push(normalize(await tts(t.text, VOICES[t.who])));
  const layout = layoutTurns(turns, clips);
  return { wav: encodeWav(layout.pcm), timings: layout.timings, seconds: layout.seconds };
}
