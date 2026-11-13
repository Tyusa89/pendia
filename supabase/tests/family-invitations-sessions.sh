#!/usr/bin/env bash
# Family invitations (20261113000001): the checks that need REAL, separate, committed sessions, so they cannot live in the single-transaction SQL test:
#   1. a non-superuser API login cannot escalate (SET ROLE, session_replication_role, dropping the trigger) and cannot link an account to a member row;
#   2. two simultaneous accepts of the SAME invitation: exactly one wins; an organizer's revoke racing an accept cannot undo it.
# SCRATCH DATABASES ONLY (commits rows, briefly gives `authenticator` a login). Same guards and style as member-invites-sessions.sh.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5434 PGDATABASE=t bash supabase/tests/family-invitations-sessions.sh
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
  "${ADMIN[@]}" -c "delete from family where name like 'SESS %'; delete from auth.users where email like '%@sessions.invalid';" >/dev/null 2>&1
}
trap cleanup EXIT
cleanup
UA=11111111-1111-4111-8111-111111111111; U1=33333333-3333-4333-8333-333333333333; U2=44444444-4444-4444-8444-444444444444
FA=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; MF=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; MG=dddddddd-dddd-4ddd-8ddd-dddddddddddd
"${ADMIN[@]}" <<SQL
do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if; end \$\$;
grant authenticated to authenticator;
grant anon to authenticator;
alter role authenticator login;
insert into auth.users (id, aud, role, email, email_confirmed_at) values
 ('$UA','authenticated','authenticated','a@sessions.invalid',now()), ('$U1','authenticated','authenticated','one@sessions.invalid',now()),
 ('$U2','authenticated','authenticated','two@sessions.invalid',now());
insert into family (id, name, created_by) values ('$FA','SESS family','$UA');
insert into member (family_id, user_id, name, role) values ('$FA','$UA','Org','organizer');
insert into member (id, family_id, name) values ('$MF','$FA','Invitee'), ('$MG','$FA','Invitee 2');
SQL
[ $? = 0 ] || { echo "setup failed"; exit 1; }
as() { local u="$1"; shift
  "${CLIENT[@]}" <<SQL 2>&1
select set_config('request.jwt.claims', '{"sub":"$u","role":"authenticated"}', false);
set role authenticated;
$*
SQL
}
# ---- 1. escalation attempts from a non-superuser API session
out=$(as "$UA" "set role postgres;");                      has "permission denied" "$out"; ok $? "organizer could SET ROLE postgres"
out=$(as "$UA" "set session_replication_role = replica;"); has "permission denied" "$out"; ok $? "an API caller could disable triggers"
out=$(as "$UA" "update member set user_id = '$U1' where id = '$MF';"); has "can only be linked to an account by accepting" "$out"; ok $? "organizer linked an arbitrary account"
out=$(as "$UA" "update member set user_id = '$UA' where id = '$MF';"); has "can only be linked" "$out"; ok $? "organizer linked THEMSELVES"
out=$(as "$UA" "insert into member (family_id, user_id, name) values ('$FA','$U1','Forced');"); has "can only be linked" "$out"; ok $? "organizer inserted a linked member"
out=$(as "$UA" "drop trigger member_user_id_guard on member;"); has "must be owner" "$out"; ok $? "organizer could drop the guard trigger"
out=$(as "$UA" "select member_user_id_guard();");          has "permission denied" "$out"; ok $? "trigger function directly callable"
out=$(as "$UA" "update family_invite set expires_at = now() + interval '1 year';"); has "permission denied" "$out"; ok $? "organizer updated family_invite directly"
out=$("${CLIENT[@]}" 2>&1 <<SQL
set role anon;
select * from my_pending_family_invites();
SQL
); has "permission denied" "$out"; ok $? "anon called my_pending_family_invites"

# ---- 2a. a real concurrent double-accept of ONE invitation (same invited account in two sessions)
IID=$(as "$UA" "select create_family_invite('$MF', 'one@sessions.invalid');" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | tail -1)
[ -n "$IID" ]; ok $? "could not create the invitation for the race"
( "${CLIENT[@]}" <<SQL >/tmp/pendia_inv_race_a.out 2>&1
select set_config('request.jwt.claims', '{"sub":"$U1","role":"authenticated"}', false);
set role authenticated;
begin;
select accept_family_invite('$IID');
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
outb=$(as "$U1" "select accept_family_invite('$IID');")
wait
outa=$(cat /tmp/pendia_inv_race_a.out); rm -f /tmp/pendia_inv_race_a.out
has "$FA" "$outa"; ok $? "the first accepter did not get the family"
has "invite_invalid" "$outb"; ok $? "the simultaneous second accept was not refused (got: $outb)"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where id = '$MF' and user_id = '$U1'"); [ "$cnt" = "1" ]; ok $? "member not linked exactly once"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where user_id = '$U1'"); [ "$cnt" = "1" ]; ok $? "duplicate membership created by the race"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from family_invite where id = '$IID' and accepted_by = '$U1' and accepted_at is not null"); [ "$cnt" = "1" ]; ok $? "acceptance not recorded once"

# ---- 2b. an organizer's revoke racing an accept: the accept holds the lock, the revoke then fails because it was already accepted
sleep 31   # clears the 30-second re-invite throttle for member MG
IID2=$(as "$UA" "select create_family_invite('$MG', 'two@sessions.invalid');" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | tail -1)
[ -n "$IID2" ]; ok $? "could not create the second invitation"
( "${CLIENT[@]}" <<SQL >/tmp/pendia_inv_race_b.out 2>&1
select set_config('request.jwt.claims', '{"sub":"$U2","role":"authenticated"}', false);
set role authenticated;
begin;
select accept_family_invite('$IID2');
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
outr=$(as "$UA" "select revoke_family_invite('$IID2');")
wait
rm -f /tmp/pendia_inv_race_b.out
has "already accepted" "$outr"; ok $? "revoke racing an accept did not report 'already accepted' (got: $outr)"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where id = '$MG' and user_id = '$U2'"); [ "$cnt" = "1" ]; ok $? "the accept was undone by the revoke"

echo "sessions: $pass passed, $failed failed"
[ "$failed" = 0 ]
