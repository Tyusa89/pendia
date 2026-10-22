// Runtime validation of provider output. Demo data passes through it, and so will Muse Spark's JSON later: anything that
// does not match is rejected (fail closed), never repaired. `checkAgainstTranscript` makes sure every quoted source is
// really in the transcript, so an extraction cannot cite words nobody said.
import { z } from "zod";
import type { TranscriptResult, VisitExtraction } from "./types";

const provenance = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("demo"),
      source: z.literal("prerecorded-synthetic"),
      model: z.null(),
      liveAi: z.literal(false),
      note: z.string().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("live"),
      source: z.literal("meta"),
      model: z
        .string()
        .min(1)
        .refine(
          (m) => !/contributor/i.test(m),
          "a contributor model may not be used for health data",
        ),
      liveAi: z.literal(true),
      generatedAt: z.string().min(1),
    })
    .strict(),
]);

const segment = z
  .object({
    speaker: z.string().min(1).max(8),
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    text: z.string().min(1),
    unclear: z.boolean().optional(),
  })
  .strict()
  .refine((s) => s.end_s >= s.start_s, "a turn cannot end before it starts");

export const transcriptResultSchema = z
  .object({
    provenance,
    segments: z.array(segment).min(1),
    keywords: z.array(z.string()),
    language: z.string().min(2),
  })
  .strict();

const source = z
  .object({ speaker: z.string().min(1), start_s: z.number().min(0), quote: z.string().min(1) })
  .strict();
const id = z.string().min(1);

export const visitExtractionSchema = z
  .object({
    provenance,
    summary: z.string().min(1),
    med_changes: z.array(
      z
        .object({
          id,
          medication: z.string().min(1),
          before: z.string().min(1),
          after: z.string().min(1),
          timing: z.string().nullable(),
          unclear: z.boolean(),
          source,
        })
        .strict(),
    ),
    tasks: z.array(
      z
        .object({
          id,
          title: z.string().min(1),
          due_hint: z.string().nullable(),
          unclear: z.boolean(),
          source,
        })
        .strict(),
    ),
    watch_items: z.array(z.object({ id, text: z.string().min(1), source }).strict()),
  })
  .strict()
  .superRefine((x, ctx) => {
    const ids = [...x.med_changes, ...x.tasks, ...x.watch_items].map((i) => i.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "item ids must be unique" });
  });

export class ProviderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOutputError";
  }
}

const fail = (what: string, e: z.ZodError) =>
  new ProviderOutputError(
    `${what} did not match the expected shape: ${e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
  );

export function parseTranscriptResult(value: unknown): TranscriptResult {
  const r = transcriptResultSchema.safeParse(value);
  if (!r.success) throw fail("The transcript", r.error);
  // zod types an absent optional as `| undefined`; the parsed object simply omits the key.
  return r.data as TranscriptResult;
}
export function parseVisitExtraction(value: unknown): VisitExtraction {
  const r = visitExtractionSchema.safeParse(value);
  if (!r.success) throw fail("The visit summary", r.error);
  return r.data;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Every item's source must point at a real turn: same speaker, same start time, and a quote that is words from that turn.
 * Returns the problems (empty = fine).
 */
export function checkAgainstTranscript(
  extraction: VisitExtraction,
  transcript: TranscriptResult,
): string[] {
  const problems: string[] = [];
  const items = [
    ...extraction.med_changes.map((i) => ({ id: i.id, source: i.source })),
    ...extraction.tasks.map((i) => ({ id: i.id, source: i.source })),
    ...extraction.watch_items.map((i) => ({ id: i.id, source: i.source })),
  ];
  for (const { id: itemId, source: s } of items) {
    const seg = transcript.segments.find((t) => t.speaker === s.speaker && t.start_s === s.start_s);
    if (!seg) problems.push(`${itemId}: no turn by speaker ${s.speaker} starts at ${s.start_s}s`);
    else if (!norm(seg.text).includes(norm(s.quote)))
      problems.push(`${itemId}: the quote is not in that turn`);
  }
  return problems;
}
