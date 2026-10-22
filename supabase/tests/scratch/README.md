# Scratch database for SQL tests

`base.sql` is a stand-in for the schema that existed before `20261021000001_phase1_hardening.sql` (tables, columns,
foreign keys, check constraints, `is_family_member` / `is_family_organizer`, Supabase-style default function
privileges, an `auth.users` stub and `auth.uid()` reading `request.jwt.claims`). It was built from the live table
definitions (read-only inspection) and replaying the repo migrations on top reproduces the live policies, triggers and
function privileges (checked by comparing policy, trigger, index and function-ACL lists).

It is NOT a copy of production data and contains none. The storage-bucket tests (`storage.test.sql`) need Supabase's
`storage` schema and are not run here.

To use it, start a throwaway local PostgreSQL 16 (socket only, e.g. `initdb -A trust`, `pg_ctl -o "-p 5434 -k DIR -c listen_addresses=''" start`),
then run `run-scratch.sh` with `PENDIA_SCRATCH_DB=1`.
