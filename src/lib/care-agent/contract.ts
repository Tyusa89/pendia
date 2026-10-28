// Care Agent: the shared contract (types, limits, JSON Schema, zod parser, input schema). Pure and isomorphic: no network,
// environment, storage or secret access. The agent is READ-ONLY and STATELESS; nothing here describes anything that is stored.
import { z } from "zod";

export const CARE_AGENT_SCHEMA_NAME = "care_agent_answer";

export const AGENT_LIMITS = {
  /** Current question, after trimming and whitespace collapsing. */
  questionMax: 500,
  recentTurnsMax: 4,
  recentTurnMax: 500,
  answerMax: 1200,
  citationsMax: 12,
  missingMax: 6,
  missingItemMax: 200,
  idMax: 80,
  /** Rendered context pack ceiling (characters). */
  packMaxChars: 6000,
  /** Per-item detail cap; the only permitted truncation is at a word boundary, ending in TRUNCATION_MARKER. */
  itemMaxChars: 600,
  /** Dose reports cover only the last 48 hours. */
  doseWindowHours: 48,
  handoffsMax: 3,
  coordinationDays: 7,
  /** Section caps. */
  visitAssociatedMax: 8,
  medicationSectionMax: 12,
  coordinationMax: 8,
} as const;

export const TRUNCATION_MARKER = "[truncated]";

/** Rate limits [founder-confirmed]: 10 per user per hour, 60 per server instance. In-memory, per server instance. */
export const AGENT_RATE = { perUser: 10, perInstance: 60, windowMs: 60 * 60_000 } as const;

/** The only two public refusal codes. Internal pre-filter categories map onto these. */
export const AGENT_REFUSALS = ["medical_advice", "out_of_scope"] as const;
export type AgentRefusal = (typeof AGENT_REFUSALS)[number];

export interface AgentAnswer {
  /** Plain text, 1..1200 chars. Empty only when `refusal` is non-null; on a refusal the SERVER fills in canned text. */
  answer: string;
  /** Exact pack-item ids the answer relies on, in order of first use. */
  citations: string[];
  /** What the records do not contain, are withheld, or do not cover. */
  missing: string[];
  /** Non-null only when the model declines. The model never supplies the prose the user sees. */
  refusal: AgentRefusal | null;
}

/** Sent to Meta as toWireSchema(...): only type/properties/required/additionalProperties/items/enum survive; limits are re-enforced locally. */
export const AGENT_RESPONSE_JSON_SCHEMA = {
  title: CARE_AGENT_SCHEMA_NAME,
  type: "object",
  additionalProperties: false,
  required: ["answer", "citations", "missing", "refusal"],
  properties: {
    answer: { type: "string", maxLength: AGENT_LIMITS.answerMax },
    citations: {
      type: "array",
      maxItems: AGENT_LIMITS.citationsMax,
      items: { type: "string", maxLength: AGENT_LIMITS.idMax },
    },
    missing: {
      type: "array",
      maxItems: AGENT_LIMITS.missingMax,
      items: { type: "string", minLength: 1, maxLength: AGENT_LIMITS.missingItemMax },
    },
    refusal: { type: ["string", "null"], enum: [...AGENT_REFUSALS, null] },
  },
} as const;

export const agentAnswerZ = z
  .object({
    answer: z.string().max(AGENT_LIMITS.answerMax),
    citations: z.array(z.string().min(1).max(AGENT_LIMITS.idMax)).max(AGENT_LIMITS.citationsMax),
    missing: z
      .array(z.string().min(1).max(AGENT_LIMITS.missingItemMax))
      .max(AGENT_LIMITS.missingMax),
    refusal: z.enum(AGENT_REFUSALS).nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------------------------------------------------
// Server-function inputs and results

export const turnZ = z
  .object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })
  .strict();

/**
 * Loose on purpose: the SERVER enforces the real limits and answers `invalid_question` (a thrown validator error would reach the
 * browser as a generic error page). These bounds only stop absurd payloads.
 */
export const askInputSchema = z
  .object({
    familyId: z.string().uuid(),
    question: z.string().max(4000),
    recentTurns: z.array(turnZ).max(20).default([]),
  })
  .strict();
export type AskInput = z.infer<typeof askInputSchema>;
export const statusInputSchema = z.object({ familyId: z.string().uuid() }).strict();

export type Language = "en" | "es";

/** [Pepper §3] `not_enabled` is also what a caller outside the allowlist sees: no state reveals the allowlist. */
export type CareAgentStatus =
  | { state: "available" }
  | { state: "not_enabled" }
  | { state: "not_demo_family" }
  | { state: "not_member" }
  | { state: "lookup_failed" };

export type AskFailCode =
  | "not_enabled"
  | "not_member"
  | "not_demo_family"
  | "lookup_failed"
  | "invalid_question"
  | "rate_limited"
  | "context_failed"
  | "context_too_large"
  | "provider_error"
  | "unverified";

export interface AgentSource {
  id: string;
  label: string;
}

/** Amendment C: `{ ok: true, answer, sources }`. `language` is the language the server chose, so the UI can show matching canned copy. */
export type AskResult =
  | { ok: true; language: Language; answer: AgentAnswer; sources: AgentSource[] }
  | { ok: false; code: AskFailCode; language: Language; detail?: string };

/** Stable, typed pack-item ids: `<type>:<key>`; dose occurrences are `dose:<schedule_id>:<YYYY-MM-DD>`. Matched EXACTLY. */
export const PACK_ID_PATTERN =
  /^(recipient|visit|medchange|med|dose|handoff|shift|task|watch):[A-Za-z0-9_-]{1,64}(:\d{4}-\d{2}-\d{2})?$/;
