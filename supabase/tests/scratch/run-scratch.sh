#!/usr/bin/env bash
# Rebuilds a SCRATCH database (stand-in for the pre-hardening schema + the repo migrations) and runs the SQL test suites.
# Local socket/loopback only; never point it at a shared or production database.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5434 PGUSER=postgres bash supabase/tests/scratch/run-scratch.sh
# Needs a throwaway PostgreSQL 16 server you started yourself (see README.md here). Creates and drops database `pendia_scratch`.
set -eu
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
export PGUSER="${PGUSER:-postgres}"
P=(psql -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -d postgres -c "drop database if exists pendia_scratch" -c "create database pendia_scratch"
"${P[@]}" -d pendia_scratch -f "$HERE/base.sql"
for f in 20261021000001_phase1_hardening 20261021000002_revoke_excess_grants 20261021000004_visit_appointments 20261022000001_coverage_requirements 20261022000002_member_access_invites; do
  "${P[@]}" -d pendia_scratch -f "$REPO/supabase/migrations/$f.sql" 2>&1 | grep -v NOTICE || true
done
for t in rls shift-writes appointments coverage-requirements member-invites; do
  printf '%-24s' "$t"; psql -X -d pendia_scratch -f "$REPO/supabase/tests/$t.test.sql" 2>&1 | grep -Eo 'PASS: [0-9]+ assertions|FAIL: .*' | head -1
done
PGDATABASE=pendia_scratch bash "$REPO/supabase/tests/member-invites-sessions.sh"
