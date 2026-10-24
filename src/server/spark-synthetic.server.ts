// SERVER ONLY. Runs Muse Spark 1.3 (Standard) on the built-in FICTIONAL visit and returns a validated, evidence-linked DRAFT.
// It is the only caller of the live client, and it applies every gate before a request can be made:
//   1. SPARK_LIVE_ENABLED must be exactly "true" (off by default);
//   2. the caller's user id must be in SPARK_LIVE_USER_IDS (empty list = nobody);
//   3. META_API_KEY must be configured on the server;
//   4. a per-user rate cap (best effort: it is per server instance);
//   5. the transcript and speaker map are loaded HERE from the fixture: the caller supplies nothing.
// Nothing is saved, no database is touched, and nothing here knows about Demo Mode's state or UI.
import { DEMO_SPEAKER_SUGGESTION, DEMO_TRANSCRIPT } from "@/lib/visit-pipeline/fixture";
import { extractWithModel, type SparkRejection } from "@/lib/visit-pipeline/spark-contract";
import { SPARK_FIXTURE_ID } from "@/lib/spark/spark-live-input";
import { isLisinoprilTenToTwenty } from "@/lib/spark/dose-match";
import type { ConfirmedSpeakerMap, VisitExtraction } from "@/lib/visit-pipeline/types";
import { makeSparkComplete, type FetchLike, type SparkCallResult } from "./spark-live.server";
import type { SparkHttpError } from "@/lib/spark/spark-http";

export interface SparkEnv {
  SPARK_LIVE_ENABLED?: string | undefined;
  SPARK_LIVE_USER_IDS?: string | undefined;
  META_API_KEY?: string | undefined;
}

export const SPARK_RATE_MAX = 5;
export const SPARK_RATE_WINDOW_MS = 10 * 60_000;
export const SPARK_INSTANCE_MAX = 20;

const calls = new Map<string, number[]>();
let instanceCalls = 0;
export function _resetSparkRateForTests() {
  calls.clear();
  instanceCalls = 0;
}

export type SparkGate = "enabled" | "off" | "not_allowlisted" | "no_key";

export function sparkGate(env: SparkEnv, userId: string): SparkGate {
  if (env.SPARK_LIVE_ENABLED !== "true") return "off";
  const allowed = (env.SPARK_LIVE_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!userId || !allowed.includes(userId)) return "not_allowlisted";
  if (!(env.META_API_KEY ?? "").trim()) return "no_key";
  return "enabled";
}

/** Users outside the allow-list get `{ enabled: false }` and nothing else: no reason, no id, no hint about the flag or key. */
export type SparkStatus =
  { enabled: boolean } | { enabled: boolean; reason: "off" | "no_key" | null };

export function sparkStatus(env: SparkEnv, userId: string): SparkStatus {
  const allowed = (env.SPARK_LIVE_USER_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!userId || !allowed.includes(userId)) return { enabled: false };
  const g = sparkGate(env, userId);
  if (g === "enabled") return { enabled: true, reason: null };
  return { enabled: false, reason: g === "no_key" ? "no_key" : "off" };
}

export interface SparkCheck {
  /** a Lisinopril change from 10 mg to 20 mg (spelled out or in digits), from the doctor */
  medChange: boolean;
  /** the blood-test follow-up */
  task: boolean;
  /** the ankle-swelling watch item */
  watch: boolean;
  itemCount: number;
  /** items whose source turn is NOT a doctor turn: must always be 0 */
  nonDoctorItems: number;
  rejectedCount: number;
}

export type SyntheticResult =
  | {
      ok: true;
      label: string;
      extraction: VisitExtraction;
      rejected: SparkRejection[];
      uncertainty: Record<string, string | null>;
      check: SparkCheck;
      meta: {
        status: number | null;
        elapsedMs: number | null;
        usage: SparkCallResult["parsed"]["usage"] | null;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
      diagnostics?: { answerChars: number | null; answerKeys: string[] };
    };

const fail = (
  code: string,
  message: string,
  diagnostics?: { answerChars: number | null; answerKeys: string[] },
): SyntheticResult => ({
  ok: false,
  code,
  message,
  ...(diagnostics ? { diagnostics } : {}),
});

function summarize(
  x: VisitExtraction,
  rejected: SparkRejection[],
  map: ConfirmedSpeakerMap,
): SparkCheck {
  const all = [...x.med_changes, ...x.tasks, ...x.watch_items];
  return {
    medChange: x.med_changes.some(isLisinoprilTenToTwenty),
    task: x.tasks.some((t) => /blood test|drive/i.test(t.title)),
    watch: x.watch_items.some((w) => /ankle/i.test(w.text)),
    itemCount: all.length,
    nonDoctorItems: all.filter((i) => map.map[i.source.speaker] !== "doctor").length,
    rejectedCount: rejected.length,
  };
}

/** Top-level key NAMES only (never values) of an answer that failed validation, so a shape mismatch is diagnosable. */
function answerShape(content: string | null): { answerChars: number | null; answerKeys: string[] } {
  if (content === null) return { answerChars: null, answerKeys: [] };
  let keys: string[] = [];
  try {
    const j = JSON.parse(content) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j))
      keys = Object.keys(j)
        .filter((k) => /^[A-Za-z0-9_.-]{1,40}$/.test(k))
        .sort()
        .slice(0, 20);
  } catch {
    /* not JSON */
  }
  return { answerChars: content.length, answerKeys: keys };
}

export async function runSyntheticExtraction(opts: {
  env: SparkEnv;
  userId: string;
  fetchImpl: FetchLike;
  now?: () => Date;
}): Promise<SyntheticResult> {
  const gate = sparkGate(opts.env, opts.userId);
  if (gate !== "enabled") return fail("not_enabled", "This tool is not enabled.");

  const clock = (opts.now ?? (() => new Date()))().getTime();
  const recent = (calls.get(opts.userId) ?? []).filter((t) => clock - t < SPARK_RATE_WINDOW_MS);
  if (recent.length >= SPARK_RATE_MAX || instanceCalls >= SPARK_INSTANCE_MAX)
    return fail("rate_limited", "Too many runs. Wait a few minutes.");
  recent.push(clock);
  calls.set(opts.userId, recent);
  instanceCalls += 1;

  // everything the model sees comes from the fixture, never from the caller
  const transcript = DEMO_TRANSCRIPT;
  const speakerMap: ConfirmedSpeakerMap = { map: { ...DEMO_SPEAKER_SUGGESTION }, confirmed: true };

  let answer: string | null = null;
  let call: SparkCallResult | null = null;
  let callError: SparkHttpError | null = null;
  const complete = makeSparkComplete({
    apiKey: (opts.env.META_API_KEY ?? "").trim(),
    fetchImpl: opts.fetchImpl,
    onResult: (r) => {
      call = r;
      answer = r.parsed.content;
    },
    onError: (e) => {
      callError = e;
    },
  });

  try {
    const r = await extractWithModel({
      transcript,
      speakerMap,
      complete,
      ...(opts.now ? { now: opts.now } : {}),
    });
    const c = call as SparkCallResult | null;
    return {
      ok: true,
      label:
        "Draft, not confirmed. Live Meta Muse Spark 1.3 (Standard) on a fictional visit. Nothing is saved.",
      extraction: r.extraction,
      rejected: r.rejected,
      uncertainty: r.uncertainty,
      check: summarize(r.extraction, r.rejected, speakerMap),
      meta: {
        status: c?.status ?? null,
        elapsedMs: c?.elapsedMs ?? null,
        usage: c?.parsed.usage ?? null,
      },
    };
  } catch (e) {
    const ce = callError as SparkHttpError | null;
    if (ce) return fail(ce.code, ce.message); // fixed code + safe message (cause code / provider token only)
    const name = (e as { name?: string } | null)?.name;
    if (name === "ProviderOutputError")
      return fail(
        "invalid_answer",
        "The model's answer was rejected by the contract.",
        answerShape(answer),
      );
    if (name === "GuardError")
      return fail("guard_refused", "The speaker map gate refused the run.");
    return fail("internal_error", "An unexpected error occurred.");
  }
}

export { SPARK_FIXTURE_ID };
