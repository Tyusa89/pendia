// @vitest-environment node
// The words shown about verification: "value-verified" says exactly what it covers, and an unverified item says why.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VERIFICATION_REASONS,
  VERIFICATION_SCOPE,
  type MedVerification,
} from "@/lib/visit-pipeline/med-verifier";
import { verificationLabel } from "@/lib/visit-pipeline/verification-labels";

const v = (
  status: MedVerification["status"],
  reason: MedVerification["reason"],
): MedVerification => ({
  status,
  reason,
  scope: VERIFICATION_SCOPE,
});

describe("verification labels", () => {
  it("a verified item names what was checked and says timing and frequency were not", () => {
    const l = verificationLabel(v("value-verified", "verified"));
    expect(l.short).toMatch(/verified/i);
    expect(l.detail).toMatch(/Checked: the medication name, the dose, the unit/);
    expect(l.detail).toMatch(/Not checked: timing, how often, or the rest of the instruction/);
    expect(l.short).not.toMatch(/timing|frequency|instruction|safe|correct|approved/i);
  });
  it("an unverified item says to check it, with a plain reason for every reason code", () => {
    for (const r of VERIFICATION_REASONS.filter((x) => x !== "verified")) {
      const l = verificationLabel(v("unverified", r));
      expect(l.short).toMatch(/Unverified: check before confirming/);
      expect(l.detail.length).toBeGreaterThan(20);
      expect(l.detail).not.toMatch(/_/); // no raw reason code leaks into the text
    }
  });
  it("an item with no label (tasks, watch items, Demo Mode) is described as quotation-checked only", () => {
    const l = verificationLabel(undefined);
    expect(l.short).toBe("Quotation-checked only");
    expect(l.detail).toMatch(/not independently checked/);
  });
  it("is pure and client-safe", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/visit-pipeline/verification-labels.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/process\.env|fetch\(|supabase|META_API_KEY/);
  });
  it("the development page shows the label for every item and still shows unverified ones", () => {
    const page = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/dev-spark.tsx"),
      "utf8",
    );
    expect(page).toMatch(/verificationLabel\(i\.v\)/);
    expect(page).toMatch(/medUnverified/);
    expect(page).not.toMatch(/\.filter\([^)]*verif/i); // nothing hides unverified items
  });
});
