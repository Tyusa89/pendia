// Meta Voice Transcribe, file endpoint: the reply side. Pure. Ported from the verified REST spike (its response parser,
// including the PR #50 fix) and kept just as strict: anything that is not a clearly well-formed, speaker-labelled `turns[]`
// is rejected, so a malformed reply can never be shown to a caregiver as if it were a transcript.
//
// CONTRACT: { sessionId, transcript, audioDurationMs, turns: [{ turnId, startMs, endMs, transcript, speaker }] }, ALL times
// in milliseconds. Extra keys are ignored. A turn with an EMPTY transcript and NO speaker is non-speech (the live reply had
// one) and is ignored; a turn with any text must carry a usable speaker.
import { formatTimestamp } from "@/lib/format";
import { MetaTranscribeError } from "./contract";

const MAX_TURNS = 2000;
const MAX_MS = 7_200_000;

export interface TranscriptTurn {
  /** Meta's anonymous label ("A", "B", ...). It says who spoke differently, never who the person is. */
  speaker: string;
  startS: number;
  endS: number;
  text: string;
}

export interface ParsedTranscript {
  turns: TranscriptTurn[];
  speakerCount: number;
  audioSeconds: number;
  ignoredEmptyTurns: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (why: string): never => {
  throw new MetaTranscribeError("malformed_response", why);
};

const label = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const ms = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return fail(`${what} is not a number.`);
  if (v < 0 || v > MAX_MS) return fail(`${what} is out of range.`);
  return v;
};

export function parseTranscribeResponse(json: unknown): ParsedTranscript {
  if (!isObject(json)) return fail("The reply is not a JSON object.");
  if (label(json["sessionId"]) === null) fail("`sessionId` is missing.");
  if (typeof json["transcript"] !== "string") fail("`transcript` is missing or not text.");
  const reportedMs = ms(json["audioDurationMs"], "`audioDurationMs`");
  const raw = json["turns"];
  if (!Array.isArray(raw) || raw.length === 0) return fail("`turns` is missing or empty.");
  if (raw.length > MAX_TURNS) return fail("`turns` is implausibly long.");

  const turns: TranscriptTurn[] = [];
  let ignoredEmptyTurns = 0;
  for (const t of raw) {
    if (!isObject(t)) return fail("A turn is not an object.");
    if (label(t["turnId"]) === null) fail("A turn has no `turnId`.");
    if (typeof t["transcript"] !== "string") return fail("A turn's `transcript` is not text.");
    const startMs = ms(t["startMs"], "`startMs`");
    const endMs = ms(t["endMs"], "`endMs`");
    if (endMs < startMs) return fail("A turn ends before it starts.");
    if (t["transcript"].trim() === "" && (t["speaker"] === undefined || t["speaker"] === null)) {
      ignoredEmptyTurns++;
      continue;
    }
    const speaker = label(t["speaker"]);
    if (!speaker || speaker.length > 40) return fail("A turn has no usable `speaker`.");
    if (t["transcript"].trim() === "") continue; // labelled but silent: nothing to show
    turns.push({
      speaker,
      text: t["transcript"].trim(),
      startS: startMs / 1000,
      endS: endMs / 1000,
    });
  }
  if (turns.length === 0)
    throw new MetaTranscribeError("no_speech", "The reply contained no spoken text.");
  return {
    turns,
    speakerCount: new Set(turns.map((s) => s.speaker)).size,
    audioSeconds: reportedMs / 1000,
    ignoredEmptyTurns,
  };
}

/** "Speaker A (0:05): text" per turn. The labels are Meta's anonymous ones; the caregiver decides who is who. */
export function formatDraftText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `Speaker ${t.speaker} (${formatTimestamp(t.startS)}): ${t.text}`)
    .join("\n");
}
