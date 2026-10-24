// Known-answer helper for the Spark development check only. Pure: no imports, no I/O.
// It reads the dose written in ONE medication field ("10 mg", "ten milligrams", "Twenty (20) mg"). It decides nothing about
// whether an extracted item is accepted: that is the contract's job (doctor turn + verbatim quote). This only answers
// "does the item that was accepted say the known change?" so the dev page can show a fair result.
//
// Deliberately narrow: whole numbers followed by mg/milligram(s), plus the words "ten" and "twenty". Decimals, times,
// numbers without a unit, a word that disagrees with its bracketed digits, and fields holding two different doses are
// all "no single dose" (null), never a guess.
const WORD_VALUE: Record<string, number> = { ten: 10, twenty: 20 };
const UNIT = "(?:mg|milligrams?)\\b";
// a number with its unit; not glued to a longer token (so "120", "0.20", "20:00" and "x20mg" never read as 20)
const DIGITS = new RegExp(`(?<![\\w.,:])(\\d+(?:[.,:]\\d+)*)\\s*-?\\s*${UNIT}`, "gi");
const WORDS = new RegExp(
  `(?<![\\w])(ten|twenty)(?:\\s*\\(\\s*(\\d+)\\s*\\))?\\s*-?\\s*${UNIT}`,
  "gi",
);

/** The single whole-number dose in milligrams that `text` states, or null. */
export function parseDoseMg(text: string): number | null {
  const doses = new Set<number>();
  for (const m of text.matchAll(DIGITS)) {
    if (!/^\d+$/.test(m[1]!)) return null; // 0.20, 1,5 or 20:00 style: ambiguous
    doses.add(Number(m[1]));
  }
  for (const m of text.matchAll(WORDS)) {
    const value = WORD_VALUE[m[1]!.toLowerCase()]!;
    if (m[2] !== undefined && Number(m[2]) !== value) return null; // "Twenty (10) mg": contradicts itself
    doses.add(value);
  }
  return doses.size === 1 ? [...doses][0]! : null;
}

const plainName = (s: string) =>
  s
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .toLowerCase();

/** The known answer of the fictional visit: Lisinopril 10 mg -> 20 mg. Units, medication and direction must all match. */
export function isLisinoprilTenToTwenty(m: {
  medication: string;
  before: string;
  after: string;
}): boolean {
  return (
    plainName(m.medication) === "lisinopril" &&
    parseDoseMg(m.before) === 10 &&
    parseDoseMg(m.after) === 20
  );
}
