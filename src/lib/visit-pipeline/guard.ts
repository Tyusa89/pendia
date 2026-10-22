// The safety rule behind the visit loop: only what the CLINICIAN said can become a proposed item. Anything sourced from a
// patient or family turn (like "tell him to call the lab first") is rejected, however the speaker labels were assigned.
// Enforced in code so it holds for demo data today and for model output later. Fails closed.
import type { ConfirmedSpeakerMap, SpeakerRole, TranscriptResult, VisitExtraction } from "./types";

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export interface RejectedItem {
  id: string;
  speaker: string;
  role: SpeakerRole | "unmapped";
  reason: string;
}
export interface GuardResult {
  /** The extraction with rejected items removed. */
  extraction: VisitExtraction;
  rejected: RejectedItem[];
}

/** Throws unless a person confirmed the map, it names a clinician, and it covers every speaker in the transcript. */
export function assertSpeakerMap(map: ConfirmedSpeakerMap, transcript: TranscriptResult): void {
  if (!map || map.confirmed !== true)
    throw new GuardError("Speakers must be confirmed before anything is extracted.");
  const roles = Object.values(map.map);
  if (!roles.includes("doctor"))
    throw new GuardError("Mark which speaker is the doctor before extraction.");
  const missing = [...new Set(transcript.segments.map((s) => s.speaker))].filter(
    (s) => !(s in map.map),
  );
  if (missing.length) throw new GuardError(`Speaker ${missing.join(", ")} has no role yet.`);
}

export function guardExtraction(
  extraction: VisitExtraction,
  transcript: TranscriptResult,
  speakerMap: ConfirmedSpeakerMap,
): GuardResult {
  assertSpeakerMap(speakerMap, transcript);
  const rejected: RejectedItem[] = [];
  const check = <T extends { id: string; source: { speaker: string } }>(items: T[]): T[] =>
    items.filter((i) => {
      const role = speakerMap.map[i.source.speaker];
      if (role === "doctor") return true;
      rejected.push({
        id: i.id,
        speaker: i.source.speaker,
        role: role ?? "unmapped",
        reason: "Only what the doctor said can become a proposed item.",
      });
      return false;
    });
  return {
    extraction: {
      ...extraction,
      med_changes: check(extraction.med_changes),
      tasks: check(extraction.tasks),
      watch_items: check(extraction.watch_items),
    },
    rejected,
  };
}
