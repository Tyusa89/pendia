// SERVER ONLY. The Care Agent orchestrator: gates, rate limits, the one provider request, validation and server-derived sources.
// Imported only from the server-function handlers in src/lib/care-agent/care-agent.functions.ts (dynamic import), never at module
// scope in anything client-reachable. It has no UI, storage or database code of its own: reads arrive through the injected
// PackSource, which uses the CALLER'S session (row-level security). No service-role client exists anywhere in this path.
//
// READ-ONLY and STATELESS: nothing about a question, answer, pack or provider response is stored or logged, and this module has no
// `console` calls. Errors are fixed codes: no question, pack, provider body, header or key text ever appears in one.
//
// Gate order, enforced identically by status and ask (the status result is never trusted as authorization):
//   1 authenticated caller (requireSupabaseAuth, in the function wrapper)  2 AGENT_LIVE_ENABLED === "true" and META_API_KEY present
//   3 caller in AGENT_LIVE_USER_IDS  4 membership and family.is_demo  5 question valid  6 advice pre-filter  7 rate limit
//   8 pack assembly (RLS)  9 ONE provider request  10 parse + validation  11 server-derived sources, or canned substitution.
import {
  SPARK_CHAT_URL,
  SPARK_MAX_OUTPUT_TOKENS,
  SPARK_REASONING_EFFORT,
  SparkHttpError,
  parseChatCompletion,
  toWireSchema,
} from "@/lib/spark/spark-http";
import { SPARK_MODEL_ID } from "@/lib/visit-pipeline/spark-contract";
import {
  AGENT_LIMITS,
  AGENT_RATE,
  AGENT_RESPONSE_JSON_SCHEMA,
  CARE_AGENT_SCHEMA_NAME,
  type AgentAnswer,
  type AskInput,
  type AskResult,
  type CareAgentStatus,
  type Language,
} from "@/lib/care-agent/contract";
import { MISSING_COPY, REFUSAL_COPY, UNVERIFIED_COPY, detectLanguage } from "@/lib/care-agent/copy";
import { buildContextPack, type PackAccess, type PackRows } from "@/lib/care-agent/pack";
import { prefilter } from "@/lib/care-agent/prefilter";
import { CARE_AGENT_SYSTEM_PROMPT, buildUserText, type RecentTurn } from "@/lib/care-agent/prompt";
import { validateAgentAnswer } from "@/lib/care-agent/validate";

export interface CareAgentEnv {
  AGENT_LIVE_ENABLED?: string | undefined;
  AGENT_LIVE_USER_IDS?: string | undefined;
  META_API_KEY?: string | undefined;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const CARE_AGENT_TIMEOUT_MS = 60_000;
export const CARE_AGENT_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface MemberRow {
  id: string;
  name: string;
  role: string;
  language: string | null;
  can_see_meds: boolean;
  can_see_schedule: boolean;
  can_see_visits: boolean;
}
export interface FamilyRow {
  id: string;
  is_demo: boolean | null;
  timezone: string;
}

/** Reads made with the caller's own session. EVERY method throws on a database error; none may return a partial result. */
export interface PackSource {
  getMember(familyId: string): Promise<MemberRow | null>;
  getFamily(familyId: string): Promise<FamilyRow | null>;
  loadRows(args: {
    familyId: string;
    access: PackAccess;
    now: Date;
    timezone: string;
  }): Promise<PackRows>;
}

// ---- configuration and allowlist -------------------------------------------------------------------------------------------------

/** AGENT_LIVE_ENABLED must be exactly "true" (default off) and the existing META_API_KEY must be present and well-formed. */
export function careAgentConfigured(env: CareAgentEnv): boolean {
  const key = (env.META_API_KEY ?? "").trim();
  if (env.AGENT_LIVE_ENABLED !== "true" || key === "") return false;
  return ![...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127);
}

/** A missing or empty list means nobody. */
export function careAgentAllowlisted(env: CareAgentEnv, userId: string): boolean {
  const ids = (env.AGENT_LIVE_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 && ids.includes(userId);
}

// ---- rate limits (in memory: per server instance, reset on restart; an accident guard, not a spending limit) ---------------------

const userCalls = new Map<string, number[]>();
let instanceCalls: number[] = [];
export function resetCareAgentLimits(): void {
  userCalls.clear();
  instanceCalls = [];
}
function takeRateSlot(userId: string, clock: number): boolean {
  const since = clock - AGENT_RATE.windowMs;
  const mine = (userCalls.get(userId) ?? []).filter((t) => t > since);
  instanceCalls = instanceCalls.filter((t) => t > since);
  if (mine.length >= AGENT_RATE.perUser || instanceCalls.length >= AGENT_RATE.perInstance) {
    userCalls.set(userId, mine);
    return false;
  }
  userCalls.set(userId, [...mine, clock]);
  instanceCalls.push(clock);
  return true;
}

// ---- eligibility (membership + demo family), separate from pack assembly ---------------------------------------------------------

type Eligibility =
  | { ok: true; member: MemberRow; family: FamilyRow }
  | { ok: false; code: "not_member" | "not_demo_family" | "lookup_failed" };

async function eligibility(source: PackSource, familyId: string): Promise<Eligibility> {
  let member: MemberRow | null;
  try {
    member = await source.getMember(familyId);
  } catch {
    return { ok: false, code: "lookup_failed" }; // a failed lookup is never turned into a denial
  }
  if (!member) return { ok: false, code: "not_member" };
  let family: FamilyRow | null;
  try {
    family = await source.getFamily(familyId);
  } catch {
    return { ok: false, code: "lookup_failed" };
  }
  if (!family) return { ok: false, code: "not_member" };
  if (family.is_demo !== true) return { ok: false, code: "not_demo_family" };
  return { ok: true, member, family };
}

// ---- status ------------------------------------------------------------------------------------------------------------------------

export async function careAgentStatus(opts: {
  env: CareAgentEnv;
  userId: string;
  familyId: string;
  source: PackSource;
}): Promise<CareAgentStatus> {
  if (!careAgentConfigured(opts.env)) return { state: "not_enabled" };
  if (!careAgentAllowlisted(opts.env, opts.userId)) return { state: "not_enabled" }; // reveals nothing about the allowlist
  const e = await eligibility(opts.source, opts.familyId);
  return e.ok ? { state: "available" } : { state: e.code };
}

// ---- the provider request --------------------------------------------------------------------------------------------------------

export interface CareAgentRequestBody {
  model: typeof SPARK_MODEL_ID;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_schema"; json_schema: { name: string; schema: unknown } };
  reasoning_effort: typeof SPARK_REASONING_EFFORT;
  max_completion_tokens: number;
}

/** Pure: the exact JSON body of the one request. No tools, no temperature, no extra fields, and no way to choose a model. */
export function buildCareAgentRequest(
  systemPrompt: string,
  userText: string,
): CareAgentRequestBody {
  return {
    model: SPARK_MODEL_ID,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: CARE_AGENT_SCHEMA_NAME,
        schema: toWireSchema(AGENT_RESPONSE_JSON_SCHEMA),
      },
    },
    reasoning_effort: SPARK_REASONING_EFFORT,
    max_completion_tokens: SPARK_MAX_OUTPUT_TOKENS,
  };
}

class ProviderFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ProviderFailure";
    this.code = code;
  }
}

async function readBounded(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderFailure("response_too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}

/** EXACTLY one POST. Key only in Authorization; redirects refused; 60 s timeout; 1 MB reply bound; no retry; fixed codes only. */
async function callProviderOnce(opts: {
  apiKey: string;
  body: CareAgentRequestBody;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<string> {
  let res: Response;
  try {
    res = await opts.fetchImpl(SPARK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(opts.body),
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    const n = (e as { name?: string } | null)?.name;
    throw new ProviderFailure(
      n === "TimeoutError" || n === "AbortError" ? "timeout" : "network_error",
    );
  }
  if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderFailure("redirect_refused");
  }
  let text: string;
  try {
    text = await readBounded(res, CARE_AGENT_MAX_RESPONSE_BYTES);
  } catch (e) {
    throw e instanceof ProviderFailure ? e : new ProviderFailure("network_error");
  }
  if (!res.ok) throw new ProviderFailure(`http_${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderFailure("malformed_response");
  }
  try {
    return parseChatCompletion(json).content;
  } catch (e) {
    throw new ProviderFailure(e instanceof SparkHttpError ? e.code : "malformed_response");
  }
}

// ---- question handling -----------------------------------------------------------------------------------------------------------

/** 1..500 chars after trimming and collapsing whitespace; no control characters; no fence tokens. Null = invalid. */
export function normalizeQuestion(
  raw: string,
  max: number = AGENT_LIMITS.questionMax,
): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return null;
  const q = raw.replace(/\s+/g, " ").trim();
  if (q.length < 1 || q.length > max) return null;
  if (/<<<|>>>/.test(q)) return null;
  return q;
}

const HANDOFF_WORDS = /handoff|hand-off|shift note|relevo|nota del turno/i;
const KEYWORDS = {
  visits: /visit|appointment|doctor|clinic|cita|visita|medico|consultorio/i,
  meds: /medication|medicine|\bmeds?\b|pill|dose|lisinopril|medicamento|medicina|pastilla|dosis/i,
  schedule:
    /handoff|hand-off|shift|coverage|covering|task|watch|relevo|turno|cobertura|tarea|vigilancia/i,
} as const;

function effectiveAccess(member: MemberRow): PackAccess {
  if (member.role === "organizer") return { visits: true, meds: true, schedule: true };
  return {
    visits: member.can_see_visits === true,
    meds: member.can_see_meds === true,
    schedule: member.can_see_schedule === true,
  };
}

const fail = (
  code: Exclude<AskResult, { ok: true }>["code"],
  language: Language,
  detail?: string,
): AskResult => ({
  ok: false,
  code,
  language,
  ...(detail ? { detail } : {}),
});

export async function askCareAgent(opts: {
  env: CareAgentEnv;
  userId: string;
  input: AskInput;
  source: PackSource;
  fetchImpl: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}): Promise<AskResult> {
  const { env, userId, input, source } = opts;
  // 2-3: configuration and allowlist (the status result is never trusted: every ask re-checks).
  if (!careAgentConfigured(env) || !careAgentAllowlisted(env, userId))
    return fail("not_enabled", "en");
  // 4: membership and demo-family eligibility, caller session, BEFORE any record content is read.
  const elig = await eligibility(source, input.familyId);
  if (!elig.ok) return fail(elig.code, "en");
  const { member, family } = elig;

  // 5: the question and the recent turns (untrusted client memory; never facts).
  const question = normalizeQuestion(input.question);
  const turns: RecentTurn[] = [];
  if (input.recentTurns.length > AGENT_LIMITS.recentTurnsMax)
    return fail("invalid_question", detectLanguage(input.question, member.language));
  for (const t of input.recentTurns) {
    const text = normalizeQuestion(t.text, AGENT_LIMITS.recentTurnMax);
    if (text === null)
      return fail("invalid_question", detectLanguage(input.question, member.language));
    turns.push({ role: t.role, text });
  }
  const language = detectLanguage(question ?? input.question, member.language);
  if (question === null) return fail("invalid_question", language);

  // 6: deterministic advice pre-filter. A hit means no record read, no rate-limit spend and ZERO provider fetches.
  const hit = prefilter(question);
  if (hit) {
    const answer: AgentAnswer = {
      answer: REFUSAL_COPY[language][hit.refusal],
      citations: [],
      missing: [],
      refusal: hit.refusal,
    };
    return { ok: true, language, answer, sources: [] };
  }

  // 7: rate limit.
  const clock = (opts.now ?? Date.now)();
  if (!takeRateSlot(userId, clock)) return fail("rate_limited", language);

  // 8: pack assembly under the caller's RLS session. ANY failed read fails the whole question (never a partial pack).
  const access = effectiveAccess(member);
  let rows: PackRows;
  try {
    rows = await source.loadRows({
      familyId: input.familyId,
      access,
      now: new Date(clock),
      timezone: family.timezone,
    });
  } catch {
    return fail("context_failed", language);
  }
  const built = buildContextPack({
    now: new Date(clock),
    timezone: family.timezone,
    language,
    access,
    rows,
  });
  if (!built.ok) return fail(built.code, language);
  const pack = built.pack;

  // 9: exactly one provider request (one-call latch).
  let calls = 0;
  const body = buildCareAgentRequest(
    CARE_AGENT_SYSTEM_PROMPT,
    buildUserText({ pack, question, recentTurns: turns, language }),
  );
  let content: string;
  try {
    calls++;
    if (calls > 1) throw new ProviderFailure("second_call_refused");
    content = await callProviderOnce({
      apiKey: (env.META_API_KEY ?? "").trim(),
      body,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs ?? CARE_AGENT_TIMEOUT_MS,
    });
  } catch (e) {
    return fail(
      "provider_error",
      language,
      e instanceof ProviderFailure ? e.code : "network_error",
    );
  }

  // 10: parse and validate. Any failure is the fixed "unverified" outcome; raw model text is never shown.
  const v = validateAgentAnswer(content, pack);
  if (!v.ok) return fail("unverified", language, v.code);

  // 11: canned substitution for a model refusal; otherwise server-derived sources and deterministic missing entries.
  if (v.answer.refusal !== null) {
    const answer: AgentAnswer = {
      answer: REFUSAL_COPY[language][v.answer.refusal],
      citations: [],
      missing: [],
      refusal: v.answer.refusal,
    };
    return { ok: true, language, answer, sources: [] };
  }
  const copy = MISSING_COPY[language];
  const extra: string[] = [];
  const citesHandoff = v.sources.some((s) => s.id.startsWith("handoff:"));
  if (access.schedule && !access.meds && (citesHandoff || HANDOFF_WORDS.test(question)))
    extra.push(copy.withheldHandoff);
  if (v.sources.some((s) => !s.id.startsWith("handoff:") && pack.byId.get(s.id)?.withheld))
    extra.push(copy.withheldDetails);
  for (const cat of ["visits", "meds", "schedule"] as const)
    if (!access[cat] && KEYWORDS[cat].test(question)) extra.push(copy.notVisible[cat]);
  const missing = [
    ...v.answer.missing.slice(0, Math.max(0, AGENT_LIMITS.missingMax - extra.length)),
    ...new Set(extra),
  ].slice(0, AGENT_LIMITS.missingMax);
  return { ok: true, language, answer: { ...v.answer, missing }, sources: v.sources };
}
