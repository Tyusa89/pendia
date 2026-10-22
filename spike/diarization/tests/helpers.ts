import { readFileSync } from "node:fs";
import type { Segment } from "../events.ts";
import { parseScript, type Turn } from "../groundtruth.ts";

export const script = (): Turn[] =>
  parseScript(
    readFileSync(new URL("../../../fixtures/spike/two-voice-script.md", import.meta.url), "utf8"),
  );

/** One segment per turn, labelled by `label(turn)`, with plausible times. */
export function segmentsFor(
  truth: Turn[],
  label: (t: Turn) => string,
  text: (t: Turn) => string = (t) => t.text,
): Segment[] {
  let at = 0.5;
  return truth.map((t) => {
    const dur = Math.max(1.5, t.text.split(" ").length * 0.38);
    const s = { speaker: label(t), text: text(t), startS: at, endS: at + dur, source: "test" };
    at += dur + 0.4;
    return s;
  });
}
export const byRole = (t: Turn) => (t.who === "D" ? "A" : "B");
