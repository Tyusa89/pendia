// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DOC_MAX_BYTES,
  docPath,
  docPathFamily,
  parseExtraction,
  sniffKind,
  toDraft,
  validateFile,
  SIMULATED_EXTRACTION,
} from "@/lib/doc-upload/contract";
import { DOC_ID, FAM_A, FAM_B, goodExtraction } from "./doc-upload-helpers";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("file validation (type from bytes, size, claimed type must agree)", () => {
  it("accepts the three types", () => {
    expect(validateFile({ size: 10, claimedMime: "application/pdf", head: PDF })).toEqual({
      ok: true,
      kind: "pdf",
    });
    expect(validateFile({ size: 10, claimedMime: "image/jpeg", head: JPG })).toEqual({
      ok: true,
      kind: "jpeg",
    });
    expect(validateFile({ size: 10, claimedMime: "image/png", head: PNG })).toEqual({
      ok: true,
      kind: "png",
    });
  });
  it("rejects empty, oversize, unknown and mismatched files", () => {
    expect(validateFile({ size: 0, claimedMime: "image/png", head: PNG })).toMatchObject({
      code: "empty",
    });
    expect(
      validateFile({ size: DOC_MAX_BYTES + 1, claimedMime: "image/png", head: PNG }),
    ).toMatchObject({ code: "too_large" });
    expect(validateFile({ size: DOC_MAX_BYTES, claimedMime: "image/png", head: PNG }).ok).toBe(
      true,
    );
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    expect(validateFile({ size: 5, claimedMime: "application/pdf", head: exe })).toMatchObject({
      code: "unsupported_type",
    });
    expect(validateFile({ size: 5, claimedMime: "application/pdf", head: PNG })).toMatchObject({
      code: "type_mismatch",
    });
    expect(validateFile({ size: 5, claimedMime: "text/html", head: PDF })).toMatchObject({
      code: "type_mismatch",
    });
  });
  it("sniffing needs the real header", () => {
    expect(sniffKind(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull();
    expect(sniffKind(new Uint8Array())).toBeNull();
  });
});

describe("storage paths are family-scoped", () => {
  it("builds and parses {family}/doc/{id}/file", () => {
    const p = docPath(FAM_A, DOC_ID, "pdf");
    expect(p).toBe(`${FAM_A}/doc/${DOC_ID}/appointment-letter.pdf`);
    expect(docPathFamily(p)).toBe(FAM_A);
    expect(docPathFamily(docPath(FAM_B, DOC_ID, "jpeg"))).toBe(FAM_B);
  });
  it("rejects traversal, wrong entity, bad extension and unscoped paths", () => {
    for (const bad of [
      `${FAM_A}/doc/${DOC_ID}/../x.pdf`,
      `${FAM_A}/handoff/${DOC_ID}/x.pdf`,
      `${FAM_A}/doc/${DOC_ID}/x.exe`,
      `${FAM_A}/doc/not-a-uuid/x.pdf`,
      "loose.pdf",
      `/${FAM_A}/doc/${DOC_ID}/x.pdf`,
    ])
      expect(docPathFamily(bad), bad).toBeNull();
  });
});

describe("extraction parsing fails closed", () => {
  const ok = (o: unknown) => parseExtraction(JSON.stringify(o));
  it("accepts a good extraction with absent fields as null", () => {
    expect(ok(goodExtraction).ok).toBe(true);
  });
  it("rejects non-JSON, wrong shape and extra keys", () => {
    expect(parseExtraction("sorry")).toEqual({ ok: false, code: "not_json" });
    expect(ok({ ...goodExtraction, extra: 1 })).toEqual({ ok: false, code: "bad_shape" });
    expect(ok({ appointment_letter: true })).toEqual({ ok: false, code: "bad_shape" });
    expect(
      ok({ ...goodExtraction, date: { value: "Nov 12", confidence: "clear", source_text: "" } }),
    ).toEqual({ ok: false, code: "bad_shape" });
    expect(
      ok({ ...goodExtraction, provider: { value: "", confidence: "clear", source_text: "" } }),
    ).toEqual({ ok: false, code: "bad_shape" });
  });
  it("rejects impossible dates and times instead of repairing them", () => {
    expect(
      ok({
        ...goodExtraction,
        date: { value: "2026-02-30", confidence: "clear", source_text: "x" },
      }),
    ).toEqual({ ok: false, code: "implausible" });
    expect(
      ok({ ...goodExtraction, time: { value: "25:10", confidence: "clear", source_text: "x" } }),
    ).toEqual({ ok: false, code: "implausible" });
  });
  it("rejects a document that is not an appointment letter", () => {
    expect(ok({ ...goodExtraction, appointment_letter: false })).toEqual({
      ok: false,
      code: "not_a_letter",
    });
  });
  it("rejects markup and links in text fields", () => {
    expect(
      ok({
        ...goodExtraction,
        instructions: { value: "see https://evil.example", confidence: "clear", source_text: "x" },
      }),
    ).toEqual({ ok: false, code: "not_plain_text" });
    expect(
      ok({
        ...goodExtraction,
        provider: { value: "<b>Dr</b>", confidence: "clear", source_text: "x" },
      }),
    ).toEqual({ ok: false, code: "not_plain_text" });
  });
});

describe("draft: extracted facts are distinguished from missing and uncertain fields", () => {
  const e = (
    parseExtraction(JSON.stringify(goodExtraction)) as {
      ok: true;
      extraction: typeof SIMULATED_EXTRACTION;
    }
  ).extraction;
  it("marks extracted / unclear / missing per field and converts the time in the family's zone", () => {
    const d = toDraft(e, "meta", "America/Chicago");
    expect(d.fields.scheduled_start).toBe("2026-11-12T16:30:00.000Z"); // 10:30 CST
    expect(d.fields.provider_name).toBe("Dr. Alma Reyes");
    expect(d.fields.office_address).toBeNull();
    expect(d.states).toEqual({
      start: "extracted",
      provider: "extracted",
      address: "missing",
      notes: "unclear",
    });
    expect(d.source).toBe("meta");
  });
  it("a date without a time leaves the start missing (never assumes a time)", () => {
    const d = toDraft({ ...e, time: null }, "meta", "America/Chicago");
    expect(d.fields.scheduled_start).toBeNull();
    expect(d.states.start).toBe("missing");
  });
  it("an unclear date or time makes the start unclear", () => {
    const d = toDraft(
      { ...e, date: { ...e.date!, confidence: "unclear" } },
      "meta",
      "America/Chicago",
    );
    expect(d.states.start).toBe("unclear");
  });
  it("simulated output carries the simulated source", () => {
    expect(toDraft(SIMULATED_EXTRACTION, "simulated", "America/Chicago").source).toBe("simulated");
  });
});
