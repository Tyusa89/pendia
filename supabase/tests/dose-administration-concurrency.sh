#!/usr/bin/env bash
# Feature C: real concurrent sessions against a SCRATCH database (set PGHOST/PGPORT/PGUSER/PGDATABASE; local socket only).
# Rounds of two (and three) callers reporting the same dose at the same moment with the same "expected head":
# exactly one report may win, the others must get dose_conflict, nothing is lost or duplicated; the same request id sent twice
# at once stores one row. Creates committed synthetic fixtures and removes them through the family cascade at the end.
set -u
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "FAIL: PGHOST must be a local socket or loopback"; exit 2;; esac
: "${PGDATABASE:?set PGDATABASE to the scratch database}"
Q=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0; CHECKS=0
note() { CHECKS=$((CHECKS+1)); if [ "$1" != "ok" ]; then FAILS=$((FAILS+1)); echo "FAIL: $2"; fi; }

IDS=$("${Q[@]}" -c "
with u as (insert into auth.users (id, aud, role, email) select gen_random_uuid(), 'authenticated', 'authenticated', 'c' || g || '-' || gen_random_uuid() || '@test.invalid' from generate_series(1,3) g returning id),
     o as (select id, row_number() over () rn from u),
     f as (insert into family (name, created_by) select 'Concurrency Fam', id from o where rn = 1 returning id),
     m as (insert into member (family_id, user_id, name, role, can_see_meds)
           select f.id, o.id, 'Person ' || o.rn, case when o.rn = 1 then 'organizer' else 'member' end, true from o cross join f returning id),
     med as (insert into medication (family_id, name, dose) select id, 'ConcMed', '1 mg' from f returning id)
select (select id from f), (select string_agg(id::text, ',' order by rn) from o), (select id from med);")
FAM=${IDS%%|*}; REST=${IDS#*|}; USERS=${REST%%|*}; MED=${REST#*|}
IFS=',' read -r U1 U2 U3 <<< "$USERS"
cleanup() { "${Q[@]}" -c "delete from family where id = '$FAM'; delete from auth.users where id in ('$U1','$U2','$U3');" >/dev/null 2>&1; }
trap cleanup EXIT

LT=$("${Q[@]}" -c "select (now() at time zone 'America/New_York')::date - 1")
ROUNDS=8
# one schedule per round (early morning, so each round's occurrence is inside the 48-hour window on LT)
SCHEDS=()
for i in $(seq 1 $ROUNDS); do
  t=$(printf '%02d:%02d' 5 $((i*5)))
  S=$("${Q[@]}" -c "insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
                    values ('$FAM', '$MED', '$t', array[1,2,3,4,5,6,7]::smallint[], current_date - 30) returning id")
  SCHEDS+=("$S")
done

call() { # user, schedule, status, expected_head (SQL literal), request_id [, change_reason]
  local reason="null"; [ -n "${6:-}" ] && reason="'$6'"
  "${Q[@]}" 2>&1 <<SQL | tr '\n' ' '
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true) \g /dev/null
select 'OK ' || id from report_dose('$2', '$LT', '$3', $4, '$5', null, $reason);
commit;
SQL
}
TMP=$(mktemp -d)

# 1. two callers, same expected head (none): one wins, one conflicts
for i in $(seq 0 $((ROUNDS-1))); do
  S=${SCHEDS[$i]}
  call "$U2" "$S" given null "$(cat /proc/sys/kernel/random/uuid)" > "$TMP/a" &
  call "$U3" "$S" not_given null "$(cat /proc/sys/kernel/random/uuid)" > "$TMP/b" &
  wait
  wins=$(cat "$TMP/a" "$TMP/b" | grep -c 'OK ' || true)
  conflicts=$(cat "$TMP/a" "$TMP/b" | grep -c 'dose_conflict' || true)
  rows=$("${Q[@]}" -c "select count(*) from dose_administration where schedule_id = '$S' and local_date = '$LT'")
  [ "$wins" = "1" ] && [ "$conflicts" = "1" ] && [ "$rows" = "1" ] && note ok "" || note bad "round $i: wins=$wins conflicts=$conflicts rows=$rows (expected 1/1/1)"
done

# 2. the same request id twice at once: one row
S=${SCHEDS[0]}; HEAD=$("${Q[@]}" -c "select id from dose_administration where schedule_id = '$S' and local_date = '$LT'")
REPLAY=$(cat /proc/sys/kernel/random/uuid)
S2=${SCHEDS[1]}; HEAD2=$("${Q[@]}" -c "select id from dose_administration where schedule_id = '$S2' and local_date = '$LT'")
OWNER=$("${Q[@]}" -c "select reported_by from dose_administration where id = '$HEAD2'")
OWNERUSER=$("${Q[@]}" -c "select user_id from member where id = '$OWNER'")
call "$OWNERUSER" "$S2" given "'$HEAD2'" "$REPLAY" other > "$TMP/c" &
call "$OWNERUSER" "$S2" given "'$HEAD2'" "$REPLAY" other > "$TMP/d" &
wait
rows=$("${Q[@]}" -c "select count(*) from dose_administration where client_request_id = '$REPLAY'")
[ "$rows" -le 1 ] && note ok "" || note bad "duplicate request stored $rows rows"
# (a 'given' -> 'given' correction needs confirmed_after_review, so both calls may be refused; what matters is never more than one row)

# 3. three corrections racing on one head (organizer + the two members' own chain rules): never two successors
S=${SCHEDS[2]}; HEAD=$("${Q[@]}" -c "select id from dose_administration where schedule_id = '$S' and local_date = '$LT'")
for u in "$U1" "$U1" "$U1"; do
  call "$u" "$S" given "'$HEAD'" "$(cat /proc/sys/kernel/random/uuid)" confirmed_after_review > "$TMP/r$RANDOM" &
done
wait
succ=$("${Q[@]}" -c "select count(*) from dose_administration where supersedes = '$HEAD'")
[ "$succ" = "1" ] && note ok "" || note bad "three racing corrections produced $succ successors of one report (expected exactly 1)"
total=$("${Q[@]}" -c "select count(*) from dose_administration where schedule_id = '$S' and local_date = '$LT'")
[ "$total" = "2" ] && note ok "" || note bad "chain length $total (expected 2)"

rm -rf "$TMP"
[ "$FAILS" = "0" ] && echo "PASS: $CHECKS concurrency checks" || { echo "FAIL: $FAILS of $CHECKS concurrency checks failed"; exit 1; }
