// Demo Mode providers: hand back the cached synthetic visit. No network, no database, no microphone, no model. Results are
// copies, validated like live output would be, and carry `mode: "demo"` provenance.
import { assertSpeakerMap, guardExtraction } from "./guard";
import { DEMO_EXTRACTION, DEMO_TRANSCRIPT } from "./fixture";
import {
  checkAgainstTranscript,
  parseTranscriptResult,
  parseVisitExtraction,
  ProviderOutputError,
} from "./schema";
import type {
  Delivery,
  ExtractionInput,
  ExtractionProvider,
  FollowUpNotifier,
  InboundReply,
  OutboundMessage,
  TranscribeProvider,
  VisitExtraction,
  VisitPipeline,
} from "./types";

const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

export function createDemoTranscribeProvider(): TranscribeProvider {
  return {
    mode: "demo",
    async transcribe() {
      return parseTranscriptResult(clone(DEMO_TRANSCRIPT));
    },
  };
}

export function createDemoExtractionProvider(): ExtractionProvider {
  return {
    mode: "demo",
    async extract({ transcript, speakerMap }: ExtractionInput): Promise<VisitExtraction> {
      assertSpeakerMap(speakerMap, transcript);
      const parsed = parseVisitExtraction(clone(DEMO_EXTRACTION));
      const problems = checkAgainstTranscript(parsed, transcript);
      if (problems.length)
        throw new ProviderOutputError(
          `The summary cites words that are not in the transcript: ${problems.join("; ")}`,
        );
      return guardExtraction(parsed, transcript, speakerMap).extraction;
    },
  };
}

/** Never contacts anyone. Records what a message WOULD say, flagged as not sent. */
export function createSimulatedNotifier(): FollowUpNotifier {
  return {
    mode: "demo",
    async send(message: OutboundMessage): Promise<Delivery> {
      return {
        channel: "simulated",
        sent: false,
        preview: message.body,
        to: message.to.name,
        at: now(),
      };
    },
  };
}

/** The made-up reply a family member "texts back" in the demo. */
export const simulatedReply = (from: string, text: string): InboundReply => ({
  channel: "simulated",
  from,
  text,
  at: now(),
});

export function createDemoPipeline(): VisitPipeline {
  return {
    mode: "demo",
    transcribe: createDemoTranscribeProvider(),
    extract: createDemoExtractionProvider(),
    notifier: createSimulatedNotifier(),
  };
}
