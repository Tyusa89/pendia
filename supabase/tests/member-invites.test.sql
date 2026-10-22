-- I-1: caregiver relationship + access window, single-use invitation links, the family directory and the member.user_id
-- lock (20261022000002_member_access_invites.sql). Synthetic users only. ONE script that ALWAYS ends in an exception, so
-- nothing persists. Pass => 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion.
-- Run only on a scratch database or, once approved, as a rolled-back dry run. The concurrent-accept race needs separate
-- committed sessions: see member-invites-race.sh.

-- Requests arrive as a NON-superuser login role (PostgREST's `authenticator`) that switches into `authenticated` or `anon`.
-- The tests do the same, so "SET ROLE postgres" is genuinely out of reach, as it is for a real API caller.
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'rando') then create role rando nologin; end if;
end $$;
grant authenticated to authenticator;
grant anon to authenticator;
grant authenticated to rando;
grant rando to authenticator;
create function pg_temp.login(u uuid) returns void language plpgsql as $f$
begin
  execute 'reset role'; execute 'set local session authorization default';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local session authorization authenticator'; execute 'set local role authenticated';
end $f$;
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  execute 'reset role'; execute 'set local session authorization default';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local session authorization authenticator'; execute 'set local role anon';
end $f$;
create function pg_temp.admin() returns void language plpgsql as $f$
begin execute 'reset role'; execute 'set local session authorization default'; end $f$;
-- runs a statement and returns 'OK' or its SQLSTATE; trymsg returns the error message instead
create function pg_temp.try(q text) returns text language plpgsql as $f$
begin execute q; return 'OK'; exception when others then return sqlstate; end $f$;
create function pg_temp.trymsg(q text) returns text language plpgsql as $f$
begin execute q; return 'OK'; exception when others then return sqlerrm; end $f$;

do $test$
declare
  n int := 0; k int; t text; tok text; tok2 text; tok3 text; r record; fa uuid; fb uuid; fc uuid; c int;
  ua uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); um uuid := gen_random_uuid(); up uuid := gen_random_uuid();
  un uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  ux uuid := gen_random_uuid(); uz uuid := gen_random_uuid(); uvict uuid := gen_random_uuid();
  unew uuid := gen_random_uuid(); uend uuid := gen_random_uuid(); uexp uuid := gen_random_uuid(); usch uuid := gen_random_uuid(); mpb2 uuid; mpb3 uuid; mpb4 uuid;
  ma uuid; ma2 uuid; mm uuid; mp uuid; mf uuid; me uuid; mv uuid; mb uuid; mpb uuid; mxa uuid; mxb uuid; mag1 uuid; mag2 uuid;
  mg uuid; mo uuid; sh uuid; inv uuid;
  fail text;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (ua, 'authenticated', 'authenticated', 'orga@test.invalid', now()),
    (u2, 'authenticated', 'authenticated', 'org2@test.invalid', now()),
    (um, 'authenticated', 'authenticated', 'mem@test.invalid', now()),
    (up, 'authenticated', 'authenticated', 'pro@test.invalid', now()),
    (un, 'authenticated', 'authenticated', 'newbie@test.invalid', now()),
    (ue, 'authenticated', 'authenticated', 'Invitee@Test.Invalid', now()),
    (uv, 'authenticated', 'authenticated', 'invitee@test.invalid', null),
    (ub, 'authenticated', 'authenticated', 'orgb@test.invalid', now()),
    (ux, 'authenticated', 'authenticated', 'both@test.invalid', now()),
    (uz, 'authenticated', 'authenticated', 'zed@test.invalid', now()),
    (uvict, 'authenticated', 'authenticated', 'victim@test.invalid', now()),
    (unew, 'authenticated', 'authenticated', 'brandnew@test.invalid', now()),
    (uend, 'authenticated', 'authenticated', 'ended@test.invalid', now()),
    (uexp, 'authenticated', 'authenticated', 'expired@test.invalid', now()),
    (usch, 'authenticated', 'authenticated', 'sched@test.invalid', now());
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role, phone) values (fa, ua, 'Org A', 'organizer', '+12125550101') returning id into ma;
  insert into member (family_id, user_id, name, role, phone) values (fa, u2, 'Org A2', 'organizer', '+12125550102') returning id into ma2;
  insert into member (family_id, user_id, name, role, phone, can_see_meds, can_see_schedule, can_see_visits)
    values (fa, um, 'Member A', 'member', '+12125550103', true, true, true) returning id into mm;
  insert into member (family_id, user_id, name, role, phone, relationship, agency_name, access_until_removed, can_see_meds, can_see_schedule, can_see_visits)
    values (fa, up, 'Pro A', 'member', '+12125550104', 'professional', 'Acme Care', true, false, true, false) returning id into mp;
  insert into member (family_id, name, phone, can_see_meds, can_see_schedule, can_see_visits)
    values (fa, 'Unlinked Friend', '+12125550105', false, true, false) returning id into mf;
  insert into member (family_id, name, can_see_meds, can_see_schedule, can_see_visits) values (fa, 'Email Friend', false, true, false) returning id into me;
  insert into member (family_id, name, can_see_meds, can_see_schedule, can_see_visits) values (fa, 'Verify Friend', false, true, false) returning id into mv;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  insert into member (family_id, name, can_see_schedule) values (fb, 'Unlinked B', true) returning id into mpb;
  insert into member (family_id, user_id, name, relationship, agency_name, access_until_removed, can_see_schedule)
    values (fa, ux, 'Both A', 'professional', 'Acme Care', true, true) returning id into mxa;
  insert into member (family_id, user_id, name, relationship, agency_name, access_until_removed, can_see_schedule)
    values (fb, ux, 'Both B', 'professional', 'Acme Care', true, true) returning id into mxb;
  insert into shift (family_id, start, "end", assigned_member_id, status)
    values (fa, now() + interval '2 days', now() + interval '2 days 4 hours', mp, 'claimed') returning id into sh;
  insert into handoff (family_id, author_member_id, note) values (fa, mp, 'synthetic handoff note');
  insert into medication (family_id, name) values (fa, 'Synthetic med');

  ------------------------------------------------------------------ 1. existing behaviour is unchanged
  select relationship, access_status into r from member where id = mm;
  if r.relationship <> 'family_friend' or r.access_status <> 'active' then raise exception 'FAIL: new columns do not default to today''s behaviour'; end if; n := n + 1;
  perform pg_temp.login(um);
  if not is_family_member(fa) or is_family_member(fb) then raise exception 'FAIL: is_family_member changed for a plain active member'; end if; n := n + 1;
  if not member_can_see(fa, 'meds') or not member_can_see(fa, 'schedule') then raise exception 'FAIL: member_can_see changed'; end if; n := n + 1;
  perform pg_temp.login(ua);
  if not is_family_organizer(fa) or is_family_organizer(fb) then raise exception 'FAIL: is_family_organizer changed'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, phone) values (%L, ''New Person'', ''+12125550199'')', fa)) <> 'OK' then
    raise exception 'FAIL: an organizer can no longer add an unlinked member (the invite form path)'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, relationship, agency_name, access_until_removed) values (%L, ''Agency Person'', ''agency'', ''Acme Care'', true)', fa)) <> 'OK' then
    raise exception 'FAIL: organizer cannot add an agency member with an explicit duration choice'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 2. member.user_id cannot be set by clients
  perform pg_temp.login(ua); -- an organizer
  if pg_temp.try(format('update member set user_id = %L where id = %L', uvict, mf)) <> '42501' then raise exception 'FAIL: organizer linked an arbitrary account by UPDATE'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, user_id, name) values (%L, %L, ''Forced'')', fa, uvict)) <> '42501' then raise exception 'FAIL: organizer inserted a member with someone else''s account'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (id, family_id, name) values (%L, %L, ''Upsert'') on conflict (id) do update set user_id = %L', mf, fa, uvict)) <> '42501' then raise exception 'FAIL: INSERT ... ON CONFLICT DO UPDATE linked an arbitrary account'; end if; n := n + 1;
  if pg_temp.try(format('update member m set user_id = %L from member o where o.id = m.id and m.id = %L', uvict, mf)) <> '42501' then raise exception 'FAIL: UPDATE ... FROM linked an arbitrary account'; end if; n := n + 1;
  if pg_temp.try('truncate member') = 'OK' then raise exception 'FAIL: an API caller can TRUNCATE member'; end if; n := n + 1;
  if pg_temp.try(format('update member set user_id = null where id = %L', mm)) <> '42501' then raise exception 'FAIL: organizer unlinked an account directly'; end if; n := n + 1;
  if pg_temp.try(format('update member set user_id = %L where id = %L', ua, mf)) <> '42501' then raise exception 'FAIL: organizer linked THEMSELVES to another member row'; end if; n := n + 1;
  -- session variables, role switching and session authorization cannot unlock it
  perform set_config('pendia.linking', 'on', true); perform set_config('app.allow_link', 'true', true);
  if pg_temp.try('select set_config(''role'', ''postgres'', true)') = 'OK' then raise exception 'FAIL: set_config(role) switched an API caller to postgres'; end if; n := n + 1;
  if pg_temp.try(format('update member set user_id = %L where id = %L', uvict, mf)) <> '42501' then raise exception 'FAIL: a session variable unlocked linking'; end if; n := n + 1;
  if pg_temp.try('set local role postgres') = 'OK' then raise exception 'FAIL: an authenticated user could switch to postgres'; end if; n := n + 1;
  -- (SET SESSION AUTHORIZATION depends on who opened the connection, so it is tested from a real non-superuser login in member-invites-sessions.sh)
  if pg_temp.try('set local role service_role') = 'OK' then raise exception 'FAIL: an authenticated user could become service_role'; end if; n := n + 1;
  select count(*) into k from member where id = mf and user_id is not null;
  if k <> 0 then raise exception 'FAIL: a refused link persisted'; end if; n := n + 1;
  -- a non-organizer member cannot either (and cannot even update)
  perform pg_temp.admin(); perform pg_temp.login(um);
  if pg_temp.try(format('update member set user_id = %L where id = %L', um, mf)) = 'OK' and exists (select 1 from member where id = mf and user_id is not null) then raise exception 'FAIL: member linked themselves'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.anon();
  if pg_temp.try(format('update member set user_id = %L where id = %L', uvict, mf)) = 'OK' then raise exception 'FAIL: anon updated member'; end if; n := n + 1;
  perform pg_temp.admin();
  -- deny by default: even a role that inherits `authenticated` but is not a trusted server role is held to the rule
  perform pg_temp.login(ua);
  execute 'set local role rando';
  if pg_temp.try(format('update member set user_id = %L where id = %L', uvict, mf)) <> '42501' then raise exception 'FAIL: an unlisted role was trusted'; end if; n := n + 1;
  perform pg_temp.admin();
  -- the family creator can still add their own organizer row; nobody else's
  insert into family (name, created_by) values ('Fam C', uz) returning id into fc;
  perform pg_temp.login(uz);
  if pg_temp.try(format('insert into member (family_id, user_id, name, role) values (%L, %L, ''Zed'', ''organizer'')', fc, uz)) <> 'OK' then raise exception 'FAIL: the creator cannot add their own organizer row'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, user_id, name, role) values (%L, %L, ''Victim'', ''organizer'')', fc, uvict)) <> '42501' then raise exception 'FAIL: the creator linked someone else''s account'; end if; n := n + 1;
  perform pg_temp.admin();
  -- trusted server paths keep working: the demo seed links the caller to their own organizer row
  perform pg_temp.login(un);
  perform join_demo_family();
  select count(*) into k from member m join family f on f.id = m.family_id where f.is_demo and m.user_id = un and m.role = 'organizer';
  if k <> 1 then raise exception 'FAIL: join_demo_family no longer creates the caller''s organizer row'; end if; n := n + 1;
  select count(*) into k from member m join family f on f.id = m.family_id where f.is_demo and m.user_id = un and (select count(*) from member x where x.family_id = f.id) = 3;
  if k <> 1 then raise exception 'FAIL: the demo family should have 3 members'; end if; n := n + 1;
  select count(*) into k from member m join family f on f.id = m.family_id where f.is_demo and m.name = 'Jenny' and m.can_see_meds = false and m.relationship = 'family_friend' and m.access_status = 'active';
  if k <> 1 then raise exception 'FAIL: the demo members changed'; end if; n := n + 1;
  perform pg_temp.admin();
  delete from family where is_demo and created_by = un;

  ------------------------------------------------------------------ 3. professional / agency rules
  if pg_temp.try(format('insert into member (family_id, name, relationship) values (%L, ''No choice'', ''professional'')', fa)) <> '23514' then raise exception 'FAIL: a professional without a duration choice was accepted'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, relationship, access_ends_at) values (%L, ''Dated'', ''professional'', now() + interval ''30 days'')', fa)) <> 'OK' then raise exception 'FAIL: a professional with an end date was refused'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, relationship, role, access_until_removed) values (%L, ''Boss'', ''professional'', ''organizer'', true)', fa)) <> '23514' then raise exception 'FAIL: a professional organizer was accepted'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, relationship, role, access_until_removed) values (%L, ''Boss'', ''agency'', ''organizer'', true)', fa)) <> '23514' then raise exception 'FAIL: an agency organizer was accepted'; end if; n := n + 1;
  if pg_temp.try(format('update member set role = ''organizer'' where id = %L', mp)) <> '23514' then raise exception 'FAIL: a professional was promoted to organizer'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, access_starts_at, access_ends_at) values (%L, ''Backwards'', now() + interval ''2 days'', now() + interval ''1 day'')', fa)) <> '23514' then raise exception 'FAIL: an end before the start was accepted'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, relationship) values (%L, ''Bad'', ''neighbor'')', fa)) <> '23514' then raise exception 'FAIL: an unknown relationship was accepted'; end if; n := n + 1;
  if pg_temp.try(format('insert into member (family_id, name, access_status) values (%L, ''Bad'', ''paused'')', fa)) <> '23514' then raise exception 'FAIL: an unknown access status was accepted'; end if; n := n + 1;

  ------------------------------------------------------------------ 4. creating invitations
  perform pg_temp.login(ua);
  tok := create_family_invite(mf, null);
  if tok !~ '^[0-9a-f]{64}$' then raise exception 'FAIL: token is not 64 hex characters (%)', tok; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from family_invite where family_invite::text like '%' || tok || '%';
  if k <> 0 then raise exception 'FAIL: the raw token is stored in the invite row'; end if; n := n + 1;
  select count(*) into k from family_invite where token_hash = sha256(convert_to(tok, 'UTF8')) and member_id = mf and family_id = fa and expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute';
  if k <> 1 then raise exception 'FAIL: invite row wrong (hash, member, or 7-day expiry)'; end if; n := n + 1;
  -- who may create
  perform pg_temp.login(um);
  if pg_temp.try(format('select create_family_invite(%L, null)', mv)) <> '42501' then raise exception 'FAIL: a plain member created an invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ub);
  if pg_temp.try(format('select create_family_invite(%L, null)', mv)) <> '42501' then raise exception 'FAIL: another family''s organizer created an invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(un);
  if pg_temp.try(format('select create_family_invite(%L, null)', mv)) <> '42501' then raise exception 'FAIL: an outsider created an invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.anon();
  if pg_temp.try(format('select create_family_invite(%L, null)', mv)) <> '42501' then raise exception 'FAIL: anon could call create_family_invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ua);
  if pg_temp.try(format('select create_family_invite(%L, null)', mm)) <> '23514' then raise exception 'FAIL: invited an already-linked member'; end if; n := n + 1;
  if pg_temp.try(format('select create_family_invite(%L, null)', ma2)) <> '23514' then raise exception 'FAIL: created an invite for an organizer row'; end if; n := n + 1;
  if pg_temp.try(format('select create_family_invite(%L, ''not-an-email'')', mv)) <> '23514' then raise exception 'FAIL: a malformed email was accepted'; end if; n := n + 1;
  if pg_temp.try(format('select create_family_invite(%L, null)', gen_random_uuid())) <> '42501' then raise exception 'FAIL: an invite for a non-existent member was created'; end if; n := n + 1;
  perform pg_temp.admin();
  -- regenerate replaces the pending link
  perform pg_temp.login(ua);
  tok2 := create_family_invite(mf, null);
  perform pg_temp.admin();
  select count(*) into k from family_invite where member_id = mf and accepted_at is null and revoked_at is null;
  if k <> 1 then raise exception 'FAIL: expected exactly one pending invite after regenerating, found %', k; end if; n := n + 1;
  select count(*) into k from family_invite where member_id = mf and revoked_at is not null;
  if k <> 1 then raise exception 'FAIL: the old invite was not revoked'; end if; n := n + 1;
  perform pg_temp.login(un);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: a replaced token still worked'; end if; n := n + 1;
  perform pg_temp.admin();
  -- email stored lowercase, trimmed
  perform pg_temp.login(ua);
  tok3 := create_family_invite(me, '  Invitee@Test.Invalid ');
  perform pg_temp.admin();
  select count(*) into k from family_invite where member_id = me and invited_email = 'invitee@test.invalid' and revoked_at is null;
  if k <> 1 then raise exception 'FAIL: email not normalised'; end if; n := n + 1;

  ------------------------------------------------------------------ 5. who can read invitations; the hash stays hidden
  perform pg_temp.login(ua);
  if pg_temp.try('select token_hash from family_invite') <> '42501' then raise exception 'FAIL: an organizer can read token_hash'; end if; n := n + 1;
  if pg_temp.try('select * from family_invite') <> '42501' then raise exception 'FAIL: select * exposes token_hash'; end if; n := n + 1;
  select count(*) into k from family_invite where family_id = fa; -- count(*) needs no column privilege beyond the row filter
  if k < 2 then raise exception 'FAIL: organizer cannot see their invites'; end if; n := n + 1;
  if pg_temp.try('select id, member_id, expires_at, accepted_at, revoked_at from family_invite') <> 'OK' then raise exception 'FAIL: organizer cannot list invite status columns'; end if; n := n + 1;
  if pg_temp.try(format('insert into family_invite (family_id, member_id, token_hash, created_by) values (%L, %L, ''\x00''::bytea, %L)', fa, mv, ua)) <> '42501' then raise exception 'FAIL: direct insert into family_invite'; end if; n := n + 1;
  if pg_temp.try('update family_invite set expires_at = now() + interval ''365 days''') <> '42501' then raise exception 'FAIL: direct update of family_invite'; end if; n := n + 1;
  if pg_temp.try('delete from family_invite') <> '42501' then raise exception 'FAIL: direct delete from family_invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(um);
  select count(*) into k from family_invite;
  if k <> 0 then raise exception 'FAIL: a plain member can read invitations'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ub);
  select count(*) into k from family_invite where family_id = fa;
  if k <> 0 then raise exception 'FAIL: another family''s organizer can read invitations'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 6. preview shows nothing private
  perform pg_temp.anon();
  if pg_temp.try(format('select * from preview_family_invite(%L)', tok2)) <> '42501' then raise exception 'FAIL: anon can preview an invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(un);
  select * into r from preview_family_invite(tok2);
  if r.family_name <> 'Fam A' or r.member_name <> 'Unlinked Friend' or r.email_bound or not r.email_matches then raise exception 'FAIL: preview content wrong'; end if; n := n + 1;
  select string_agg(parameter_name, ',' order by ordinal_position) into t from information_schema.parameters
    where specific_schema = 'public' and specific_name like 'preview_family_invite%' and parameter_mode = 'OUT';
  if t <> 'family_name,member_name,relationship,agency_name,access_starts_at,access_ends_at,access_until_removed,email_bound,email_matches,second_family_blocked,expires_at' then
    raise exception 'FAIL: preview returns unapproved columns: %', t; end if; n := n + 1;
  if pg_temp.trymsg(format('select * from preview_family_invite(%L)', 'deadbeef')) <> 'invite_invalid' then raise exception 'FAIL: bad token message'; end if; n := n + 1;
  if pg_temp.trymsg(format('select * from preview_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: revoked token previewed'; end if; n := n + 1;
  select * into r from preview_family_invite(tok3); -- email-bound, wrong account
  if not r.email_bound or r.email_matches then raise exception 'FAIL: email-bound preview for the wrong account'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ue);
  select * into r from preview_family_invite(tok3);
  if not r.email_bound or not r.email_matches then raise exception 'FAIL: email-bound preview for the right (case-insensitive) account'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 7. accepting
  -- new account, unbound invite
  perform pg_temp.login(un);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', repeat('0', 64))) <> 'invite_invalid' then raise exception 'FAIL: unknown token message'; end if; n := n + 1;
  if pg_temp.trymsg(format('select accept_family_invite(%L)', 'not hex')) <> 'invite_invalid' then raise exception 'FAIL: malformed token message'; end if; n := n + 1;
  if pg_temp.trymsg('select accept_family_invite(null)') <> 'invite_invalid' then raise exception 'FAIL: null token message'; end if; n := n + 1;
  if accept_family_invite(tok2) <> fa then raise exception 'FAIL: accept did not return the family'; end if; n := n + 1;
  select user_id, can_see_meds, can_see_schedule, can_see_visits, role, relationship into r from member where id = mf;
  if r.user_id <> un then raise exception 'FAIL: member not linked to the accepting account'; end if; n := n + 1;
  if r.can_see_meds or not r.can_see_schedule or r.can_see_visits or r.role <> 'member' then raise exception 'FAIL: accepting changed the organizer-set permissions'; end if; n := n + 1;
  if not is_family_member(fa) or not member_can_see(fa, 'schedule') or member_can_see(fa, 'meds') or member_can_see(fa, 'visits') then raise exception 'FAIL: new member''s access is not exactly what was granted'; end if; n := n + 1;
  select count(*) into k from medication where family_id = fa;
  if k <> 0 then raise exception 'FAIL: new member without meds access can read medications'; end if; n := n + 1;
  -- reuse
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok2)) <> 'invite_invalid' then raise exception 'FAIL: a used token worked a second time (same user)'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(uvict);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok2)) <> 'invite_invalid' then raise exception 'FAIL: a used token worked for a forwarded recipient'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from member where user_id = uvict;
  if k <> 0 then raise exception 'FAIL: forwarded recipient got linked'; end if; n := n + 1;
  select accepted_by into r from family_invite where member_id = mf and accepted_at is not null;
  if r.accepted_by <> un then raise exception 'FAIL: accepted_by not recorded'; end if; n := n + 1;
  -- no new pending invite can be made for a linked member
  perform pg_temp.login(ua);
  if pg_temp.try(format('select create_family_invite(%L, null)', mf)) <> '23514' then raise exception 'FAIL: an invite for a now-linked member'; end if; n := n + 1;
  perform pg_temp.admin();

  -- email-bound: wrong account, unverified account, right account (case-insensitive)
  perform pg_temp.login(uvict);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok3)) <> 'invite_email_mismatch' then raise exception 'FAIL: a different verified email accepted a bound invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(uv);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok3)) <> 'invite_email_unverified' then raise exception 'FAIL: an UNVERIFIED matching email accepted a bound invite'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from member where id = me and user_id is not null;
  if k <> 0 then raise exception 'FAIL: a refused email-bound accept linked the member'; end if; n := n + 1;
  perform pg_temp.login(ue);
  if accept_family_invite(tok3) <> fa then raise exception 'FAIL: the right verified account could not accept'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from member where id = me and user_id = ue;
  if k <> 1 then raise exception 'FAIL: email-bound accept did not link'; end if; n := n + 1;

  -- expired (at and past the boundary) / revoked / near-expiry still valid
  perform pg_temp.login(ua);
  tok := create_family_invite(mv, null);
  perform pg_temp.admin();
  update family_invite set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where member_id = mv and revoked_at is null;
  perform pg_temp.login(uv);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: an expired invite worked'; end if; n := n + 1;
  if pg_temp.trymsg(format('select * from preview_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: an expired invite previewed'; end if; n := n + 1;
  perform pg_temp.admin();
  update family_invite set expires_at = now() where member_id = mv and revoked_at is null;
  perform pg_temp.login(uv);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: an invite expiring exactly now worked'; end if; n := n + 1;
  perform pg_temp.admin();
  update family_invite set created_at = now() - interval '6 days 23 hours', expires_at = now() + interval '1 hour' where member_id = mv and revoked_at is null;
  perform pg_temp.login(uv);
  if accept_family_invite(tok) <> fa then raise exception 'FAIL: an invite one hour before expiry did not work'; end if; n := n + 1;
  perform pg_temp.admin();
  -- revoked
  insert into member (family_id, name, can_see_schedule) values (fa, 'Revoke Me', true) returning id into mg;
  perform pg_temp.login(ua);
  tok := create_family_invite(mg, null);
  select id into inv from family_invite where member_id = mg and revoked_at is null;
  perform revoke_family_invite(inv);
  perform pg_temp.admin(); perform pg_temp.login(uvict);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: a revoked invite worked'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(um);
  if pg_temp.try(format('select revoke_family_invite(%L)', inv)) <> '42501' then raise exception 'FAIL: a plain member revoked an invite'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ub);
  if pg_temp.try(format('select revoke_family_invite(%L)', inv)) <> '42501' then raise exception 'FAIL: another family''s organizer revoked an invite'; end if; n := n + 1;
  perform pg_temp.admin();

  -- cross-family: an account that already has a CURRENT membership elsewhere cannot take a second one (no switcher yet)
  perform pg_temp.login(ub);
  tok := create_family_invite(mpb, null); -- a family B invite
  perform pg_temp.admin(); perform pg_temp.login(um);                -- member of family A
  select * into r from preview_family_invite(tok);
  if not r.second_family_blocked then raise exception 'FAIL: the preview does not warn that a second family is unsupported'; end if; n := n + 1;
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_second_family' then raise exception 'FAIL: a member of A could take a second membership in B'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from member where id = mpb and user_id is not null;
  if k <> 0 then raise exception 'FAIL: a refused second-family accept still linked the member'; end if; n := n + 1;
  select count(*) into k from family_invite where member_id = mpb and accepted_at is null and revoked_at is null and expires_at > now();
  if k <> 1 then raise exception 'FAIL: a refused second-family accept consumed the invite'; end if; n := n + 1;
  select count(*) into k from member where family_id = fa and user_id = um;
  if k <> 1 then raise exception 'FAIL: the refused accept disturbed the A membership'; end if; n := n + 1;
  -- the same invite works for a person with no other current membership (a new account)
  perform pg_temp.login(unew);
  if accept_family_invite(tok) <> fb then raise exception 'FAIL: a fresh account could not take the family B invite'; end if; n := n + 1;
  perform pg_temp.admin();
  -- ended / expired memberships elsewhere do not block; not-yet-started ones do
  insert into member (family_id, user_id, name, access_status) values (fa, uend, 'Ended Elsewhere', 'ended');
  insert into member (family_id, user_id, name, access_ends_at) values (fa, uexp, 'Expired Elsewhere', now() - interval '1 day');
  insert into member (family_id, user_id, name, access_starts_at) values (fa, usch, 'Scheduled Elsewhere', now() + interval '3 days');
  insert into member (family_id, name, can_see_schedule) values (fb, 'B Two', true) returning id into mpb2;
  insert into member (family_id, name, can_see_schedule) values (fb, 'B Three', true) returning id into mpb3;
  insert into member (family_id, name, can_see_schedule) values (fb, 'B Four', true) returning id into mpb4;
  perform pg_temp.login(ub);
  tok := create_family_invite(mpb2, null); tok2 := create_family_invite(mpb3, null); tok3 := create_family_invite(mpb4, null);
  perform pg_temp.admin(); perform pg_temp.login(uend);
  if accept_family_invite(tok) <> fb then raise exception 'FAIL: an ENDED membership elsewhere blocked a new invitation'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(uexp);
  if accept_family_invite(tok2) <> fb then raise exception 'FAIL: an EXPIRED membership elsewhere blocked a new invitation'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(usch);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok3)) <> 'invite_second_family' then raise exception 'FAIL: a not-yet-started membership elsewhere did not block'; end if; n := n + 1;
  perform pg_temp.admin();
  if pg_temp.try('select has_other_current_membership(gen_random_uuid(), gen_random_uuid())') <> 'OK' then null; end if;
  perform pg_temp.login(un);
  if pg_temp.try(format('select has_other_current_membership(%L, %L)', um, fb)) <> '42501' then raise exception 'FAIL: a client can probe other people''s memberships'; end if; n := n + 1;
  perform pg_temp.admin();
  perform pg_temp.login(ua);
  tok := create_family_invite(mg, null);
  perform pg_temp.admin(); perform pg_temp.login(u2);       -- already an organizer in A
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'already_member' then raise exception 'FAIL: an existing member linked a second row in the same family'; end if; n := n + 1;
  perform pg_temp.admin();
  -- an invite row can never point at another family's member (tampering)
  if pg_temp.try(format('update family_invite set member_id = %L where member_id = %L and revoked_at is null', mpb, mg)) <> '23503' then raise exception 'FAIL: an invite was re-pointed at another family''s member'; end if; n := n + 1;
  -- the member is promoted/linked after the invite was made: the invite dies
  update member set role = 'organizer' where id = mg;
  perform pg_temp.login(uvict);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'invite_invalid' then raise exception 'FAIL: an invite for a since-promoted row worked'; end if; n := n + 1;
  perform pg_temp.admin();
  update member set role = 'member' where id = mg;
  -- an ended person who already has a row in the family cannot take a second one
  insert into member (family_id, user_id, name, access_status) values (fa, uvict, 'Was Here', 'ended') returning id into mo;
  perform pg_temp.login(ua);
  tok := create_family_invite(mg, null);
  perform pg_temp.admin(); perform pg_temp.login(uvict);
  if pg_temp.trymsg(format('select accept_family_invite(%L)', tok)) <> 'already_member' then raise exception 'FAIL: an ended member took a second row'; end if; n := n + 1;
  perform pg_temp.admin();
  -- nothing links by name or phone: an account matching an unlinked member's name or phone stays unlinked
  insert into member (family_id, name, phone) values (fa, 'Zed', '+12125550177');
  perform pg_temp.login(uz);
  perform my_memberships(); perform family_directory(fa); perform pg_temp.try(format('select * from preview_family_invite(%L)', repeat('a', 64)));
  perform pg_temp.admin();
  select count(*) into k from member where user_id = uz and family_id = fa;
  if k <> 0 then raise exception 'FAIL: an account was linked by matching name or phone'; end if; n := n + 1;
  -- an invite cannot be created for an ended row
  update member set access_status = 'ended' where id = mg;
  perform pg_temp.login(ua);
  if pg_temp.try(format('select create_family_invite(%L, null)', mg)) <> '23514' then raise exception 'FAIL: an invite was created for an ended member'; end if; n := n + 1;
  perform pg_temp.admin();
  update member set access_status = 'active' where id = mg;

  ------------------------------------------------------------------ 8. access windows, ended access, nothing silently cancelled
  perform pg_temp.login(up);
  if not is_family_member(fa) or not member_can_see(fa, 'schedule') or member_can_see(fa, 'meds') then raise exception 'FAIL: professional access is not exactly schedule-only'; end if; n := n + 1;
  select count(*) into k from shift where family_id = fa; if k < 1 then raise exception 'FAIL: professional cannot see the schedule'; end if; n := n + 1;
  select count(*) into k from medication where family_id = fa; if k <> 0 then raise exception 'FAIL: professional can read medications'; end if; n := n + 1;
  perform pg_temp.admin();
  foreach t in array array['future', 'past', 'suspended', 'ended'] loop
    if t = 'future' then update member set access_starts_at = now() + interval '1 day' where id = mp;
    elsif t = 'past' then update member set access_starts_at = null, access_ends_at = now() - interval '1 second' where id = mp;
    elsif t = 'suspended' then update member set access_ends_at = null, access_status = 'suspended' where id = mp;
    else update member set access_status = 'ended' where id = mp; end if;
    perform pg_temp.login(up);
    if is_family_member(fa) or member_can_see(fa, 'schedule') then raise exception 'FAIL: access still works (%)', t; end if; n := n + 1;
    select count(*) into k from shift where family_id = fa; if k <> 0 then raise exception 'FAIL: shifts readable after access stopped (%)', t; end if; n := n + 1;
    select count(*) into k from family where id = fa; if k <> 0 then raise exception 'FAIL: family readable after access stopped (%)', t; end if; n := n + 1;
    select count(*) into k from family_directory(fa); if k <> 0 then raise exception 'FAIL: directory readable after access stopped (%)', t; end if; n := n + 1;
    select access_state into r from my_memberships() where member_id = mp;
    fail := case t when 'future' then 'scheduled' when 'past' then 'expired' else t end;
    if r.access_state <> fail then raise exception 'FAIL: my_memberships state wrong for %: %', t, r.access_state; end if; n := n + 1;
    perform pg_temp.admin();
  end loop;
  -- nothing was cancelled or unassigned, and history still names the person
  select count(*) into k from shift where id = sh and assigned_member_id = mp and status = 'claimed';
  if k <> 1 then raise exception 'FAIL: ending access changed a shift'; end if; n := n + 1;
  select count(*) into k from handoff where author_member_id = mp;
  if k <> 1 then raise exception 'FAIL: ending access changed a handoff author'; end if; n := n + 1;
  perform pg_temp.login(um);
  select access_state, name into r from family_directory(fa) where id = mp;
  if r.access_state <> 'ended' or r.name <> 'Pro A' then raise exception 'FAIL: directory should still list the ended person by name'; end if; n := n + 1;
  perform pg_temp.admin();
  -- restoring is immediate
  update member set access_status = 'active', access_starts_at = null, access_ends_at = null where id = mp;
  perform pg_temp.login(up);
  if not is_family_member(fa) then raise exception 'FAIL: restoring access did not take effect'; end if; n := n + 1;
  -- a member cannot change their own access, dates, role or permissions
  if pg_temp.try(format('update member set access_ends_at = null, can_see_meds = true, role = ''organizer'' where id = %L', mp)) = 'OK'
     and exists (select 1 from member where id = mp and can_see_meds) then raise exception 'FAIL: a professional edited their own permissions'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 9. last organizer
  update member set access_status = 'ended' where id = ma2; -- fine: Org A still current
  if pg_temp.try(format('update member set access_status = ''ended'' where id = %L', ma)) <> '23514' then raise exception 'FAIL: the last organizer was ended'; end if; n := n + 1;
  if pg_temp.try(format('update member set access_status = ''suspended'' where id = %L', ma)) <> '23514' then raise exception 'FAIL: the last organizer was suspended'; end if; n := n + 1;
  if pg_temp.try(format('update member set access_ends_at = now() - interval ''1 minute'' where id = %L', ma)) <> '23514' then raise exception 'FAIL: the last organizer was expired'; end if; n := n + 1;
  if pg_temp.try(format('update member set role = ''member'' where id = %L', ma)) <> '23514' then raise exception 'FAIL: the last organizer was demoted'; end if; n := n + 1;
  if pg_temp.try(format('delete from member where id = %L', ma)) <> '23514' then raise exception 'FAIL: the last organizer was deleted'; end if; n := n + 1;
  update member set access_status = 'active' where id = ma2;
  if pg_temp.try(format('update member set access_status = ''ended'' where id = %L', ma)) <> 'OK' then raise exception 'FAIL: an organizer could not be ended while another remains'; end if; n := n + 1;
  update member set access_status = 'active' where id = ma;
  perform pg_temp.login(ub);
  if pg_temp.try(format('delete from family where id = %L', fb)) <> 'OK' then raise exception 'FAIL: the last organizer cannot delete their own family'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into k from member where family_id = fb;
  if k <> 0 then raise exception 'FAIL: deleting a family left members'; end if; n := n + 1;
  -- rebuild a family B for the isolation checks below
  insert into family (name, created_by) values ('Fam B2', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  insert into member (family_id, user_id, name, relationship, agency_name, access_until_removed, can_see_schedule)
    values (fb, ux, 'Both B', 'professional', 'Acme Care', true, true) returning id into mxb;
  insert into shift (family_id, start, "end", status) values (fb, now() + interval '1 day', now() + interval '1 day 4 hours', 'open');

  ------------------------------------------------------------------ 10. directory: independent membership check, approved fields only
  select string_agg(parameter_name, ',' order by ordinal_position) into t from information_schema.parameters
    where specific_schema = 'public' and specific_name like 'family_directory%' and parameter_mode = 'OUT';
  if t <> 'id,family_id,name,role,relationship,agency_name,access_state' then raise exception 'FAIL: family_directory returns unapproved columns: %', t; end if; n := n + 1;
  select count(*) into k from unnest(string_to_array(t, ',')) as u(col) where u.col ~* 'phone|email|user|language|can_see|access_(starts|ends|until)|created|note';
  if k <> 0 then raise exception 'FAIL: a sensitive-looking column in family_directory'; end if; n := n + 1;
  perform pg_temp.login(um);
  select count(*) into k from family_directory(fa); if k < 5 then raise exception 'FAIL: a member cannot read the roster names'; end if; n := n + 1;
  select count(*) into k from family_directory(fb); if k <> 0 then raise exception 'FAIL: the directory leaked another family to an A member (not a member of fb)'; end if; n := n + 1;
  select count(*) into k from family_directory(gen_random_uuid()); if k <> 0 then raise exception 'FAIL: directory for an unknown family returned rows'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ub);
  select count(*) into k from family_directory(fa); if k <> 0 then raise exception 'FAIL: another family''s organizer read family A''s roster'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(uz);
  select count(*) into k from family_directory(fa); if k <> 0 then raise exception 'FAIL: an outsider read the roster'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.anon();
  if pg_temp.try(format('select * from family_directory(%L)', fa)) <> '42501' then raise exception 'FAIL: anon can call family_directory'; end if; n := n + 1;
  perform pg_temp.admin();
  -- phone and permissions are not readable by other members, only by organizers and the person themself
  perform pg_temp.login(um);
  select count(*) into k from member where family_id = fa; if k <> 1 then raise exception 'FAIL: a member can read other member rows (% rows)', k; end if; n := n + 1;
  select phone into t from member where id = mm; if t <> '+12125550103' then raise exception 'FAIL: a member cannot read their own phone'; end if; n := n + 1;
  select count(*) into k from member where phone is not null and id <> mm; if k <> 0 then raise exception 'FAIL: another member''s phone is readable'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(up);
  select count(*) into k from member where family_id = fa; if k <> 1 then raise exception 'FAIL: a professional can read other member rows'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ua);
  select count(*) into k from member where family_id = fa; if k < 6 then raise exception 'FAIL: an organizer cannot read the full roster'; end if; n := n + 1;
  select count(*) into k from member where family_id = fb; if k <> 0 then raise exception 'FAIL: an organizer can read another family''s member rows'; end if; n := n + 1;
  select count(*) into k from member where phone = '+12125550103'; if k <> 1 then raise exception 'FAIL: an organizer cannot read member phones'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 11. agency label grants nothing; people in several families stay isolated
  -- Pro A (family A) and Both A/B share agency_name 'Acme Care'
  perform pg_temp.login(up);
  select count(*) into k from shift where family_id = fb; if k <> 0 then raise exception 'FAIL: a shared agency name opened another family'; end if; n := n + 1;
  select count(*) into k from family_directory(fb); if k <> 0 then raise exception 'FAIL: a shared agency name opened another family''s roster'; end if; n := n + 1;
  perform pg_temp.admin(); perform pg_temp.login(ux);
  select count(*) into k from shift where family_id = fa and assigned_member_id = mp; if k <> 1 then raise exception 'FAIL: a two-family professional cannot see family A'; end if; n := n + 1;
  select count(*) into k from shift where family_id = fb; if k <> 1 then raise exception 'FAIL: a two-family professional cannot see family B'; end if; n := n + 1;
  select count(*) into k from my_memberships(); if k <> 2 then raise exception 'FAIL: my_memberships should list both families'; end if; n := n + 1;
  select count(*) into k from family_directory(fa) where family_id <> fa; if k <> 0 then raise exception 'FAIL: directory mixed families'; end if; n := n + 1;
  perform pg_temp.admin();
  update member set access_status = 'ended' where id = mxa;
  perform pg_temp.login(ux);
  select count(*) into k from shift where family_id = fa; if k <> 0 then raise exception 'FAIL: ended family A still readable'; end if; n := n + 1;
  select count(*) into k from shift where family_id = fb; if k <> 1 then raise exception 'FAIL: ending A removed access to B'; end if; n := n + 1;
  select count(*) into k from my_memberships() where access_state = 'ended' and family_id = fa; if k <> 1 then raise exception 'FAIL: ended family not reported'; end if; n := n + 1;
  select count(*) into k from my_memberships() where access_state = 'active' and family_id = fb; if k <> 1 then raise exception 'FAIL: family B not reported active'; end if; n := n + 1;
  perform pg_temp.admin();

  ------------------------------------------------------------------ 12. exposed functions: who can execute what
  select count(*) into k from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('create_family_invite','revoke_family_invite','preview_family_invite','accept_family_invite','family_directory','my_memberships')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));
  if k <> 0 then raise exception 'FAIL: % invitation/directory function(s) executable by anon/public', k; end if; n := n + 1;
  select count(*) into k from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('create_family_invite','revoke_family_invite','preview_family_invite','accept_family_invite','family_directory','my_memberships')
     and (not p.prosecdef or p.proconfig is null or not exists (select 1 from unnest(p.proconfig) as cfg(setting) where cfg.setting like 'search_path=%'));
  if k <> 0 then raise exception 'FAIL: a function is not security definer with a fixed search_path'; end if; n := n + 1;
  select count(*) into k from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('member_user_id_guard','member_last_organizer_guard')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if k <> 0 then raise exception 'FAIL: a trigger function is directly callable'; end if; n := n + 1;
  -- the ONLY security-definer code that can write member.user_id is join_demo_family and accept_family_invite
  select string_agg(p.proname, ',' order by p.proname) into t from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and pg_get_functiondef(p.oid) ~* '(insert\s+into\s+public\.member|update\s+public\.member\s+set\s+[^;]*user_id|update\s+public\.member\s+set\s+user_id)';
  if t <> 'accept_family_invite,join_demo_family' then raise exception 'FAIL: unexpected security-definer writers of member: %', t; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end
$test$;
rollback;
