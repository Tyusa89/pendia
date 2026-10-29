// SERVER ONLY. Appointment-letter extraction. Imported only from the server-function handlers in
// src/lib/doc-upload/doc-extract.functions.ts (dynamic import). Stateless: nothing about a document, page, extraction or provider
// response is stored or logged, and there is no `console` call here. Errors are fixed codes.
//
// Modes (DOC_EXTRACT_ENABLED / DOC_EXTRACT_SIMULATED, both off by default):
//   live       DOC_EXTRACT_ENABLED === "true" + META_API_KEY + caller in DOC_EXTRACT_USER_IDS + DEMO family only (fictional letters)
//   simulated  DOC_EXTRACT_SIMULATED === "true" (and live off): returns a fixed fictional sample, labelled simulated, NO Meta call
//   off        anything else: the caller enters the appointment manually
// Gate order: config -> allow-list (live) -> membership + organizer -> path belongs to this family -> input -> document readable
//             -> demo family (live) -> rate limit (live) -> ONE provider call -> strict parse.
import { SPARK_CHAT_URL, SparkHttpError, parseChatCompletion } from "@/lib/spark/spark-http";
import {
  DOC_MAX_PAGES,
  PAGE_IMAGE_MAX_BYTES,
  PAGES_TOTAL_MAX_BYTES,
  SIMULATED_EXTRACTION,
  docPathFamily,
  parseExtraction,
  sniffKind,
  type Extraction,
} from "@/lib/doc-upload/contract";
import { buildDocExtractRequest, type PageImage } from "@/lib/doc-upload/prompt";

export interface DocExtractEnv {
  DOC_EXTRACT_ENABLED?: string | undefined;
  DOC_EXTRACT_SIMULATED?: string | undefined;
  DOC_EXTRACT_USER_IDS?: string | undefined;
  META_API_KEY?: string | undefined;
}
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export const DOC_EXTRACT_TIMEOUT_MS = 60_000;
export const DOC_EXTRACT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const DOC_EXTRACT_RATE = { perUser: 10, perInstance: 30, windowMs: 3_600_000 } as const;

export type DocExtractMode = "live" | "simulated" | "off";

export function docExtractMode(env: DocExtractEnv): DocExtractMode {
  const key = (env.META_API_KEY ?? "").trim();
  const keyOk =
    key !== "" && ![...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127);
  if (env.DOC_EXTRACT_ENABLED === "true" && keyOk) return "live";
  if (env.DOC_EXTRACT_SIMULATED === "true") return "simulated";
  return "off";
}
export function docExtractAllowlisted(env: DocExtractEnv, userId: string): boolean {
  const ids = (env.DOC_EXTRACT_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 && ids.includes(userId);
}

const userCalls = new Map<string, number[]>();
let instanceCalls: number[] = [];
export function resetDocExtractLimits(): void {
  userCalls.clear();
  instanceCalls = [];
}
function takeRateSlot(userId: string, clock: number): boolean {
  const since = clock - DOC_EXTRACT_RATE.windowMs;
  const mine = (userCalls.get(userId) ?? []).filter((t) => t > since);
  instanceCalls = instanceCalls.filter((t) => t > since);
  if (
    mine.length >= DOC_EXTRACT_RATE.perUser ||
    instanceCalls.length >= DOC_EXTRACT_RATE.perInstance
  ) {
    userCalls.set(userId, mine);
    return false;
  }
  userCalls.set(userId, [...mine, clock]);
  instanceCalls.push(clock);
  return true;
}

export interface DocSource {
  /** The caller's own member row in that family (caller session / RLS), or null. Throws on a failed lookup. */
  getMember(familyId: string): Promise<{ role: string } | null>;
  getFamily(familyId: string): Promise<{ is_demo: boolean | null; timezone: string } | null>;
  /** True only if the caller's own session can read the stored object (storage RLS). Throws on a failed lookup. */
  canReadDocument(path: string): Promise<boolean>;
}

export type DocExtractCode =
  | "not_enabled"
  | "not_member"
  | "not_organizer"
  | "not_demo_family"
  | "lookup_failed"
  | "bad_path"
  | "bad_input"
  | "document_not_found"
  | "rate_limited"
  | "provider_error"
  | "unreadable"
  | "not_a_letter";
export type DocExtractResult =
  | { ok: true; source: "meta" | "simulated"; extraction: Extraction; timeZone: string }
  | { ok: false; code: DocExtractCode };

export type DocStatus =
  | { mode: DocExtractMode; state: "available"; timeZone: string }
  | { mode: "off"; state: "not_enabled" | "not_member" | "not_organizer" | "lookup_failed" };

const fail = (code: DocExtractCode): DocExtractResult => ({ ok: false, code });

async function gate(
  env: DocExtractEnv,
  userId: string,
  familyId: string,
  source: DocSource,
): Promise<
  | { ok: true; mode: Exclude<DocExtractMode, "off">; timeZone: string; isDemo: boolean }
  | { ok: false; code: DocExtractCode }
> {
  const mode = docExtractMode(env);
  if (mode === "off") return { ok: false, code: "not_enabled" };
  if (mode === "live" && !docExtractAllowlisted(env, userId))
    return { ok: false, code: "not_enabled" };
  try {
    const m = await source.getMember(familyId);
    if (!m) return { ok: false, code: "not_member" };
    if (m.role !== "organizer") return { ok: false, code: "not_organizer" };
    const f = await source.getFamily(familyId);
    if (!f) return { ok: false, code: "not_member" };
    return { ok: true, mode, timeZone: f.timezone, isDemo: f.is_demo === true };
  } catch {
    return { ok: false, code: "lookup_failed" };
  }
}

/** What the upload page may offer. Independently re-checked by extraction; never an authorization. */
export async function docExtractStatus(opts: {
  env: DocExtractEnv;
  userId: string;
  familyId: string;
  source: DocSource;
}): Promise<DocStatus> {
  const g = await gate(opts.env, opts.userId, opts.familyId, opts.source);
  if (!g.ok) {
    const c = g.code;
    return {
      mode: "off",
      state:
        c === "not_member" || c === "not_organizer" || c === "lookup_failed" ? c : "not_enabled",
    };
  }
  // Live mode is demo-family only: for any other family the upload still works, extraction is simply unavailable.
  if (g.mode === "live" && !g.isDemo) return { mode: "off", state: "not_enabled" };
  return { mode: g.mode, state: "available", timeZone: g.timeZone };
}

// ---- input validation ---------------------------------------------------------------------------------------------------------------
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export function validatePages(pages: unknown): PageImage[] | null {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > DOC_MAX_PAGES) return null;
  const out: PageImage[] = [];
  let total = 0;
  for (const p of pages) {
    if (!p || typeof p !== "object") return null;
    const { mime, base64 } = p as { mime?: unknown; base64?: unknown };
    if ((mime !== "image/jpeg" && mime !== "image/png") || typeof base64 !== "string") return null;
    if (base64.length < 8 || !B64.test(base64) || base64.length % 4 !== 0) return null;
    const bytes =
      (base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (bytes > PAGE_IMAGE_MAX_BYTES) return null;
    total += bytes;
    if (total > PAGES_TOTAL_MAX_BYTES) return null;
    let head: Uint8Array;
    try {
      head = Uint8Array.from(atob(base64.slice(0, 16)), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
    const kind = sniffKind(head);
    if (kind !== (mime === "image/jpeg" ? "jpeg" : "png")) return null; // bytes must match the declared type; PDFs are rendered client-side
    out.push({ mime, base64 });
  }
  return out;
}

// ---- transport ---------------------------------------------------------------------------------------------------------------------
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

/** EXACTLY one POST. Key only in Authorization; redirects refused; 60 s timeout; 1 MB reply bound; no retry. */
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
    text = await readBounded(res, DOC_EXTRACT_MAX_RESPONSE_BYTES);
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

// ---- extraction ----------------------------------------------------------------------------------------------------------------------
export async function extractAppointmentLetter(opts: {
  env: DocExtractEnv;
  userId: string;
  input: { familyId: string; path: string; pages: unknown };
  source: DocSource;
  fetchImpl: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}): Promise<DocExtractResult> {
  const { env, userId, input, source } = opts;
  const g = await gate(env, userId, input.familyId, source);
  if (!g.ok) return fail(g.code);

  // the stored object must live in THIS family's folder (the database/storage RLS enforces the same rule)
  if (docPathFamily(input.path) !== input.familyId.toLowerCase()) return fail("bad_path");
  const pages = validatePages(input.pages);
  if (!pages) return fail("bad_input");
  try {
    if (!(await source.canReadDocument(input.path))) return fail("document_not_found");
  } catch {
    return fail("lookup_failed");
  }

  if (g.mode === "simulated")
    return {
      ok: true,
      source: "simulated",
      extraction: SIMULATED_EXTRACTION,
      timeZone: g.timeZone,
    };

  // live: fictional/demo families only, so a real family's document is never sent to Meta
  if (!g.isDemo) return fail("not_demo_family");
  if (!takeRateSlot(userId, (opts.now ?? Date.now)())) return fail("rate_limited");

  let content: string;
  try {
    content = await callProviderOnce({
      apiKey: (env.META_API_KEY ?? "").trim(),
      body: buildDocExtractRequest(pages, g.timeZone),
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs ?? DOC_EXTRACT_TIMEOUT_MS,
    });
  } catch {
    return fail("provider_error");
  }
  const parsed = parseExtraction(content);
  if (!parsed.ok) return fail(parsed.code === "not_a_letter" ? "not_a_letter" : "unreadable");
  return { ok: true, source: "meta", extraction: parsed.extraction, timeZone: g.timeZone };
}
