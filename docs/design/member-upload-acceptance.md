# Family-member document upload: acceptance log (redacted)

Feature: `member.can_upload_documents` (migration `20261112000001_member_upload_capability.sql`, **not applied anywhere**). Synthetic data only; no real patient data.
Status: **offline acceptance PASSED. Live acceptance on `pendia-hackathon-test` is PENDING** (needs the owner's separate authorization to apply the migration there).

## Assumptions (the November 9 brief and November 12 addendum were not available to the build; defaults chosen with the owner)
- An organizer grants or revokes the permission per **member** (default off). Organizers always may upload. A member cannot change any grant.
- A granted member only **uploads**. They cannot read the document through AI, create or edit appointments, or open it again. An **organizer** of the family reads it and saves the appointment, which attaches the document and confirms it.
- Pending documents stay private as before: only the uploader reads a pending document, **plus** organizers of the family when the uploader is a plain member. One organizer still cannot read another organizer's pending upload (Gate B B-14 rule unchanged).
- A granted member may delete only their own, still-pending upload. Attached reads, update/overwrite (organizer only), the 10 MB / three-type limits, family-folder scoping and the synthetic-only extraction rule are unchanged.
- Revocation is immediate (rules read `member.can_upload_documents` per request). An organizer can still read, attach or delete a revoked member's earlier pending upload.
- Waiting member uploads are shown to organizers for 30 days and are excluded from the 24-hour abandoned-upload sweep while listed; older ones are swept as before.

## Tested configuration
- Offline: throwaway PostgreSQL 16 built from `supabase/tests/scratch/base.sql` + repo migrations + `supabase/tests/scratch/storage-standin.sql` (minimal stand-in; proves nothing about real Storage), two variants (with and without migrations 20261022000001/2, which are not approved). App tests with mocked services.
- Live (pending): `pendia-hackathon-test` (`tsaztmblbtlzgwzzmhpm`), existing Gate B identities only: organizer orgA1 (and orgA2), Member A = memV (ungranted, then granted, then revoked), Member B = memN (never granted), orgB and anonymous as outsiders. No new account or family. Fresh (nonce, no-store) read probes. Harness `member-upload` command (Gate B package v1.3, 32 checks).

## Results
| Check | Result |
|---|---|
| `supabase/tests/member-upload-capability.test.sql` (ungranted denial, no self-grant, granted upload, intended reads, organizer privacy, no cross-family upload, own-pending delete only, attached reads, immediate revocation, organizer list) | PASS, 42 assertions, both scratch variants |
| `appointment-docs.test.sql` (existing, 29+ assertions) with the new migration | PASS, 43 assertions, both variants |
| Mutation checks: organizers allowed to read other organizers' pending; grant not checked; migration absent | each makes the test FAIL, as intended |
| `src/test/member-upload-capability-ui.test.tsx` (switch, upload-only screen, ungranted denial, refusal message, organizer list, document attached on save) | PASS, 13 tests |
| Gate B v1.3 offline self-test, `member-upload` scenario on the intended-policy model; breach models "grant ignored" and "revocation lags" | 32/32 PASS; both breach models HALT |
| Live `member-upload` run on `pendia-hackathon-test` | **PENDING** |

## Open items kept separate
- Gate B cached-download question (B-14): unchanged; the pending-read policy is not weakened here.
- Live result lines and any deviation are appended below after the authorized run (paste `acceptance-log.md` from the harness evidence folder).
