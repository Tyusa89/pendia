# Medication dose reporting (Feature C)

Status: implemented on branch `feature-c-dose-administration`. **The migration is not applied.** Until it is, the Medications page
shows "Dose reporting is not switched on for this family yet" and nothing else changes.

## What it is, and what it is not

A family member reports whether a scheduled dose was **Given** or **Not given**. A dose nobody has reported is **Not confirmed**.
A report is a person's word. Pendia does not check that the medication was taken, no AI model sets any status, and nothing is
inferred from transcripts or free text. There are no dose recommendations and no free-text medical notes.

## Data (`supabase/migrations/20261027000001_dose_administration.sql`)

- `medication_schedule`: fixed local time + ISO weekdays + start/end date, per medication. Organizer writes; people who may see
  medications read. Frozen (time/days/start/medication) once reports exist; end it and add a new one instead.
- `dose_administration`: append-only. One row per report, correction, withdrawal or disagreement flag, keyed by
  `(schedule_id, local_date)`. Corrections link with `supersedes`; flags use `entry_kind = 'disagreement'` and `disputes`.
  UPDATE/DELETE/TRUNCATE are blocked for every role; only a family delete (cascade) removes history.
- Occurrences are computed by `dose_occurrences()` from schedule x local date in `family.timezone`; they are never stored.

## Writes: `report_dose()` and `flag_dose_disagreement()` only

SECURITY DEFINER, `search_path = public, pg_temp`, execute revoked from `public`/`anon`. They derive the reporter from `auth.uid()`,
the time from `now()`, the scheduled instant from the schedule and the family zone. They take a per-occurrence advisory lock, an
idempotency key (`client_request_id`) and the head the caller saw (`dose_conflict` if stale).

Rules: members with medication visibility (and organizers) may report; no future doses; members may report within 48 h, organizers
later with a predefined reason; the original reporter or an organizer may correct (reason required); other caregivers may flag a
disagreement, which never changes the status; Not given may carry one predefined reason.

## Time zones

Nonexistent local times (spring forward) are listed as "skipped" and cannot be reported; repeated times (fall back) use the earlier
instant. The TypeScript mirror is tested against 480 vectors generated from the SQL function (including Lord Howe's half-hour shift).

## Compatibility with pending migrations, and application order

Feature C depends only on `20261021000001` (helpers `member_can_see`, `is_family_member`, `is_family_organizer`, `enforce_same_family`,
`lock_family_id`). It calls them by name and does not read other members' `member` rows (reporter names are snapshotted), so the
`...0002` directory restriction does not affect it. It needs neither pending migration, and neither needs it.

Timestamp order, which is the order the Supabase tooling applies them:

1. `20261022000001_coverage_requirements.sql` (pending founder approval)
2. `20261022000002_member_access_invites.sql` (pending founder approval; **not** before the I-2 member-directory app changes)
3. `20261027000001_dose_administration.sql` (this PR, pending founder approval)

Each needs its own approval. Because step 3 does not depend on 1 or 2, it may also be applied first, but the tooling then treats 1 and
2 as out-of-order and needs an explicit include-all; applying in timestamp order avoids that. All three arrangements pass the full SQL
suite on scratch databases (`supabase/tests/scratch/run-dose.sh`): Feature C alone on the live-like schema, after both pending
migrations, and before them with both applied on top.

## Demo Mode

`/demo-meds`: synthetic people and medications on a fixed virtual clock; the same pure rule functions; sessionStorage only. Its modules
import no Supabase client, `src/services`, family hooks or `AppShell` (tests enforce this).

## Append-only and deletion: what remains

History rows cannot be updated, deleted or truncated by any role (including the table owner). The one exception is the foreign-key
cascade of deleting the whole family: the delete must come from a nested trigger **and** the family row must already be gone, so a
DELETE issued from some other trigger while the family exists is refused (tested). Remaining risks:

- An organizer can delete their family (existing policy), which erases its dose history with no retention hold. This is the intended
  explicit-deletion path; a retention policy would have to be decided separately.
- A database superuser can still bypass any trigger (`session_replication_role = replica`, `ALTER TABLE ... DISABLE TRIGGER`, dropping
  the table); append-only is enforced against application roles, not against whoever administers the database. The rollback script
  deliberately destroys history.
- Reports are not signed or hash-chained, so tampering by an administrator would not be detectable.

## Tests

SQL: `supabase/tests/dose-administration.test.sql` (+ concurrency script, rollback and re-apply) via `supabase/tests/scratch/run-dose.sh`.
App: `src/test/dose-administration.test.ts`, `dose-service.test.ts`, `medication-day-ui.test.tsx`, `med-demo.test.tsx`.

## Deployment sequence (each step needs separate founder approval)

1. Review the migration and rollback script. 2. Shared-database dry-run. 3. Apply. 4. Regenerate Supabase types.
2. Verify as organizer, member with and without medication access, and a member from another family.
