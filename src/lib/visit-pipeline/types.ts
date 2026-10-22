// The visit pipeline's contracts: what a transcription provider, an extraction provider and a follow-up notifier take and
// return. Demo Mode implements them with prerecorded synthetic data; the live Muse Voice Transcribe / Muse Spark 1.3
// providers (server-side only, after the spike is approved) will implement the same interfaces, so the screens and the
// safety rules do not change when they are connected.

/**
 * Where a result came from. A demo result can never be mistaken for a live one: the two shapes share no value, and the UI
 * renders its labels from this field only.
 */
export type Provenance =
  | {
      mode: "demo";
      source: "prerecorded-synthetic";
      model: null;
      liveAi: false;
      /** Human-readable note shown with the data, e.g. "Prerecorded example". */
      note: string;
    }
  | {
      mode: "live";
      source: "meta";
      /** e.g. "muse-voice-transcribe-1.0" or "muse-spark-1.3". Never a "-contributor" model. */
      model: string;
      liveAi: true;
      generatedAt: string;
    };

/** One diarized turn. Same shape as `visit.transcript` rows, so a live result can be saved as-is. */
export interface TranscriptSegment {
  /** Anonymous session label ("A", "B", ...). Who they are is decided by the family (SpeakerMap). */
  speaker: string;
  start_s: number;
  end_s: number;
  text: string;
  unclear?: boolean;
}

export interface TranscriptResult {
  provenance: Provenance;
  segments: TranscriptSegment[];
  /** Words the recognizer was asked to favor (e.g. medication names). */
  keywords: string[];
  language: string;
}

export type SpeakerRole = "doctor" | "patient" | "family" | "other";
/** {"A": "doctor", "B": "patient"} */
export type SpeakerMap = Record<string, SpeakerRole>;
/** A speaker map a person has confirmed. Extraction cannot be requested without one. */
export interface ConfirmedSpeakerMap {
  map: SpeakerMap;
  confirmed: true;
}

/** Every extracted item says exactly where it was heard. */
export interface SourceRef {
  speaker: string;
  start_s: number;
  /** Words from the transcript, verbatim. */
  quote: string;
}

export interface ProposedMedChange {
  id: string;
  medication: string;
  before: string;
  after: string;
  /** What the clinician said about timing, e.g. "starting tomorrow". Null when not said. */
  timing: string | null;
  unclear: boolean;
  source: SourceRef;
}
export interface ProposedTask {
  id: string;
  title: string;
  /** What was said about timing, e.g. "within the next two weeks". Never turned into a date by the pipeline. */
  due_hint: string | null;
  unclear: boolean;
  source: SourceRef;
}
export interface ProposedWatchItem {
  id: string;
  text: string;
  source: SourceRef;
}

export interface VisitExtraction {
  provenance: Provenance;
  /** Plain-language account of what was said. Explains; never advises. */
  summary: string;
  med_changes: ProposedMedChange[];
  tasks: ProposedTask[];
  watch_items: ProposedWatchItem[];
}

export interface TranscribeInput {
  visitId: string;
  keywords: string[];
}
export interface TranscribeProvider {
  readonly mode: Provenance["mode"];
  transcribe(input: TranscribeInput): Promise<TranscriptResult>;
}

export interface ExtractionInput {
  transcript: TranscriptResult;
  speakerMap: ConfirmedSpeakerMap;
}
export interface ExtractionProvider {
  readonly mode: Provenance["mode"];
  extract(input: ExtractionInput): Promise<VisitExtraction>;
}

export interface OutboundMessage {
  kind: "task-assignment" | "reminder";
  to: { name: string };
  body: string;
}
/** What happened to a message. A simulated delivery is never `sent`. */
export type Delivery =
  | { channel: "simulated"; sent: false; preview: string; to: string; at: string }
  | { channel: "sms"; sent: true; to: string; at: string; providerId: string };
export interface InboundReply {
  channel: "simulated";
  from: string;
  text: string;
  at: string;
}
export interface FollowUpNotifier {
  readonly mode: Provenance["mode"];
  send(message: OutboundMessage): Promise<Delivery>;
}

export interface VisitPipeline {
  readonly mode: "demo";
  transcribe: TranscribeProvider;
  extract: ExtractionProvider;
  notifier: FollowUpNotifier;
}

export const isDemo = (p: Provenance): p is Extract<Provenance, { mode: "demo" }> =>
  p.mode === "demo";
