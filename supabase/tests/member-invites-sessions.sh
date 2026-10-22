#!/usr/bin/env bash
# I-1 tests that need REAL, separate, committed database sessions, so they cannot live in the single-transaction SQL test:
#   1. a non-superuser API login (PostgREST's `authenticator`) cannot escalate: SET ROLE / SET SESSION AUTHORIZATION /
#      set_config('role') are refused, the user_id lock holds, internal and trigger functions are not callable;
#   2. two people accepting the SAME invitation at the same moment: exactly one wins.
# SCRATCH DATABASES ONLY. It commits rows and briefly gives `authenticator` a login. It refuses to run unless you point it
# at a local socket/loopback server and set PENDIA_SCRATCH_DB=1.
#   PENDIA_SCRATCH_DB=1 PGHOST=/path/to/socket PGPORT=5434 PGDATABASE=t bash supabase/tests/member-invites-sessions.sh
set -u
[ "${PENDIA_SCRATCH_DB:-}" = "1" ] || { echo "Refusing: set PENDIA_SCRATCH_DB=1 (scratch database only)."; exit 2; }
case "${PGHOST:-}" in /*|127.0.0.1|localhost) ;; *) echo "Refusing: PGHOST must be a local socket or loopback."; exit 2;; esac
: "${PGDATABASE:?set PGDATABASE}"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$PGDATABASE")
CLIENT=(psql -X -A -t -U authenticator -d "$PGDATABASE")
pass=0; failed=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $2"; fi; }
has() { grep -q -- "$1" <<<"$2"; }  # has PATTERN TEXT

cleanup() {
  "${ADMIN[@]}" -c "alter role authenticator nologin" >/dev/null 2>&1
  "${ADMIN[@]}" -c "delete from family where name like 'SESS %'; delete from auth.users where email like '%@sessions.invalid';" >/dev/null 2>&1
}
trap cleanup EXIT
cleanup

UA=11111111-1111-4111-8111-111111111111; UM=22222222-2222-4222-8222-222222222222
U1=33333333-3333-4333-8333-333333333333; U2=44444444-4444-4444-8444-444444444444; UV=55555555-5555-4555-8555-555555555555
FA=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; MF=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; MM=cccccccc-cccc-4ccc-8ccc-cccccccccccc
"${ADMIN[@]}" <<SQL
alter role authenticator login;
insert into auth.users (id, aud, role, email, email_confirmed_at) values
 ('$UA','authenticated','authenticated','a@sessions.invalid',now()), ('$UM','authenticated','authenticated','m@sessions.invalid',now()),
 ('$U1','authenticated','authenticated','one@sessions.invalid',now()), ('$U2','authenticated','authenticated','two@sessions.invalid',now()),
 ('$UV','authenticated','authenticated','v@sessions.invalid',now());
insert into family (id, name, created_by) values ('$FA','SESS family','$UA');
insert into member (family_id, user_id, name, role) values ('$FA','$UA','Org','organizer');
insert into member (id, family_id, user_id, name) values ('$MM','$FA','$UM','Plain Member');
insert into member (id, family_id, name, can_see_schedule) values ('$MF','$FA','Invitee',true);
SQL
[ $? = 0 ] || { echo "setup failed"; exit 1; }

as() { # as USER SQL...  -> output of a fresh API-style session (login role authenticator -> authenticated)
  local u="$1"; shift
  "${CLIENT[@]}" <<SQL 2>&1
select set_config('request.jwt.claims', '{"sub":"$u","role":"authenticated"}', false);
set role authenticated;
$*
SQL
}

# ---- 1. escalation attempts from a non-superuser API session
out=$(as "$UA" "set role postgres;");                      has "permission denied" "$out"; ok $? "organizer could SET ROLE postgres"
out=$(as "$UA" "set session authorization postgres;");     has "permission denied" "$out"; ok $? "organizer could SET SESSION AUTHORIZATION"
out=$(as "$UA" "select set_config('role','postgres',false);"); has "permission denied" "$out"; ok $? "set_config('role') escalated"
out=$(as "$UA" "set session_replication_role = replica;"); has "permission denied" "$out"; ok $? "an API caller could disable triggers (session_replication_role)"
out=$(as "$UA" "set local session_replication_role = replica; update member set user_id = '$U1' where id = '$MF';"); ! has "UPDATE 1" "$out"; ok $? "linking succeeded with triggers disabled"
out=$(as "$UA" "select set_config('pendia.linking','on',false); update member set user_id = '$U1' where id = '$MF';"); has "can only be linked to an account by accepting" "$out"; ok $? "a session variable unlocked linking"
out=$(as "$UA" "update member set user_id = '$UA' where id = '$MF';"); has "can only be linked" "$out"; ok $? "organizer linked THEMSELVES"
out=$(as "$UA" "insert into member (family_id, user_id, name) values ('$FA','$U1','Forced');"); has "can only be linked" "$out"; ok $? "organizer inserted a linked member"
out=$(as "$UA" "alter table member disable trigger member_user_id_guard;"); has "must be owner" "$out"; ok $? "organizer could disable the guard trigger"
out=$(as "$UA" "drop trigger member_user_id_guard on member;"); has "must be owner" "$out"; ok $? "organizer could drop the guard trigger"
out=$(as "$UA" "select member_user_id_guard();");          has "permission denied" "$out"; ok $? "trigger function directly callable"
out=$(as "$UA" "select has_other_current_membership('$UM','$FA');"); has "permission denied" "$out"; ok $? "membership probe callable"
out=$(as "$UM" "select create_family_invite('$MF', null);"); has "Only an organizer" "$out"; ok $? "plain member created an invite"
out=$(as "$UM" "select count(*) from member;");            [ "$(tail -1 <<<"$out")" = "1" ]; ok $? "plain member sees other member rows"
out=$(as "$UM" "select * from family_directory('$FA');");  has "Invitee" "$out" && ! has "@" "$out"; ok $? "directory missing names or leaking an address"
out=$(as "$UM" "select phone from family_directory('$FA');"); has "does not exist" "$out"; ok $? "directory exposes a phone column"
out=$(as "$UA" "update family_invite set expires_at = now() + interval '1 year';"); has "permission denied" "$out"; ok $? "organizer updated family_invite directly"
out=$(as "$UA" "select token_hash from family_invite;");   has "permission denied" "$out"; ok $? "organizer read token_hash"
# anonymous role
out=$("${CLIENT[@]}" 2>&1 <<SQL
set role anon;
select * from family_directory('$FA');
SQL
); has "permission denied" "$out"; ok $? "anon called family_directory"

# ---- 2. a real concurrent double-accept
TOK=$(as "$UA" "select create_family_invite('$MF', null);" | grep -Eo '[0-9a-f]{64}' | head -1)
[ -n "$TOK" ]; ok $? "could not create the invite for the race"
( "${CLIENT[@]}" <<SQL >/tmp/pendia_race_a.out 2>&1
select set_config('request.jwt.claims', '{"sub":"$U1","role":"authenticated"}', false);
set role authenticated;
begin;
select accept_family_invite('$TOK');
select pg_sleep(2);
commit;
SQL
) &
sleep 0.7
outb=$(as "$U2" "select accept_family_invite('$TOK');")
wait
outa=$(cat /tmp/pendia_race_a.out); rm -f /tmp/pendia_race_a.out
has "$FA" "$outa"; ok $? "the first accepter did not get the family"
has "invite_invalid" "$outb"; ok $? "the second, simultaneous accepter was not refused (got: $outb)"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where id = '$MF' and user_id = '$U1'"); [ "$cnt" = "1" ]; ok $? "the member is not linked to exactly the first accepter"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from member where user_id = '$U2'"); [ "$cnt" = "0" ]; ok $? "the loser was linked anyway"
cnt=$("${ADMIN[@]}" -A -t -c "select count(*) from family_invite where member_id = '$MF' and accepted_by = '$U1'"); [ "$cnt" = "1" ]; ok $? "accepted_by not recorded for the winner"

echo "sessions: $pass passed, $failed failed"
[ "$failed" = 0 ]
