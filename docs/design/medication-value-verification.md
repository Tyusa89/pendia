# Independent medication-value verification (Hackathon Feature A)

**New work, Oct 27 2026.** Builds on the pre-Oct-27 Spark extraction contract (PR #39), the gated live provider (PRs #40-#44) and the
dev-page known-answer check (PR #43). Those are not new work.

## What it does

For every medication item that the extraction contract accepts (doctor turn, verbatim quote), `src/lib/visit-pipeline/med-verifier.ts`
reads the **quote on its own** and compares what it finds with the model's structured fields:

| Result                | Meaning                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `value-verified`      | the medication name, dose, unit and before -> after direction in the quote agree with the structured fields |
| `unverified` + reason | anything else; the item is **kept and shown** for human review, never dropped or silently accepted          |

Reasons: `medication_not_in_quote`, `unparseable_value`, `missing_value`, `value_mismatch`, `unit_mismatch`, `direction_mismatch`,
`ambiguous_quote`, `hedged_quote`, `unsupported_detail`.

## What "value-verified" does NOT mean

It does not say timing, frequency or the instruction as a whole was checked. Every label carries the scope text
"medication name, dose, unit, and before/after direction". The strict extra-details rule only goes the other way: if a structured field
says anything more about its dose (a frequency, a schedule, a form such as "extended-release"), the quote must say the same words
**right next to that same dose** (commas and filler words aside). A word that merely appears elsewhere in the quote (another sentence,
another medication, another meaning) supports nothing, and the item is `unverified`. A detail said for the new dose does not support the
same detail claimed for the old dose.

## Fail-closed rules

- Doses are read only as number + unit (`20 mg`, `20mg`, `twenty milligrams`, `0.5 mg`, `point five milligrams`, `two and a half`, `half a`).
  Units are never converted into each other.
- The before and after doses must be in **one sentence** that names the medication, joined by "from X to Y", "X to Y", or "to Y from X".
- Unverified: ranges, compound units (`mg/day`), decimal commas, more or fewer than two doses, a list or combination (`lisinopril and
metformin`, `lisinopril-HCTZ`), negation or hedging (`not`, `maybe`, `if`, `or`, a question), or two different changes for the same drug.
- Any unexpected error is "unverified".

## Where it runs and what is unchanged

Called from `mapSparkOutput` after the existing evidence checks; the label is an optional `verification` field on `ProposedMedChange`
(Demo Mode items have none). The model cannot supply it (the answer schema is strict). Doctor-only sourcing, verbatim-quote checks,
human confirmation, the gates and Demo Mode are unchanged. Tasks and watch items stay quotation-checked only.

## Limits

English only; units limited to mg, mcg, g, mL, units, IU, tablets, capsules; spelled-out numbers up to 999,999; no brand/generic
mapping; a correct but unusually phrased quote may be `unverified` (the safe direction). The `timing` field is not verified.
