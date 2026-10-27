# Feature C production activation plan (`20261027000001` then `20261027000002`)

**PLAN ONLY. Nothing here has been executed against the shared database. Each phase needs the founder's explicit authorization.**
Target: Lovable project `5942e04f-3398-42f2-bd0d-7f812c9a2d9d` (PostgreSQL 17.11, executes as `postgres`, non-superuser, `BYPASSRLS`, via the management API).
Both October 22 migrations (`20261022000001`, `20261022000002`) are **excluded**: the guard aborts the activation if any of their objects exist, and
nothing in this plan touches them.

## 1. Pins

| Item                                                                | Pin                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `main` (both PRs merged)                                            | `82c6395ffd66657741f00695a8e550f5df2fa6e2` (merge of #48), first parent `275aedf43f3287a848bc04eeb7ccb8efda43efc5` (merge of #47) |
| `supabase/migrations/20261027000001_dose_administration.sql`        | `753aef850fa03d9a1b0487f5f356716373179560c9c58a96791b6c5552d73f60`                                                                |
| `supabase/migrations/20261027000002_family_delete_guard.sql`        | `c4f999c17dc6af71567d5bfb9f281fe1c66b0e8eacc78dab5a02ff43fa564c8c`                                                                |
| `supabase/rollback/20261027000001_dose_administration.rollback.sql` | `0b89f80e7156f758f1c62525a22787a502d40de1e8d22196d1206758e9cebf8d`                                                                |
| `supabase/rollback/20261027000002_family_delete_guard.rollback.sql` | `c453a18bc1540a814fb3d0565c95d1dcc58874a58a2a2d1535fe023b17c9370f`                                                                |
| Oct 22 files on `main` (excluded, unchanged)                        | coverage `ba9317c8…`, member access `77b16665…` (SHA-256 prefixes)                                                                |
| Builder `supabase/tests/scratch/build-activation-sql.py`            | `df405e5bc8b061ac4146635c85aa8475f2bd39c4eb33e8950e7a229e2485295e`                                                                |
| Expected baseline `activation-expected-baseline.json`               | `5cb4e1f9d5bc1f52a99a46addf0d00ebcc5f0806ba46f33a4eeb46fba5b82b69`                                                                |
| Verify block files                                                  | `combined-dry-run-verify.sql` `47805e8d…26b5`, `combined-dry-run-baseline.sql` `2f026e8b…60e9` (already on `main`)                |

The builder reads the four migration/rollback files **from git at `82c6395`** and refuses to build if any hash differs. It never executes anything.
Generated SQL (default owner `postgres`, shared baseline), each with exactly one `BEGIN` and one `COMMIT` or one `ROLLBACK`:

| Command                                                                  | SHA-256 of output                                                  | Transaction                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| `build-activation-sql.py both-dryrun`                                    | `b49d56704056b5ab9a780c43a759adf6038db3e93a85394fa4a861dab679b883` | BEGIN … ROLLBACK                    |
| `build-activation-sql.py both`                                           | `a85d09b98cb761dfa190a3970ff7436e28b2cbfa49f81bf4bbffc3aa516e65ef` | BEGIN … COMMIT                      |
| `build-activation-sql.py verify`                                         | `273a2f0819d97609427c2bb00a79dac085c883e2ab77accbd8b0ed92331434df` | BEGIN … ROLLBACK (synthetic probes) |
| `build-activation-sql.py rollback-0002`                                  | `9f3f3f814ef728691bbaf83f45b65f7350fe051b732c54e320925063d2e9deb1` | BEGIN … COMMIT                      |
| `build-activation-sql.py rollback-0001-empty`                            | `18853374db8ac312a73fa7cf8b8938c2b9d8bf9e5a80cf25bf82d729bf45dfab` | BEGIN … COMMIT                      |
| `build-activation-sql.py step1` / `step2` (fallback, one migration each) | `5b4431d3…0d0d` / `cbbf29c6…2edc`                                  | BEGIN … COMMIT                      |
| `build-activation-sql.py digests` (read-only)                            | `4751291f2ef56c68a9c688858fea37ec3aa1a2c429be7c08b76ef8fc8f035778` | none                                |

## 2. Baseline (read-only, as of this plan)

Schema digests that EXCLUDE Feature C's own objects (so the same expression is valid before, between and after the migrations), taken from the
shared database and equal to `activation-expected-baseline.json`: `class_md5 fdf7a172…`, `proc_md5 8514577c…`, `policy_md5 018cb5f1…`,
`trig_md5 b605357d…`, `con_n 49`, `type_n 22`, `default_acl_md5 aec9fae8…`, `evt_md5 92a5c041…`.
Neither October 27 migration is applied (0 Feature C tables/functions/policies, no `family_delete_guard` trigger); no October 22 object exists;
`family`, `member`, `medication` row counts `1 / 2 / 0`; role `postgres`, non-superuser; no idle-in-transaction sessions.
Rows may legitimately change as users act; **any schema digest difference is a STOP.**

## 3. Sequence

**Phase 0 (gates, read-only).** `main` still `82c6395…` (or only later commits that do not touch `supabase/`); the four file hashes above; rerun the
`digests` query and the absence counts and compare with section 2; confirm a recent backup or point-in-time restore exists for the project
(founder: Lovable Cloud project settings; this plan cannot see it); confirm a quiet moment (the transaction takes brief `SHARE ROW EXCLUSIVE`
locks on `family`, `member`, `medication`).

**Phase 1: shared dry-run of the exact activation SQL (rolled back).** One `query_database` call with `both-dryrun`. It runs the guard, 0001, the
0001 assertions, 0002, the 0002 assertions, then `ROLLBACK`, then a read-only status row. PASS = no error, `feature_c_tables 0`, `guard_trigger 0`,
`committed_digests` equal to the baseline. This proves the new guard/assertion logic on the real database before anything is committed.

**Phase 2: activation (one transaction, 0001 then 0002).** One `query_database` call with `both`. Timeouts `lock_timeout 5s`, `statement_timeout 60s`,
`idle_in_transaction_session_timeout 90s`. Inside the transaction: guard (aborts unless role is `postgres`, no Oct 22 objects, digests equal baseline, no
Feature C objects) → 0001 verbatim → assertions → 0002 verbatim → assertions → `COMMIT`. Any failed assertion raises and the whole transaction rolls back, so
there is never a state with 0001 but not 0002 (no window in which reports exist without the family-delete guard). PASS = result row `step 2`,
`feature_c_tables 2`, `feature_c_functions 9`, `guard_trigger 1`, digests equal baseline. `step1`/`step2` exist only as a fallback if a single
transaction is ever judged too long.

**Phase 3: verification (details in section 4).** Run immediately after Phase 2.

**Phase 4: types and application testing (section 6).**

## 4. Post-activation verification

1. **Independent read-only catalog check** (separate call): 2 tables with RLS on, owned by `postgres`; exactly the policies `dose_administration.read:SELECT`,
   `medication_schedule.read:SELECT` and organizer insert/update/delete; 9 functions owned by `postgres`; `report_dose`, `flag_dose_disagreement`,
   `dose_administration_append_only`, `dose_administration_guard`, `medication_schedule_guard`, `family_delete_guard` are SECURITY DEFINER with
   `search_path=public, pg_temp`; `anon` can execute none; `authenticated` can execute exactly `report_dose`, `flag_dose_disagreement`, `dose_occurrences`,
   `dose_scheduled_at`, `valid_iso_days`; no role other than the owner has INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on `dose_administration` or
   USAGE/UPDATE on its sequence; `authenticated` has `SELECT` only; `anon` has no table grants; 6 enabled triggers on the two tables and `family.family_delete_guard`
   (`BEFORE DELETE`, row-level, enabled `O`); the `digests` output equals the baseline; the October 22 objects are still absent; row counts unchanged; no idle-in-transaction sessions.
2. **Behavioural verification, rolled back:** one call with `verify`. Synthetic rows inside the transaction only. PASS = report accepted; API delete and owner delete of a
   family with history refused (`23503 family_has_dose_history`); delete of a family without history succeeds; direct insert by the API role refused (`42501`); owner `UPDATE`
   of history refused (`42501 … append-only`); after `ROLLBACK`: `lock_timeout_after 0`, `probe_families_after 0`, `feature_c_relations_after 2`, `feature_c_functions_after 9`,
   `feature_c_triggers_after 5`, `feature_c_policies_after 5`, and `after_rollback` equals `start_of_txn` (the probes left no trace).

## 5. Recovery, and what can be lost

| Situation                                                     | Action                                                                                                                                                                                                                                                                         | Data                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Phase 1 or 2 errors                                           | The transaction is rolled back; nothing persisted. Run the read-only check, report, stop. Do not edit and rerun without new approval.                                                                                                                                          | none                                                |
| Activation committed but verification fails, no dose data yet | `rollback-0002` (removes only the guard; never touches data), then `rollback-0001-empty`. The latter **refuses to run if any dose row or schedule exists, or if the guard is still installed**, and asserts the digests return to baseline.                                    | none lost (tables empty)                            |
| Dose data already exists                                      | Do **not** roll back. Fix forward. If removal is ever required: export `medication_schedule` and `dose_administration` first (for example `select jsonb_agg(t)` saved to a file), then a separate founder approval to drop. `rollback-0001-empty` deliberately cannot do this. | the rollback **destroys all reports and schedules** |
| Guard misbehaves                                              | `rollback-0002` alone; data untouched. Families with history become deletable again, and deleting one cascades to its history.                                                                                                                                                 | none                                                |
| Deliberate erasure of one family's history                    | As table owner: `ALTER TABLE public.family DISABLE TRIGGER family_delete_guard; DELETE FROM public.family WHERE id = …; ALTER TABLE public.family ENABLE TRIGGER family_delete_guard;` (tested). Needs founder approval each time.                                             | that family's history                               |

Data-loss risks, all documented elsewhere in `dose-administration.md`: the rollback scripts destroy data by design; an organizer cannot delete a family that has history, but a
table owner or superuser can bypass the guard or drop the tables; history is not hash-chained; reports written during testing are permanent (append-only) unless the
administrator path above is used; nothing in the application ever shows a report as verified ingestion. The activation itself changes no existing table, policy, trigger or grant,
and no existing row.

## 6. Type regeneration and application testing

**Types.** `src/integrations/supabase/types.ts` is generated by Lovable from the live database and must not be hand-edited. After Phase 2 either Lovable regenerates it (a commit to
`main` appears) or the founder triggers a regeneration in the editor. Then: `git fetch`, diff the file; expected change is additions only (tables `medication_schedule` and
`dose_administration`; functions `dose_occurrences`, `dose_scheduled_at`, `flag_dose_disagreement`, `report_dose`, `valid_iso_days`); any removal or change to an existing table is a STOP.
Run `npx tsc --noEmit`, the full Vitest suite, ESLint on changed files and `vite build`. The application does not depend on the regenerated types (the service uses a validated structural
client), so a regeneration delay does not block activation.

**Testing after activation.**

- _Automated, leaves no trace:_ the `verify` call (section 4) and the read-only catalog check.
- _UI smoke test (founder, needs a signed-in organizer; I cannot log in):_ `/meds` shows the "Medication day" section instead of "not switched on"; as organizer set a dose time for a
  medication; as a second member without medication access confirm nothing is visible; `/demo-meds` still works. A schedule with no report can be deleted again.
- _Reporting test:_ a real report in the existing family is permanent. Decide beforehand: (a) skip it, relying on the rolled-back `verify`; or (b) use a throwaway test family and accept that its
  history persists, or schedule an administrator erasure (needs approval).
- Hand the result back: PASS/FAIL, any deviation, and the final `main` commit.

## 7. Stop conditions

Any hash, `main` SHA, digest, absence count or baseline value differs; the builder exits non-zero; any call errors (do not retry or edit); any Oct 22 object appears; the role is not
`postgres`. Not authorized by this plan: applying either October 22 migration, deploy or publish, credential or permission changes, Meta calls, editing `types.ts` by hand.

## 8. Local rehearsal (PostgreSQL 17.10, hosted default privileges, migrations run as a non-superuser owner)

`both-dryrun` leaves nothing; `both` commits and a repeat aborts; `step2` before `step1` aborts and changes nothing; `step1`/`step2` repeats abort; `verify` passes after activation and
leaves no trace; `rollback-0002` removes only the guard; `rollback-0001-empty` refuses with data present and, after the administrator erasure path, restores the pre-activation digests. The
rehearsal found and fixed five defects in the builder (array typing, a `%` in a carried statement, quoting) before this plan was written.
