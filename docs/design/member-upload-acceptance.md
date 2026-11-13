# Family-member document upload: acceptance log (redacted)

Feature: `member.can_upload_documents` (migration `20261112000001_member_upload_capability.sql`). Synthetic data only; no real patient data.
Status: **offline acceptance PASSED; live acceptance on `pendia-hackathon-test` PASSED (32/32, no FAIL or HALT).** The migration was applied by the owner to `pendia-hackathon-test` only (ref `tsaztmblbtlzgwzzmhpm`); it has not been applied to production or any other environment and still needs separate authorization there.

## Assumptions (the November 9 brief and November 12 addendum were not available to the build; defaults chosen with the owner)
- An organizer grants or revokes the permission per **member** (default off). Organizers always may upload. A member cannot change any grant.
- A granted member only **uploads**. They cannot read the document through AI, create or edit appointments, or open it again. An **organizer** of the family reads it and saves the appointment, which attaches the document and confirms it.
- Pending documents stay private as before: only the uploader reads a pending document, **plus** organizers of the family when the uploader is a plain member. One organizer still cannot read another organizer's pending upload (Gate B B-14 rule unchanged).
- A granted member may delete only their own, still-pending upload. Attached reads, update/overwrite (organizer only), the 10 MB / three-type limits, family-folder scoping and the synthetic-only extraction rule are unchanged.
- Revocation is immediate (rules read `member.can_upload_documents` per request). An organizer can still read, attach or delete a revoked member's earlier pending upload.
- Waiting member uploads are shown to organizers for 30 days and are excluded from the 24-hour abandoned-upload sweep while listed; older ones are swept as before.

## Tested configuration
- Offline: throwaway PostgreSQL 16 built from `supabase/tests/scratch/base.sql` + repo migrations + `supabase/tests/scratch/storage-standin.sql` (minimal stand-in; proves nothing about real Storage), two variants (with and without migrations 20261022000001/2, which are not approved). App tests with mocked services.
- Live: `pendia-hackathon-test` (`tsaztmblbtlzgwzzmhpm`), existing Gate B identities only: organizer orgA1 (and orgA2), Member A = memV (ungranted, then granted, then revoked), Member B = memN (never granted), orgB and anonymous as outsiders. No new account or family. Fresh (nonce, no-store) read probes. Harness `member-upload` command (Gate B package v1.3, 32 checks).

## Results
| Check | Result |
|---|---|
| `supabase/tests/member-upload-capability.test.sql` (ungranted denial, no self-grant, granted upload, intended reads, organizer privacy, no cross-family upload, own-pending delete only, attached reads, immediate revocation, organizer list) | PASS, 42 assertions, both scratch variants |
| `appointment-docs.test.sql` (existing, 29+ assertions) with the new migration | PASS, 43 assertions, both variants |
| Mutation checks: organizers allowed to read other organizers' pending; grant not checked; migration absent | each makes the test FAIL, as intended |
| `src/test/member-upload-capability-ui.test.tsx` (switch, upload-only screen, ungranted denial, refusal message, organizer list, document attached on save) | PASS, 13 tests |
| Gate B v1.3 offline self-test, `member-upload` scenario on the intended-policy model; breach models "grant ignored" and "revocation lags" | 32/32 PASS; both breach models HALT |
| Live `member-upload` run on `pendia-hackathon-test` (2026-11-12, Gate B package v1.3, run by the owner) | **PASS, 32/32, no halt**; controlled Storage cleanup removed 3 synthetic objects, 0 remaining, 0 non-fixture paths affected |

## Live acceptance log (as produced by the harness; already redacted)
Executed 32/32, `{"PASS":32}`, no halt. Read probes used a unique cacheNonce and no-store.

| id | check | expected | result | note |
|---|---|---|---|---|
| MU-1 | Member A (not yet granted) uploads to Family A | deny | PASS | new row violates row-level security policy |
| MU-2 | Member B (ungranted) uploads to Family A | deny | PASS | new row violates row-level security policy |
| MU-3 | Member A tries to grant Member B the permission | deny | PASS | rows=0 |
| MU-4 | Member A tries to grant themselves the permission | deny | PASS | rows=0 |
| MU-5 | organizer orgA1 grants Member A (exactly one row, read back true) | allow | PASS | updatedRows=1 readBack=true |
| MU-6 | granted Member A uploads a PDF to Family A | allow | PASS |  |
| MU-7 | granted Member A uploads a second PDF (kept pending for the revocation checks) | allow | PASS |  |
| MU-8 | granted Member A reads own pending upload | allow | PASS | list=true sign=true download=true |
| MU-9-orgA1 | organizer orgA1 reads Member A's pending upload | allow | PASS | list=true sign=true download=true |
| MU-9-orgA2 | organizer orgA2 reads Member A's pending upload | allow | PASS | list=true sign=true download=true |
| MU-10-memN | memN reads Member A's pending upload | deny | PASS | list=false sign=false download=false |
| MU-10-orgB | orgB reads Member A's pending upload | deny | PASS | list=false sign=false download=false |
| MU-10-guest0 | guest0 reads Member A's pending upload | deny | PASS | list=false sign=false download=false |
| MU-10-anon | anon reads Member A's pending upload | deny | PASS | list=false sign=false download=false |
| MU-11 | orgA1 uploads own PDF (organizer-to-organizer privacy control) | allow | PASS |  |
| MU-12-orgA2 | orgA2 reads orgA1's pending upload (must stay private) | deny | PASS | list=false sign=false download=false |
| MU-12-memV | memV reads orgA1's pending upload (must stay private) | deny | PASS | list=false sign=false download=false |
| MU-13 | granted Member A uploads into Family B's folder | deny | PASS | new row violates row-level security policy |
| MU-14 | granted Member A uploads into a nonexistent family folder | deny | PASS | new row violates row-level security policy |
| MU-15 | granted Member A removes orgA1's pending upload | deny | PASS | apiRemoved=false before=true after=true |
| MU-16 | granted Member A uploads then removes their own temporary pending upload (removal verified) | allow | PASS | apiRemoved=true before=true after=false |
| MU-17 | orgA1 attaches Member A's upload to visit V1 (confirms it) | allow | PASS |  |
| MU-18 | Member A (visits visible) reads the ATTACHED document | allow | PASS | list=true sign=true download=true |
| MU-19 | Member B (no visits visibility) reads the ATTACHED document | deny | PASS | list=false sign=false download=false |
| MU-20 | granted Member A removes their own ATTACHED document | deny | PASS | apiRemoved=false before=true after=true |
| MU-21 | orgA1 detaches V1 (one row deleted, visit gone) | allow | PASS | deletedRows=1 remainingAfter=0 |
| MU-22 | organizer orgA1 REVOKES Member A (exactly one row, read back false) | allow | PASS | updatedRows=1 readBack=false |
| MU-23 | revoked Member A uploads to Family A (immediate denial) | deny | PASS | new row violates row-level security policy |
| MU-24 | revoked Member A reads own earlier pending upload | deny | PASS | list=false sign=false download=false |
| MU-25 | revoked Member A removes own earlier pending upload | deny | PASS | apiRemoved=false before=true after=true |
| MU-26 | orgA1 still reads the revoked member's pending upload (not orphaned) | allow | PASS | list=true sign=true download=true |
| MU-27 | Member B was never granted (read back false) | allow | PASS | memN can_upload_documents=false |

## Not recorded here (not provided, so not claimed)
- `owner-check.sql` results for this run (the run's objects were removed by cleanup, so it can no longer return anything but "removed").
- The result grids of the pre-migration and post-migration read-only SQL checks run in the SQL Editor.

## Standing test fixture and cleanup
- **Temporary, removed by the run:** the 3 uploaded Storage objects (0 remaining; no non-fixture path touched). Fixture visits and Member A's grant are created and restored by the harness.
- **Persistent, kept on purpose as the reusable Pendia test fixture in `pendia-hackathon-test`:** the 7 `gateb-*@example.com` auth users, Family A and Family B, the 6 fixture member rows, and the applied migration. Do **not** run Gate B teardown SQL 05/06 (or treat 07 as a pass criterion) while the fixture is standing. No new accounts or families are created for this feature.

## Open items kept separate
- Gate B cached-download question (B-14): unchanged; the pending-read policy is not weakened here.
