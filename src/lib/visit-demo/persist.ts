// Session-scoped recovery for Demo Mode's SYNTHETIC progress. If the page reloads or remounts (for example the Lovable
// preview reloading after a sync), the walkthrough returns to the step the person was on.
//
// What is stored (sessionStorage, this tab only, ends with the tab): the step, the consent tick, how many transcript
// lines have appeared, the speaker roles and their confirmation, each Confirm/Reject, who a follow-up is assigned to, and
// two flags per follow-up (message prepared, simulated reply received). That is all. NO transcript, summary, quote or
// message text is stored: those come from the synthetic fixtures and templates again on restore, and every stored value
// is re-checked against them. Nothing real exists in Demo Mode, and this module never talks to a network, database,
// SMS service or AI model. The real visit workflow does not import it (a test enforces that).
import { z } from "zod";
import {
  STEPS,
  allDecided,
  confirmedTasks,
  initialState,
  itemIds,
  rolesComplete,
  speakerLabels,
  type Decision,
  type DemoState,
  type FollowUp,
  type RoleChoice,
  type Step,
} from "@/lib/visit-demo/state";
import { DEMO_FAMILY } from "@/lib/visit-pipeline/fixture";
import type {
  Delivery,
  InboundReply,
  SpeakerRole,
  TranscriptResult,
  VisitExtraction,
} from "@/lib/visit-pipeline/types";

export const STORAGE_KEY = "pendia.demo.visit";
export const STORAGE_VERSION = 1;
/** A valid saved state is well under 1 KB; anything bigger is not ours. */
export const MAX_STORED_BYTES = 4096;

const stepIds = STEPS.map((s) => s.id) as [Step, ...Step[]];
const ROLES = ["doctor", "patient", "family", "other"] as const satisfies readonly SpeakerRole[];
const speakerLabel = z.string().regex(/^[A-Z]$/);
const itemId = z.string().regex(/^(med|task|watch)-[0-9]{1,3}$/);

const persistedSchema = z
  .object({
    v: z.literal(STORAGE_VERSION),
    step: z.enum(stepIds),
    consent: z.boolean(),
    revealed: z.number().int().min(0).max(100),
    roles: z.record(speakerLabel, z.enum(ROLES)),
    speakersConfirmed: z.boolean(),
    decisions: z.record(itemId, z.enum(["confirmed", "rejected"])),
    owners: z.record(itemId, z.enum(DEMO_FAMILY)),
    followUps: z.record(
      itemId,
      z.object({ delivered: z.boolean(), replied: z.boolean() }).strict(),
    ),
  })
  .strict();

export type PersistedDemo = z.infer<typeof persistedSchema>;

const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

/** The part of the state worth keeping. Never includes transcript, summary or message text. */
export function toPersisted(s: DemoState): PersistedDemo | null {
  if (s.step === "intro") return null; // nothing to recover at the very start
  const roles: Record<string, SpeakerRole> = {};
  for (const [k, v] of Object.entries(s.roles)) if (v) roles[k] = v;
  const past = stepIndex(s.step) >= stepIndex("summary");
  return {
    v: STORAGE_VERSION,
    step: s.step,
    consent: s.consent,
    revealed: s.revealed,
    roles,
    // a confirmation still being processed is not a confirmation yet
    speakersConfirmed: past && s.speakersConfirmed,
    decisions: { ...s.decisions },
    owners: Object.fromEntries(
      Object.entries(s.owners).filter(([, v]) => (DEMO_FAMILY as readonly string[]).includes(v)),
    ) as PersistedDemo["owners"],
    followUps: Object.fromEntries(
      Object.entries(s.followUps).map(([id, f]) => [
        id,
        { delivered: !!f.delivery, replied: !!f.reply },
      ]),
    ),
  };
}

/** Parses and validates saved text. Returns null for anything missing, oversized, malformed, tampered or outdated. */
export function parsePersisted(raw: string | null): PersistedDemo | null {
  if (!raw || raw.length > MAX_STORED_BYTES) return null;
  try {
    const r = persistedSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ---- storage access: never throws, works with no storage at all ----
function store(): Storage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null; // blocked storage can throw on access
  }
}
export function clearDemoState(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
export function saveDemoState(s: DemoState): void {
  try {
    const p = toPersisted(s);
    if (!p) return;
    const text = JSON.stringify(p);
    if (text.length <= MAX_STORED_BYTES) store()?.setItem(STORAGE_KEY, text);
  } catch {
    /* storage full or blocked: the demo simply runs without recovery */
  }
}
/** The saved progress, or null. Invalid data is removed so it cannot cause trouble again. */
export function loadDemoState(): PersistedDemo | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return null;
    const p = parsePersisted(raw);
    if (!p) clearDemoState();
    return p;
  } catch {
    return null;
  }
}

/** What the screens need from the cached fixtures to rebuild a saved state. */
export interface RestoreSources {
  transcript: TranscriptResult | null;
  extraction: VisitExtraction | null;
  /** Rebuilt (not stored) so the simulated text and reply are the real template output. */
  delivery: (taskId: string, owner: string) => Delivery;
  reply: (owner: string) => InboundReply;
}

/** Which fixtures a saved state needs; the caller loads them before calling buildRestoredState. */
export const needsTranscript = (p: PersistedDemo) => stepIndex(p.step) >= stepIndex("visit");
export const needsExtraction = (p: PersistedDemo) => stepIndex(p.step) >= stepIndex("summary");

/**
 * Rebuilds a full state from saved choices plus the fixtures, checking every value against them. Returns null if anything
 * does not fit (so a tampered or stale entry can never produce an impossible screen).
 */
export function buildRestoredState(p: PersistedDemo, src: RestoreSources): DemoState | null {
  const at = stepIndex(p.step);
  const t = src.transcript;
  const x = src.extraction;
  if (at >= stepIndex("visit") && !t) return null;
  if (at >= stepIndex("summary") && !x) return null;
  if (at >= stepIndex("visit") && !p.consent) return null;
  if (p.step === "intro") return null;
  if (at < stepIndex("visit") && (p.revealed !== 0 || Object.keys(p.roles).length)) return null;

  const base: DemoState = {
    ...initialState,
    step: p.step,
    consent: p.consent,
    transcript: t,
    extraction: x,
    revealed: 0,
    roles: p.roles as Record<string, RoleChoice>,
    speakersConfirmed: p.speakersConfirmed,
    decisions: p.decisions as Record<string, Decision>,
    owners: p.owners,
  };
  if (at >= stepIndex("visit") && t) {
    if (p.revealed > t.segments.length) return null;
    base.revealed = at >= stepIndex("speakers") ? t.segments.length : p.revealed;
    if (at >= stepIndex("speakers") && p.revealed !== t.segments.length) return null;
    // every voice in the transcript has a role (the suggestion is kept until the person changes it)
    const labels = speakerLabels(t);
    if (Object.keys(p.roles).some((k) => !labels.includes(k))) return null;
    if (at >= stepIndex("speakers") && !labels.every((l) => p.roles[l])) return null;
  }
  if (at >= stepIndex("summary")) {
    if (!p.speakersConfirmed || !rolesComplete(base)) return null;
    const ids = new Set(itemIds(x));
    if (Object.keys(p.decisions).some((id) => !ids.has(id))) return null;
    const taskIds = new Set(x!.tasks.map((k) => k.id));
    if (Object.keys(p.owners).some((id) => !taskIds.has(id))) return null;
    if (
      Object.entries(p.decisions).some(
        ([id, d]) => d === "confirmed" && taskIds.has(id) && !p.owners[id],
      )
    )
      return null;
  } else if (
    Object.keys(p.decisions).length ||
    Object.keys(p.owners).length ||
    Object.keys(p.followUps).length ||
    p.speakersConfirmed
  ) {
    return null;
  }
  if (at >= stepIndex("followup")) {
    if (!allDecided(base)) return null;
    const confirmed = confirmedTasks(base).map((k) => k.id);
    if (p.step === "followup" && confirmed.length === 0) return null;
    if (Object.keys(p.followUps).some((id) => !confirmed.includes(id))) return null;
    const followUps: Record<string, FollowUp> = {};
    for (const id of confirmed) {
      const f = p.followUps[id];
      if (!f) {
        if (p.step === "followup") return null;
        continue;
      }
      if (f.replied && !f.delivered) return null;
      followUps[id] = {
        delivery: f.delivered ? src.delivery(id, p.owners[id]!) : null,
        reply: f.replied ? src.reply(p.owners[id]!) : null,
      };
    }
    base.followUps = followUps;
  } else if (Object.keys(p.followUps).length) {
    return null;
  }
  return base; // busy, error and playing are deliberately fresh: playback restores PAUSED
}
