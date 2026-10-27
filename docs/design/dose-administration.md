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
3. `20261027000001_dose_administration.sql` (PR #47, pending founder approval)
4. `20261027000002_family_delete_guard.sql` (separate review, pending founder approval; apply only after step 3)

Each needs its own approval. Because step 3 does not depend on 1 or 2, it may also be applied first, but the tooling then treats 1 and
2 as out-of-order and needs an explicit include-all; applying in timestamp order avoids that. All three arrangements pass the full SQL
suite on scratch databases (`supabase/tests/scratch/run-dose.sh`): Feature C alone on the live-like schema, after both pending
migrations, and before them with both applied on top.

## Demo Mode

`/demo-meds`: synthetic people and medications on a fixed virtual clock; the same pure rule functions; sessionStorage only. Its modules
import no Supabase client, `src/services`, family hooks or `AppShell` (tests enforce this).

## Append-only and deletion: the family-delete guard

History rows cannot be updated, deleted or truncated by any role (including the table owner). The only exception is the foreign-key
cascade of deleting the whole family, which requires the delete to come from a nested trigger **and** the family row to be gone already.

Separate migration `20261027000002_family_delete_guard.sql` (reviewed on its own; **requires `20261027000001`** and refuses to install, with a clear error and nothing left behind, if `public.dose_administration` is missing; independent of the two
October 22 migrations) adds a `BEFORE DELETE` row trigger on `public.family` that raises `family_has_dose_history` (SQLSTATE `23503`)
while any `dose_administration` row exists for that family. Consequences:

- Families **without** dose history delete exactly as before, through the same policy and cascade (tested, including the member-invite
  suite's "last organizer deletes their own family" case).
- With history, the organizer's API `DELETE`, an unfiltered `DELETE FROM family`, and the owner/superuser are all refused; nothing is lost.
  `TRUNCATE family CASCADE` is refused by the append-only truncate trigger.
- A delete racing a first report waits on the report's foreign-key lock and is then refused (tested with two real sessions); without the
  guard that race erased the report.
- Removing a member, other family data, and every existing refusal (medication with history, direct history deletes) are unchanged.
- The guard function is SECURITY DEFINER with a fixed `search_path` and no API-role execute grant. It checks the `dose_administration`
  table directly, so row-level security cannot hide history from it.

Deliberate erasure is an administrator act, not an app feature: as the table owner run, in one transaction,
`ALTER TABLE public.family DISABLE TRIGGER family_delete_guard; DELETE FROM public.family WHERE id = ...; ALTER TABLE public.family ENABLE TRIGGER family_delete_guard;`
The cascade then removes the history (tested). There is still no product UI or retention policy for this; that remains a founder decision.

Remaining bypasses, all requiring database-administrator privileges and not available to API roles:

- the table owner (`postgres` on the hosted project) or a superuser can `DISABLE TRIGGER`, `DROP TRIGGER`, `DROP TABLE`, or run with
  `session_replication_role = replica`, which skips triggers;
- the rollback scripts for either migration deliberately remove protection or data;
- `service_role` is not the owner and cannot disable triggers, but it bypasses RLS, so it can still delete families that have no history;
- history is not signed or hash-chained, so tampering by an administrator would not be detectable.

## Tests

SQL: `supabase/tests/dose-administration.test.sql` (+ concurrency script, rollback and re-apply) via `supabase/tests/scratch/run-dose.sh`.
App: `src/test/dose-administration.test.ts`, `dose-service.test.ts`, `medication-day-ui.test.tsx`, `med-demo.test.tsx`.

## Deployment sequence (each step needs separate founder approval)

1. Review the migration and rollback script. 2. Shared-database dry-run. 3. Apply. 4. Regenerate Supabase types.
2. Verify as organizer, member with and without medication access, and a member from another family.
