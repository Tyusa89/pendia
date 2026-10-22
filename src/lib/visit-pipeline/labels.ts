// Wording the screens use for provenance and safety. Labels come from the result's provenance, never from a screen's own
// assumption, so a demo result cannot be shown as live and a live result cannot be shown as a demo.
import type { Provenance } from "./types";

export const DEMO_BANNER = {
  title: "DEMO MODE",
  lines: ["Prerecorded synthetic data", "No live Meta AI", "No real SMS", "Nothing is saved"],
} as const;
export const DEMO_BANNER_TEXT = [DEMO_BANNER.title, ...DEMO_BANNER.lines].join(" · ");

export const NOT_MEDICAL_ADVICE = "Not medical advice. Check with your doctor or pharmacist.";

export function provenanceLabel(p: Provenance): string {
  return p.mode === "demo"
    ? `${p.note} · not processed by live AI`
    : `Live · ${p.model} · ${p.generatedAt}`;
}
