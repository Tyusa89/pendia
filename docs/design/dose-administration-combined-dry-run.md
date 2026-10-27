# Combined shared-database dry-run: Feature C (`…0001`) + family-delete guard (`…0002`)

**Status: PLAN ONLY. Nothing here has been run against the shared database. Needs the founder's explicit authorization.**
Target: Lovable project `5942e04f-3398-42f2-bd0d-7f812c9a2d9d` (PostgreSQL 17.11, executes as `postgres`, non-superuser, `BYPASSRLS`, via the management API).
Scope: exactly two migrations, in this order. `20261022000001` and `20261022000002` are **excluded** and must remain unapplied.

## 1. Pins

| Item                                                       | Pin                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PR #47 head (Feature C)                                    | `3b11078ab71a12e1504a39b8bd3f2b718fcc908a` (draft, base `main`)                                                                  |
| PR #48 head (guard, precondition)                          | `20649e612b8385eed3f59093480cd3d8a230c206` (draft, base `feature-c-dose-administration`); contains the #47 commit as an ancestor |
| `20261027000001_dose_administration.sql`                   | `753aef850fa03d9a1b0487f5f356716373179560c9c58a96791b6c5552d73f60` (identical at `3b11078` and `20649e6`)                        |
| `20261027000002_family_delete_guard.sql`                   | `c4f999c17dc6af71567d5bfb9f281fe1c66b0e8eacc78dab5a02ff43fa564c8c` (at `20649e6`)                                                |
| Builder `supabase/tests/scratch/build-combined-dry-run.py` | `f371d19129af000c75bdbcc0bf879f5621ab2176d93747533d38c7cce1d3d233`                                                               |
| Verification block `combined-dry-run-verify.sql`           | `47805e8de16475113b43341e7369d6fdcea6b79fce1906d6cde18556173a26b5`                                                               |
| Start digests `combined-dry-run-baseline.sql`              | `2f026e8b4f8f37559ed3e77a52f8d532fed69d3bfee25f9ffd6ea29bcba060e9`                                                               |
| Expected shared baseline `combined-dry-run-expected.json`  | `cdad6374440d1fcc810f03cef5f2b2bf9d3ec8a48530053eca6cbf6083daf61c`                                                               |
| Generated SQL, with probes (recommended)                   | `cb4f6e62520025aaec5fefa7af1fc6959d58e0573c79538c607fe31b64377ab5` (47,592 bytes)                                                |
| Generated SQL, `--no-probes`                               | `4f2edf12ea9fcb9c1698b67e6b28700a9aedb91cddc7667087ed8db181cd8618` (43,736 bytes)                                                |

The builder reads both migration files **from git at the pinned commits** and refuses to build if either hash differs. The exact commit
that adds this plan and the scripts is stated with the authorization request; the generated-SQL hashes above only hold for those script hashes.

## 2. Gates before anything runs (all must be true)

1. Written founder authorization for ONE combined rolled-back dry-run (state whether probes are included).
2. `gh api repos/Tyusa89/pendia/pulls/47` and `/48`: both open, draft, not merged; heads equal the pins above.
3. Working tree: only the pinned files are used; the two-space-named untracked file is not touched.
4. **Baseline unchanged (read-only).** Run the baseline snapshot query (the one used for the first dry-run) and compare with
   `combined-dry-run-expected.json`. As of this plan (checked read-only, after the first dry-run) every value matched:
   `class_n 25 / class_md5 fdf7a172…`, `proc_md5 8514577c…`, `policy_n 44 / policy_md5 018cb5f1…`, `trig_md5 b605357d…`, `con_n 49`, `type_n 22`,
   `default_acl_n 28 / default_acl_md5 aec9fae8…`, `evt_n 6 / evt_md5 92a5c041…`, row counts `family=1 member=2 medication=0 shift=3 handoff=3
visit=0 task=0 watch_item=0 med_change=0 care_recipient=1 digest=0`; zero Feature C objects, zero guard trigger, zero October 22 objects
   (`pending_tables 0, pending_member_cols 0, pending_funcs 0`); no idle-in-transaction sessions; role `postgres`, non-superuser.
   **Row counts may legitimately change if real users act; any schema digest change is a STOP.**

## 3. The execution (one `query_database` call)

Build, then paste the generated file unchanged:

    python3 supabase/tests/scratch/build-combined-dry-run.py --expect supabase/tests/scratch/combined-dry-run-expected.json > dry-run.sql
    sha256sum dry-run.sql        # must equal the pin in section 1 for the chosen variant

Shape of `dry-run.sql` (enforced by the builder, which exits non-zero otherwise): exactly one `BEGIN` (first line), exactly one `ROLLBACK`,
zero `COMMIT`:

    begin;
    set local lock_timeout = '5s';
    set local statement_timeout = '60s';
    set local idle_in_transaction_session_timeout = '90s';
    <start-of-transaction digests -> transaction-local setting pendia.base>
    <20261027000001 body, its own begin;/commit; removed>
    <20261027000002 body, its own begin;/commit; removed; its precondition sees 0001's table inside the same transaction>
    <verification DO block>
    rollback;
    execute pendia_combined_result;      -- read-only SELECT after the rollback

The tool returns only the last statement's result set, so the verification results are carried past the `ROLLBACK` in a session-local
prepared statement (not transactional, not a database object). That final statement also re-reads the live catalogs **after** the rollback.

Effects inside the transaction (all rolled back): creates both migrations' objects; with probes, inserts two synthetic families, members, one
medication, one schedule and one report (no `auth.users` row; the probe user id is random), then tries deletes/updates/direct inserts.
No external effect: no email, webhook, NOTIFY that survives (PostgREST's schema-reload notice is only delivered on commit), no sequence of an
existing table is used. Rolled-back inserts leave a few dead tuples in `family`, `member` and `medication` (reclaimed by autovacuum).
Locks: the foreign keys take `SHARE ROW EXCLUSIVE` on `family`, `member`, `medication` briefly and the guard trigger takes
`SHARE ROW EXCLUSIVE` on `family`; `lock_timeout = 5s` makes the dry-run fail rather than queue behind a writer.

## 4. Pass criteria (read from the single result row)

In `in_txn`:

- `owner = postgres`; timeouts in the transaction `5s / 1min / 90s`.
- Tables `medication_schedule`, `dose_administration`: RLS on, owner `postgres`. Policies exactly: `dose_administration.read:SELECT`,
  `medication_schedule.read:SELECT` and `medication_schedule.organizer insert/update/delete`.
- Functions (all owner `postgres`): `report_dose`, `flag_dose_disagreement`, `dose_administration_append_only`, `dose_administration_guard`,
  `medication_schedule_guard`, `family_delete_guard` are SECURITY DEFINER with `search_path=public, pg_temp`; `dose_occurrences` and
  `dose_scheduled_at`, `valid_iso_days` are not. `anon_exec` false for all; `auth_exec` true only for `report_dose`, `flag_dose_disagreement`,
  `dose_occurrences`, `dose_scheduled_at`, `valid_iso_days`; **false for `family_delete_guard`** and the three trigger functions.
- Triggers: `family.family_delete_guard` enabled (`O`) `BEFORE DELETE ... FOR EACH ROW`; `dose_administration_append_only`, `_no_truncate`,
  `_guard`; `medication_schedule_guard`, `lock_family_id`, `same_family`: all `O`.
- `non_owner_write_privs = []`, `non_owner_seq_privs = []`, `anon_table_privs = 0`, `authenticated_dose_privs = ["SELECT"]`.
- `new_public_relations = 10`.
- Probes (if included): `report_as_organizer = accepted`; `api_delete_family_with_history` and `owner_delete_family_with_history` both
  `23503 family_has_dose_history`; `api_delete_family_without_history_rows = 1`; `api_direct_insert = 42501 permission denied for table dose_administration`;
  `owner_update_history = 42501 dose reports are append-only: UPDATE is not allowed`; `family_A_still_exists = true`;
  `reports_for_family_A = reports_for_family_A_after_attempts = 1`.

After the rollback (same row): `lock_timeout_after = 0`, `statement_timeout_after = 2min` (the session defaults, proving the rollback ran);
`feature_c_relations_after = feature_c_functions_after = feature_c_triggers_after = feature_c_policies_after = probe_families_after = 0`;
and `after_rollback` equals `start_of_txn` in every field, and `start_of_txn` equals `expected_shared_baseline` (schedule digests).

## 5. Independent confirmation (separate read-only call, afterwards)

Re-run the gate-4 baseline query and the object-absence counts: zero Feature C / guard objects, zero policies, zero triggers (including
`family_delete_guard`), `idle_in_transaction = 0`, no foreign exclusive locks, `pg_prepared_statements` empty in a fresh session, and the same
digests and row counts as before the dry-run. Report PASS/FAIL with the execution-role evidence.

## 6. Stop conditions (do not retry without new authorization)

- Any gate fails, any hash differs, or the builder exits non-zero: do not run.
- The call errors: the aborted transaction is rolled back when the connection ends; run section 5 to prove nothing persisted, report the error,
  stop. Do not edit and rerun.
- Any pass criterion fails: report FAIL with the row; nothing is applied.

## 7. Local rehearsal (PostgreSQL 17.10, hosted default privileges, migrations run as a non-superuser owner)

Both variants executed as one multi-statement query: all pass criteria met, the 25-relation / ACL / function digests identical before and
after, all probe results as above. The rehearsal caught and fixed two defects in the verification block (a `"char"` concatenation and an
unescaped `%` in the carried statement) that would otherwise have failed on the shared database. A wrong pin makes the builder refuse.

## 8. Not covered

Permanent application (separate approval), `20261022000001`, `20261022000002`, type regeneration, merge, deploy, publish, credentials, Meta
calls, and the separate decision on an erasure UI / retention policy.
