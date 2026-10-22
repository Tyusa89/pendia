// The Demo Mode walkthrough as a small state machine. Pure: no timers, no I/O. Invalid moves are ignored, so a screen can
// never get ahead of what the person has actually done (no skipping consent, no extraction before the speakers are
// confirmed). Nothing here is persisted; reset returns to the start.
import type { RejectedItem } from "@/lib/visit-pipeline/guard";
import type {
  Delivery,
  InboundReply,
  SpeakerRole,
  TranscriptResult,
  VisitExtraction,
} from "@/lib/visit-pipeline/types";

export type Step = "intro" | "consent" | "visit" | "speakers" | "summary" | "followup" | "done";
export const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: "intro", label: "Start" },
  { id: "consent", label: "Consent" },
  { id: "visit", label: "Visit" },
  { id: "speakers", label: "Speakers" },
  { id: "summary", label: "Review" },
  { id: "followup", label: "Follow-up" },
  { id: "done", label: "Wrap-up" },
];

export type RoleChoice = SpeakerRole | "";
export interface DemoState {
  step: Step;
  consent: boolean;
  /** Waiting for the (cached) pipeline. */
  busy: boolean;
  error: string | null;
  transcript: TranscriptResult | null;
  /** How many transcript lines have appeared so far. */
  revealed: number;
  playing: boolean;
  /** The speaker roles as currently chosen. They count only once `speakersConfirmed`. */
  roles: Record<string, RoleChoice>;
  speakersConfirmed: boolean;
  extraction: VisitExtraction | null;
  rejected: RejectedItem[];
  /** A person's decision on each proposed item. Nothing is decided for them. */
  decisions: Record<string, Decision>;
  /** Who a confirmed follow-up is assigned to (a task cannot be confirmed without one). */
  owners: Record<string, string>;
  /** What the simulated notifier "sent" for each confirmed task, and the made-up reply. */
  followUps: Record<string, FollowUp>;
}
export type Decision = "confirmed" | "rejected";
export interface FollowUp {
  delivery: Delivery | null;
  reply: InboundReply | null;
}

export const initialState: DemoState = {
  step: "intro",
  consent: false,
  busy: false,
  error: null,
  transcript: null,
  revealed: 0,
  playing: false,
  roles: {},
  speakersConfirmed: false,
  extraction: null,
  rejected: [],
  decisions: {},
  owners: {},
  followUps: {},
};

export type Action =
  | { type: "begin" }
  | { type: "setConsent"; value: boolean }
  | { type: "startVisit" }
  | {
      type: "transcriptLoaded";
      transcript: TranscriptResult;
      suggestion: Record<string, SpeakerRole>;
    }
  | { type: "reveal" }
  | { type: "setPlaying"; value: boolean }
  | { type: "skipToEnd" }
  | { type: "toSpeakers" }
  | { type: "setRole"; label: string; role: RoleChoice }
  | { type: "confirmSpeakers" }
  | { type: "extractionLoaded"; extraction: VisitExtraction; rejected: RejectedItem[] }
  | { type: "setOwner"; taskId: string; owner: string }
  | { type: "decide"; id: string; decision: Decision | null }
  | { type: "toFollowup" }
  | { type: "deliveryReady"; taskId: string; delivery: Delivery }
  | { type: "replyReceived"; taskId: string; reply: InboundReply }
  | { type: "finish" }
  | { type: "failed"; message: string }
  | { type: "reset" };

export const speakerLabels = (t: TranscriptResult | null): string[] => [
  ...new Set((t?.segments ?? []).map((s) => s.speaker)),
];
export const itemIds = (x: VisitExtraction | null): string[] =>
  x ? [...x.med_changes, ...x.tasks, ...x.watch_items].map((i) => i.id) : [];
export const allDecided = (s: DemoState) => itemIds(s.extraction).every((id) => !!s.decisions[id]);
/** Confirmed tasks: these are the ones that get a (simulated) text. */
export const confirmedTasks = (s: DemoState) =>
  (s.extraction?.tasks ?? []).filter((t) => s.decisions[t.id] === "confirmed");
export const allRevealed = (s: DemoState) =>
  !!s.transcript && s.revealed >= s.transcript.segments.length;
/** A doctor is chosen and every speaker has a role. */
export const rolesComplete = (s: DemoState) =>
  speakerLabels(s.transcript).every((l) => !!s.roles[l]) &&
  Object.values(s.roles).includes("doctor");

const omit = <T>(o: Record<string, T>, k: string): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));

export function reducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case "begin":
      return s.step === "intro" ? { ...s, step: "consent" } : s;
    case "setConsent":
      return s.step === "consent" ? { ...s, consent: a.value } : s;
    case "startVisit":
      return s.step === "consent" && s.consent && !s.busy ? { ...s, busy: true, error: null } : s;
    case "transcriptLoaded":
      if (s.step !== "consent" || !s.busy) return s;
      return {
        ...s,
        step: "visit",
        busy: false,
        transcript: a.transcript,
        revealed: 0,
        playing: true,
        roles: { ...a.suggestion },
      };
    case "reveal":
      return s.step === "visit" && s.transcript && !allRevealed(s)
        ? { ...s, revealed: s.revealed + 1 }
        : s;
    case "setPlaying":
      return s.step === "visit" ? { ...s, playing: a.value } : s;
    case "skipToEnd":
      return s.step === "visit" && s.transcript
        ? { ...s, revealed: s.transcript.segments.length, playing: false }
        : s;
    case "toSpeakers":
      return s.step === "visit" && allRevealed(s) ? { ...s, step: "speakers", playing: false } : s;
    case "setRole":
      return s.step === "speakers" && !s.busy
        ? { ...s, roles: { ...s.roles, [a.label]: a.role }, speakersConfirmed: false }
        : s;
    case "confirmSpeakers":
      return s.step === "speakers" && !s.busy && rolesComplete(s)
        ? { ...s, busy: true, error: null, speakersConfirmed: true }
        : s;
    case "extractionLoaded":
      if (s.step !== "speakers" || !s.busy || !s.speakersConfirmed) return s;
      return { ...s, step: "summary", busy: false, extraction: a.extraction, rejected: a.rejected };
    case "setOwner":
      return s.step === "summary" && s.extraction?.tasks.some((t) => t.id === a.taskId)
        ? {
            ...s,
            owners: { ...s.owners, [a.taskId]: a.owner },
            // choosing nobody withdraws a confirmation that depended on it
            decisions:
              a.owner || s.decisions[a.taskId] !== "confirmed"
                ? s.decisions
                : omit(s.decisions, a.taskId),
          }
        : s;
    case "decide": {
      if (s.step !== "summary" || !itemIds(s.extraction).includes(a.id)) return s;
      if (a.decision === null) return { ...s, decisions: omit(s.decisions, a.id) };
      const isTask = s.extraction!.tasks.some((t) => t.id === a.id);
      if (a.decision === "confirmed" && isTask && !s.owners[a.id]) return s; // a follow-up needs a person
      return { ...s, decisions: { ...s.decisions, [a.id]: a.decision } };
    }
    case "toFollowup": {
      if (s.step !== "summary" || !allDecided(s)) return s;
      const tasks = confirmedTasks(s);
      return {
        ...s,
        step: tasks.length ? "followup" : "done",
        followUps: Object.fromEntries(tasks.map((t) => [t.id, { delivery: null, reply: null }])),
      };
    }
    case "deliveryReady":
      return s.step === "followup" && s.followUps[a.taskId] && !s.followUps[a.taskId]!.delivery
        ? {
            ...s,
            followUps: {
              ...s.followUps,
              [a.taskId]: { ...s.followUps[a.taskId]!, delivery: a.delivery },
            },
          }
        : s;
    case "replyReceived":
      return s.step === "followup" &&
        s.followUps[a.taskId]?.delivery &&
        !s.followUps[a.taskId]!.reply
        ? {
            ...s,
            followUps: {
              ...s.followUps,
              [a.taskId]: { ...s.followUps[a.taskId]!, reply: a.reply },
            },
          }
        : s;
    case "finish":
      return s.step === "followup" ? { ...s, step: "done" } : s;
    case "failed":
      return {
        ...s,
        busy: false,
        error: a.message,
        speakersConfirmed: s.step === "speakers" ? false : s.speakersConfirmed,
      };
    case "reset":
      return initialState;
  }
}
