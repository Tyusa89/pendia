// Care Agent: answer validation and server-derived sources. Pure. A model answer is accepted ONLY if every rule below passes; any
// failure rejects the WHOLE answer (no salvaging, no raw model text shown) and the caller returns the fixed "unverified" outcome.
//
// What this proves: citation membership (exact pack-item ids), numeric/date/time traceability, forbidden advisory and dose
// language, plain text. What it does NOT prove: that every qualitative sentence is semantically grounded. The system prompt, the
// pack design and the golden-set tests remain mandatory controls; they must not be overstated.
import { agentAnswerZ, type AgentAnswer, type AgentSource } from "./contract";
import type { ContextPack, PackItem } from "./pack";

export type ValidationCode =
  | "not_json"
  | "bad_shape"
  | "refusal_inconsistent"
  | "not_plain_text"
  | "unknown_citation"
  | "uncited"
  | "ungrounded_value"
  | "advisory_language"
  | "dose_misstated";

export type ValidationResult =
  { ok: true; answer: AgentAnswer; sources: AgentSource[] } | { ok: false; code: ValidationCode };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase();

// ---- numbers, dates and times ----------------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  ene: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  diciembre: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const pad = (n: number) => String(n).padStart(2, "0");

// ---- spelled-out numbers (English and Spanish) -----------------------------------------------------------------------------------
// Word counts are converted to the same `N:` tokens as digits, so "three doses" is checked exactly like "3 doses". "one" / "uno" /
// "una" / "un" are deliberately NOT numbers on their own (no one, which one, un medicamento); "one" counts only directly before a
// record noun. "once" is skipped (English adverb). Unsupported constructions (thousands, fractions) are not parsed here.
const UNITS: Record<string, number> = {
  zero: 0,
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
  twice: 2,
  both: 2,
  dozen: 12,
  cero: 0,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  ambos: 2,
  ambas: 2,
  docena: 12,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
};
const SMALL: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
};
const RECORD_NOUN =
  "(?:doses?|dosis|medications?|medicines?|medicamentos?|visits?|visitas?|citas?|appointments?|handoffs?|relevos?|shifts?|turnos?|tasks?|tareas?|items?|records?|registros?|reports?|reportes?|informes?)";
const alt = (o: Record<string, number>) =>
  Object.keys(o)
    .sort((a, b) => b.length - a.length)
    .join("|");

function numberWordTokens(t: string, add: (n: number) => void): string {
  // compound: "twenty-one", "twenty one", "treinta y cinco" (tens + unit 1-9)
  t = t.replace(
    new RegExp(`(?<![a-z])(${alt(TENS)})(?:\\s+y\\s+|[\\s-]+)(${alt(SMALL)})(?![a-z])`, "g"),
    (_m, a: string, b: string) => {
      add(TENS[a]! + (b === "un" || b === "uno" || b === "una" ? 1 : SMALL[b]!));
      return " ";
    },
  );
  // "one"/"uno"/"una"/"un" before a record noun ("one dose", "una dosis")
  t = t.replace(
    new RegExp(`(?<![a-z])(one)(\\s+(?:${RECORD_NOUN}))(?![a-z])`, "g"),
    (_m, _w: string, noun: string) => {
      add(1);
      return ` ${noun} `;
    },
  );
  t = t.replace(
    new RegExp(`(?<![a-z])(${alt({ ...UNITS, ...TENS })})(?![a-z])`, "g"),
    (m: string) => {
      add((UNITS[m] ?? TENS[m])!);
      return " ";
    },
  );
  return t;
}

/** Canonical tokens: `D:MM-DD` dates, `T:HH:MM` times, `N:<number>` plain numbers. Works on English and Spanish text. */
export function extractNumericTokens(text: string): Set<string> {
  let t = ` ${fold(text)} `;
  const out = new Set<string>();
  const take = (re: RegExp, fn: (m: RegExpExecArray) => string[]) => {
    t = t.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      for (const tok of fn(m)) out.add(tok);
      return " ";
    });
  };
  t = numberWordTokens(t, (n) => out.add(`N:${n}`));
  const hour24 = (h: number, mer: string | undefined) => {
    if (!mer) return h;
    const pm = mer.startsWith("p");
    return pm ? (h % 12) + 12 : h % 12;
  };
  take(
    new RegExp(
      `\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(?:19|20)\\d{2})?`,
      "g",
    ),
    (m) => [`D:${pad(MONTHS[m[1]!]!)}-${pad(+m[2]!)}`],
  );
  take(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${MONTH_RE})\\b(?:\\s+(?:de\\s+)?(?:19|20)\\d{2})?`,
      "g",
    ),
    (m) => [`D:${pad(MONTHS[m[2]!]!)}-${pad(+m[1]!)}`],
  );
  take(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g, (m) => [`D:${m[2]}-${m[3]}`]);
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(?:19|20)?\d{2})?\b/g, (m) => {
    const a = +m[1]!;
    const b = +m[2]!;
    const r: string[] = [];
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) r.push(`D:${pad(a)}-${pad(b)}`);
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) r.push(`D:${pad(b)}-${pad(a)}`);
    return r;
  });
  take(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/g, (m) => [
    `T:${pad(hour24(+m[1]!, m[3]))}:${m[2]}`,
  ]);
  take(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/g, (m) => [`T:${pad(hour24(+m[1]!, m[2]))}:00`]);
  take(/\d+(?:[.,]\d+)?/g, (m) => [`N:${String(parseFloat(m[0]!.replace(",", ".")))}`]);
  return out;
}

// ---- language screens ------------------------------------------------------------------------------------------------------------

/** Advisory, treatment, diagnostic or interpretive phrasing is never allowed in an answer. English and Spanish. */
const ADVISORY = new RegExp(
  [
    "you should",
    "you shouldn't",
    "you must",
    "you need to",
    "i recommend",
    "i suggest",
    "i advise",
    "we recommend",
    "consider (taking|giving|stopping|increasing|decreasing|asking for)",
    "it('s| is) (safe|fine|ok|okay) to",
    "try (taking|giving)",
    "(take|give) \\d",
    "start (her|him|them) on",
    "stop (giving|taking)",
    "increase (the|her|his|their)",
    "decrease (the|her|his|their)",
    "diagnos",
    "likely (has|have|means)",
    "probably (has|have|is|means)",
    "suggests that",
    "indicates",
    "is normal",
    "is abnormal",
    "is dangerous",
    "is serious",
    "you can safely",
    "debe(ria)? (darle|tomar|dejar|suspender|aumentar|reducir)",
    "le recomiendo",
    "le sugiero",
    "te sugiero",
    "se recomienda",
    "considere (darle|tomar|suspender|aumentar)",
    "es seguro (darle|tomar)",
    "esta bien (darle|tomar)",
    "pruebe (a )?(darle|tomar)",
    "empiece a",
    "deje de (darle|tomar)",
    "aumente",
    "disminuya",
    "probablemente (tiene|es)",
    "es normal",
    "es anormal",
    "es peligroso",
    "es grave",
    "indica que",
  ].join("|"),
  "i",
);

/** "Not confirmed" must never become missed / skipped / not taken / noncompliance. English and Spanish. */
const DOSE_MISSTATED = new RegExp(
  [
    "missed",
    "skipped",
    "forgot",
    "forgotten",
    "didn't take",
    "did not take",
    "wasn't taken",
    "was not taken",
    "not taken",
    "non-?complian\\w*",
    "refused",
    "omiti\\w*",
    "salto",
    "saltaron",
    "olvid\\w*",
    "no (la |lo )?tomo",
    "no fue tomad\\w*",
    "no tomad\\w*",
    "incumpl\\w*",
    "rechaz\\w*",
    "falto",
  ].join("|"),
  "i",
);

/** Dose-instruction language: never allowed in `missing` (it describes absent records, not what anyone should do with a dose). */
const DOSE_INSTRUCTION = new RegExp(
  [
    "(give|giving|take|taking|skip|skipping|stop|stopping|double|increase|decrease|adjust|change|switch|withhold)\\b.{0,25}\\b(dose|dosage|medication|medicine|pill|insulin|mg|mcg)",
    "(dose|dosage).{0,20}\\b(should|must|needs? to|ought)\\b",
    "(dar|darle|tomar|saltar|suspender|duplicar|aumentar|reducir|cambiar|ajustar)\\b.{0,25}\\b(dosis|medicamento|medicina|pastilla|insulina|mg|mcg)",
  ].join("|"),
  "i",
);

/** Window / limit numbers the pack itself states (48 hours, 7 days, 3 handoffs): allowed in `missing`, which describes absent records. */
const PACK_WINDOW_NUMBERS = new Set(["N:48", "N:7", "N:3"]);

const sentencesOf = (text: string): string[] =>
  fold(text)
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * "Not confirmed" safety, per sentence. A sentence containing missed / skipped / not-taken language is acceptable only when every
 * dose it names resolves to a caregiver-reported "Not given" dose. A "Not given" citation elsewhere in the answer never excuses
 * the sentence. A medication with both a Not given and a Not confirmed dose among the citations must be disambiguated by the
 * dose's own date/time appearing in the sentence; otherwise the sentence is rejected. Sentences naming no medication are rejected
 * whenever any cited dose is Not confirmed (or nothing cited is Not given).
 */
function doseMisstated(text: string, cited: PackItem[]): boolean {
  const doses = cited.filter((c) => c.dose);
  const notGiven = doses.filter((c) => c.dose!.status === "not_given");
  for (const sentence of sentencesOf(text)) {
    if (!DOSE_MISSTATED.test(sentence)) continue;
    if (notGiven.length === 0) return true;
    const named = doses.filter((c) => sentence.includes(fold(c.dose!.medication)));
    if (named.length === 0) {
      if (doses.some((c) => c.dose!.status !== "not_given")) return true;
      continue;
    }
    const tokens = extractNumericTokens(sentence);
    const sD = [...tokens].filter((tk) => tk.startsWith("D:"));
    const sT = [...tokens].filter((tk) => tk.startsWith("T:"));
    const hasTime = (c: PackItem) => {
      if (sD.length === 0 && sT.length === 0) return false;
      const own = extractNumericTokens(c.label);
      const oD = [...own].filter((tk) => tk.startsWith("D:"));
      const oT = [...own].filter((tk) => tk.startsWith("T:"));
      return (
        (sD.length === 0 || oD.some((x) => sD.includes(x))) &&
        (sT.length === 0 || oT.some((x) => sT.includes(x)))
      );
    };
    for (const med of new Set(named.map((c) => fold(c.dose!.medication)))) {
      const same = doses.filter((c) => fold(c.dose!.medication) === med);
      const others = same.filter((c) => c.dose!.status !== "not_given");
      const ng = same.filter((c) => c.dose!.status === "not_given");
      if (ng.length === 0) return true;
      if (others.length > 0 && (!ng.some(hasTime) || others.some(hasTime))) return true;
    }
  }
  return false;
}

const PLAIN_TEXT_BAD =
  /[<>`]|https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i;

// ---- the validator ---------------------------------------------------------------------------------------------------------------

export function validateAgentAnswer(content: string, pack: ContextPack): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, code: "not_json" };
  }
  const parsed = agentAnswerZ.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "bad_shape" };
  const a = parsed.data;

  if (a.refusal !== null) {
    // The model declined: it must say nothing else. The SERVER substitutes canned copy and discards any model prose.
    if (a.answer !== "" || a.citations.length > 0 || a.missing.length > 0)
      return { ok: false, code: "refusal_inconsistent" };
    return { ok: true, answer: a, sources: [] };
  }
  if (a.answer.trim() === "") return { ok: false, code: "bad_shape" };
  if (PLAIN_TEXT_BAD.test(a.answer) || a.missing.some((m) => PLAIN_TEXT_BAD.test(m)))
    return { ok: false, code: "not_plain_text" };

  // Advice language is checked first so it is always reported as advice, whatever else is wrong with the answer.
  if (ADVISORY.test(fold(a.answer))) return { ok: false, code: "advisory_language" };

  // Citations: exact pack-item ids, deduplicated, in first-use order.
  const citations: string[] = [];
  for (const id of a.citations) {
    if (!pack.byId.has(id)) return { ok: false, code: "unknown_citation" };
    if (!citations.includes(id)) citations.push(id);
  }
  const cited = citations.map((id) => pack.byId.get(id)!);

  const tokens = extractNumericTokens(a.answer);
  if (citations.length === 0) {
    // A missing-information-only answer: no positive factual claim about a record, and `missing` names what is absent.
    if (a.missing.length === 0 || tokens.size > 0 || a.answer.length > 600)
      return { ok: false, code: "uncited" };
  } else {
    // Every number, date and time must come from a cited item, or be a count of cited items.
    const corpus = new Set<string>();
    for (const it of cited)
      for (const tok of extractNumericTokens(`${it.label} ${it.body}`)) corpus.add(tok);
    const counts = new Set<string>([String(cited.length)]);
    const perType = new Map<string, number>();
    for (const it of cited) perType.set(it.type, (perType.get(it.type) ?? 0) + 1);
    for (const n of perType.values()) counts.add(String(n));
    for (const tok of tokens) {
      if (corpus.has(tok)) continue;
      if (tok.startsWith("N:") && counts.has(tok.slice(2))) continue;
      return { ok: false, code: "ungrounded_value" };
    }
  }

  if (doseMisstated(a.answer, cited)) return { ok: false, code: "dose_misstated" };

  // `missing` entries describe absent records. They get the same grounding and language checks as the answer.
  if (a.missing.length > 0) {
    const missingCorpus = new Set<string>();
    for (const it of cited)
      for (const tok of extractNumericTokens(`${it.label} ${it.body}`)) missingCorpus.add(tok);
    const counts = new Set<string>([String(cited.length)]);
    for (const m of a.missing) {
      for (const tok of extractNumericTokens(m)) {
        if (missingCorpus.has(tok) || PACK_WINDOW_NUMBERS.has(tok)) continue;
        if (tok.startsWith("N:") && counts.has(tok.slice(2))) continue;
        return { ok: false, code: "ungrounded_value" };
      }
      const folded = fold(m);
      if (ADVISORY.test(folded) || DOSE_INSTRUCTION.test(folded))
        return { ok: false, code: "advisory_language" };
      if (doseMisstated(m, cited)) return { ok: false, code: "dose_misstated" };
    }
  }

  const sources: AgentSource[] = cited.map((it) => ({ id: it.id, label: it.label }));
  return { ok: true, answer: { ...a, citations }, sources };
}
