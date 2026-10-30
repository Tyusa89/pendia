// SERVER ONLY. Guest (judge) Ask Pendia: a SEPARATE, unauthenticated path for the published Judge Demo. The audited member path
// (care-agent.server.ts, PR #54) is imported for its pure helpers only and is not modified or called.
//
// What makes it safe:
//  * Eligibility is independent of anything the client sends: there is no family identifier in the input. The one family this path
//    can ever serve is the fictional Judge Demo snapshot compiled into the server. A request that names ANY other family id (a
//    real one, a crafted one) is answered `not_enabled` before any read, cap spend or provider call.
//  * The evidence pack is built from that in-code snapshot only. There is no database client, no service-role client and no
//    import of any Supabase module in this file or its imports; no code path reaches live family data.
//  * Dose items and medication schedules are excluded BY CONSTRUCTION: the row builder has no doses input (it returns `doses: []`
//    from a literal) and drops `schedule`, and after assembly the pack is checked and the ask is refused if a dose item or a
//    schedule line is present anyway (a future change cannot slip one in unnoticed).
//  * Fails closed unless JUDGE_AGENT_LIVE_ENABLED is exactly "true" AND META_API_KEY is present AND the shared global cap store is
//    configured. Deleting the flag is the kill switch.
//  * Same pipeline as the member path: question validation -> EN/ES advice pre-filter (zero cap spend, zero provider calls) -> hard
//    global cap -> pack -> exactly ONE provider POST (no retry) -> strict validation -> canned substitution; sources are derived
//    from validated citations; the pack never reaches the client; nothing is stored or logged.
import { SPARK_CHAT_URL, SparkHttpError, parseChatCompletion } from "@/lib/spark/spark-http";
import {
  AGENT_LIMITS,
  type AgentAnswer,
  type AskResult,
  type Language,
} from "@/lib/care-agent/contract";
import { REFUSAL_COPY, detectLanguage } from "@/lib/care-agent/copy";
import {
  buildContextPack,
  type HandoffFullRow,
  type PackAccess,
  type PackRows,
} from "@/lib/care-agent/pack";
import { prefilter } from "@/lib/care-agent/prefilter";
import { CARE_AGENT_SYSTEM_PROMPT, buildUserText, type RecentTurn } from "@/lib/care-agent/prompt";
import { validateAgentAnswer } from "@/lib/care-agent/validate";
import { judgeDemoData } from "@/lib/judge-demo-data";
import { JUDGE_DEMO_FAMILY_ID } from "@/lib/judge-demo";
import {
  buildCareAgentRequest,
  normalizeQuestion,
  CARE_AGENT_MAX_RESPONSE_BYTES,
  CARE_AGENT_TIMEOUT_MS,
  type FetchLike,
} from "./care-agent.server";
import { guestCapConfigured, takeGuestSlot, type GuestCapEnv } from "./guest-agent-limits.server";

export interface GuestAgentEnv extends GuestCapEnv {
  JUDGE_AGENT_LIVE_ENABLED?: string | undefined;
  META_API_KEY?: string | undefined;
}

/** The guest's whole input. Deliberately has NO way to choose a family; `familyId` exists only so a crafted one is refused. */
export interface GuestAskInput {
  question: string;
  recentTurns: Array<{ role: "user" | "assistant"; text: string }>;
  familyId?: unknown;
}

/** Exactly "true", a well-formed key, and a configured shared cap store. Anything else (absent, empty, "TRUE", " true") is off. */
export function guestAgentEnabled(env: GuestAgentEnv): boolean {
  const key = (env.META_API_KEY ?? "").trim();
  if (env.JUDGE_AGENT_LIVE_ENABLED !== "true" || key === "") return false;
  if ([...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return false;
  return guestCapConfigured(env);
}

export function guestAgentStatus(env: GuestAgentEnv): { state: "available" | "not_enabled" } {
  return { state: guestAgentEnabled(env) ? "available" : "not_enabled" };
}

const GUEST_ACCESS: PackAccess = { visits: true, meds: true, schedule: true };

/**
 * The ONLY evidence a guest can ever receive. Built from the fictional in-code snapshot. No doses input exists; medication
 * schedules are dropped; the handoff's medication answer is dropped (it is a dose-like report).
 */
export function guestPackRows(
  now: Date,
): Omit<PackRows, "handoffs" | "doses"> & { handoffs: HandoffFullRow[]; doses: [] } {
  const d = judgeDemoData(now);
  return {
    recipient: { id: d.recipient.id, name: d.recipient.name },
    members: d.members.map(({ id, name }) => ({ id, name })),
    medications: d.medications.map(({ id, name, dose, status }) => ({
      id,
      name,
      dose,
      schedule: null,
      status,
    })),
    visits: d.visits.map((v) => ({
      id: v.id,
      status: v.status,
      confirmation_status: v.confirmation_status,
      scheduled_start: v.scheduled_start,
      scheduled_end: v.scheduled_end,
      provider_name: v.provider_name,
      office_name: v.office_name,
      reason: v.reason,
      notes: v.notes,
      summary: v.summary,
    })),
    handoffs: d.handoffs.map((h) => ({
      id: h.id,
      created_at: h.created_at,
      author_member_id: h.author_member_id,
      ate: h.ate,
      meds_taken: null,
      note: h.note,
      unusual: h.unusual,
      watch_answers: {},
    })),
    shifts: d.shifts.map(({ id, start, end, assigned_member_id, status }) => ({
      id,
      start,
      end,
      assigned_member_id,
      status,
    })),
    medChanges: [],
    followUpTasks: [],
    followUpWatch: [],
    doses: [],
    tasks: [],
    watch: [],
    medNames: null,
  };
}

export function buildGuestPack(now: Date, language: Language) {
  const built = buildContextPack({
    now,
    timezone: judgeDemoData(now).family.timezone,
    language,
    access: GUEST_ACCESS,
    rows: guestPackRows(now),
  });
  if (!built.ok) return null;
  // belt and braces: refuse if a dose item or a schedule line is present anyway
  if (built.pack.items.some((i) => i.type === "dose")) return null;
  if (
    /schedule:/i.test(
      built.pack.items
        .filter((i) => i.type === "med")
        .map((i) => i.body)
        .join("\n"),
    )
  )
    return null;
  return built.pack;
}

// ---- transport: exactly one POST (mirrors the member path; that module's transport is private and is not edited) -------------------
class ProviderFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProviderFailure";
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
async function callProviderOnce(opts: {
  apiKey: string;
  body: unknown;
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

// ---- the ask -------------------------------------------------------------------------------------------------------------------------
/** Guests never see error detail: every failure is a fixed code. `not_enabled` is also what an exceeded cap returns. */
const fail = (code: Exclude<AskResult, { ok: true }>["code"], language: Language): AskResult => ({
  ok: false,
  code,
  language,
});

export async function askGuestAgent(opts: {
  env: GuestAgentEnv;
  input: GuestAskInput;
  fetchImpl: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}): Promise<AskResult> {
  const { env, input } = opts;
  // 1: the dedicated flag (and key, and shared cap store). Fails closed.
  if (!guestAgentEnabled(env)) return fail("not_enabled", "en");
  // 2: eligibility does not depend on the client. A supplied family id must be exactly the fictional snapshot's, else refuse
  // before ANY read, cap spend or provider call.
  if (input.familyId !== undefined && input.familyId !== JUDGE_DEMO_FAMILY_ID)
    return fail("not_enabled", "en");

  // 3: question and recent turns (untrusted client memory; never facts).
  const question = normalizeQuestion(input.question);
  const language = detectLanguage(question ?? String(input.question ?? ""), "en");
  if (question === null) return fail("invalid_question", language);
  if (!Array.isArray(input.recentTurns) || input.recentTurns.length > AGENT_LIMITS.recentTurnsMax)
    return fail("invalid_question", language);
  const turns: RecentTurn[] = [];
  for (const t of input.recentTurns) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string")
      return fail("invalid_question", language);
    const text = normalizeQuestion(t.text, AGENT_LIMITS.recentTurnMax);
    if (text === null) return fail("invalid_question", language);
    turns.push({ role: t.role, text });
  }

  // 4: deterministic EN/ES advice pre-filter: canned refusal, ZERO provider calls, no cap spend.
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

  // 5: the hard global cap. Exceeded, or not verifiable -> the canned unavailable response (never an error leak).
  const clock = (opts.now ?? Date.now)();
  try {
    if (!(await takeGuestSlot(env, clock, opts.fetchImpl))) return fail("not_enabled", language);
  } catch {
    return fail("not_enabled", language);
  }

  // 6: the snapshot pack (no doses, no schedules, no database).
  const pack = buildGuestPack(new Date(clock), language);
  if (!pack) return fail("context_failed", language);

  // 7: exactly one provider request.
  let content: string;
  try {
    content = await callProviderOnce({
      apiKey: (env.META_API_KEY ?? "").trim(),
      body: buildCareAgentRequest(
        CARE_AGENT_SYSTEM_PROMPT,
        buildUserText({ pack, question, recentTurns: turns, language }),
      ),
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs ?? CARE_AGENT_TIMEOUT_MS,
    });
  } catch {
    return fail("provider_error", language);
  }

  // 8: strict validation. Any failure is the fixed "unverified" outcome; raw model text is never shown.
  const v = validateAgentAnswer(content, pack);
  if (!v.ok) return fail("unverified", language);
  if (v.answer.refusal !== null) {
    const answer: AgentAnswer = {
      answer: REFUSAL_COPY[language][v.answer.refusal],
      citations: [],
      missing: [],
      refusal: v.answer.refusal,
    };
    return { ok: true, language, answer, sources: [] };
  }
  return {
    ok: true,
    language,
    answer: { ...v.answer, missing: v.answer.missing.slice(0, AGENT_LIMITS.missingMax) },
    sources: v.sources,
  };
}
