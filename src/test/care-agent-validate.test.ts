// @vitest-environment node
// Answer validation and server-derived sources. A model answer is accepted only if EVERY rule passes; any failure rejects the whole
// answer with a fixed code and returns no model text at all. Pure; no network.
import { describe, expect, it } from "vitest";
import { buildContextPack, type PackRows } from "@/lib/care-agent/pack";
import { extractNumericTokens, validateAgentAnswer } from "@/lib/care-agent/validate";
import { ALL, MED_BLIND, NOW, SENTINEL_NAME, TZ, baseRows, dose } from "./care-agent-helpers";

const packFor = (rows: PackRows = baseRows(), access = ALL) => {
  const r = buildContextPack({ now: NOW, timezone: TZ, language: "en", access, rows });
  if (!r.ok) throw new Error(r.code);
  return r.pack;
};
const json = (o: Record<string, unknown>) =>
  JSON.stringify({ answer: "", citations: [], missing: [], refusal: null, ...o });
const check = (o: Record<string, unknown>, pack = packFor()) => validateAgentAnswer(json(o), pack);
const code = (o: Record<string, unknown>, pack = packFor()) => {
  const r = check(o, pack);
  return r.ok ? "ok" : r.code;
};

describe("grounded answers pass; sources are server-derived", () => {
  it("accepts a cited answer and derives sources from the citations, in order, with pack labels only", () => {
    const r = check({
      answer: "Lisinopril 10 mg is listed, taken once daily in the morning.",
      citations: ["med:med1"],
    });
    expect(r).toMatchObject({
      ok: true,
      sources: [{ id: "med:med1", label: "Medication — Lisinopril" }],
    });
  });
  it("preserves citation order and deduplicates sources", () => {
    const r = check({
      answer: "Metformin 500 mg and Lisinopril 10 mg are listed.",
      citations: ["med:med2", "med:med1", "med:med2"],
    });
    expect(r.ok && r.sources.map((s) => s.id)).toEqual(["med:med2", "med:med1"]);
    expect(r.ok && r.answer.citations).toEqual(["med:med2", "med:med1"]);
  });
  it("returns no source for an item the answer did not cite", () => {
    const r = check({ answer: "Lisinopril is listed.", citations: ["med:med1"] });
    expect(r.ok && r.sources.map((s) => s.id)).toEqual(["med:med1"]);
  });
  it("a refusal passes validation with no sources (the SERVER later substitutes canned copy)", () => {
    expect(check({ refusal: "medical_advice" })).toMatchObject({ ok: true, sources: [] });
    expect(check({ refusal: "out_of_scope" })).toMatchObject({ ok: true, sources: [] });
  });
});

describe("citations must be exact pack-item ids", () => {
  it.each([
    ["an id that is not in the pack", "med:not-in-pack"],
    ["a near miss (extra space)", "med:med1 "],
    ["a different case", "MED:med1"],
    ["a bare id without its type", "med1"],
    ["an id from another family's namespace", "med:99999999-9999-4999-8999-999999999999"],
  ])("rejects %s", (_n, id) => {
    expect(code({ answer: "Lisinopril is listed.", citations: [id] })).toBe("unknown_citation");
  });
  it("rejects the WHOLE answer when one of several citations is bad", () => {
    expect(code({ answer: "Both are listed.", citations: ["med:med1", "med:bogus"] })).toBe(
      "unknown_citation",
    );
  });
});

describe("uncited claims", () => {
  it("a factual answer with no citation and no missing entry is rejected", () => {
    expect(code({ answer: "She takes Lisinopril every morning." })).toBe("uncited");
  });
  it("a missing-information-only answer is allowed: no citation, no number, non-empty `missing`", () => {
    expect(
      code({
        answer: "I don't have a future visit record in the records I can access.",
        missing: ["a future visit record"],
      }),
    ).toBe("ok");
  });
  it("...but not if it carries a number, or names nothing in `missing`", () => {
    expect(code({ answer: "I have 3 records but none about that.", missing: ["a record"] })).toBe(
      "uncited",
    );
    expect(code({ answer: "I don't have that.", missing: [] })).toBe("uncited");
  });
  it("an empty answer without a refusal is malformed", () => {
    expect(code({ answer: "", citations: ["med:med1"] })).toBe("bad_shape");
  });
});

describe("numbers, dates and times must be traceable to a cited item or be a count of cited items", () => {
  it("a number that appears in a cited item passes; one that does not is rejected", () => {
    expect(code({ answer: "Lisinopril 10 mg.", citations: ["med:med1"] })).toBe("ok");
    expect(code({ answer: "Lisinopril 20 mg.", citations: ["med:med1"] })).toBe("ungrounded_value");
  });
  it("a number traceable only to an UNCITED item is rejected", () => {
    expect(code({ answer: "Lisinopril 500 mg.", citations: ["med:med1"] })).toBe(
      "ungrounded_value",
    );
  });
  it("a COUNT of the cited items is allowed even though the numeral is not in any item", () => {
    expect(
      code({
        answer: "2 medications are listed: Lisinopril and Metformin.",
        citations: ["med:med1", "med:med2"],
      }),
    ).toBe("ok");
    expect(code({ answer: "1 medication is listed.", citations: ["med:med1"] })).toBe("ok");
  });
  it("a wrong count is rejected", () => {
    expect(code({ answer: "3 medications are listed.", citations: ["med:med1", "med:med2"] })).toBe(
      "ungrounded_value",
    );
  });
  it("a count per item type is also accepted", () => {
    expect(
      code({
        answer: "2 medications and 1 visit are cited.",
        citations: ["med:med1", "med:med2", "visit:v-next"],
      }),
    ).toBe("ok");
  });
  it("dates and times are compared canonically (English and Spanish forms of the same date and time match)", () => {
    // The next visit is Oct 31, 10:00 AM in the family's zone.
    expect(
      code({ answer: "The next visit is on October 31 at 10:00 AM.", citations: ["visit:v-next"] }),
    ).toBe("ok");
    expect(
      code({
        answer: "La próxima visita es el 31 de octubre a las 10:00 AM.",
        citations: ["visit:v-next"],
      }),
    ).toBe("ok");
    expect(
      code({ answer: "The next visit is on October 30 at 10:00 AM.", citations: ["visit:v-next"] }),
    ).toBe("ungrounded_value");
    expect(
      code({ answer: "The next visit is on October 31 at 11:00 AM.", citations: ["visit:v-next"] }),
    ).toBe("ungrounded_value");
  });
  it("extractNumericTokens canonicalises dates, times and numbers", () => {
    expect([...extractNumericTokens("Oct 31, 2026 at 2:05 pm, 10 mg")].sort()).toEqual([
      "D:10-31",
      "N:10",
      "T:14:05",
    ]);
    expect([...extractNumericTokens("31 de octubre; 3 PM")].sort()).toEqual(["D:10-31", "T:15:00"]);
    expect([...extractNumericTokens("10/31 and 2026-10-31")].sort()).toEqual(["D:10-31"]);
    expect([...extractNumericTokens("0.5 mg, 1,5 mg")].sort()).toEqual(["N:0.5", "N:1.5"]);
  });
});

describe("dose language: Not confirmed is never missed, skipped, not taken or non-compliance", () => {
  const notConfirmed = baseRows({
    doses: [
      dose({
        status: "not_confirmed",
        reported_by: null,
        reported_by_name: null,
        reported_at: null,
        head_id: null,
      }),
    ],
  });
  const id = "dose:aaaaaaaa-0000-4000-8000-000000000001:2026-10-28";
  it("accepts 'not confirmed: no one has reported it'", () => {
    expect(
      code(
        { answer: "That dose is not confirmed: no one has reported it.", citations: [id] },
        packFor(notConfirmed),
      ),
    ).toBe("ok");
  });
  it.each([
    "She missed the 8:00 AM dose.",
    "The dose was skipped.",
    "She forgot her pill.",
    "She did not take it.",
    "It was not taken.",
    "This shows non-compliance.",
    "Omitió la dosis de la mañana.",
    "No la tomó.",
    "Se la saltaron.",
  ])("rejects %s", (answer) => {
    expect(code({ answer, citations: [id] }, packFor(notConfirmed))).toBe("dose_misstated");
  });
  it("allows 'refused' only when a cited dose report is Not given", () => {
    const ng = baseRows({ doses: [dose({ status: "not_given", not_given_reason: "refused" })] });
    expect(
      code(
        {
          answer: "Jordan reported it as not given: refused.",
          citations: ["dose:aaaaaaaa-0000-4000-8000-000000000001:2026-10-28"],
        },
        packFor(ng),
      ),
    ).toBe("ok");
  });
});

describe("advisory and diagnostic language is never allowed", () => {
  it.each([
    "You should give her the pill with food.",
    "I recommend asking the doctor to lower it.",
    "It is safe to take both.",
    "Her blood pressure is normal.",
    "That probably means an infection.",
    "Le recomiendo darle la pastilla con comida.",
    "Debería tomar la medicina por la noche.",
    "Es normal que duerma tanto.",
  ])("rejects %s", (answer) => {
    expect(code({ answer, citations: ["med:med1"] })).toBe("advisory_language");
  });
});

describe("shape, plain text and provenance", () => {
  it("rejects output that is not exactly one JSON object", () => {
    const p = packFor();
    for (const raw of [
      "Sure! Here you go",
      "```json\n{}\n```",
      "",
      "[]",
      "null",
      '{"answer":"x"} trailing',
    ])
      expect(validateAgentAnswer(raw, p)).toEqual({
        ok: false,
        code: expect.stringMatching(/not_json|bad_shape/),
      });
  });
  it.each([
    ["an extra key", { extra: 1 }],
    ["a wrong refusal code", { refusal: "urgent" }],
    ["a non-array citations", { citations: "med:med1" }],
    ["an over-long answer", { answer: "x".repeat(1201), citations: ["med:med1"] }],
    ["more than 6 missing entries", { missing: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["an empty missing entry", { missing: [""] }],
  ])("rejects %s as malformed", (_n, over) => {
    expect(code({ answer: "Lisinopril.", citations: ["med:med1"], ...over })).toMatch(/bad_shape/);
  });
  it.each([
    ["a link", "See https://example.com for details"],
    ["html", "<b>Lisinopril</b>"],
    ["markdown code", "Lisinopril `10 mg`"],
    ["an e-mail address", "Write to someone@example.com"],
    ["a phone number", "Call 555-123-4567"],
  ])("rejects %s", (_n, answer) => {
    expect(code({ answer, citations: ["med:med1"] })).toBe("not_plain_text");
  });
  it("a refusal must be silent: no answer text, citations or missing entries alongside it", () => {
    expect(code({ refusal: "medical_advice", answer: "Sure, give her more." })).toBe(
      "refusal_inconsistent",
    );
    expect(code({ refusal: "medical_advice", citations: ["med:med1"] })).toBe(
      "refusal_inconsistent",
    );
    expect(code({ refusal: "out_of_scope", missing: ["x"] })).toBe("refusal_inconsistent");
  });
  it("on ANY failure the result carries only a fixed code: no model text, no partial answer", () => {
    const r = check({ answer: "You should do X and secret-model-text", citations: ["med:med1"] });
    expect(r).toEqual({ ok: false, code: "advisory_language" });
    expect(JSON.stringify(r)).not.toContain("secret-model-text");
  });
});

describe("citation labels never expose field-filtered information", () => {
  it("for a medication-blind member, a cited handoff has a sentinel-free label and the answer validates", () => {
    const rows = baseRows({
      handoffs: [
        {
          id: "h-s",
          created_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
          author_member_id: "m-jordan",
          ate: true,
          meds_taken: true,
          note: `Gave ${SENTINEL_NAME}`,
          unusual: null,
          watch_answers: {},
        } as never,
      ],
    });
    const p = packFor(rows, MED_BLIND);
    const r = check(
      {
        answer: "A handoff was recorded by Jordan and she ate.",
        citations: ["handoff:h-s"],
        missing: ["Handoff details are withheld"],
      },
      p,
    );
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SENTINEL_NAME);
    expect(r.ok && r.sources[0]!.label).toMatch(/^Handoff — Jordan, /);
  });
});
