// Independent medication-value verification. Pure: no imports, no I/O, no model, no network.
//
// The model returns structured medication fields AND a quote from the doctor. This module reads the QUOTE on its own
// (medication name, doses, units, which dose is "before" and which is "after") and compares what it finds with the structured
// fields. Fail-closed in both directions: it can withhold "value-verified", it can never grant it without a quote that parses to
// the same values. It never removes an item: a mismatch only labels the item "unverified" so a person sees it and decides.
//
// WHAT "value-verified" MEANS (and nothing more): the medication name, the dose, the unit and the before -> after direction were
// each found in the doctor's quote and agree with the structured fields. Timing, frequency and the instruction as a whole are
// NOT verified; only that none of the extra words in the structured fields is missing from the quote.
//
// English only. Whole and decimal numbers, spelled-out numbers (zero to 999,999, "point five", "and a half", "half a"), and the
// units mg, mcg, g, mL, units, IU, tablets and capsules. Units are never converted into each other (0.5 mg vs 500 mcg is a mismatch,
// not a match). Anything the parser does not fully understand is "unverified", never guessed.

export const VERIFICATION_SCOPE =
  "medication name, dose, unit, and before/after direction" as const;

export const VERIFICATION_REASONS = [
  "verified",
  "medication_not_in_quote",
  "unparseable_value",
  "missing_value",
  "value_mismatch",
  "unit_mismatch",
  "direction_mismatch",
  "ambiguous_quote",
  "hedged_quote",
  "unsupported_detail",
] as const;
export type VerificationReason = (typeof VERIFICATION_REASONS)[number];
export type VerificationStatus = "value-verified" | "unverified";

export interface MedVerification {
  status: VerificationStatus;
  reason: VerificationReason;
  /** Always the same text: what "value-verified" covers. Nothing outside it was checked. */
  scope: typeof VERIFICATION_SCOPE;
}

export interface MedValueInput {
  medication: string;
  before: string;
  after: string;
}

const no = (reason: Exclude<VerificationReason, "verified">): MedVerification => ({
  status: "unverified",
  reason,
  scope: VERIFICATION_SCOPE,
});
const yes = (): MedVerification => ({
  status: "value-verified",
  reason: "verified",
  scope: VERIFICATION_SCOPE,
});

// ---------------------------------------------------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------------------------------------------------
interface Tok {
  t: "word" | "num" | "p";
  s: string;
  v: number;
  start: number;
  end: number;
}
interface Lexed {
  toks: Tok[];
  /** a comma or colon between digits that is not a thousands separator: "0,5", "20:00" */
  malformed: boolean;
}

function lex(raw: string): Lexed {
  const text = raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/[µμ]/g, "u");
  const re = /\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+|[a-z]+(?:'[a-z]+)*|[^\sa-z\d]/g;
  const toks: Tok[] = [];
  let malformed = false;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    const start = m.index ?? 0;
    const end = start + s.length;
    if (/^[\d.]/.test(s) && /\d/.test(s)) {
      toks.push({ t: "num", s, v: Number(s.replace(/,/g, "")), start, end });
    } else if (/^[a-z]/.test(s)) {
      toks.push({ t: "word", s, v: 0, start, end });
    } else {
      if (
        (s === "," || s === ":") &&
        /\d/.test(text[start - 1] ?? "") &&
        /\d/.test(text[end] ?? "")
      )
        malformed = true;
      toks.push({ t: "p", s, v: 0, start, end });
    }
  }
  return { toks, malformed };
}

const adjacent = (a: Tok | undefined, b: Tok | undefined) => !!a && !!b && a.end === b.start;

// ---------------------------------------------------------------------------------------------------------------------
// Numbers and units
// ---------------------------------------------------------------------------------------------------------------------
const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

type Last = "none" | "small" | "teen" | "tens" | "hundred" | "thousand";

/** "twenty-five", "one hundred and fifty", "a hundred", "two thousand". Returns null if no number word starts at i. */
function readSpelled(toks: Tok[], i: number): { value: number; next: number } | null {
  let k = i;
  let total = 0;
  let cur = 0;
  let last: Last = "none";
  let used = false;
  let good = i;
  if (
    toks[k]?.t === "word" &&
    toks[k]!.s === "a" &&
    /^(hundred|thousand)$/.test(toks[k + 1]?.s ?? "")
  ) {
    cur = 1;
    last = "small";
    k++;
  }
  while (k < toks.length) {
    const tk = toks[k]!;
    if (
      tk.t === "p" &&
      tk.s === "-" &&
      used &&
      adjacent(toks[k - 1], tk) &&
      adjacent(tk, toks[k + 1])
    ) {
      k++;
      continue;
    }
    if (tk.t !== "word") break;
    const w = tk.s;
    if (w === "and" && (last === "hundred" || last === "thousand")) {
      const nx = toks[k + 1]?.s ?? "";
      if (nx in SMALL || nx in TENS) {
        k++;
        continue;
      }
      break;
    }
    if (w in SMALL) {
      const n = SMALL[w]!;
      const ok =
        n === 0
          ? last === "none" && !used
          : n < 10
            ? last === "none" || last === "tens" || last === "hundred" || last === "thousand"
            : last === "none" || last === "hundred" || last === "thousand";
      if (!ok) break;
      cur += n;
      last = n < 10 ? "small" : "teen";
    } else if (w in TENS) {
      if (!(last === "none" || last === "hundred" || last === "thousand")) break;
      cur += TENS[w]!;
      last = "tens";
    } else if (w === "hundred") {
      if (!(last === "small" || last === "teen")) break;
      cur *= 100;
      last = "hundred";
    } else if (w === "thousand") {
      if (!(last === "small" || last === "teen" || last === "tens" || last === "hundred")) break;
      total += cur * 1000;
      cur = 0;
      last = "thousand";
    } else break;
    used = true;
    k++;
    good = k;
  }
  return used ? { value: total + cur, next: good } : null;
}

/** "point five", "point two five": the digits after "point". Null when no digit word follows. */
function readFraction(toks: Tok[], i: number): { digits: string; next: number } | null {
  if (toks[i]?.t !== "word" || toks[i]!.s !== "point") return null;
  let k = i + 1;
  let digits = "";
  while (toks[k]?.t === "word" && toks[k]!.s in DIGIT_WORDS) {
    digits += DIGIT_WORDS[toks[k]!.s];
    k++;
  }
  return digits ? { digits, next: k } : null;
}

/** A number of any written form starting at i: digits, spelled-out, "point five", "and a half", "half a". */
function readNumber(toks: Tok[], i: number): { value: number; next: number } | null {
  const tk = toks[i];
  if (!tk) return null;
  let value: number;
  let next: number;
  if (tk.t === "num") {
    value = tk.v;
    next = i + 1;
  } else if (tk.t === "word") {
    if (tk.s === "half") {
      return { value: 0.5, next: toks[i + 1]?.s === "a" ? i + 2 : i + 1 };
    }
    if (tk.s === "a" && toks[i + 1]?.s === "half") return { value: 0.5, next: i + 2 };
    if (tk.s === "a" && toks[i + 1]?.s === "quarter") return { value: 0.25, next: i + 2 };
    const frac = readFraction(toks, i);
    if (frac) return { value: Number(`0.${frac.digits}`), next: frac.next };
    const sp = readSpelled(toks, i);
    if (!sp) return null;
    value = sp.value;
    next = sp.next;
    const f = readFraction(toks, next);
    if (f) {
      value = Number(`${value}.${f.digits}`);
      next = f.next;
    }
  } else return null;
  if (toks[next]?.s === "and" && toks[next + 1]?.s === "a" && toks[next + 2]?.s === "half") {
    value += 0.5;
    next += 3;
  }
  return { value, next };
}

const UNIT_WORDS: Record<string, string> = {
  mg: "mg",
  mgs: "mg",
  milligram: "mg",
  milligrams: "mg",
  milligramme: "mg",
  milligrammes: "mg",
  mcg: "mcg",
  mcgs: "mcg",
  ug: "mcg",
  microgram: "mcg",
  micrograms: "mcg",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  unit: "unit",
  units: "unit",
  iu: "iu",
  tablet: "tablet",
  tablets: "tablet",
  tab: "tablet",
  tabs: "tablet",
  pill: "tablet",
  pills: "tablet",
  capsule: "capsule",
  capsules: "capsule",
};

function readUnit(toks: Tok[], i: number): { unit: string; next: number } | null {
  let k = i;
  if (
    toks[k]?.t === "p" &&
    toks[k]!.s === "-" &&
    adjacent(toks[k - 1], toks[k]) &&
    adjacent(toks[k], toks[k + 1])
  )
    k++;
  const w = toks[k];
  if (!w || w.t !== "word") return null;
  if (w.s === "international" && /^units?$/.test(toks[k + 1]?.s ?? ""))
    return { unit: "iu", next: k + 2 };
  const unit = UNIT_WORDS[w.s];
  return unit ? { unit, next: k + 1 } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dose mentions: a number followed by a unit ("20 mg", "twenty milligrams", "from ten to twenty milligrams")
// ---------------------------------------------------------------------------------------------------------------------
interface Dose {
  value: number;
  unit: string;
}
interface Mention extends Dose {
  from: number; // token index of the first token
  to: number; // token index after the last token (unit included)
}
interface Mentions {
  list: Mention[];
  /** a range ("10-20 mg"), a compound unit ("5 mg/ml") or similar: not one clean dose */
  ambiguous: boolean;
  /** numbers that carry no unit: [value, from, to] */
  bare: Array<{ value: number; from: number; to: number }>;
}

function findMentions(toks: Tok[]): Mentions {
  const list: Mention[] = [];
  const bare: Mentions["bare"] = [];
  let ambiguous = false;
  let i = 0;
  while (i < toks.length) {
    const n = readNumber(toks, i);
    if (!n) {
      i++;
      continue;
    }
    // "10-20 mg" or "ten-twenty": a range, not a change
    if (
      toks[n.next]?.s === "-" &&
      adjacent(toks[n.next - 1], toks[n.next]) &&
      readNumber(toks, n.next + 1)
    )
      ambiguous = true;
    const u = readUnit(toks, n.next);
    if (u) {
      if (toks[u.next]?.s === "/" && adjacent(toks[u.next - 1], toks[u.next])) ambiguous = true; // mg/day, mg/ml
      list.push({ value: n.value, unit: u.unit, from: i, to: u.next });
      i = u.next;
    } else {
      bare.push({ value: n.value, from: i, to: n.next });
      i = n.next;
    }
  }
  // "from ten to twenty milligrams": the first number shares the unit of the one after "to"
  for (const b of bare) {
    if (toks[b.to]?.s !== "to") continue;
    const m = list.find((x) => x.from === b.to + 1);
    if (m) list.push({ value: b.value, unit: m.unit, from: b.from, to: b.to });
  }
  list.sort((a, b) => a.from - b.from);
  return { list, ambiguous, bare };
}

const sameDose = (a: Dose, b: Dose) => a.unit === b.unit && Math.abs(a.value - b.value) < 1e-9;
const sameValue = (a: Dose, b: Dose) => Math.abs(a.value - b.value) < 1e-9;

// ---------------------------------------------------------------------------------------------------------------------
// Structured fields ("ten milligrams", "20 mg, once a day in the morning")
// ---------------------------------------------------------------------------------------------------------------------
const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "from",
  "per",
  "at",
  "in",
  "on",
  "and",
  "dose",
  "doses",
  "dosage",
]);

interface Field {
  dose: Dose;
  /** words and bare numbers in the field that are not part of the dose: they must also be in the quote */
  details: string[];
}

function parseField(text: string): Field | null {
  const { toks, malformed } = lex(text);
  if (malformed) return null;
  const m = findMentions(toks);
  if (m.ambiguous || m.list.length !== 1) return null;
  const only = m.list[0]!;
  const details: string[] = [];
  const used = new Set<number>();
  for (let k = only.from; k < only.to; k++) used.add(k);
  for (const b of m.bare) for (let k = b.from; k < b.to; k++) used.add(k);
  toks.forEach((tk, k) => {
    if (used.has(k) || tk.t !== "word" || STOP.has(tk.s)) return;
    details.push(tk.s);
  });
  for (const b of m.bare) details.push(`#${b.value}`);
  return { dose: { value: only.value, unit: only.unit }, details };
}

/** Letters only (parenthesised brand names dropped). Null when the name holds digits or nothing usable. */
function medicationWords(name: string): string[] | null {
  const { toks } = lex(name.replace(/\([^)]*\)/g, " "));
  if (toks.some((t) => t.t === "num")) return null;
  const words = toks.filter((t) => t.t === "word").map((t) => t.s);
  return words.length ? words : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------------------------------------------------
const HEDGES = new Set([
  "not",
  "no",
  "never",
  "hold",
  "stop",
  "stopping",
  "cancel",
  "skip",
  "avoid",
  "maybe",
  "might",
  "perhaps",
  "possibly",
  "probably",
  "consider",
  "considering",
  "thinking",
  "if",
  "unless",
  "whether",
  "could",
  "may",
  "depends",
  "depending",
  "either",
  "or",
  "unsure",
  "unclear",
]);

function splitClauses(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const tk of toks) {
    cur.push(tk);
    if (tk.t === "p" && /^[.?!;]$/.test(tk.s)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const isHedged = (clause: Tok[]) =>
  clause.some(
    (t) =>
      (t.t === "p" && t.s === "?") || (t.t === "word" && (HEDGES.has(t.s) || /n't$/.test(t.s))),
  );

/** Token positions (within the clause) where the medication's words appear in a row (punctuation inside the run is allowed). */
function findMedication(clause: Tok[], words: string[]): Array<{ from: number; to: number }> {
  const idx: number[] = [];
  clause.forEach((t, k) => {
    if (t.t === "word") idx.push(k);
  });
  const hits: Array<{ from: number; to: number }> = [];
  for (let a = 0; a + words.length <= idx.length; a++) {
    if (words.every((w, j) => clause[idx[a + j]!]!.s === w))
      hits.push({ from: idx[a]!, to: idx[a + words.length - 1]! + 1 });
  }
  return hits;
}

/** The medication sits in a list or a combination product: "Lisinopril and metformin", "lisinopril-HCTZ", "Lisinopril/HCTZ". */
function inListOrCombination(clause: Tok[], hit: { from: number; to: number }): boolean {
  const before = clause[hit.from - 1];
  const after = clause[hit.to];
  const joiner = (t: Tok | undefined) => !!t && t.t === "word" && /^(and|plus|with)$/.test(t.s);
  if (joiner(before) || joiner(after)) return true;
  if (
    after?.t === "p" &&
    /^[-/]$/.test(after.s) &&
    adjacent(clause[hit.to - 1], after) &&
    clause[hit.to + 1]?.t === "word"
  )
    return true;
  const prev = clause[hit.from - 1];
  if (
    prev?.t === "p" &&
    /^[-/]$/.test(prev.s) &&
    adjacent(prev, clause[hit.from]) &&
    clause[hit.from - 2]?.t === "word"
  )
    return true;
  return false;
}

type ClauseRead =
  | { kind: "pair"; before: Dose; after: Dose }
  | { kind: "none" }
  | { kind: "partial" }
  | { kind: "ambiguous" };

const FORWARD = [["to"], ["up", "to"], ["down", "to"]];
const REVERSED = [
  ["from"],
  ["up", "from"],
  ["down", "from"],
  ["instead", "of"],
  ["rather", "than"],
];
const sameWords = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

function readClause(clause: Tok[]): ClauseRead {
  const m = findMentions(clause);
  if (m.ambiguous) return { kind: "ambiguous" };
  if (m.list.length === 0) return { kind: "none" };
  if (m.list.length === 1) return { kind: "partial" };
  if (m.list.length > 2) return { kind: "ambiguous" };
  const [a, b] = m.list as [Mention, Mention];
  const between = clause.slice(a.to, b.from);
  if (between.some((t) => t.t === "p" && t.s !== ",")) return { kind: "ambiguous" };
  const words = between.filter((t) => t.t === "word").map((t) => t.s);
  if (FORWARD.some((f) => sameWords(f, words)))
    return {
      kind: "pair",
      before: { value: a.value, unit: a.unit },
      after: { value: b.value, unit: b.unit },
    };
  if (REVERSED.some((f) => sameWords(f, words)) && clause[a.from - 1]?.s === "to")
    return {
      kind: "pair",
      before: { value: b.value, unit: b.unit },
      after: { value: a.value, unit: a.unit },
    };
  return { kind: "ambiguous" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------------------------------------------------
export function verifyMedValue(item: MedValueInput, quote: string): MedVerification {
  try {
    return verify(item, quote);
  } catch {
    return no("unparseable_value"); // anything unexpected is a refusal to verify, never a pass
  }
}

function verify(item: MedValueInput, quote: string): MedVerification {
  const name = medicationWords(item.medication);
  const before = parseField(item.before);
  const after = parseField(item.after);
  if (!name || !before || !after) return no("unparseable_value");

  const q = lex(quote);
  if (q.malformed) return no("ambiguous_quote");

  const clauses = splitClauses(q.toks);
  const reads: ClauseRead[] = [];
  let found = false;
  for (const clause of clauses) {
    const hits = findMedication(clause, name);
    if (!hits.length) continue;
    found = true;
    if (isHedged(clause)) return no("hedged_quote");
    if (hits.some((h) => inListOrCombination(clause, h))) return no("ambiguous_quote");
    reads.push(readClause(clause));
  }
  if (!found) return no("medication_not_in_quote");
  if (reads.some((r) => r.kind === "ambiguous")) return no("ambiguous_quote");

  const pairs = reads.filter((r): r is Extract<ClauseRead, { kind: "pair" }> => r.kind === "pair");
  if (pairs.length === 0) return no("missing_value");
  const first = pairs[0]!;
  if (pairs.some((p) => !sameDose(p.before, first.before) || !sameDose(p.after, first.after)))
    return no("ambiguous_quote");

  const agree = sameDose(first.before, before.dose) && sameDose(first.after, after.dose);
  if (!agree) {
    if (sameDose(first.before, after.dose) && sameDose(first.after, before.dose))
      return no("direction_mismatch");
    const valuesMatch = sameValue(first.before, before.dose) && sameValue(first.after, after.dose);
    return no(valuesMatch ? "unit_mismatch" : "value_mismatch");
  }

  // Every other word or number in the structured fields must also be in the quote (frequency, schedule, form...).
  const seen = new Set<string>();
  for (const t of q.toks) {
    if (t.t === "word") seen.add(t.s);
    else if (t.t === "num") seen.add(`#${t.v}`);
  }
  const qm = findMentions(q.toks);
  for (const n of [...qm.list, ...qm.bare]) seen.add(`#${n.value}`);
  for (const w of [...before.details, ...after.details])
    if (!seen.has(w)) return no("unsupported_detail");

  return yes();
}
