// Document Upload: shared, pure contract. File validation (type, size, magic bytes), storage paths, the extraction answer
// schema (wire JSON schema + zod parity), and the conversion of an extraction into a PREFILLED DRAFT for the existing
// appointment form. Nothing here reads the network, the environment or storage.
//
// Honesty rules: an extracted field is only ever a SUGGESTION. A missing field stays missing (null), a low-confidence
// field is flagged "unclear", and simulated (fixture) output is always labelled as simulated.
import { z } from "zod";
import { fromZonedInputValue } from "@/lib/zoned-time";

export const DOC_BUCKET = "appointment-docs";
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_MAX_PAGES = 3;
/** Rendered page image sent to the extractor: JPEG/PNG, longest side scaled down by the client. */
export const PAGE_IMAGE_MAX_BYTES = 1_500_000;
export const PAGES_TOTAL_MAX_BYTES = 3_500_000;
export const ABANDONED_AFTER_MS = 24 * 3_600_000;

export const DOC_KINDS = ["pdf", "jpeg", "png"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_MIME: Record<DocKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};
const EXT: Record<DocKind, string> = { pdf: "pdf", jpeg: "jpg", png: "png" };

/** Identify the type from the file's own leading bytes (never from the name or the browser's claimed type). */
export function sniffKind(head: Uint8Array): DocKind | null {
  const at = (i: number) => head[i];
  if (
    head.length >= 5 &&
    at(0) === 0x25 &&
    at(1) === 0x50 &&
    at(2) === 0x44 &&
    at(3) === 0x46 &&
    at(4) === 0x2d
  )
    return "pdf";
  if (head.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  )
    return "png";
  return null;
}

export type FileCheck =
  | { ok: true; kind: DocKind }
  | { ok: false; code: "empty" | "too_large" | "unsupported_type" | "type_mismatch" };

/** `claimedMime` is the browser-reported type; it must agree with the bytes (a renamed file is rejected). */
export function validateFile(input: {
  size: number;
  claimedMime: string;
  head: Uint8Array;
}): FileCheck {
  if (input.size <= 0) return { ok: false, code: "empty" };
  if (input.size > DOC_MAX_BYTES) return { ok: false, code: "too_large" };
  const kind = sniffKind(input.head);
  if (!kind) return { ok: false, code: "unsupported_type" };
  const claimed = input.claimedMime === "image/jpg" ? "image/jpeg" : input.claimedMime;
  if (claimed !== DOC_MIME[kind]) return { ok: false, code: "type_mismatch" };
  return { ok: true, kind };
}

export const FILE_ERROR_COPY: Record<Exclude<FileCheck, { ok: true }>["code"], string> = {
  empty: "That file is empty.",
  too_large: "That file is larger than 10 MB. Please choose a smaller one.",
  unsupported_type: "Pendia can read PDF, JPG and PNG files only.",
  type_mismatch:
    "That file's contents don't match its type. Please choose the original PDF, JPG or PNG.",
};

// ---- storage paths ----------------------------------------------------------------------------------------------------------------
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Mirrors public.appt_doc_path_family in the migration. */
export const DOC_PATH_RE = new RegExp(
  `^(${UUID})/doc/(${UUID})/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,78}\\.(pdf|jpe?g|png)$`,
  "i",
);
export const docPathFamily = (p: string): string | null =>
  p.includes("..") ? null : (DOC_PATH_RE.exec(p)?.[1]?.toLowerCase() ?? null);
export const docPath = (familyId: string, docId: string, kind: DocKind) =>
  `${familyId}/doc/${docId}/appointment-letter.${EXT[kind]}`;

// ---- extraction answer --------------------------------------------------------------------------------------------------------------
export const CONFIDENCE = ["clear", "unclear"] as const;
const field = (max: number) =>
  z
    .object({
      value: z.string().min(1).max(max),
      confidence: z.enum(CONFIDENCE),
      source_text: z.string().max(300),
    })
    .strict()
    .nullable();

export const extractionZ = z
  .object({
    appointment_letter: z.boolean(),
    date: z
      .object({
        value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        confidence: z.enum(CONFIDENCE),
        source_text: z.string().max(300),
      })
      .strict()
      .nullable(),
    time: z
      .object({
        value: z.string().regex(/^\d{2}:\d{2}$/),
        confidence: z.enum(CONFIDENCE),
        source_text: z.string().max(300),
      })
      .strict()
      .nullable(),
    provider: field(120),
    location: field(300),
    instructions: field(800),
  })
  .strict();
export type Extraction = z.infer<typeof extractionZ>;
export type ExtractionKey = "date" | "time" | "provider" | "location" | "instructions";

const nullableField = (props: Record<string, unknown>) => ({
  type: ["object", "null"],
  additionalProperties: false,
  required: ["value", "confidence", "source_text"],
  properties: props,
});
const fieldProps = (valueSchema: Record<string, unknown>) => ({
  value: valueSchema,
  confidence: { type: "string", enum: [...CONFIDENCE] },
  source_text: { type: "string" },
});
export const EXTRACTION_SCHEMA_NAME = "appointment_letter_extraction";
export const EXTRACTION_JSON_SCHEMA = {
  title: EXTRACTION_SCHEMA_NAME,
  type: "object",
  additionalProperties: false,
  required: ["appointment_letter", "date", "time", "provider", "location", "instructions"],
  properties: {
    appointment_letter: { type: "boolean" },
    date: nullableField(fieldProps({ type: "string" })),
    time: nullableField(fieldProps({ type: "string" })),
    provider: nullableField(fieldProps({ type: "string" })),
    location: nullableField(fieldProps({ type: "string" })),
    instructions: nullableField(fieldProps({ type: "string" })),
  },
} as const;

const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const realTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59;
};
const PLAIN_BAD = /[<>`]|https?:\/\/|www\./i;

export type ParsedExtraction =
  | { ok: true; extraction: Extraction }
  | {
      ok: false;
      code: "not_json" | "bad_shape" | "not_a_letter" | "implausible" | "not_plain_text";
    };

/** Strict parse + plausibility. A bad calendar date/time or markup is rejected whole; nothing is repaired or guessed. */
export function parseExtraction(content: string): ParsedExtraction {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, code: "not_json" };
  }
  const p = extractionZ.safeParse(raw);
  if (!p.success) return { ok: false, code: "bad_shape" };
  const e = p.data;
  if (!e.appointment_letter) return { ok: false, code: "not_a_letter" };
  if (e.date && !realDate(e.date.value)) return { ok: false, code: "implausible" };
  if (e.time && !realTime(e.time.value)) return { ok: false, code: "implausible" };
  for (const k of ["provider", "location", "instructions"] as const)
    if (e[k] && PLAIN_BAD.test(e[k]!.value)) return { ok: false, code: "not_plain_text" };
  return { ok: true, extraction: e };
}

// ---- prefilled draft for the existing appointment form ---------------------------------------------------------------------------------
export type FieldState = "extracted" | "unclear" | "missing";
export interface DraftFields {
  provider_name: string | null;
  office_address: string | null;
  notes: string | null;
  scheduled_start: string | null;
}
export interface Draft {
  /** "meta" = read by Muse Spark; "simulated" = built-in sample (NOT a real reading of the document). */
  source: "meta" | "simulated";
  fields: DraftFields;
  states: Record<"start" | "provider" | "address" | "notes", FieldState>;
}

const stateOf = (f: { confidence: "clear" | "unclear" } | null | undefined): FieldState =>
  !f ? "missing" : f.confidence === "unclear" ? "unclear" : "extracted";

export function toDraft(e: Extraction, source: Draft["source"], timeZone: string): Draft {
  let start: string | null = null;
  if (e.date && e.time) start = fromZonedInputValue(`${e.date.value}T${e.time.value}`, timeZone);
  const startState: FieldState =
    !e.date || !e.time || !start
      ? "missing"
      : e.date.confidence === "unclear" || e.time.confidence === "unclear"
        ? "unclear"
        : "extracted";
  return {
    source,
    fields: {
      provider_name: e.provider?.value ?? null,
      office_address: e.location?.value ?? null,
      notes: e.instructions?.value ?? null,
      scheduled_start: start,
    },
    states: {
      start: startState,
      provider: stateOf(e.provider),
      address: stateOf(e.location),
      notes: stateOf(e.instructions),
    },
  };
}

/** Fixed fictional sample used by the simulated mode. It is NOT read from the uploaded document. */
export const SIMULATED_EXTRACTION: Extraction = {
  appointment_letter: true,
  date: { value: "2026-11-12", confidence: "clear", source_text: "Thursday, November 12, 2026" },
  time: { value: "10:30", confidence: "clear", source_text: "10:30 AM" },
  provider: {
    value: "Dr. Alma Reyes (fictional)",
    confidence: "clear",
    source_text: "Dr. Alma Reyes",
  },
  location: {
    value: "Maple Grove Family Clinic, 100 Example Street, Springfield (fictional)",
    confidence: "unclear",
    source_text: "Maple Grove Family Clinic",
  },
  instructions: {
    value: "Bring your medication list. Arrive 15 minutes early.",
    confidence: "clear",
    source_text: "Please bring your medication list and arrive 15 minutes early.",
  },
};

export const SIMULATED_NOTICE =
  "Simulated sample: this is built-in example text, not a reading of your document. Check every field against the document.";
