// @vitest-environment node
// Independent medication-value verification: the verifier reads the doctor's QUOTE on its own and compares it with the structured
// fields. Offline, pure. The safety property under test: "value-verified" is never granted without a quote that parses to the same
// medication, doses, units and direction; every doubt is "unverified".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VERIFICATION_REASONS,
  VERIFICATION_SCOPE,
  verifyMedValue,
  type VerificationReason,
} from "@/lib/visit-pipeline/med-verifier";

const Q =
  "I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow.";
const item = (over: Partial<{ medication: string; before: string; after: string }> = {}) => ({
  medication: "Lisinopril",
  before: "ten milligrams",
  after: "twenty milligrams",
  ...over,
});
const status = (i: ReturnType<typeof item>, quote: string) => verifyMedValue(i, quote);
const reasonOf = (i: ReturnType<typeof item>, quote: string): VerificationReason =>
  verifyMedValue(i, quote).reason;
const verified = (i: ReturnType<typeof item>, quote: string) =>
  verifyMedValue(i, quote).status === "value-verified";

describe("what is verified", () => {
  it("the live Oct 24 answer: spelled-out values from a spelled-out quote", () => {
    expect(status(item(), Q)).toEqual({
      status: "value-verified",
      reason: "verified",
      scope: VERIFICATION_SCOPE,
    });
  });
  it("the scope text names exactly name, dose, unit and direction, and never timing or frequency", () => {
    expect(VERIFICATION_SCOPE).toBe("medication name, dose, unit, and before/after direction");
    expect(VERIFICATION_SCOPE).not.toMatch(/timing|frequen|schedule|instruction/i);
  });
  it.each([
    ["digits in the fields, words in the quote", { before: "10 mg", after: "20 mg" }, Q],
    [
      "words in the fields, digits in the quote",
      item(),
      "Increase Lisinopril from 10 mg to 20 mg.",
    ],
    ["no space: 20mg", { before: "10mg", after: "20mg" }, "Lisinopril from 10mg to 20mg"],
    ["hyphen: 20-mg", { before: "10-mg", after: "20-mg" }, "Lisinopril from 10 mg to 20 mg"],
    [
      "milligram units abbreviated either way",
      { before: "10 milligrams", after: "20 mg" },
      "Lisinopril from 10 mg to 20 milligrams",
    ],
    [
      "shared unit: from ten to twenty milligrams",
      item(),
      "Raise the Lisinopril from ten to twenty milligrams.",
    ],
    ["mixed case and brand in brackets", { medication: "LISINOPRIL (Zestril)" }, Q],
    [
      "the doctor says the new dose first: to X from Y",
      item(),
      "I'm moving your Lisinopril to twenty milligrams from ten milligrams.",
    ],
    ["up from", item(), "Lisinopril goes to twenty milligrams, up from ten milligrams."],
    ["instead of", item(), "Lisinopril to twenty milligrams instead of ten milligrams."],
    [
      "a decrease",
      { before: "twenty milligrams", after: "ten milligrams" },
      "Lower the Lisinopril from twenty milligrams to ten milligrams.",
    ],
  ])("verifies: %s", (_n, over, quote) => {
    const i =
      "medication" in over || "before" in over || "after" in over ? { ...item(), ...over } : item();
    // the "to X from Y" and "instead of" cases name the medication after the doses, so they need a sentence that holds both
    expect(verified(i, quote)).toBe(true);
  });
});

describe("spelled-out numbers beyond ten and twenty", () => {
  const swap = (before: string, after: string, quote: string) =>
    verified({ ...item(), before, after }, quote);
  it.each([
    ["twenty-five", "25"],
    ["twenty five", "25"],
    ["thirty", "30"],
    ["forty", "40"],
    ["forty-five", "45"],
    ["fifty", "50"],
    ["seventy-five", "75"],
    ["ninety", "90"],
    ["one hundred", "100"],
    ["a hundred", "100"],
    ["one hundred and fifty", "150"],
    ["two hundred", "200"],
    ["two hundred fifty", "250"],
    ["five hundred", "500"],
    ["one thousand", "1000"],
    ["fifteen hundred", "1500"],
    ["eleven", "11"],
    ["nineteen", "19"],
  ])("%s milligrams = %s mg", (words, digits) => {
    const quote = `Lisinopril from ten milligrams to ${words} milligrams.`;
    expect(swap("10 mg", `${digits} mg`, quote)).toBe(true);
    expect(swap("10 mg", `${Number(digits) + 5} mg`, quote)).toBe(false);
  });
  it("1,000 mg written with a thousands separator", () => {
    expect(
      swap(
        "500 mg",
        "1,000 mg",
        "Lisinopril from five hundred milligrams to one thousand milligrams.",
      ),
    ).toBe(true);
  });
  it("does not run two numbers together: 'ten twenty' is not 30", () => {
    expect(swap("10 mg", "30 mg", "Lisinopril from ten milligrams to ten twenty milligrams.")).toBe(
      false,
    );
  });
});

describe("decimal doses", () => {
  const dec = (before: string, after: string, quote: string) =>
    verified({ ...item(), before, after }, quote);
  it.each([
    ["0.5 mg", "zero point five milligrams"],
    ["0.5 mg", "point five milligrams"],
    ["0.5 mg", "half a milligram"],
    ["0.25 mg", "a quarter milligram"],
    ["0.25 mg", "zero point two five milligrams"],
    ["2.5 mg", "two point five milligrams"],
    ["2.5 mg", "two and a half milligrams"],
    ["0.5 mg", ".5 mg"],
    ["2.5 mg", "2.5 milligrams"],
  ])("%s = %s", (digits, words) => {
    expect(dec("1 mg", digits, `Lisinopril from one milligram to ${words}.`)).toBe(true);
  });
  it.each([
    ["5 mg", "0.5 milligrams"],
    ["0.5 mg", "5 milligrams"],
    ["0.05 mg", "0.5 milligrams"],
    ["25 mg", "2.5 milligrams"],
    ["0.5 mg", "0.25 milligrams"],
    ["20 mg", "0.20 milligrams"],
    ["2 mg", "2.5 milligrams"],
  ])("%s is NOT %s", (digits, quoteDose) => {
    expect(dec("1 mg", digits, `Lisinopril from one milligram to ${quoteDose}.`)).toBe(false);
  });
  it("a European-style decimal comma is ambiguous, never read as 1.5 or 15", () => {
    expect(
      reasonOf({ ...item(), before: "1 mg", after: "1,5 mg" }, "Lisinopril from 1 mg to 1,5 mg."),
    ).toBe("unparseable_value");
    expect(
      reasonOf({ ...item(), before: "1 mg", after: "15 mg" }, "Lisinopril from 1 mg to 1,5 mg."),
    ).toBe("ambiguous_quote");
  });
});

describe("a correct quote with the wrong dose, unit or direction", () => {
  it.each([
    ["wrong new dose", { after: "thirty milligrams" }, "value_mismatch"],
    ["wrong old dose", { before: "five milligrams" }, "value_mismatch"],
    ["both wrong", { before: "5 mg", after: "40 mg" }, "value_mismatch"],
    ["off by a factor of ten", { after: "200 mg" }, "value_mismatch"],
    ["off by a decimal point", { after: "2.0 mg" }, "value_mismatch"],
    ["the right number in the wrong unit", { after: "20 mcg" }, "unit_mismatch"],
    ["grams for milligrams", { after: "20 g" }, "unit_mismatch"],
    ["units for milligrams", { after: "20 units" }, "unit_mismatch"],
    ["tablets for milligrams", { after: "20 tablets" }, "unit_mismatch"],
    [
      "swapped before and after",
      { before: "twenty milligrams", after: "ten milligrams" },
      "direction_mismatch",
    ],
  ] as const)("%s", (_n, over, reason) => {
    expect(status({ ...item(), ...over }, Q)).toMatchObject({ status: "unverified", reason });
  });
  it("never converts between units: 0.5 mg is not 500 mcg", () => {
    const quote = "Lisinopril from one milligram to zero point five milligrams.";
    expect(reasonOf({ ...item(), before: "1 mg", after: "500 mcg" }, quote)).toBe("value_mismatch");
  });
});

describe("evidence about a different medication", () => {
  it.each([
    ["another drug entirely", { medication: "Metformin" }],
    ["a look-alike name", { medication: "Lisinopril-HCTZ" }],
    ["a name that only contains the real one", { medication: "Lisinoprilate" }],
    ["a name that is part of a longer word in the quote", { medication: "Lisinopril" }],
  ])("%s -> medication_not_in_quote", (_n, over) => {
    const quote =
      over.medication === "Lisinopril"
        ? "I want to increase the Lisinoprilate from ten milligrams to twenty milligrams."
        : Q;
    expect(reasonOf({ ...item(), ...over }, quote)).toBe("medication_not_in_quote");
  });
  it("a dose quoted for another drug is not borrowed", () => {
    const quote =
      "Your Metformin goes from five hundred milligrams to one thousand milligrams. Lisinopril stays the same.";
    expect(reasonOf({ ...item(), before: "500 mg", after: "1000 mg" }, quote)).toBe(
      "missing_value",
    );
    expect(
      status({ medication: "Metformin", before: "500 mg", after: "1000 mg" }, quote).status,
    ).toBe("value-verified");
  });
  it("two medications changed in one sentence: neither is verified", () => {
    const quote =
      "Raise the Lisinopril from ten to twenty milligrams and the Metformin from five hundred to one thousand milligrams.";
    expect(reasonOf(item(), quote)).toBe("ambiguous_quote");
    expect(reasonOf({ medication: "Metformin", before: "500 mg", after: "1000 mg" }, quote)).toBe(
      "ambiguous_quote",
    );
  });
  it("a list of medications sharing one dose change is ambiguous", () => {
    const quote = "Lisinopril and Metformin from ten milligrams to twenty milligrams.";
    expect(reasonOf(item(), quote)).toBe("ambiguous_quote");
    expect(
      reasonOf(
        { ...item(), medication: "Metformin" },
        "Increase Lisinopril and Metformin from ten milligrams to twenty milligrams.",
      ),
    ).toBe("ambiguous_quote");
  });
  it("a combination product is not the single drug", () => {
    expect(reasonOf(item(), "Lisinopril-HCTZ from ten milligrams to twenty milligrams.")).toBe(
      "ambiguous_quote",
    );
    expect(reasonOf(item(), "Lisinopril/HCTZ from ten milligrams to twenty milligrams.")).toBe(
      "ambiguous_quote",
    );
    expect(
      verified(
        { ...item(), medication: "Lisinopril-HCTZ" },
        "Lisinopril-HCTZ from ten milligrams to twenty milligrams.",
      ),
    ).toBe(true);
  });
});

describe("missing values", () => {
  it.each([
    ["the quote has only the new dose", "I'm increasing your Lisinopril to twenty milligrams."],
    ["the quote has only the old dose", "You take Lisinopril, ten milligrams, in the morning."],
    ["the quote has no dose at all", "We need to change your Lisinopril."],
    [
      "the doses are in other sentences",
      "I take Lisinopril ten milligrams. Next week it will be twenty milligrams.",
    ],
    ["numbers without units", "Lisinopril from ten to twenty."],
  ])("%s -> missing_value", (_n, quote) => {
    expect(reasonOf(item(), quote)).toBe("missing_value");
  });
  it.each([
    ["no dose in the field", { after: "increase" }],
    ["empty-ish field", { before: "unknown" }],
    ["two doses in one field", { after: "10 mg to 20 mg" }],
    ["a range", { after: "10-20 mg" }],
    ["a compound unit", { after: "20 mg/day" }],
    ["a time, not a dose", { after: "20:00" }],
    ["a bare number", { after: "20" }],
    ["a medication field holding a number", { medication: "Lisinopril 10" }],
    ["an empty medication after removing the brackets", { medication: "(Zestril)" }],
  ])("%s in the structured fields -> unparseable_value", (_n, over) => {
    expect(reasonOf({ ...item(), ...over }, Q)).toBe("unparseable_value");
  });
});

describe("ambiguous, hedged or conflicting quotations", () => {
  it.each([
    ["a range", "Lisinopril between ten and twenty milligrams, maybe 10-20 milligrams."],
    ["a range in the quote", "Lisinopril 10-20 milligrams."],
    [
      "three doses in the sentence",
      "Lisinopril from ten milligrams to twenty milligrams, not thirty milligrams.",
    ],
    ["two doses with no connecting words", "Lisinopril, ten milligrams, twenty milligrams."],
    ["alternatives", "Lisinopril ten milligrams and then twenty milligrams."],
    ["a time", "Lisinopril 20:00 from ten milligrams."],
  ])("%s -> unverified", (_n, quote) => {
    expect(verified(item(), quote)).toBe(false);
  });
  it.each([
    ["a negation", "Do not increase the Lisinopril from ten milligrams to twenty milligrams."],
    ["don't", "I don't want to increase the Lisinopril from ten milligrams to twenty milligrams."],
    ["maybe", "Maybe we increase the Lisinopril from ten milligrams to twenty milligrams."],
    ["might", "We might raise the Lisinopril from ten milligrams to twenty milligrams."],
    [
      "if",
      "If your pressure stays high, raise the Lisinopril from ten milligrams to twenty milligrams.",
    ],
    ["a question", "Should we increase the Lisinopril from ten milligrams to twenty milligrams?"],
    ["consider", "We could consider moving Lisinopril from ten milligrams to twenty milligrams."],
    ["or", "Lisinopril from ten milligrams to twenty milligrams or thirty milligrams."],
    ["stop", "Stop the Lisinopril, it was ten milligrams, not twenty milligrams."],
  ])("hedging: %s -> hedged_quote", (_n, quote) => {
    expect(reasonOf(item(), quote)).toBe("hedged_quote");
  });
  it("'from' with no 'to X' in front is not a change: the order of the doses is not guessed", () => {
    for (const quote of [
      "Lisinopril twenty milligrams from ten milligrams.",
      "Lisinopril ten milligrams from twenty milligrams.",
      "Lisinopril, twenty milligrams, instead of ten milligrams.",
    ]) {
      expect(verified(item(), quote)).toBe(false);
      expect(
        verified({ ...item(), before: "twenty milligrams", after: "ten milligrams" }, quote),
      ).toBe(false);
    }
  });
  it("two different changes for the same medication in one quote", () => {
    const quote =
      "Lisinopril from ten milligrams to twenty milligrams. Actually, Lisinopril from ten milligrams to forty milligrams.";
    expect(reasonOf(item(), quote)).toBe("ambiguous_quote");
  });
  it("the same change said twice is not a conflict", () => {
    const quote =
      "Lisinopril from ten milligrams to twenty milligrams. Again: Lisinopril from 10 mg to 20 mg.";
    expect(verified(item(), quote)).toBe(true);
  });
  it("a hedge in an unrelated sentence does not block, but one in the medication's sentence does", () => {
    expect(verified(item(), `If you feel dizzy, call us. ${Q}`)).toBe(true);
    expect(
      verified(
        item(),
        "Maybe tomorrow. Lisinopril from ten milligrams to twenty milligrams, maybe.",
      ),
    ).toBe(false);
  });
});

describe("extra details in the structured fields (strict rule)", () => {
  it("a frequency the quote never said is unsupported", () => {
    expect(
      reasonOf(
        {
          ...item(),
          before: "10 mg, once a day in the morning",
          after: "20 mg, once a day in the morning",
        },
        Q,
      ),
    ).toBe("unsupported_detail");
    expect(reasonOf({ ...item(), after: "twenty milligrams twice daily" }, Q)).toBe(
      "unsupported_detail",
    );
  });
  it("a detail said right next to the NEW dose does not block the dose check, but is still NOT claimed as verified", () => {
    const quote =
      "Increase Lisinopril from ten milligrams to twenty milligrams, once a day in the morning.";
    const v = status({ ...item(), after: "20 mg, once a day in the morning" }, quote);
    expect(v.status).toBe("value-verified");
    expect(v.scope).not.toMatch(/frequency|timing|morning|daily/i);
  });
  it("the same detail claimed for the OLD dose is unsupported: the quote only says it after the new dose", () => {
    const quote =
      "Increase Lisinopril from ten milligrams to twenty milligrams, once a day in the morning.";
    expect(
      reasonOf(
        {
          ...item(),
          before: "10 mg, once a day in the morning",
          after: "20 mg, once a day in the morning",
        },
        quote,
      ),
    ).toBe("unsupported_detail");
  });
  it("what a field says BEFORE its dose must be said right before that dose in the quote", () => {
    const early = "In the morning, increase Lisinopril from ten milligrams to twenty milligrams.";
    expect(reasonOf({ ...item(), after: "in the morning twenty milligrams" }, early)).toBe(
      "unsupported_detail",
    );
    const said = "Increase Lisinopril from extended-release ten milligrams to twenty milligrams.";
    expect(verified({ ...item(), before: "extended-release 10 mg" }, said)).toBe(true);
    expect(verified({ ...item(), before: "extended-release 10 mg" }, Q)).toBe(false);
    expect(verified({ ...item(), after: "extended-release 20 mg" }, said)).toBe(false);
  });
  it("filler words alone never block", () => {
    expect(
      verified(
        { ...item(), before: "the dose of ten milligrams", after: "a twenty milligrams" },
        Q,
      ),
    ).toBe(true);
  });
  it("an extra number is checked too", () => {
    expect(reasonOf({ ...item(), after: "twenty milligrams, take 3" }, Q)).toBe(
      "unsupported_detail",
    );
  });
  it("an extended-release qualifier that the quote lacks is unsupported", () => {
    expect(reasonOf({ ...item(), after: "twenty milligrams extended release" }, Q)).toBe(
      "unsupported_detail",
    );
  });
});

describe("a detail that appears ELSEWHERE in the quote does not support the structured fields", () => {
  // The structured fields claim a frequency/timing detail. It must be said about THIS dose, right next to it, not merely appear
  // somewhere in the quote (another sentence, another medication, another subject).
  const withAfter = (after: string) => ({ ...item(), after });
  it.each([
    [
      "in another sentence, about another medication",
      "Take your Metformin twice daily. Increase the Lisinopril from ten milligrams to twenty milligrams.",
      "twenty milligrams twice daily",
    ],
    [
      "before the medication, in the same sentence, about another medication",
      "Metformin stays twice daily but Lisinopril goes from ten milligrams to twenty milligrams.",
      "twenty milligrams twice daily",
    ],
    [
      "after the dose, joined by 'but', about another medication",
      "Lisinopril goes from ten milligrams to twenty milligrams but Metformin stays twice daily.",
      "twenty milligrams twice daily",
    ],
    [
      "after the dose, joined by a comma, about something else",
      "Lisinopril goes from ten milligrams to twenty milligrams, check your pressure daily.",
      "twenty milligrams daily",
    ],
    [
      "a word used in another sense ('once' as a conjunction)",
      "Once your pressure settles, Lisinopril goes from ten milligrams to twenty milligrams, a day at a time.",
      "twenty milligrams once a day",
    ],
    [
      "in the sentence before",
      "Take it every morning. Lisinopril goes from ten milligrams to twenty milligrams.",
      "twenty milligrams every morning",
    ],
    [
      "separated from the dose by other words",
      "Lisinopril goes from ten milligrams to twenty milligrams starting tomorrow, in the morning.",
      "twenty milligrams in the morning",
    ],
    [
      "as part of the medication's own hedge-free list of another drug",
      "Lisinopril goes from ten milligrams to twenty milligrams. Metformin: once a day in the morning.",
      "twenty milligrams once a day in the morning",
    ],
  ])("%s -> unverified (unsupported_detail)", (_n, quote, after) => {
    expect(status(withAfter(after), quote)).toMatchObject({
      status: "unverified",
      reason: "unsupported_detail",
    });
  });
  it("a detail on the OLD dose that the quote says only about the new one is unsupported", () => {
    const quote = "Lisinopril from ten milligrams to twenty milligrams once a day in the morning.";
    expect(reasonOf({ ...item(), before: "ten milligrams once a day in the morning" }, quote)).toBe(
      "unsupported_detail",
    );
  });
  it("a detail that a repeated sentence supports only the first time is unsupported", () => {
    const quote =
      "Lisinopril from ten milligrams to twenty milligrams daily. Again: Lisinopril from ten milligrams to twenty milligrams.";
    expect(reasonOf(withAfter("twenty milligrams daily"), quote)).toBe("unsupported_detail");
  });
  it.each([
    [
      "directly after the dose",
      "Raise the Lisinopril from ten milligrams to twenty milligrams once a day in the morning.",
    ],
    [
      "with commas",
      "Raise the Lisinopril from ten milligrams to twenty milligrams, once a day, in the morning.",
    ],
    [
      "with the dose in digits",
      "Raise the Lisinopril from 10 mg to 20 mg once a day in the morning.",
    ],
  ])("a detail said right after the dose is still accepted: %s", (_n, quote) => {
    const v = status(withAfter("20 mg, once a day in the morning"), quote);
    expect(v.status).toBe("value-verified");
    expect(v.scope).toBe(VERIFICATION_SCOPE); // still only name, dose, unit and direction
  });
  it("timing said right after the dose is accepted as a detail but never claimed as verified", () => {
    const v = status(withAfter("twenty milligrams, starting tomorrow"), Q);
    expect(v.status).toBe("value-verified");
    expect(JSON.stringify(v)).not.toMatch(/tomorrow|timing|frequency/i);
  });
});

describe("fail-closed behavior", () => {
  it("never throws, whatever it is given", () => {
    const weird = [
      "",
      " ",
      "\u0000",
      "((((",
      "1".repeat(5000),
      "ten ".repeat(500),
      "😀",
      "to to to",
      "mg mg mg",
      "-/-",
      "0,0,0",
    ];
    for (const w of weird) {
      for (const q of weird) {
        const v = verifyMedValue({ medication: w, before: w, after: w }, q);
        expect(v.status).toBe("unverified");
      }
      expect(() => verifyMedValue(item(), w)).not.toThrow();
      expect(verifyMedValue(item(), w).status).toBe("unverified");
    }
  });
  it("always returns a known reason and the fixed scope", () => {
    for (const q of [Q, "", "nothing here", "Lisinopril 5 mg"]) {
      const v = verifyMedValue(item(), q);
      expect(VERIFICATION_REASONS).toContain(v.reason);
      expect(v.scope).toBe(VERIFICATION_SCOPE);
      expect(v.status === "value-verified").toBe(v.reason === "verified");
    }
  });
  it("is deterministic and does not depend on the model's own claims: only the quote and fields are read", () => {
    const a = verifyMedValue(item(), Q);
    expect(verifyMedValue(item(), Q)).toEqual(a);
    expect(verifyMedValue({ ...item(), medication: "lisinopril" }, Q.toUpperCase())).toEqual(a);
  });
});

describe("the module stays pure", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/visit-pipeline/med-verifier.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  it("has no imports, network, storage or environment access", () => {
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(
      /\bfetch\b|XMLHttpRequest|localStorage|process\.env|import\.meta|supabase|META_API_KEY|Math\.random|Date\./,
    );
  });
});

describe("exhaustive agreement matrix: verified exactly when the numbers agree", () => {
  const WORDS: Record<string, string> = {
    "0.5": "zero point five",
    "1": "one",
    "2.5": "two point five",
    "5": "five",
    "10": "ten",
    "20": "twenty",
    "25": "twenty-five",
    "50": "fifty",
    "100": "one hundred",
    "150": "one hundred and fifty",
    "200": "two hundred",
    "500": "five hundred",
    "1000": "one thousand",
  };
  const NUMS = Object.keys(WORDS);
  const forms = (n: string) => [`${n} mg`, `${n}mg`, `${WORDS[n]} milligrams`, `${WORDS[n]} mg`];
  it("never verifies a pair that differs from the quote, in any written form, and always verifies one that agrees", () => {
    let checked = 0;
    for (const qb of NUMS)
      for (const qa of NUMS) {
        if (qb === qa) continue;
        for (const qf of [0, 2]) {
          const quote = `I want to change the Lisinopril from ${forms(qb)[qf]} to ${forms(qa)[qf]}, starting tomorrow.`;
          const candidates: Array<[string, string]> = [
            [qb, qa],
            [qa, qb],
          ];
          for (const x of NUMS) candidates.push([qb, x], [x, qa]);
          for (const [sb, sa] of candidates)
            for (const sf of [0, 1, 2, 3]) {
              const expected = sb === qb && sa === qa;
              const got = verifyMedValue(
                { medication: "Lisinopril", before: forms(sb)[sf]!, after: forms(sa)[sf]! },
                quote,
              );
              expect(got.status === "value-verified", `${quote} <- ${sb}->${sa} (${sf})`).toBe(
                expected,
              );
              checked++;
            }
        }
      }
    expect(checked).toBeGreaterThan(10000);
  });
});
