#!/usr/bin/env bash
# Family-delete guard: builds scratch databases and runs the guard suite plus the existing family/RLS suites with the guard present.
#   pendia_guard_live     = live-like schema + Feature C + the guard
#   pendia_guard_future   = the same PLUS the two still-pending migrations (coverage, member access)
#   pendia_guard_acl      = live-like with hosted-project default privileges, migrations run by a NON-superuser owner
#   pendia_guard_nomig    = Feature C WITHOUT the guard (proves the guard test fails before the change)
# Local socket/loopback only.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5435 PGUSER=postgres bash supabase/tests/scratch/run-family-guard.sh
set -eu
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
export PGUSER="${PGUSER:-postgres}"
P=(psql -X -q -v ON_ERROR_STOP=1)
BASE=(20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments)
PENDING=(20261022000001_coverage_requirements 20261022000002_member_access_invites)
DOSE=20261027000001_dose_administration; GUARD=20261027000002_family_delete_guard
build() { # db owner migrations...
  db="$1"; owner="$2"; shift 2
  "${P[@]}" -d postgres -c "drop database if exists $db" -c "create database $db"
  "${P[@]}" -d "$db" -f "$HERE/base.sql"
  if [ "$owner" != "$PGUSER" ]; then
    "${P[@]}" -d "$db" -c "alter database $db owner to $owner" -c "alter schema public owner to $owner" -c "grant usage on schema auth to $owner" -c "grant authenticated, anon, service_role to $owner"
    "${P[@]}" -d "$db" <<SQL
do \$\$ declare r record; begin
  for r in select c.relname, c.relkind from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','S','v') loop
    execute format('alter %s public.%I owner to $owner', case r.relkind when 'S' then 'sequence' when 'v' then 'view' else 'table' end, r.relname); end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace='public'::regnamespace loop execute format('alter function %s owner to $owner', r.sig); end loop;
end \$\$;
alter default privileges for role $owner in schema public grant all on tables to authenticated, service_role;
alter default privileges for role $owner in schema public grant select, insert on tables to sandbox_exec;
alter default privileges for role $owner in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role $owner in schema public grant execute on functions to anon, authenticated, service_role;
SQL
  fi
  for f in "$@"; do PGUSER="$owner" "${P[@]}" -d "$db" -f "$REPO/supabase/migrations/$f.sql" 2>&1 | grep -v 'NOTICE\|WARNING' || true; done
}
# hosted-project roles (shared database has them)
"${P[@]}" -d postgres -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='sandbox_exec') then create role sandbox_exec nologin; end if;
  if not exists (select 1 from pg_roles where rolname='guard_owner') then create role guard_owner login createdb createrole bypassrls; end if; end \$\$"
build pendia_guard_live    "$PGUSER"    "${BASE[@]}" $DOSE $GUARD
build pendia_guard_future  "$PGUSER"    "${BASE[@]}" "${PENDING[@]}" $DOSE $GUARD
build pendia_guard_acl     guard_owner  "${BASE[@]}" $DOSE $GUARD
build pendia_guard_nomig   "$PGUSER"    "${BASE[@]}" $DOSE
result() { grep -Eo '(PASS|FAIL): .*' | head -1; }
for db in pendia_guard_live pendia_guard_future pendia_guard_acl; do
  printf '%-22s %-26s' "$db" "family-delete-guard"; psql -X -d "$db" -f "$REPO/supabase/tests/family-delete-guard.test.sql" 2>&1 | result
  printf '%-22s %-26s' "$db" "dose-administration"; psql -X -d "$db" -f "$REPO/supabase/tests/dose-administration.test.sql" 2>&1 | result
done
for t in rls shift-writes appointments coverage-requirements member-invites; do
  printf '%-22s %-26s' pendia_guard_future "$t"; psql -X -d pendia_guard_future -f "$REPO/supabase/tests/$t.test.sql" 2>&1 | result
done
printf '%-22s %-26s' pendia_guard_live "rls (live-like)"; psql -X -d pendia_guard_live -f "$REPO/supabase/tests/rls.test.sql" 2>&1 | result
printf '%-22s %-26s' pendia_guard_nomig "BEFORE (no guard)"; psql -X -d pendia_guard_nomig -f "$REPO/supabase/tests/family-delete-guard.test.sql" 2>&1 | result
for db in pendia_guard_live pendia_guard_future pendia_guard_acl; do
  printf '%-22s %-26s' "$db" "guard concurrency"; PGDATABASE="$db" bash "$REPO/supabase/tests/family-delete-guard-concurrency.sh" 2>&1 | tail -1
done
printf '%-22s %-26s' pendia_guard_nomig "BEFORE: race, no guard"; PGDATABASE=pendia_guard_nomig bash "$REPO/supabase/tests/family-delete-guard-concurrency.sh" 2>&1 | grep -m1 'the report is missing' || echo "(no failure shown)"
# rollback leaves the delete behaviour as it was, and the migration re-applies
"${P[@]}" -d pendia_guard_live -f "$REPO/supabase/rollback/${GUARD}.rollback.sql"
printf '%-22s %-26s' pendia_guard_live "rollback removes guard"
psql -X -At -d pendia_guard_live -c "select case when count(*) = 0 then 'PASS: clean' else 'FAIL: guard left behind' end from pg_trigger where tgname='family_delete_guard' union all select case when count(*) = 0 then 'PASS: function gone' else 'FAIL: function left' end from pg_proc where proname='family_delete_guard'" | tr '\n' ' '; echo
"${P[@]}" -d pendia_guard_live -f "$REPO/supabase/migrations/${GUARD}.sql" 2>&1 | grep -v NOTICE || true
printf '%-22s %-26s' pendia_guard_live "re-apply after rollback"; psql -X -d pendia_guard_live -f "$REPO/supabase/tests/family-delete-guard.test.sql" 2>&1 | result
