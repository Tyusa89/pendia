// The only way the app obtains a visit pipeline. Today that is Demo Mode and nothing else: there is no client-side switch
// to "live". The live providers (Muse Voice Transcribe, Muse Spark 1.3 Standard) will be server functions that hold the
// Meta key, added behind these same interfaces after the live spike is approved.
import { createDemoPipeline } from "./demo";
import type { VisitPipeline } from "./types";

export const PIPELINE_MODE = "demo" as const;

export function getVisitPipeline(mode: string = PIPELINE_MODE): VisitPipeline {
  if (mode !== "demo")
    throw new Error("Live visit processing is not enabled. Only Demo Mode is available.");
  return createDemoPipeline();
}

export * from "./types";
export { DEMO_BANNER, DEMO_BANNER_TEXT, NOT_MEDICAL_ADVICE, provenanceLabel } from "./labels";
export { guardExtraction, assertSpeakerMap, GuardError } from "./guard";
export {
  DEMO_DOCTOR,
  DEMO_EXTRACTION,
  DEMO_FAMILY,
  DEMO_NOTE,
  DEMO_PATIENT,
  DEMO_SPEAKER_SUGGESTION,
  DEMO_TRANSCRIPT,
} from "./fixture";
export {
  checkAgainstTranscript,
  parseTranscriptResult,
  parseVisitExtraction,
  ProviderOutputError,
} from "./schema";
export { simulatedReply } from "./demo";
