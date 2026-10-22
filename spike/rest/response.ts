// Parses and validates the reply against the documented contract. Anything that is not a clearly well-formed,
// speaker-labelled `turns[]` is rejected, so a malformed reply can never be scored as if it were good.
//
// CONTRACT (documented): { sessionId, transcript, audioDurationMs, turns: [{ turnId, startMs, endMs, transcript, speaker }] }
// with ALL times in milliseconds. There are no aliases: a reply using other names fails closed, and the scorecard then
// reports the KEY NAMES it saw (never values) so the difference is visible without printing a transcript.
// Extra keys are ignored (the service may add fields); every documented key below is required.
import type { Segment } from "../diarization/events.ts";
import { RestSpikeError } from "./config.ts";

const MAX_TURNS = 2000;
const MAX_MS = 7_200_000; // two hours: far beyond the 10 minute limit, just a sanity bound

export interface ParsedResponse {
  segments: Segment[];
  turnCount: number;
  speakerLabelCount: number;
  /** The service's own measure of the audio length, in seconds (informational). */
  reportedAudioSeconds: number;
}

export interface ObservedShape {
  top: string[];
  turn: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Key names only (never values), for the sanitized scorecard. Safe to call on any reply. */
export function observedShape(json: unknown): ObservedShape {
  if (!isObject(json)) return { top: [], turn: [] };
  const first = Array.isArray(json["turns"]) ? json["turns"][0] : undefined;
  const clean = (ks: string[]) =>
    ks
      .filter((k) => /^[A-Za-z0-9_.-]{1,40}$/.test(k))
      .sort()
      .slice(0, 30);
  return { top: clean(Object.keys(json)), turn: isObject(first) ? clean(Object.keys(first)) : [] };
}

const fail = (why: string): never => {
  throw new RestSpikeError("malformed_response", why);
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

export function parseTranscribeResponse(json: unknown): ParsedResponse {
  if (!isObject(json)) return fail("The reply is not a JSON object.");
  if (label(json["sessionId"]) === null) fail("`sessionId` is missing.");
  if (typeof json["transcript"] !== "string") fail("`transcript` is missing or not text.");
  const reportedMs = ms(json["audioDurationMs"], "`audioDurationMs`");
  const turns = json["turns"];
  if (!Array.isArray(turns) || turns.length === 0) return fail("`turns` is missing or empty.");
  if (turns.length > MAX_TURNS) return fail("`turns` is implausibly long.");

  const segments: Segment[] = [];
  for (const t of turns) {
    if (!isObject(t)) return fail("A turn is not an object.");
    if (label(t["turnId"]) === null) fail("A turn has no `turnId`.");
    const speaker = label(t["speaker"]);
    if (!speaker || speaker.length > 40) return fail("A turn has no usable `speaker`.");
    if (typeof t["transcript"] !== "string") return fail("A turn's `transcript` is not text.");
    const startMs = ms(t["startMs"], "`startMs`");
    const endMs = ms(t["endMs"], "`endMs`");
    if (endMs < startMs) return fail("A turn ends before it starts.");
    segments.push({
      speaker,
      text: t["transcript"],
      startS: startMs / 1000,
      endS: endMs / 1000,
      source: "rest",
    });
  }
  if (segments.every((s) => s.text.trim() === "")) return fail("Every turn is empty.");
  return {
    segments,
    turnCount: segments.length,
    speakerLabelCount: new Set(segments.map((s) => s.speaker)).size,
    reportedAudioSeconds: reportedMs / 1000,
  };
}
