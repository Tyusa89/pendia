#!/usr/bin/env bash
# The guard migration must refuse to install when Feature C (public.dose_administration) is missing, and leave nothing behind;
# it must install normally once Feature C is there. SCRATCH DATABASES ONLY; creates and drops database `pendia_guard_order`.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5435 PGUSER=postgres bash supabase/tests/family-delete-guard-order.sh
set -u
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
export PGUSER="${PGUSER:-postgres}"; DB=pendia_guard_order
M="$REPO/supabase/migrations"; GUARD="$M/20261027000002_family_delete_guard.sql"
pass=0; failed=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $2"; fi; }
left() { psql -X -At -d "$DB" -c "select (select count(*) from pg_proc where proname = 'family_delete_guard') + (select count(*) from pg_trigger where tgname = 'family_delete_guard')"; }
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/scratch/base.sql"
for f in 20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$M/$f.sql" 2>&1 | grep -v 'NOTICE\|WARNING'
done
# 1. without Feature C: refused with a clear message, in both psql modes (stop on error / keep going), nothing left behind
for mode in stop continue; do
  if [ "$mode" = stop ]; then out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GUARD" 2>&1); else out=$(psql -X -q -d "$DB" -f "$GUARD" 2>&1); fi; rc=$?
  case "$out" in *"requires 20261027000001_dose_administration"*) ok 0;; *) ok 1 "($mode) no clear dependency message: $out";; esac
  [ "$mode" = stop ] && { [ "$rc" != 0 ] && ok 0 || ok 1 "(stop) exit status was 0"; }
  [ "$(left)" = 0 ] && ok 0 || ok 1 "($mode) a function or trigger was left behind"
done
# 2. the same text sent as ONE multi-statement query (as the management API does) is refused and leaves nothing
out=$(psql -X -q -d "$DB" -c "$(cat "$GUARD")" 2>&1)
case "$out" in *"requires 20261027000001_dose_administration"*) ok 0;; *) ok 1 "(single query) no clear dependency message: $out";; esac
[ "$(left)" = 0 ] && ok 0 || ok 1 "(single query) a function or trigger was left behind"
# 3. families still delete normally while the guard is absent
psql -X -q -d "$DB" -c "insert into family (name) values ('order-test')" -c "delete from family where name = 'order-test'" >/dev/null 2>&1 && ok 0 || ok 1 "family delete broken after a refused install"
# 4. after Feature C the same file installs normally
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$M/20261027000001_dose_administration.sql" 2>&1 | grep -v 'NOTICE\|WARNING'
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GUARD" 2>&1 | grep -v NOTICE && ok 1 "install after Feature C printed errors" || ok 0
[ "$(left)" = 2 ] && ok 0 || ok 1 "after Feature C the function and trigger should both exist (found $(left))"
psql -X -q -d "$DB" -c "insert into family (name) values ('order-test')" -c "delete from family where name = 'order-test'" >/dev/null 2>&1 && ok 0 || ok 1 "normal family delete broken once installed"
psql -X -q -d postgres -c "drop database $DB" >/dev/null
echo "$([ $failed = 0 ] && echo PASS || echo FAIL): $pass install-order checks"
