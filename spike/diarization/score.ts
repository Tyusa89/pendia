// Scores diarized segments against the script. Acceptance criteria (from the project's evaluation plan):
//   1. at least 90% speaker-turn accuracy, and
//   2. ZERO patient-to-doctor leakage (a patient turn, or the instruction-bearing words inside the trap turns,
//      attributed to the doctor's speaker).
// Fails closed: if the events could not be turned into segments, or a turn cannot be matched, it counts against the run.
import type { Segment } from "./events.ts";
import {
  LEAK_PHRASES,
  patientTurns,
  TRAP_TURNS,
  tokenize,
  type Role,
  type Turn,
} from "./groundtruth.ts";

export const MIN_TURN_ACCURACY = 0.9;
/** a turn needs at least this share of its words found in the transcript to be judged at all */
const MIN_MATCHED_SHARE = 0.3;

export interface TurnResult {
  n: number;
  expected: Role;
  /** the anonymous speaker label the server gave most of this turn's words, or null if unmatched */
  label: string | null;
  /** the role that label maps to by best fit, or null */
  predicted: Role | null;
  matchedShare: number;
  correct: boolean;
  overlap: boolean;
}

export interface LeakFinding {
  turn: number;
  kind: "turn" | "phrase";
  detail: string;
}

export interface ScoreResult {
  scorable: boolean;
  reason?: string;
  labels: string[];
  mapping: Record<string, Role | null>;
  turns: TurnResult[];
  correctTurns: number;
  totalTurns: number;
  turnAccuracy: number;
  turnAccuracyExcludingOverlaps: number;
  secondsAccuracy: number | null;
  leaks: LeakFinding[];
  verdict: { pass: boolean; accuracyOk: boolean; leakageZero: boolean; failures: string[] };
}

interface Tok {
  w: string;
  turn?: number;
  who?: Role;
  label?: string;
}

/** Longest-common-subsequence alignment of two token lists; returns matched index pairs. */
function align(g: string[], a: string[]): Array<[number, number]> {
  const n = g.length;
  const m = a.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = g[i] === a[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (g[i] === a[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const plurality = (xs: string[]): string | null => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: string | null = null;
  let bn = 0;
  for (const [k, v] of c) {
    if (v > bn) {
      best = k;
      bn = v;
    }
  }
  return best;
};

function emptyResult(reason: string, turns: Turn[]): ScoreResult {
  return {
    scorable: false,
    reason,
    labels: [],
    mapping: {},
    turns: [],
    correctTurns: 0,
    totalTurns: turns.length,
    turnAccuracy: 0,
    turnAccuracyExcludingOverlaps: 0,
    secondsAccuracy: null,
    leaks: [],
    verdict: { pass: false, accuracyOk: false, leakageZero: false, failures: [reason] },
  };
}

export function scoreSegments(
  segments: Segment[],
  truth: Turn[],
  timings?: Record<string, [number, number]>,
): ScoreResult {
  if (segments.length === 0)
    return emptyResult(
      "No speaker-labelled segments were extracted (cannot score; failing closed).",
      truth,
    );

  // Ground-truth token stream and ASR token stream.
  const G: Tok[] = truth.flatMap((t) =>
    tokenize(t.text).map((w) => ({ w, turn: t.n, who: t.who })),
  );
  const A: Tok[] = segments.flatMap((s) => tokenize(s.text).map((w) => ({ w, label: s.speaker })));
  const pairs = align(
    G.map((x) => x.w),
    A.map((x) => x.w),
  );
  for (const [gi, aj] of pairs) G[gi]!.label = A[aj]!.label!;

  const labels = [...new Set(segments.map((s) => s.speaker))].sort();
  // Best-fit mapping: each anonymous label is the role it most often co-occurs with.
  const mapping: Record<string, Role | null> = {};
  for (const l of labels) {
    const d = G.filter((x) => x.label === l && x.who === "D").length;
    const p = G.filter((x) => x.label === l && x.who === "P").length;
    mapping[l] = d === p ? null : d > p ? "D" : "P";
  }

  const turns: TurnResult[] = truth.map((t) => {
    const toks = G.filter((x) => x.turn === t.n);
    const matched = toks.filter((x) => x.label !== undefined);
    const share = toks.length ? matched.length / toks.length : 0;
    const label = share >= MIN_MATCHED_SHARE ? plurality(matched.map((x) => x.label!)) : null;
    const predicted = label ? (mapping[label] ?? null) : null;
    return {
      n: t.n,
      expected: t.who,
      label,
      predicted,
      matchedShare: Number(share.toFixed(2)),
      correct: predicted === t.who,
      overlap: t.overlap,
    };
  });

  const correct = turns.filter((t) => t.correct).length;
  const nonOverlap = turns.filter((t) => !t.overlap);
  const accEx = nonOverlap.length
    ? nonOverlap.filter((t) => t.correct).length / nonOverlap.length
    : 0;

  // Leakage: patient material attributed to the doctor.
  const leaks: LeakFinding[] = [];
  for (const n of patientTurns(truth)) {
    const r = turns.find((t) => t.n === n)!;
    if (r.predicted === "D")
      leaks.push({
        turn: n,
        kind: "turn",
        detail: `patient turn ${n} was attributed to the doctor's speaker (${r.label})`,
      });
  }
  for (const n of TRAP_TURNS) {
    const phrase = LEAK_PHRASES[n];
    if (!phrase) continue;
    const toks = G.filter((x) => x.turn === n);
    const pt = tokenize(phrase);
    for (let s = 0; s + pt.length <= toks.length; s++) {
      if (toks.slice(s, s + pt.length).every((x, k) => x.w === pt[k])) {
        const span = toks.slice(s, s + pt.length).filter((x) => x.label !== undefined);
        const asDoctor = span.filter((x) => mapping[x.label!] === "D").length;
        if (span.length >= 2 && asDoctor / span.length >= 0.5)
          leaks.push({
            turn: n,
            kind: "phrase",
            detail: `"${phrase}" (turn ${n}) was attributed to the doctor's speaker`,
          });
        break;
      }
    }
  }

  // Optional: seconds-weighted accuracy, only when both the segments and the ground-truth timings have times.
  let secondsAccuracy: number | null = null;
  if (timings) {
    let ok = 0;
    let all = 0;
    for (const s of segments) {
      if (s.startS === undefined || s.endS === undefined) continue;
      for (const t of truth) {
        const iv = timings[String(t.n)];
        if (!iv) continue;
        const ov = Math.min(s.endS, iv[1]) - Math.max(s.startS, iv[0]);
        if (ov <= 0) continue;
        all += ov;
        if (mapping[s.speaker] === t.who) ok += ov;
      }
    }
    secondsAccuracy = all > 0 ? ok / all : null;
  }

  const turnAccuracy = truth.length ? correct / truth.length : 0;
  const failures: string[] = [];
  const accuracyOk = turnAccuracy >= MIN_TURN_ACCURACY;
  if (!accuracyOk)
    failures.push(
      `speaker-turn accuracy ${(turnAccuracy * 100).toFixed(1)}% is below ${MIN_TURN_ACCURACY * 100}%`,
    );
  const leakageZero = leaks.length === 0;
  if (!leakageZero) failures.push(`${leaks.length} patient-to-doctor leak(s)`);
  return {
    scorable: true,
    labels,
    mapping,
    turns,
    correctTurns: correct,
    totalTurns: truth.length,
    turnAccuracy,
    turnAccuracyExcludingOverlaps: accEx,
    secondsAccuracy,
    leaks,
    verdict: { pass: accuracyOk && leakageZero, accuracyOk, leakageZero, failures },
  };
}

export function formatReport(r: ScoreResult): string {
  if (!r.scorable) return `NOT SCORABLE: ${r.reason}\nVERDICT: FAIL`;
  const rows = r.turns.map(
    (t) =>
      `  turn ${String(t.n).padStart(2)}  expected ${t.expected}  got ${t.predicted ?? "?"} (label ${t.label ?? "-"}, matched ${Math.round(t.matchedShare * 100)}%)  ${t.correct ? "ok" : "WRONG"}${t.overlap ? "  [overlap]" : ""}`,
  );
  return [
    `Labels seen: ${r.labels.join(", ")}  ->  best-fit roles: ${r.labels.map((l) => `${l}=${r.mapping[l] ?? "?"}`).join(", ")}`,
    ...rows,
    `Turn accuracy: ${r.correctTurns}/${r.totalTurns} = ${(r.turnAccuracy * 100).toFixed(1)}% (excluding overlap turns: ${(r.turnAccuracyExcludingOverlaps * 100).toFixed(1)}%)`,
    `Seconds accuracy: ${r.secondsAccuracy === null ? "n/a (needs segment times and a timings file)" : `${(r.secondsAccuracy * 100).toFixed(1)}%`}`,
    `Leakage: ${r.leaks.length === 0 ? "none" : r.leaks.map((l) => l.detail).join("; ")}`,
    `VERDICT: ${r.verdict.pass ? "PASS" : `FAIL (${r.verdict.failures.join("; ")})`}`,
  ].join("\n");
}
