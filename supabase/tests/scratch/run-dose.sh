#!/usr/bin/env bash
# Feature C (dose administration): builds TWO scratch databases and runs the SQL suite on each:
#   pendia_dose_live    = what the live database is believed to have (phase1 + grants + appointments) + the Feature C migration
#   pendia_dose_future  = the same PLUS the two still-pending migrations (coverage, member access) + the Feature C migration
#   pendia_dose_late    = Feature C applied BEFORE the two pending migrations, which are then applied on top
# so the feature is proven compatible whether or not those approvals have happened. Local socket/loopback only.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5434 PGUSER=postgres bash supabase/tests/scratch/run-dose.sh
set -eu
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
export PGUSER="${PGUSER:-postgres}"
P=(psql -X -q -v ON_ERROR_STOP=1)
build() { # name, migrations...
  db="$1"; shift
  "${P[@]}" -d postgres -c "drop database if exists $db" -c "create database $db"
  "${P[@]}" -d "$db" -f "$HERE/base.sql"
  for f in "$@"; do "${P[@]}" -d "$db" -f "$REPO/supabase/migrations/$f.sql" 2>&1 | grep -v NOTICE || true; done
}
LIVE=(20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments 20261027000001_dose_administration)
FUTURE=(20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments 20261022000001_coverage_requirements 20261022000002_member_access_invites 20261027000001_dose_administration)
build pendia_dose_live "${LIVE[@]}"
build pendia_dose_future "${FUTURE[@]}"
# Feature C applied FIRST, the two pending migrations applied on top later
LATE=(20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments 20261027000001_dose_administration 20261022000001_coverage_requirements 20261022000002_member_access_invites)
build pendia_dose_late "${LATE[@]}"
for db in pendia_dose_live pendia_dose_future pendia_dose_late; do
  printf '%-22s %-26s' "$db" "dose-administration"
  psql -X -d "$db" -f "$REPO/supabase/tests/dose-administration.test.sql" 2>&1 | grep -Eo '(PASS|FAIL): .*' | head -1
  printf '%-22s %-26s' "$db" "concurrency"
  PGDATABASE="$db" bash "$REPO/supabase/tests/dose-administration-concurrency.sh" 2>&1 | tail -1
done
# the rollback must leave a clean database that the migration can be applied to again
"${P[@]}" -d pendia_dose_live -f "$REPO/supabase/rollback/20261027000001_dose_administration.rollback.sql"
printf '%-22s %-26s' pendia_dose_live "rollback leaves nothing"
psql -X -At -d pendia_dose_live -c "select case when count(*) = 0 then 'PASS: clean' else 'FAIL: left behind ' || string_agg(proname, ',') end from pg_proc where proname in ('report_dose','flag_dose_disagreement','dose_occurrences','dose_scheduled_at','valid_iso_days') and pronamespace = 'public'::regnamespace"
"${P[@]}" -d pendia_dose_live -f "$REPO/supabase/migrations/20261027000001_dose_administration.sql" 2>&1 | grep -v NOTICE || true
printf '%-22s %-26s' pendia_dose_live "re-apply after rollback"
psql -X -d pendia_dose_live -f "$REPO/supabase/tests/dose-administration.test.sql" 2>&1 | grep -Eo '(PASS|FAIL): .*' | head -1
