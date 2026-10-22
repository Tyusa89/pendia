// Turns raw captured server events into speaker-labelled segments. The `speaker` event payload is UNVERIFIED, so this
// layer is deliberately (a) config-driven (dotted paths you set after looking at a real capture), (b) heuristic only as a
// fallback, and (c) honest: when it cannot recognise the events it says so and the scorer fails closed.
import type { Capture } from "./capture.ts";

export interface Segment {
  speaker: string;
  text: string;
  startS?: number;
  endS?: number;
  source: string;
}

export interface AdapterConfig {
  /** server event `type` the segments come from (default: heuristic over all) */
  eventType?: string;
  /** dotted path to the speaker label inside the event, e.g. "speaker.id" */
  speakerPath?: string;
  textPath?: string;
  startPath?: string;
  endPath?: string;
  /** dotted path to a boolean marking a final (non-partial) result; when set, only truthy ones are used */
  finalPath?: string;
  /** unit of start/end values (default "s") */
  unit?: "s" | "ms";
}

const SPEAKER_KEYS = [
  "speaker",
  "speakerId",
  "speaker_id",
  "speakerLabel",
  "speaker_label",
  "speakerTag",
  "label",
];
const TEXT_KEYS = ["text", "transcript", "utterance", "content"];
const START_KEYS = [
  "start",
  "startTime",
  "start_s",
  "startS",
  "startMs",
  "start_ms",
  "begin",
  "from",
];
const END_KEYS = ["end", "endTime", "end_s", "endS", "endMs", "end_ms", "to"];
const FINAL_KEYS = ["final", "isFinal", "is_final", "complete", "isComplete"];

export function getPath(o: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined,
      o,
    );
}

/** The object plus one level of nesting (payload / data / result), the places a label might live. */
function layers(o: unknown): Record<string, unknown>[] {
  if (!o || typeof o !== "object") return [];
  const top = o as Record<string, unknown>;
  const out = [top];
  for (const k of ["payload", "data", "result", "speaker", "segment"]) {
    const v = top[k];
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
  }
  return out;
}

const pick = (
  ls: Record<string, unknown>[],
  keys: string[],
): { key: string; value: unknown } | null => {
  for (const l of ls)
    for (const k of keys)
      if (k in l && l[k] !== null && l[k] !== undefined && typeof l[k] !== "object")
        return { key: k, value: l[k] };
  return null;
};

const num = (v: unknown, ms: boolean): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? (ms ? n / 1000 : n) : undefined;
};

export interface Extraction {
  segments: Segment[];
  /** which rule produced the segments, or null when nothing was recognised */
  strategy: string | null;
  notes: string[];
}

export function extractSegments(c: Capture, cfg: AdapterConfig = {}): Extraction {
  const events = c.entries.filter(
    (e) => e.dir === "recv" && e.json && typeof e.json === "object" && !Array.isArray(e.json),
  );
  const notes: string[] = [];
  const segs: Segment[] = [];

  if (cfg.speakerPath) {
    for (const e of events) {
      const t = (e.json as Record<string, unknown>)["type"];
      if (cfg.eventType && t !== cfg.eventType) continue;
      if (cfg.finalPath && !getPath(e.json, cfg.finalPath)) continue;
      const sp = getPath(e.json, cfg.speakerPath);
      const text = cfg.textPath ? getPath(e.json, cfg.textPath) : undefined;
      if (sp === undefined || sp === null || typeof text !== "string" || !text.trim()) continue;
      const ms = cfg.unit === "ms";
      const s = cfg.startPath ? num(getPath(e.json, cfg.startPath), ms) : undefined;
      const en = cfg.endPath ? num(getPath(e.json, cfg.endPath), ms) : undefined;
      segs.push({
        speaker: String(sp),
        text,
        ...(s !== undefined ? { startS: s } : {}),
        ...(en !== undefined ? { endS: en } : {}),
        source: String(t),
      });
    }
    return {
      segments: segs,
      strategy: segs.length ? "config" : null,
      notes: segs.length ? notes : ["config matched no events"],
    };
  }

  // Heuristic fallback: any event carrying both a speaker-ish key and a text-ish key.
  const anyFinal = events.some((e) => pick(layers(e.json), FINAL_KEYS)?.value === true);
  for (const e of events) {
    const ls = layers(e.json);
    const sp = pick(ls, SPEAKER_KEYS);
    const tx = pick(ls, TEXT_KEYS);
    if (!sp || !tx || typeof tx.value !== "string" || !tx.value.trim()) continue;
    const fin = pick(ls, FINAL_KEYS);
    if (anyFinal && fin?.value !== true) continue; // cumulative partials would double-count text
    const st = pick(ls, START_KEYS);
    const en = pick(ls, END_KEYS);
    const s = st ? num(st.value, /ms/i.test(st.key)) : undefined;
    const x = en ? num(en.value, /ms/i.test(en.key)) : undefined;
    segs.push({
      speaker: String(sp.value),
      text: tx.value,
      ...(s !== undefined ? { startS: s } : {}),
      ...(x !== undefined ? { endS: x } : {}),
      source: String((e.json as Record<string, unknown>)["type"] ?? "?"),
    });
  }
  // Second fallback: speaker events (label + times, no text) joined to transcript events (text + times, no label).
  if (!segs.length) {
    const spk: Array<{ speaker: string; s: number; e: number }> = [];
    const txt: Array<{ text: string; s: number; e: number }> = [];
    for (const e of events) {
      const ls = layers(e.json);
      const sp = pick(ls, SPEAKER_KEYS);
      const tx = pick(ls, TEXT_KEYS);
      const fin = pick(ls, FINAL_KEYS);
      const st = pick(ls, START_KEYS);
      const en = pick(ls, END_KEYS);
      const s = st ? num(st.value, /ms/i.test(st.key)) : undefined;
      const x = en ? num(en.value, /ms/i.test(en.key)) : undefined;
      if (s === undefined || x === undefined) continue;
      if (sp && !tx) spk.push({ speaker: String(sp.value), s, e: x });
      else if (
        tx &&
        !sp &&
        typeof tx.value === "string" &&
        tx.value.trim() &&
        (!anyFinal || fin?.value === true)
      )
        txt.push({ text: tx.value, s, e: x });
    }
    if (spk.length && txt.length) {
      for (const t of txt) {
        let best: { speaker: string; ov: number } | null = null;
        for (const p of spk) {
          const ov = Math.min(t.e, p.e) - Math.max(t.s, p.s);
          if (ov > 0 && (!best || ov > best.ov)) best = { speaker: p.speaker, ov };
        }
        if (best)
          segs.push({
            speaker: best.speaker,
            text: t.text,
            startS: t.s,
            endS: t.e,
            source: "joined by time overlap",
          });
      }
      if (segs.length)
        return {
          segments: segs,
          strategy: "heuristic: speaker events joined to transcript events by time overlap",
          notes: ["Join is time-based; verify against a real capture."],
        };
    }
  }
  if (segs.length) {
    if (!anyFinal)
      notes.push(
        "No event carried a final flag; all matching events were used (cumulative partials can repeat text).",
      );
    return { segments: segs, strategy: "heuristic: speaker+text on the same event", notes };
  }
  return {
    segments: [],
    strategy: null,
    notes: [
      "No event carried both a speaker label and text. Run `inspect`, then pass an adapter config.",
    ],
  };
}

const KEEP_KEYS = /^(type|event|status|kind|code|final|isFinal|is_final|complete)$/;
const LABEL_KEYS = /(speaker|label|^id$|Id$|_id$)/i;

/**
 * A structure-only copy of a server message: numbers and booleans are kept; strings are replaced by their length unless
 * they are an event/status word or a short speaker label. Transcript text is never printed by default.
 */
export function redactValues(v: unknown, key = ""): unknown {
  if (typeof v === "string") {
    if (KEEP_KEYS.test(key) && v.length <= 40) return v;
    if (LABEL_KEYS.test(key) && /^[A-Za-z0-9_:-]{1,16}$/.test(v)) return v;
    return `<string ${v.length} chars>`;
  }
  if (Array.isArray(v)) return v.map((x) => redactValues(x, key));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactValues(x, k)]));
  return v;
}

/**
 * A human-readable map of what the server actually sent: counts per type, an example, and every key path.
 * By default the example is structure-only (no transcript text), so the output is safe to paste or to appear in a log.
 * Pass showText only for a local look at a synthetic capture.
 */
export function inspectCapture(c: Capture, opts: { showText?: boolean } = {}): string {
  const byType = new Map<string, { n: number; example: string; paths: Map<string, Set<string>> }>();
  const walk = (v: unknown, p: string, into: Map<string, Set<string>>) => {
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, into);
    else {
      const t = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
      (into.get(p) ?? into.set(p, new Set()).get(p)!).add(t);
    }
  };
  for (const e of c.entries) {
    if (e.dir !== "recv") continue;
    const key = e.type ?? "?";
    const example = opts.showText
      ? (e.raw ?? `(${e.kind} ${e.bytes ?? 0} bytes)`)
      : e.json !== undefined
        ? JSON.stringify(redactValues(e.json))
        : `(${e.kind} ${e.bytes ?? 0} bytes)`;
    const rec = byType.get(key) ?? { n: 0, example, paths: new Map() };
    rec.n++;
    if (e.json) walk(e.json, "", rec.paths);
    byType.set(key, rec);
  }
  const lines = [
    `Session ${c.meta.sessionId}`,
    `Close: ${c.meta.close.code} ${c.meta.close.meaning} ${c.meta.close.reason ? `("${c.meta.close.reason}")` : ""}`,
    `Frames sent: ${c.meta.framesSent}, endStream: ${c.meta.endStreamSent}`,
    "",
  ];
  if (byType.size === 0) lines.push("No server messages were received.");
  for (const [type, r] of [...byType.entries()].sort()) {
    lines.push(`== ${type} x${r.n}`, `   example: ${r.example.slice(0, 400)}`);
    for (const [p, ts] of [...r.paths.entries()].sort())
      lines.push(`   ${p || "(root)"}: ${[...ts].join("|")}`);
    lines.push("");
  }
  const x = extractSegments(c);
  lines.push(
    `Adapter (heuristic): ${x.strategy ?? "no recognised speaker segments"}`,
    ...x.notes.map((n) => `  note: ${n}`),
  );
  return lines.join("\n");
}
