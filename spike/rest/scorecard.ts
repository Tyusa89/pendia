// The sanitized scorecard: numbers, booleans, turn numbers, fixed codes and key NAMES. It never holds audio, transcript
// text, response bodies, headers or the credential. (A test feeds it canary text and asserts none of it appears.)
import { scoreSegments, type ScoreResult } from "../diarization/score.ts";
import { tokenize, type Turn } from "../diarization/groundtruth.ts";
import type { Segment } from "../diarization/events.ts";
import { MODEL, REST_URL } from "./config.ts";
import type { RawInfo } from "./raw.ts";
import type { ObservedShape } from "./response.ts";
import type { WavInfo } from "./wav-check.ts";

export interface Scorecard {
  schema: 1;
  kind: "meta-rest-spike-scorecard";
  live: boolean;
  model: string;
  endpointHost: string;
  http: { status: number | null; elapsedMs: number | null };
  audio: { seconds: number; bytes: number; sampleRate: number } | null;
  response: {
    parsed: boolean;
    errorCode: string | null;
    turnCount: number;
    speakerLabelCount: number;
    /** The service's own audio length (seconds), for comparison with the clip we sent. */
    reportedAudioSeconds: number | null;
    observedKeys: ObservedShape;
  };
  /** Facts about the saved raw reply (file names, sizes, hashes). Never its content. */
  rawResponse: {
    saved: boolean;
    error: string | null;
    bodyFile: string | null;
    metaFile: string | null;
    status: number | null;
    bytesReceived: number;
    bytesSaved: number;
    truncated: boolean;
    keyRedactions: number;
    sha256Original: string | null;
    sha256Saved: string | null;
  } | null;
  score: {
    scorable: boolean;
    pass: boolean;
    turnAccuracy: number | null;
    correctTurns: number | null;
    totalTurns: number | null;
    turnAccuracyExcludingOverlaps: number | null;
    secondsAccuracy: number | null;
    leakageTurns: number[];
    failureCodes: string[];
    perTurn: Array<{ n: number; expected: "D" | "P"; correct: boolean; matchedSharePct: number }>;
  };
  /** Word error rate against the script (informational; not part of the pass/fail verdict). */
  wordErrorRate: number | null;
  notes: string[];
}

/** Word-level edit distance divided by reference length, on the same tokenizer the scorer uses. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const r = tokenize(reference);
  const h = tokenize(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[h.length]! / r.length;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function failureCodes(r: ScoreResult): string[] {
  const codes: string[] = [];
  if (!r.scorable) codes.push("not_scorable");
  if (r.scorable && !r.verdict.accuracyOk) codes.push("accuracy_below_threshold");
  if (!r.verdict.leakageZero) codes.push("patient_to_doctor_leakage");
  return codes;
}

export function buildScorecard(input: {
  live: boolean;
  audio: WavInfo | null;
  http: { status: number | null; elapsedMs: number | null };
  segments: Segment[] | null;
  parseErrorCode: string | null;
  reportedAudioSeconds?: number | null;
  raw?: RawInfo | null;
  observed: ObservedShape;
  truth: Turn[];
  timings?: Record<string, [number, number]>;
  notes?: string[];
}): Scorecard {
  const segs = input.segments;
  const base = {
    schema: 1 as const,
    kind: "meta-rest-spike-scorecard" as const,
    live: input.live,
    model: MODEL,
    endpointHost: new URL(REST_URL).hostname,
    http: input.http,
    audio: input.audio
      ? {
          seconds: round(input.audio.seconds, 2),
          bytes: input.audio.bytes,
          sampleRate: input.audio.sampleRate,
        }
      : null,
    notes: input.notes ?? [],
    rawResponse: input.raw ? { ...input.raw } : null,
  };
  if (!segs) {
    return {
      ...base,
      response: {
        parsed: false,
        errorCode: input.parseErrorCode ?? "no_response",
        turnCount: 0,
        speakerLabelCount: 0,
        reportedAudioSeconds: null,
        observedKeys: input.observed,
      },
      score: {
        scorable: false,
        pass: false,
        turnAccuracy: null,
        correctTurns: null,
        totalTurns: null,
        turnAccuracyExcludingOverlaps: null,
        secondsAccuracy: null,
        leakageTurns: [],
        failureCodes: ["not_scorable"],
        perTurn: [],
      },
      wordErrorRate: null,
    };
  }
  const r = scoreSegments(segs, input.truth, input.timings);
  const reference = input.truth.map((t) => t.text).join(" ");
  const hypothesis = segs.map((s) => s.text).join(" ");
  return {
    ...base,
    response: {
      parsed: true,
      errorCode: null,
      turnCount: segs.length,
      speakerLabelCount: new Set(segs.map((s) => s.speaker)).size,
      reportedAudioSeconds: input.reportedAudioSeconds ?? null,
      observedKeys: input.observed,
    },
    score: {
      scorable: r.scorable,
      pass: r.verdict.pass,
      turnAccuracy: r.scorable ? round(r.turnAccuracy) : null,
      correctTurns: r.scorable ? r.correctTurns : null,
      totalTurns: r.totalTurns,
      turnAccuracyExcludingOverlaps: r.scorable ? round(r.turnAccuracyExcludingOverlaps) : null,
      secondsAccuracy: r.secondsAccuracy === null ? null : round(r.secondsAccuracy),
      leakageTurns: [...new Set(r.leaks.map((l) => l.turn))].sort((a, b) => a - b),
      failureCodes: failureCodes(r),
      perTurn: r.turns.map((t) => ({
        n: t.n,
        expected: t.expected,
        correct: t.correct,
        matchedSharePct: Math.round(t.matchedShare * 100),
      })),
    },
    wordErrorRate: round(wordErrorRate(reference, hypothesis)),
  };
}
