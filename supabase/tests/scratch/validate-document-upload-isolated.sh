#!/usr/bin/env bash
# Validates the Document Upload migration (20261029000001_appointment_documents.sql) against an ISOLATED Supabase project
# (pendia-hackathon-test). It applies the migration TWICE (idempotency) and runs supabase/tests/appointment-docs.test.sql
# (29+ assertions; the test rolls itself back and ends with a message starting PASS or FAIL).
#
# It NEVER touches production: it refuses unless every guard below passes. Run it yourself, locally; the connection string is
# never written to a file or printed.
#   export PENDIA_TEST_DB_URL='postgresql://postgres:<password>@db.<test-project-ref>.supabase.co:5432/postgres'
#   export PENDIA_TEST_PROJECT_NAME='pendia-hackathon-test'
#   export PENDIA_CONFIRM_ISOLATED='I confirm this is pendia-hackathon-test and not production'
#   bash supabase/tests/scratch/validate-document-upload-isolated.sh
#
# Prerequisite: the test project already has Pendia's app schema (family, member, visit ... and the member_can_see /
# is_family_organizer helpers), i.e. the earlier repo migrations are applied there. The script checks and stops if not.
set -eu
die() { echo "REFUSING: $*" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"

[ -n "${PENDIA_TEST_DB_URL:-}" ] || die "PENDIA_TEST_DB_URL is not set."
[ "${PENDIA_TEST_PROJECT_NAME:-}" = "pendia-hackathon-test" ] || die "PENDIA_TEST_PROJECT_NAME must be exactly pendia-hackathon-test."
[ "${PENDIA_CONFIRM_ISOLATED:-}" = "I confirm this is pendia-hackathon-test and not production" ] || die "PENDIA_CONFIRM_ISOLATED is missing or wrong."

# Never the production project: compare against the project ref in this repo's .env (a public value).
PROD_REF="$(sed -n 's/^VITE_SUPABASE_PROJECT_ID=//p' "$REPO/.env" 2>/dev/null | tr -d '"' | head -1)"
if [ -n "$PROD_REF" ] && printf '%s' "$PENDIA_TEST_DB_URL" | grep -qF -- "$PROD_REF"; then
  die "the connection string refers to the production project."
fi
case "$PENDIA_TEST_DB_URL" in postgresql://*|postgres://*) ;; *) die "PENDIA_TEST_DB_URL must be a postgres connection URI.";; esac

P=(psql -X -q -v ON_ERROR_STOP=1 "$PENDIA_TEST_DB_URL")
echo "1/4 prerequisites"
missing="$("${P[@]}" -At -c "
  select string_agg(x, ', ') from (
    select 'table '||t as x from unnest(array['family','member','visit']) t
      where to_regclass('public.'||t) is null
    union all select 'function '||f from unnest(array['member_can_see','is_family_organizer']) f
      where not exists (select 1 from pg_proc where proname = f and pronamespace = 'public'::regnamespace)
    union all select 'storage.objects.owner_id' where not exists (
      select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id')
  ) s")"
[ -z "$missing" ] || die "the test project lacks the app schema (missing: $missing). Apply the earlier repo migrations there first."
echo "   ok"

echo "2/4 apply migration (first time)";  "${P[@]}" -f "$REPO/supabase/migrations/20261029000001_appointment_documents.sql" 2>&1 | grep -v NOTICE || true
echo "3/4 apply migration (second time, must be clean)"
out="$("${P[@]}" -f "$REPO/supabase/migrations/20261029000001_appointment_documents.sql" 2>&1 | grep -v NOTICE || true)"
[ -z "$out" ] || { echo "$out"; die "the second application printed errors (not idempotent)."; }
echo "   ok"

echo "4/4 SQL tests (they roll back; a message starting PASS is success)"
res="$("${P[@]}" -f "$REPO/supabase/tests/appointment-docs.test.sql" 2>&1 || true)"
echo "$res" | grep -E "PASS|FAIL" || { echo "$res" | tail -5; die "no PASS/FAIL line (see output above)."; }
echo "$res" | grep -q "PASS" || exit 1
echo "RESULT: PASS"
