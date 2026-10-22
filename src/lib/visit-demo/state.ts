// The Demo Mode walkthrough as a small state machine. Pure: no timers, no I/O. Invalid moves are ignored, so a screen can
// never get ahead of what the person has actually done (no skipping consent, no extraction before the speakers are
// confirmed). Nothing here is persisted; reset returns to the start.
import type { RejectedItem } from "@/lib/visit-pipeline/guard";
import type { SpeakerRole, TranscriptResult, VisitExtraction } from "@/lib/visit-pipeline/types";

export type Step = "intro" | "consent" | "visit" | "speakers" | "summary";
export const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: "intro", label: "Start" },
  { id: "consent", label: "Consent" },
  { id: "visit", label: "Visit" },
  { id: "speakers", label: "Speakers" },
  { id: "summary", label: "Summary" },
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
  | { type: "failed"; message: string }
  | { type: "reset" };

export const speakerLabels = (t: TranscriptResult | null): string[] => [
  ...new Set((t?.segments ?? []).map((s) => s.speaker)),
];
export const allRevealed = (s: DemoState) =>
  !!s.transcript && s.revealed >= s.transcript.segments.length;
/** A doctor is chosen and every speaker has a role. */
export const rolesComplete = (s: DemoState) =>
  speakerLabels(s.transcript).every((l) => !!s.roles[l]) &&
  Object.values(s.roles).includes("doctor");

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
