// Ground truth for the spike, parsed from fixtures/spike/two-voice-script.md (the single source of truth).
export type Role = "D" | "P";

export interface Turn {
  n: number;
  who: Role;
  /** the spoken line without the ~ overlap markers */
  text: string;
  /** the line contains a deliberate overlap / interruption (~) */
  overlap: boolean;
}

export function parseScript(markdown: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([DP])\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const raw = m[3]!;
    turns.push({
      n: Number(m[1]),
      who: m[2] as Role,
      text: raw.replace(/~/g, "").replace(/\s+/g, " ").trim(),
      overlap: raw.includes("~"),
    });
  }
  if (turns.length === 0) throw new Error("No script rows found.");
  return turns;
}

export const patientTurns = (t: Turn[]) => t.filter((x) => x.who === "P").map((x) => x.n);

/** The fixture calls out turns 2, 7 and 10 as the leakage traps (a dose, and two instruction-sounding sentences). */
export const TRAP_TURNS = [2, 7, 10] as const;

/** The instruction-bearing phrase inside each trap turn. If these words are attributed to the doctor, that is leakage. */
export const LEAK_PHRASES: Record<number, string> = {
  2: "ten milligrams every morning",
  7: "tell him to call the lab first",
  10: "call the office if my ankles swell",
};

const NUMBER_WORDS: Record<string, string> = {
  "10": "ten",
  "20": "twenty",
  "2": "two",
  mg: "milligrams",
  milligram: "milligrams",
};

/** Lowercased word tokens, punctuation removed, a few spoken-number variants unified so "10 mg" matches "ten milligrams". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}
