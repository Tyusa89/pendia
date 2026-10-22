// Parses and validates the reply. Anything that is not a clearly well-formed speaker-labelled `turns[]` is rejected, so
// a malformed reply can never be scored as if it were good.
//
// ASSUMPTION (unverified): the research report says "transcript and speaker-labeled turns[] with timestamps" but not the
// field names or the time unit. Each turn is read with the aliases below; the unit follows the key (`*_ms` = milliseconds,
// everything else seconds). If the real reply differs, the scorecard still reports the KEY NAMES it saw (never values), so
// this table can be corrected without ever printing a transcript.
import type { Segment } from "../diarization/events.ts";
import { RestSpikeError } from "./config.ts";

const SPEAKER_KEYS = ["speaker", "speaker_id", "speakerId", "speaker_label", "label"];
const TEXT_KEYS = ["text", "transcript"];
const START_KEYS: Array<[string, number]> = [
  ["start", 1],
  ["start_s", 1],
  ["startTime", 1],
  ["start_time", 1],
  ["start_ms", 0.001],
  ["startMs", 0.001],
];
const END_KEYS: Array<[string, number]> = [
  ["end", 1],
  ["end_s", 1],
  ["endTime", 1],
  ["end_time", 1],
  ["end_ms", 0.001],
  ["endMs", 0.001],
];
const MAX_TURNS = 2000;
const MAX_SECONDS = 7200;

export interface ParsedResponse {
  segments: Segment[];
  turnCount: number;
  speakerLabelCount: number;
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

function pick<T>(
  o: Record<string, unknown>,
  keys: T[],
  name: (k: T) => string,
): [T, unknown] | null {
  for (const k of keys) if (name(k) in o) return [k, o[name(k)]];
  return null;
}

export function parseTranscribeResponse(json: unknown): ParsedResponse {
  if (!isObject(json)) return fail("The reply is not a JSON object.");
  if ("transcript" in json && typeof json["transcript"] !== "string")
    fail("`transcript` is not text.");
  const turns = json["turns"];
  if (!Array.isArray(turns) || turns.length === 0) return fail("`turns` is missing or empty.");
  if (turns.length > MAX_TURNS) return fail("`turns` is implausibly long.");

  const segments: Segment[] = [];
  for (const t of turns) {
    if (!isObject(t)) return fail("A turn is not an object.");
    const sp = pick(t, SPEAKER_KEYS, (k) => k);
    const tx = pick(t, TEXT_KEYS, (k) => k);
    const st = pick(t, START_KEYS, (k) => k[0]);
    const en = pick(t, END_KEYS, (k) => k[0]);
    if (!sp || !tx || !st || !en) return fail("A turn lacks a speaker, text, start or end.");
    const speakerRaw = sp[1];
    const speaker =
      typeof speakerRaw === "string"
        ? speakerRaw.trim()
        : typeof speakerRaw === "number" && Number.isFinite(speakerRaw)
          ? String(speakerRaw)
          : "";
    if (!speaker || speaker.length > 40) return fail("A turn has no usable speaker label.");
    if (typeof tx[1] !== "string") return fail("A turn's text is not text.");
    const startS = Number(st[1]) * st[0][1];
    const endS = Number(en[1]) * en[0][1];
    if (typeof st[1] !== "number" || typeof en[1] !== "number")
      return fail("A turn time is not a number.");
    if (!Number.isFinite(startS) || !Number.isFinite(endS))
      return fail("A turn time is not finite.");
    if (startS < 0 || endS < startS || endS > MAX_SECONDS)
      return fail("A turn has impossible times.");
    segments.push({ speaker, text: tx[1], startS, endS, source: "rest" });
  }
  if (segments.every((s) => s.text.trim() === "")) return fail("Every turn is empty.");
  return {
    segments,
    turnCount: segments.length,
    speakerLabelCount: new Set(segments.map((s) => s.speaker)).size,
  };
}
