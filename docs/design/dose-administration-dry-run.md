# Feature C: shared-database dry-run and apply plan (for founder approval; nothing here has been run)

Target: Lovable project `5942e04f-3398-42f2-bd0d-7f812c9a2d9d`. Migration: `supabase/migrations/20261027000001_dose_administration.sql`
(record its SHA-256 before and after approval; apply only the file at the approved commit).

## How migrations reach this database

- The repo README states the mechanism: schema changes are applied through the Lovable SQL tool (`query_database`). The tool runs through the
  Supabase management API (`application_name = mgmt-api`) as role `postgres`: not a superuser, `BYPASSRLS`, `search_path = "$user", public, extensions`.
  It accepts a multi-statement string including `begin; ... commit;`.
- There is **no migration ledger** (no `supabase_migrations` schema); the only tracker is a one-row `drizzle.__drizzle_migrations`. "Applied" is
  therefore established from the schema itself.
- Merging a file into `main` does not apply it: `20261022000001` and `20261022000002` are on `main` and are absent from the database.
  Applying Feature C executes only the text sent; it cannot include other migrations.
- The migration was tested as a non-superuser owner with hosted-project default privileges on PostgreSQL 17.10 (production is 17.11).

## Event triggers (read-only inspection)

Six, all owned by `supabase_admin`: four fire only on `CREATE EXTENSION` / `DROP EXTENSION` (pg_graphql, pg_cron, pg_net grants, graphql placeholder);
`pgrst_ddl_watch` and `pgrst_drop_watch` tell PostgREST to reload its schema after DDL. None touches grants, RLS or ownership, and none fires on the
statements in this migration other than the schema-reload notice, which is only delivered on commit.

## Step 0: gates (all must be true)

1. Founder approves this dry-run, in writing. Apply is a separate approval.
2. Read-only precheck repeated immediately before: Feature C objects absent; `20261022000001`/`...02` objects absent; role `postgres`;
   `pg_default_acl` unchanged; family/member/medication row counts recorded (currently 1 / 2 / 0).

## Step 1: dry-run (one `query_database` call, rolls back)

Send the migration body with its `begin;` kept and its final `commit;` replaced by the verification query and then `rollback;`:

    begin;
    set local lock_timeout = '5s';
    set local statement_timeout = '60s';
    -- ... migration body, unchanged ...
    -- verification (below)
    rollback;

The migration's own `commit;` MUST NOT be sent in the dry-run. DDL is transactional, so `rollback` removes everything. The dry-run briefly locks
`family`, `member` and `medication` (foreign keys); `lock_timeout` makes it fail fast instead of waiting behind a writer.

Verification, inside the transaction:

- both tables exist with RLS enabled; policies: `medication_schedule` (read, organizer insert/update/delete), `dose_administration` (read only);
- no role other than the owner has INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on `dose_administration` (same query as the SQL suite);
- `report_dose`, `flag_dose_disagreement`: SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE for `authenticated`, not `anon`;
- `dose_administration_append_only` is not executable by `authenticated`/`anon`;
- `dose_occurrences` and `dose_scheduled_at` exist; `select count(*) from medication_schedule` returns 0.

## Step 2: confirm nothing persisted (read-only)

Feature C tables/functions absent; row counts and `pg_default_acl` identical to Step 0.

## Step 3: apply (only after a second, separate approval)

Same file, unchanged, with its own `begin; ... commit;`. Then repeat the Step 1 verification (read-only, no `rollback` needed), confirm PostgREST
sees the RPCs (the `pgrst_ddl_watch` event trigger reloads its schema), let Lovable regenerate `src/integrations/supabase/types.ts`, run
`npx tsc --noEmit` and the test suite, and add a dev-log entry. Do not apply `20261022000001` or `20261022000002` in the same step.

## Rollback

- Before any real report exists (true today: 0 medications): run `supabase/rollback/20261027000001_dose_administration.rollback.sql` in one
  transaction. It drops the functions, then the tables. Verified on scratch: nothing is left behind and the migration re-applies.
- After real reports exist: the rollback destroys them. First export `medication_schedule` and `dose_administration` (for example
  `select jsonb_agg(t) from dose_administration t` saved to a file), and get a separate approval to drop.

## Residual risks to accept or fix before apply

- Family deletion erases dose history (see the recommendation delivered with this plan; not implemented).
- No ledger: nothing records that this migration was applied other than the schema and the dev log.
- Scratch runs used PostgreSQL 17.10; the one production difference not reproducible is the Supabase platform's own roles and extensions.
