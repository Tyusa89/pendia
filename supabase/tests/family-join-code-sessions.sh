#!/usr/bin/env bash
# Join with a family code (20261114000001): checks that need REAL, separate, committed sessions:
#   1. a non-superuser API login cannot read the code tables, read a code hash, or insert a member linked to someone else;
#   2. two organizers approving the SAME request at the same moment: exactly one wins, one member row;
#   3. one person submitting the SAME request twice at once: one pending row.
# SCRATCH DATABASES ONLY (commits rows, briefly gives `authenticator` a login).
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5434 PGDATABASE=t bash supabase/tests/family-join-code-sessions.sh
set -u
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
: "${PGDATABASE:?set PGDATABASE}"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$PGDATABASE")
CLIENT=(psql -X -A -t -U authenticator -d "$PGDATABASE")
pass=0; failed=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $2"; fi; }
has() { grep -q -- "$1" <<<"$2"; }
cleanup() {
  "${ADMIN[@]}" -c "alter role authenticator nologin" >/dev/null 2>&1
  "${ADMIN[@]}" -c "delete from family where name like 'JSESS %'; delete from auth.users where email like '%@jsessions.invalid';" >/dev/null 2>&1
}
trap cleanup EXIT
cleanup
UA=11111111-1111-4111-8111-111111111111; UB=22222222-2222-4222-8222-222222222222; U1=33333333-3333-4333-8333-333333333333; U2=44444444-4444-4444-8444-444444444444
FA=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
"${ADMIN[@]}" <<SQL
do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if; end \$\$;
grant authenticated to authenticator;
grant anon to authenticator;
alter role authenticator login;
insert into auth.users (id, aud, role, email, email_confirmed_at) values
 ('$UA','authenticated','authenticated','a@jsessions.invalid',now()), ('$UB','authenticated','authenticated','b@jsessions.invalid',now()),
 ('$U1','authenticated','authenticated','one@jsessions.invalid',now()), ('$U2','authenticated','authenticated','two@jsessions.invalid',now());
insert into family (id, name, created_by) values ('$FA','JSESS family','$UA');
insert into member (family_id, user_id, name, role) values ('$FA','$UA','Org A','organizer'), ('$FA','$UB','Org B','organizer');
SQL
[ $? = 0 ] || { echo "setup failed"; exit 1; }
as() { local u="$1"; shift
  "${CLIENT[@]}" <<SQL 2>&1
select set_config('request.jwt.claims', '{"sub":"$u","role":"authenticated"}', false);
set role authenticated;
$*
SQL
}
UUIDRE='[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}'
# ---- 1. API sessions
out=$(as "$UA" "select code_hash from family_join_code;");              has "permission denied" "$out"; ok $? "an organizer read the code hash table"
out=$(as "$UA" "select * from family_join_request;");                   has "permission denied" "$out"; ok $? "an organizer read the request table directly"
out=$(as "$UA" "update family_join_request set status = 'approved';");  has "permission denied" "$out"; ok $? "an organizer approved by direct update"
out=$(as "$UA" "insert into member (family_id, user_id, name) values ('$FA','$U1','Forced');"); has "can only be linked" "$out"; ok $? "an organizer inserted a linked member directly"
out=$(as "$UA" "select family_join_code_hash('AAAA');");                has "permission denied" "$out"; ok $? "the hash helper is callable by clients"
# ---- 2. two organizers approve one request at the same moment
CODE=$(as "$UA" "select rotate_family_join_code('$FA');" | grep -Eo '[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}' | tail -1)
[ -n "$CODE" ]; ok $? "no code returned"
RID=$(as "$U1" "select request_to_join_family('$CODE', 'One Requester');" | grep -o "$UUIDRE" | tail -1)
[ -n "$RID" ]; ok $? "request not created"
( "${CLIENT[@]}" <<SQL >/tmp/pendia_join_race_a.out 2>&1
select set_config('request.jwt.claims', '{"sub":"$UA","role":"authenticated"}', false);
set role authenticated;
begin;
select decide_join_request('$RID', true);
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
outb=$(as "$UB" "select decide_join_request('$RID', true);")
wait
outa=$(cat /tmp/pendia_join_race_a.out); rm -f /tmp/pendia_join_race_a.out
has "$UUIDRE" "$outa"; ok $? "the first approver did not get the new member id"
has "request_not_pending" "$outb"; ok $? "the simultaneous second approval was not refused (got: $outb)"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where family_id = '$FA' and user_id = '$U1'"); [ "$cnt" = "1" ]; ok $? "membership not created exactly once"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from family_join_request where id = '$RID' and status = 'approved'"); [ "$cnt" = "1" ]; ok $? "request not approved once"
# ---- 3. the same person submits the same request twice at once
( "${CLIENT[@]}" <<SQL >/tmp/pendia_join_dup_a.out 2>&1
select set_config('request.jwt.claims', '{"sub":"$U2","role":"authenticated"}', false);
set role authenticated;
begin;
select request_to_join_family('$CODE', 'Two Requester');
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
outd=$(as "$U2" "select request_to_join_family('$CODE', 'Two Requester');")
wait
rm -f /tmp/pendia_join_dup_a.out
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from family_join_request where user_id = '$U2' and status = 'pending'"); [ "$cnt" = "1" ]; ok $? "simultaneous duplicate requests created $cnt pending rows"
has "$UUIDRE" "$outd"; ok $? "the second submission did not return the existing request (got: $outd)"
echo "join-code sessions: $pass passed, $failed failed"; [ "$failed" = 0 ]
