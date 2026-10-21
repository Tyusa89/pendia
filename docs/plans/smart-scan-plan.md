# Pendia Smart Scan — Plan (planning only)

Status: PROPOSED feature for the roadmap. No code, migrations, deploys, or paid AI calls authorized by this document. Synthetic test documents only until the data-handling gate (§7) is fully satisfied.

## 1. What it is

From a visit/appointment in Pendia, a caregiver photographs or uploads visit paperwork (after-visit summary, instruction sheet, prescription printout). A Meta vision-capable model extracts structured items — medication instructions, follow-up appointments, symptoms to monitor, care instructions — which are compared against existing Pendia records and presented as **proposed additions and changes with source references and uncertainty flags**. Nothing enters the record until an authorized family member explicitly approves each item. Manual entry remains fully supported and unchanged.

## 2. Model choice — read this before assuming

- **Use Muse Spark 1.3 (Standard tier) with image input.** Spark 1.3 is Meta's multimodal model; document understanding (reading a photographed page and returning structured content) is a vision-language task, and Spark is the model in the current Meta lineup that does it.
- **Do NOT use Muse Image for this.** Muse Image is an image *generation* model ($0.01/image to create pictures). It does not read documents. (It remains the right tool only for the optional generated fridge-chart idea elsewhere in the roadmap.)
- **Standard tier only — hard rule, same as all Pendia health data.** Never a `-contributor` model ID: Contributor inputs may be used for training. State this in the consent copy (§6) and the submission README.
- PDFs: render pages to images client- or server-side and send as images (page count capped, §8). Do not assume native PDF ingestion until verified against Meta's API docs at build time.
- Fallback if image input is unavailable at build time: there is no silent downgrade — the feature pauses and the manual flow carries the visit. (Spark takes no audio; that constraint is about transcription, a different feature.)

## 3. Reuse map — this feature is mostly assembly

| Need | Already exists |
|---|---|
| Proposed medication change with before/after + human Confirm | `med_change` pending→confirmed machinery + DB guard (Phase 1) |
| Draft tasks / watch items awaiting confirmation | Draft states on `task` / `watch_item` (Phase 1) |
| Proposed follow-up appointment | `visit` lifecycle (V1): lands as `scheduled` + `confirmation_status = unconfirmed` |
| Private file storage with family/entity authorization | `recordings` bucket pattern (Phase A): path `{family_id}/{entity}/{entity_id}/…`, storage RLS helpers, short-lived signed URLs — add a `scan` entity type to the same helpers rather than a second bucket design |
| Spark call + review UI patterns | Phase D visit-extraction Edge Function and review screen (Smart Scan's review screen is the same component family: item, source, confirm/reject) |
| Recipient scoping | V0 recipient work: every scan belongs to exactly one `care_recipient_id` (the visit's recipient); extraction can never emit items for another recipient |

New build is therefore: capture/upload UI, one Edge Function (`scan-extract`), the comparison/diff logic, and the proposal review surface. 

## 4. Minimum viable version

**In:** one document per scan (photo or PDF, ≤5 pages); extraction of the four categories; per-item proposals with (a) the extracted value, (b) source reference (document + page + the text snippet it came from), (c) clarity flag (`clear` / `unclear`) — unclear items are shown for verification and can never be bulk-approved; diff against current records classified as **new** / **matches existing** / **conflicts with existing** (conflicts are flagged, never resolved by the AI); approve/reject per item; approved items write through the existing confirmed-change flows; scan and extraction remain viewable from the visit.

**Out of MVP:** handwriting guarantees (printed after-visit summaries are the target; handwriting attempts extraction but expect `unclear` flags); lab-result interpretation (extraction of a follow-up *instruction* is in scope; interpreting values is medical advice — out, permanently); insurance cards and billing documents; multi-document batch scans; any automatic approval path, including "approve all" for unclear or conflicting items.

## 5. Hard rules (non-negotiable, testable)

1. **Never silently overwrite.** The scan flow cannot UPDATE a medication or appointment in place. It creates proposals; approval routes through the same human-confirmed paths as manual changes.
2. **Never prescribe or adjust.** The AI restates what the document says. It cannot recommend a dose, a change, or an extra dose — the prompt and the output validator both enforce extraction-only (items must quote or closely paraphrase a source snippet; items without a source snippet are dropped by the validator, not displayed).
3. **Unclear means unclear.** Illegible or ambiguous text returns `unclear` with the region noted; the UI requires the human to type the value themselves if they accept the item.
4. **Recipient-bound.** A scan is attached to one visit and one recipient before processing; no cross-recipient proposals are possible by construction (query scoping, tested like RLS).

## 6. Consent and data handling

- **Explicit consent before the first scan in a family**, and a per-scan notice thereafter: the document will be sent to Meta's AI (Standard tier — contractually not used for training, per terms re-verified at integration time) for extraction, then stored privately in the family's Pendia storage. Consent is logged (who, when) — the `visit` consent-logging pattern from Phase 1 extends to a `scan_consent` record or a flag + timestamp on the scan row.
- **Storage/encryption:** private bucket (Phase A pattern), encrypted at rest by the platform, access only via short-lived signed URLs after family + recipient + visibility authorization (med-affecting proposals require `can_see_meds`, same as the records themselves).
- **Retention/deletion:** scans follow the family's recording-retention ruling (owner decision pending on the 90-day default); deleting a scan deletes the stored file first-class (object removed, DB reference cleared first per Phase A delete ordering), its extraction, and any *unapproved* proposals derived from it. Approved items remain — they are the family's records now, with provenance noting the source document (which may itself later be deleted; provenance degrades to "from a deleted scan," never breaks).
- **HIPAA applicability:** same analysis as Phase A's plan — a family-run app is generally not a covered entity; that changes if offered through providers/plans; FTC/state health-privacy laws can apply regardless; a BAA-covered stack remains a pre-commercial decision, and no Meta BAA is assumed. **Until the §7 gate passes, synthetic documents only.**

## 7. Data-handling gate (inherited from the dual-experience plan — all four, in order)

1. Meta Standard-tier no-training terms re-verified in writing at integration time.
2. Consent flows (§6) shipped.
3. Retention + deletion controls shipped and tested.
4. Owner sign-off recorded. Until then: synthetic/fictional paperwork only — which is also all the testing strategy needs.

## 8. Cost controls and estimated AI cost

Controls: **one model call per document** (all pages in a single request where the API allows); client-side image downscale/compression before upload (paperwork is legible at modest resolution); extraction cached on the document row — re-opening the review screen never re-calls the model; no background or speculative calls; a per-family monthly scan cap (owner-configurable, default generous for a family, e.g. 50); page cap 5.

Estimate (assumptions stated, verify at build time): a photographed page is on the order of 1–2k input tokens as an image; a 2-page after-visit summary with structured JSON output ≈ 3–5k input + ~1k output tokens ≈ **$0.008–0.012 per scan** at Spark Standard rates ($1.25/$4.25 per M). A family scanning every visit's paperwork might spend **well under $1/month**; the $150 hackathon API credit covers thousands of test scans. The dominant cost is engineering time, not tokens.

## 9. Database requirements (design only — no migration authorized)

- `scan_document`: id, family_id, care_recipient_id, visit_id (nullable — a scan usually starts from a visit, but allow from Meds too), storage_path, mime_type, page_count, uploaded_by, consent_at, status (`uploaded` | `extracted` | `reviewed` | `failed`), created_at.
- `scan_extraction`: id, scan_document_id, model id, raw structured JSON, extracted_at, token usage (for cost accounting), validator results.
- Proposal linkage: existing draft rows (`med_change`, `task`, `watch_item`, `visit`) gain `source_scan_extraction_id` (nullable FK) + `source_snippet` + `clarity` — provenance rides the records the family already trusts, rather than a parallel proposal table. (If the V0/V1 migrations reshape these tables first, this addition is written against the final shapes.)
- RLS: family + recipient scoping on both new tables; storage policies extended with the `scan` entity type under the Phase A helper functions.

## 10. Authorization rules

Organizer or the visit's attending member uploads; proposals visible per the member's existing visibility flags (med proposals hidden from a member without `can_see_meds` — they see "1 item hidden by your access," not the content); approvals are member actions recorded with confirmer identity, same as med Confirm; all access server-enforced (Edge Function runs as service role — it must scope explicitly, the standing Phase 1 warning).

## 11. Testing strategy (synthetic documents only)

- **Fixture corpus:** generated fake after-visit summaries with known ground truth — a dose change, a new medication, a follow-up appointment, a watch symptom ("call if swelling"), plus traps: an illegible dosage (must return `unclear`), a dose that conflicts with the current record (must classify `conflicts`, not overwrite), a patient-voice instruction ("remind me to…") that must not become a clinician instruction, handwriting sample (expect partial/`unclear`).
- **Scoring:** field-level accuracy per category on printed fixtures (target ≥95% printed); **zero** silent overwrites and **zero** un-sourced items across the whole corpus — those are hard gates, not averages.
- **Security:** cross-family scan access denied at storage and API layers; recipient isolation; proposal visibility respects flags; consent gate blocks the Edge Function when consent is absent.
- **Cost:** token usage logged per fixture scan; assert the one-call-per-document rule (no duplicate calls on review re-open).

## 12. Sequencing and dependencies

Roadmap position: **Phase S — after the core caregiving workflow improvements and after Phase D (visit extraction)**, because it reuses D's Spark plumbing and review UI wholesale, and after V0/V1/M1 (it writes proposals into those shapes). Order within the full roadmap: V0 → V1 → M1 → N1 → R1 → D1, with dual-experience phases B–F interleaved as previously planned; **S follows D** and is a November candidate unless the demo loop lands early — it is a strong *second* Meta-tooling showcase (multimodal Spark) but never ahead of the visit loop it depends on. No dependency on Twilio, notifications, or Epic research.

## 13. Decisions requiring owner approval (before any build)

1. Approve Phase S placement (after Phase D; November unless the loop lands early).
2. Retention default for scans — align with the pending recordings ruling (90-day auto-delete vs keep-until-organizer-deletes).
3. Page cap (5) and monthly scan cap (50/family) as defaults.
4. Whether unapproved proposals expire (recommend: they persist with the scan until reviewed or the scan is deleted — no silent expiry of something a family may act on).
