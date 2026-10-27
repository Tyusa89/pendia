#!/usr/bin/env bash
# A family delete racing a first report: the delete must wait for the report's transaction and then be refused, never erase it.
# SCRATCH DATABASES ONLY (commits rows, cleans up through the family cascade with the guard briefly disabled).
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5435 PGDATABASE=pendia_guard_live bash supabase/tests/family-delete-guard-concurrency.sh
set -u
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
: "${PGDATABASE:?set PGDATABASE}"
Q=(psql -X -q -At -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
U=$(cat /proc/sys/kernel/random/uuid); F=$(cat /proc/sys/kernel/random/uuid); M=$(cat /proc/sys/kernel/random/uuid); S=$(cat /proc/sys/kernel/random/uuid)
"${Q[@]}" <<SQL
insert into auth.users (id, aud, role, email) values ('$U', 'authenticated', 'authenticated', '$U@race.invalid');
insert into family (id, name, created_by) values ('$F', 'RACE', '$U');
insert into member (family_id, user_id, name, role) values ('$F', '$U', 'Racer', 'organizer');
insert into medication (id, family_id, name, dose) values ('$M', '$F', 'M', '1');
insert into medication_schedule (id, family_id, medication_id, local_time, days_of_week, starts_on)
  values ('$S', '$F', '$M', '00:01', array[1,2,3,4,5,6,7]::smallint[], current_date - 5);
SQL
pass=0; failed=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $2"; fi; }
D=$("${Q[@]}" -c "select ((now() at time zone 'America/New_York')::date - 1)")
# session A: report inside a transaction that stays open for a few seconds
( "${Q[@]}" >/dev/null <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$U","role":"authenticated"}', true);
set local role authenticated;
select report_dose('$S', '$D', 'given', null, gen_random_uuid());
reset role;
select pg_sleep(3);
commit;
SQL
) &
sleep 1
# session B: the organizer tries to delete the family while A's report is uncommitted
OUT=$("${Q[@]}" 2>&1 <<SQL
select set_config('request.jwt.claims', '{"sub":"$U","role":"authenticated"}', false);
set role authenticated;
delete from family where id = '$F';
SQL
)
wait
case "$OUT" in *family_has_dose_history*) ok 0;; *) ok 1 "delete during an uncommitted report was not refused (got: $OUT)";; esac
n=$("${Q[@]}" -c "select count(*) from dose_administration where family_id = '$F'")
[ "$n" = 1 ] && ok 0 || ok 1 "the report is missing after the race ($n)"
f=$("${Q[@]}" -c "select count(*) from family where id = '$F'")
[ "$f" = 1 ] && ok 0 || ok 1 "the family is gone after the race"
# cleanup through the explicit administrator path
"${Q[@]}" >/dev/null <<SQL
alter table public.family disable trigger family_delete_guard;
delete from family where id = '$F';
alter table public.family enable trigger family_delete_guard;
delete from auth.users where id = '$U';
SQL
echo "PASS: $pass guard concurrency checks" | sed "s/PASS: $pass/$([ $failed = 0 ] && echo PASS || echo FAIL): $pass/"
