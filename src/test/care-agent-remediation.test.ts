// @vitest-environment node
// Audit remediation (PR #54 re-audit items F1, F2, F3, F5, F6, F7). Pure; no network.
import { describe, expect, it } from "vitest";
import { AGENT_LIMITS } from "@/lib/care-agent/contract";
import { buildContextPack, type PackRows } from "@/lib/care-agent/pack";
import { prefilter } from "@/lib/care-agent/prefilter";
import { extractNumericTokens, validateAgentAnswer } from "@/lib/care-agent/validate";
import { ALL, NOW, TZ, baseRows, dose } from "./care-agent-helpers";

const packFor = (rows: PackRows = baseRows()) => {
  const r = buildContextPack({ now: NOW, timezone: TZ, language: "en", access: ALL, rows });
  if (!r.ok) throw new Error(r.code);
  return r.pack;
};
const body = (o: Record<string, unknown>) =>
  JSON.stringify({ answer: "", citations: [], missing: [], refusal: null, ...o });
const code = (o: Record<string, unknown>, pack = packFor()) => {
  const r = validateAgentAnswer(body(o), pack);
  return r.ok ? "ok" : r.code;
};
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

// ---- F1 ---------------------------------------------------------------------------------------------------------------------------
describe("F1: a cited Not given dose never excuses a misstatement about a Not confirmed dose", () => {
  const SCHED = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
  const rows = baseRows({
    doses: [
      dose({
        schedule_id: SCHED(1),
        medication_name: "Lisinopril",
        dose_text: "10 mg",
        status: "not_given",
        not_given_reason: "refused",
        scheduled_at: iso(-2),
      }),
      dose({
        schedule_id: SCHED(2),
        medication_name: "Metformin",
        dose_text: "500 mg",
        status: "not_confirmed",
        reported_by: null,
        reported_by_name: null,
        reported_at: null,
        scheduled_at: iso(-3),
      }),
      dose({
        schedule_id: SCHED(3),
        medication_name: "Lisinopril",
        dose_text: "10 mg",
        status: "not_confirmed",
        reported_by: null,
        reported_by_name: null,
        reported_at: null,
        local_date: "2026-10-27",
        scheduled_at: iso(-26),
      }),
    ],
  });
  const pack = packFor(rows);
  const NG = `dose:${SCHED(1)}:2026-10-28`;
  const NC = `dose:${SCHED(2)}:2026-10-28`;
  const NC_LIS = `dose:${SCHED(3)}:2026-10-27`;
  it("rejects 'skipped' about the Not confirmed Metformin dose when a different Not given dose is also cited", () => {
    expect(
      code(
        {
          answer: "Lisinopril was not given. The Metformin dose was skipped.",
          citations: [NG, NC],
        },
        pack,
      ),
    ).toBe("dose_misstated");
  });
  it("rejects a Not confirmed dose called missed in the same sentence as a Not given dose", () => {
    expect(
      code({ answer: "Lisinopril and Metformin doses were missed.", citations: [NG, NC] }, pack),
    ).toBe("dose_misstated");
  });
  it("rejects a sentence that names no medication when any cited dose is Not confirmed", () => {
    expect(code({ answer: "A dose was skipped.", citations: [NG, NC] }, pack)).toBe(
      "dose_misstated",
    );
  });
  it("rejects when the same medication has a Not given and a Not confirmed dose and the sentence does not say which", () => {
    expect(
      code({ answer: "The Lisinopril dose was skipped.", citations: [NG, NC_LIS] }, pack),
    ).toBe("dose_misstated");
  });
  it("rejects when the sentence's time points at the Not confirmed dose of that medication", () => {
    expect(
      code(
        { answer: "The Lisinopril dose on October 27 was skipped.", citations: [NG, NC_LIS] },
        pack,
      ),
    ).toBe("dose_misstated");
  });
  it("accepts a legitimate description of the caregiver-reported Not given dose (reason wording kept)", () => {
    expect(
      code(
        {
          answer:
            "The Lisinopril dose was not given; the caregiver reported the reason as refused.",
          citations: [NG],
        },
        pack,
      ),
    ).toBe("ok");
    expect(
      code(
        { answer: "Lisinopril was skipped, as reported by a caregiver.", citations: [NG] },
        pack,
      ),
    ).toBe("ok");
  });
  it("accepts describing the Not given dose and, separately, the Not confirmed one without misstating it", () => {
    expect(
      code(
        {
          answer:
            "The Lisinopril dose was reported as not given. The Metformin dose has no report yet.",
          citations: [NG, NC],
        },
        pack,
      ),
    ).toBe("ok");
  });
  it("accepts a time-disambiguated statement about the Not given dose of a medication that also has a Not confirmed dose", () => {
    const t = new Date(rows.doses[0]!.scheduled_at!);
    const clock = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    }).format(t);
    expect(
      code(
        {
          answer: `The Lisinopril dose on October 28 at ${clock} was skipped.`,
          citations: [NG, NC_LIS],
        },
        pack,
      ),
    ).toBe("ok");
  });
  it("still rejects misstatement wording with no Not given dose cited at all", () => {
    expect(code({ answer: "The Metformin dose was missed.", citations: [NC] }, pack)).toBe(
      "dose_misstated",
    );
  });
  it("covers Spanish wording the same way", () => {
    expect(
      code(
        { answer: "Lisinopril no fue dado. Se omitió la dosis de Metformin.", citations: [NG, NC] },
        pack,
      ),
    ).toBe("dose_misstated");
  });
});

// ---- F2 ---------------------------------------------------------------------------------------------------------------------------
describe("F2: missing[] entries get the same grounding and language checks", () => {
  const med = ["med:med1"];
  const ok = (missing: string[], answer = "Lisinopril 10 mg is listed.") =>
    code({ answer, citations: med, missing });
  it("rejects an ungrounded number, date or time in missing", () => {
    expect(ok(["Lisinopril 40 mg is not in the records."])).toBe("ungrounded_value");
    expect(ok(["The visit on March 3 is not in the records."])).toBe("ungrounded_value");
    expect(ok(["A 4:30 PM dose report is not in the records."])).toBe("ungrounded_value");
  });
  it("rejects spelled-out numbers in missing that are not grounded", () => {
    expect(ok(["Forty milligrams is not recorded."])).toBe("ungrounded_value");
  });
  it("rejects medical-advice or dose-instruction language in missing", () => {
    expect(ok(["You should ask the doctor to increase the dose."])).toBe("advisory_language");
    expect(ok(["Give the medication with food; no such record exists."])).toBe("advisory_language");
    expect(ok(["Skip the dose and call the clinic."])).toBe("advisory_language");
    expect(ok(["Debería darle la medicina por la noche."])).toBe("advisory_language");
    expect(ok(["Es seguro tomar la dosis doble."])).toBe("advisory_language");
  });
  it("rejects missed/skipped/not-taken wording in missing when no Not given dose backs it", () => {
    expect(ok(["The morning dose was missed."])).toBe("dose_misstated");
  });
  it("accepts legitimate descriptions of absent records, including the pack's own windows", () => {
    expect(ok(["No visit notes are in the records provided."])).toBe("ok");
    expect(ok(["Dose reports older than 48 hours are not included."])).toBe("ok");
    expect(ok(["Shifts more than 7 days ahead are not included."])).toBe("ok");
    expect(ok(["No dose report for Metformin is in the records."])).toBe("ok");
    expect(ok(["Ninguna visita futura está en los registros."])).toBe("ok");
  });
  it("applies to answers with no citations too", () => {
    expect(
      code({
        answer: "I don't have that in the records.",
        missing: ["A dose report for 9:15 AM."],
      }),
    ).toBe("ungrounded_value");
    expect(
      code({ answer: "I don't have that in the records.", missing: ["A future visit record."] }),
    ).toBe("ok");
  });
});

// ---- F3 ---------------------------------------------------------------------------------------------------------------------------
describe("F3: spelled-out counts are checked like digits", () => {
  it("extracts English and Spanish number words as number tokens", () => {
    const t = (s: string) => [...extractNumericTokens(s)].sort();
    expect(t("three doses")).toEqual(["N:3"]);
    expect(t("twenty-one items")).toEqual(["N:21"]);
    expect(t("twenty one items")).toEqual(["N:21"]);
    expect(t("tres dosis")).toEqual(["N:3"]);
    expect(t("treinta y cinco registros")).toEqual(["N:35"]);
    expect(t("veintidós citas")).toEqual(["N:22"]);
    expect(t("both medications")).toEqual(["N:2"]);
    expect(t("one dose")).toEqual(["N:1"]);
    expect(t("una dosis")).toEqual([]); // Spanish un/una are articles: not counted (documented limitation)
  });
  it("does not treat pronoun/article uses as numbers", () => {
    for (const s of [
      "No one has reported it.",
      "Which one is listed?",
      "Un medicamento está en la lista.",
      "She took it once.",
      "Uno de ellos.",
    ])
      expect([...extractNumericTokens(s)]).toEqual([]);
  });
  const two = packFor(); // baseRows has medications; cite exactly two
  it("rejects a wrong spelled-out count", () => {
    expect(
      code({ answer: "Three medications are listed.", citations: ["med:med1", "med:med2"] }, two),
    ).toBe("ungrounded_value");
    expect(
      code(
        { answer: "Hay cinco medicamentos en la lista.", citations: ["med:med1", "med:med2"] },
        two,
      ),
    ).toBe("ungrounded_value");
    expect(code({ answer: "Twenty doses are listed.", citations: ["med:med1"] }, two)).toBe(
      "ungrounded_value",
    );
  });
  it("accepts a correct spelled-out count of cited items, in English and Spanish", () => {
    expect(
      code({ answer: "Two medications are listed.", citations: ["med:med1", "med:med2"] }, two),
    ).toBe("ok");
    expect(
      code(
        { answer: "Hay dos medicamentos en la lista.", citations: ["med:med1", "med:med2"] },
        two,
      ),
    ).toBe("ok");
    expect(
      code({ answer: "Both medications are listed.", citations: ["med:med1", "med:med2"] }, two),
    ).toBe("ok");
  });
  it("a spelled-out dose is grounded exactly like a digit dose", () => {
    expect(
      code({ answer: "Lisinopril ten milligrams is listed.", citations: ["med:med1"] }, two),
    ).toBe("ok");
    expect(
      code({ answer: "Lisinopril forty milligrams is listed.", citations: ["med:med1"] }, two),
    ).toBe("ungrounded_value");
  });
  it("a spelled-out count in a no-citation answer is rejected", () => {
    expect(code({ answer: "There are three visits.", missing: ["Visit records."] })).toBe(
      "uncited",
    );
  });
});

// ---- F5 ---------------------------------------------------------------------------------------------------------------------------
describe("F5: capped records are never described as the only ones, and omission is disclosed", () => {
  const manyMeds = Array.from({ length: 14 }, (_, n) => ({
    id: `m${n}`,
    name: `Med${String.fromCharCode(65 + n)}`,
    dose: "5 mg",
    schedule: "daily",
    status: "active",
  }));
  it("the standing note no longer says only these records exist", () => {
    const p = packFor();
    const text = p.notes.join("\n");
    expect(text).not.toMatch(/Only the records listed below exist/i);
    expect(text).toMatch(/may still exist/);
    expect(p.capped).toEqual([]);
    expect(text).not.toMatch(/Limits were reached/);
  });
  it("a section cap hit is disclosed in the NOTES and the capped list", () => {
    const p = packFor(baseRows({ medications: manyMeds as never, doses: [] }));
    expect(p.capped).toContain("medications");
    expect(p.notes.join("\n")).toMatch(
      /Limits were reached, so more records may exist than are listed for: .*medications/,
    );
    expect(p.rendered).toMatch(/Limits were reached/);
  });
  it("a source read limit (the extra row the source reads) is disclosed even when the pack holds only the cap", () => {
    const p = packFor(
      baseRows({ truncated: { shifts: true, tasks: true, watch: true, handoffs: true } }),
    );
    for (const s of ["shifts", "tasks", "watch items", "handoffs"]) expect(p.capped).toContain(s);
  });
  it("leftover dose reports after the shared medication/dose cap are disclosed", () => {
    const meds = manyMeds.slice(0, 10) as never;
    const doses = Array.from({ length: 5 }, (_, n) =>
      dose({ schedule_id: `aaaaaaaa-0000-4000-8000-00000000010${n}`, scheduled_at: iso(-1 - n) }),
    );
    const p = packFor(baseRows({ medications: meds, doses }));
    expect(p.capped).toContain("dose reports");
  });
  it("the cap constants the disclosure relies on are unchanged", () => {
    expect(AGENT_LIMITS.medicationSectionMax).toBe(12);
    expect(AGENT_LIMITS.coordinationMax).toBe(8);
    expect(AGENT_LIMITS.handoffsMax).toBe(3);
  });
});

// ---- F6 ---------------------------------------------------------------------------------------------------------------------------
describe("F6: coverage wording matches the actual queries", () => {
  const notes = packFor().notes.join("\n");
  it("shifts are described as 7-day bounded and tasks/watch items as not date-windowed", () => {
    expect(notes).toMatch(/shifts that start within the next 7 days only/);
    expect(notes).toMatch(
      /open tasks and active watch items that are not visit follow-ups, with no date window/,
    );
    expect(notes).not.toMatch(/shifts, tasks and watch items for the next 7 days/);
  });
  it("visit follow-ups are described as limited to the two listed visits", () => {
    expect(notes).toMatch(/follow-ups only for the two visits listed/);
  });
});

// ---- F7 ---------------------------------------------------------------------------------------------------------------------------
describe("F7: interaction and indirect treatment questions are refused (EN/ES) without breaking lookups", () => {
  const refused = [
    "Does lisinopril interact with ibuprofen?",
    "Are there any drug interactions with her Metformin?",
    "Is it safe to take Lisinopril and Atorvastatin together?",
    "Can she have a glass of wine with her medications? Is alcohol ok with them?",
    "Is grapefruit juice bad with Atorvastatin?",
    "What are the side effects of Metformin?",
    "Is it okay to mix her pills with applesauce and take them at the same time?",
    "What would help with her pain?",
    "What else can we try for her constipation?",
    "Is there anything we can give her to help her sleep?",
    "How can we make her more comfortable?",
    "Any suggestions for her cough?",
    "What alternatives to Metformin are there?",
    "¿Interactúa el Lisinopril con el ibuprofeno?",
    "¿Hay interacciones entre sus medicamentos?",
    "¿Es seguro tomar Lisinopril y Atorvastatina juntos?",
    "¿Puede tomar vino con sus medicinas? ¿Es peligroso con alcohol?",
    "¿Cuáles son los efectos secundarios de la Metformina?",
    "¿Qué podemos darle para el dolor?",
    "¿Hay algo que podamos hacer para que duerma mejor?",
    "¿Cómo podemos hacerla sentir mejor?",
    "¿Qué alternativas hay a la Metformina?",
  ];
  for (const q of refused)
    it(`refuses: ${q}`, () => {
      expect(prefilter(q)?.refusal, q).toBe("medical_advice");
    });
  const allowed = [
    "What medications are listed in these records?",
    "What medication is listed in these records, and which source supports that?",
    "What dose of Lisinopril is listed?",
    "Which medications does she take in the morning according to the records?",
    "Who is covering Tuesday night?",
    "When is the next visit?",
    "Did anyone report the Metformin dose today?",
    "Were any side effects reported in the latest handoff?",
    "What can the family see on the coverage page?",
    "What tasks are open?",
    "¿Qué medicamentos aparecen en los registros?",
    "¿Cuándo es la próxima visita?",
    "¿Quién cubre el martes por la noche?",
    "¿Qué dosis de Lisinopril aparece?",
    "¿Se reportó la dosis de Metformina hoy?",
  ];
  for (const q of allowed)
    it(`still allows the lookup: ${q}`, () => {
      expect(prefilter(q), q).toBeNull();
    });
});
