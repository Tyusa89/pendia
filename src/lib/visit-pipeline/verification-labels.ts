// The plain words shown next to an extracted medication item about how far its values were checked. Pure and client-safe.
// "value-verified" is described as exactly what it covers; it never says that timing, frequency or the whole instruction was
// checked, and an item without a label is described as quotation-checked only.
import type { MedVerification, VerificationReason } from "./med-verifier";

export interface VerificationLabel {
  short: string;
  detail: string;
}

const WHY: Record<Exclude<VerificationReason, "verified">, string> = {
  medication_not_in_quote: "The doctor's quote does not name this medication.",
  unparseable_value: "The dose could not be read as one clear value.",
  missing_value: "The quote does not contain both the old and the new dose.",
  value_mismatch: "The doses in the quote differ from the extracted ones.",
  unit_mismatch: "The unit in the quote differs from the extracted one.",
  direction_mismatch: "The quote's old and new doses are the other way round.",
  ambiguous_quote: "The quote could mean more than one thing (several medications or doses).",
  hedged_quote: "The quote sounds uncertain or conditional.",
  unsupported_detail: "The extracted values include details that the quote does not contain.",
};

export function verificationLabel(v: MedVerification | undefined): VerificationLabel {
  if (!v)
    return {
      short: "Quotation-checked only",
      detail: "The doctor's words are shown. The values were not independently checked.",
    };
  if (v.status === "value-verified")
    return {
      short: "Dose verified against the doctor's words",
      detail:
        "Checked: the medication name, the dose, the unit, and that it goes from the old dose to the new one. Not checked: timing, how often, or the rest of the instruction.",
    };
  return {
    short: "Unverified: check before confirming",
    detail: v.reason === "verified" ? WHY.unparseable_value : WHY[v.reason],
  };
}
