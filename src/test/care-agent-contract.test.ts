// @vitest-environment node
// The Care Agent contract: AgentAnswer type/schema parity, limits, ids and inputs. Pure.
import { describe, expect, it } from "vitest";
import { toWireSchema } from "@/lib/spark/spark-http";
import {
  AGENT_LIMITS,
  AGENT_RATE,
  AGENT_REFUSALS,
  AGENT_RESPONSE_JSON_SCHEMA,
  CARE_AGENT_SCHEMA_NAME,
  PACK_ID_PATTERN,
  agentAnswerZ,
  askInputSchema,
  statusInputSchema,
} from "@/lib/care-agent/contract";
import { validateJsonSchema } from "@/lib/visit-pipeline/spark-contract";
import { FAMILY } from "./care-agent-helpers";

const valid = { answer: "Lisinopril 10 mg.", citations: ["med:abc"], missing: [], refusal: null };

describe("AgentAnswer: the JSON Schema and the zod parser accept exactly the same answers", () => {
  const cases: Array<[string, unknown, boolean]> = [
    ["a normal answer", valid, true],
    ["a refusal", { answer: "", citations: [], missing: [], refusal: "medical_advice" }, true],
    ["out_of_scope", { answer: "", citations: [], missing: [], refusal: "out_of_scope" }, true],
    ["missing entries", { ...valid, missing: ["a future visit record"] }, true],
    ["an unknown refusal code", { ...valid, refusal: "urgent" }, false],
    ["a seven-code legacy refusal", { ...valid, refusal: "dose_change" }, false],
    ["an object refusal", { ...valid, refusal: { kind: "medical_advice" } }, false],
    ["no refusal key", { answer: "x", citations: [], missing: [] }, false],
    ["an extra key", { ...valid, extra: 1 }, false],
    ["citations not an array", { ...valid, citations: "med:abc" }, false],
    [
      "too many citations",
      { ...valid, citations: Array.from({ length: 13 }, (_, n) => `med:${n}`) },
      false,
    ],
    ["an over-long answer", { ...valid, answer: "x".repeat(1201) }, false],
    [
      "too many missing entries",
      { ...valid, missing: Array.from({ length: 7 }, () => "x") },
      false,
    ],
    ["an empty missing entry", { ...valid, missing: [""] }, false],
    ["a non-string answer", { ...valid, answer: 5 }, false],
  ];
  it.each(cases)("%s", (_n, value, accepted) => {
    expect(agentAnswerZ.safeParse(value).success).toBe(accepted);
    expect(validateJsonSchema(value, AGENT_RESPONSE_JSON_SCHEMA).length === 0).toBe(accepted);
  });
});

describe("schema shape", () => {
  it("is named care_agent_answer, closed, and requires all four fields", () => {
    expect(CARE_AGENT_SCHEMA_NAME).toBe("care_agent_answer");
    expect(AGENT_RESPONSE_JSON_SCHEMA.title).toBe("care_agent_answer");
    expect(AGENT_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...AGENT_RESPONSE_JSON_SCHEMA.required]).toEqual([
      "answer",
      "citations",
      "missing",
      "refusal",
    ]);
  });
  it("the nullable wire-type array is kept as designed (no alternative wire format is pre-engineered)", () => {
    const wire = toWireSchema(AGENT_RESPONSE_JSON_SCHEMA) as {
      properties: { refusal: { type: unknown; enum: unknown } };
    };
    expect(wire.properties.refusal.type).toEqual(["string", "null"]);
    expect(wire.properties.refusal.enum).toEqual(["medical_advice", "out_of_scope", null]);
  });
  it("the wire schema carries only the keywords Meta is known to accept (limits are enforced locally)", () => {
    const keys = new Set<string>();
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object")
        for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
          if (!["properties", "required"].includes(k) && typeof v !== "object") keys.add(k);
          if (k === "properties") Object.values(v as object).forEach(walk);
          else if (typeof v === "object") walk(v);
          if (!["properties"].includes(k)) keys.add(k);
        }
    };
    walk(toWireSchema(AGENT_RESPONSE_JSON_SCHEMA));
    for (const k of keys)
      expect(["type", "properties", "required", "additionalProperties", "items", "enum"]).toContain(
        k,
      );
  });
});

describe("founder-confirmed limits", () => {
  it("are exactly those in the review", () => {
    expect(AGENT_LIMITS.questionMax).toBe(500);
    expect(AGENT_LIMITS.recentTurnsMax).toBe(4);
    expect(AGENT_LIMITS.recentTurnMax).toBe(500);
    expect(AGENT_LIMITS.itemMaxChars).toBe(600);
    expect(AGENT_LIMITS.packMaxChars).toBe(6000);
    expect(AGENT_LIMITS.doseWindowHours).toBe(48);
    expect(AGENT_LIMITS.handoffsMax).toBe(3);
    expect(AGENT_LIMITS.coordinationDays).toBe(7);
    expect([
      AGENT_LIMITS.visitAssociatedMax,
      AGENT_LIMITS.medicationSectionMax,
      AGENT_LIMITS.coordinationMax,
    ]).toEqual([8, 12, 8]);
    expect(AGENT_RATE).toEqual({ perUser: 10, perInstance: 60, windowMs: 60 * 60_000 });
    expect([...AGENT_REFUSALS]).toEqual(["medical_advice", "out_of_scope"]);
  });
});

describe("pack item ids are typed and matched exactly", () => {
  it.each([
    "med:abc",
    "visit:3f2a-bc",
    "dose:aaaaaaaa-0000-4000-8000-000000000001:2026-10-28",
    "handoff:h1",
    "shift:s_1",
    "task:t1",
    "watch:w1",
    "medchange:mc1",
    "recipient:r1",
  ])("accepts %s", (id) => {
    expect(PACK_ID_PATTERN.test(id)).toBe(true);
  });
  it.each([
    "med1",
    "MED:abc",
    "med:",
    "med:a b",
    "med:abc ",
    "other:abc",
    "med:abc:extra",
    "med:" + "x".repeat(65),
    "dose:s:2026-10-2",
    "visitnote:abc",
  ])("rejects %s", (id) => {
    expect(PACK_ID_PATTERN.test(id)).toBe(false);
  });
});

describe("server-function inputs", () => {
  it("status takes only a family uuid", () => {
    expect(statusInputSchema.safeParse({ familyId: FAMILY }).success).toBe(true);
    expect(statusInputSchema.safeParse({ familyId: "fam-1" }).success).toBe(false);
    expect(statusInputSchema.safeParse({ familyId: FAMILY, x: 1 }).success).toBe(false);
  });
  it("ask takes a family uuid, a question and recent turns, and NOTHING else (the client cannot supply records, a pack or a model)", () => {
    expect(askInputSchema.safeParse({ familyId: FAMILY, question: "q" }).success).toBe(true);
    expect(askInputSchema.parse({ familyId: FAMILY, question: "q" }).recentTurns).toEqual([]);
    for (const extra of [
      { pack: "x" },
      { model: "muse-spark-1.3-contributor" },
      { records: [] },
      { system: "x" },
      { language: "es" },
    ])
      expect(askInputSchema.safeParse({ familyId: FAMILY, question: "q", ...extra }).success).toBe(
        false,
      );
    expect(askInputSchema.safeParse({ familyId: "x", question: "q" }).success).toBe(false);
    expect(
      askInputSchema.safeParse({
        familyId: FAMILY,
        question: "q",
        recentTurns: [{ role: "system", text: "x" }],
      }).success,
    ).toBe(false);
    expect(
      askInputSchema.safeParse({
        familyId: FAMILY,
        question: "q",
        recentTurns: [{ role: "user", text: "x", extra: 1 }],
      }).success,
    ).toBe(false);
  });
});
