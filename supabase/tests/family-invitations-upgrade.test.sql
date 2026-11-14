-- Family invitations on a database that ALREADY has I-1 (access windows, member RLS, token invitations): the upgrade path of
-- 20261113000001_family_invitations.sql. Run it AFTER applying that migration to a copy of the test-project schema. Synthetic users only.
-- ONE script that ALWAYS ends in an exception, so nothing persists. Pass => PASS: N assertions. Fail => FAIL: naming the assertion.
-- Requests arrive as a NON-superuser login role (PostgREST authenticator) that switches into authenticated or anon.
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if;
end $$;
grant authenticated to authenticator;
grant anon to authenticator;
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
create function pg_temp.try(q text) returns text language plpgsql as $f$
begin execute q; return 'OK'; exception when others then return sqlstate; end $f$;
create function pg_temp.trymsg(q text) returns text language plpgsql as $f$
begin execute q; return 'OK'; exception when others then return sqlerrm; end $f$;


do $test$
declare
  n int := 0; c int; t text; fa uuid; fb uuid; i1 uuid; i2 uuid; i3 uuid; ma uuid; mb uuid; mc uuid; md uuid; mo uuid;
  uo uuid := gen_random_uuid(); ux uuid := gen_random_uuid(); ui uuid := gen_random_uuid(); uj uuid := gen_random_uuid();
  uk uuid := gen_random_uuid();
begin
  if not exists (select 1 from information_schema.columns where table_name = 'member' and column_name = 'access_status') then
    raise exception 'FAIL: this schema has no I-1 access window; run family-invitations.test.sql instead';
  end if;
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (uo, 'authenticated', 'authenticated', 'org-a@test.invalid', now()), (ux, 'authenticated', 'authenticated', 'org-b@test.invalid', now()),
    (ui, 'authenticated', 'authenticated', 'invitee@test.invalid', now()), (uj, 'authenticated', 'authenticated', 'second@test.invalid', now()),
    (uk, 'authenticated', 'authenticated', 'third@test.invalid', now());
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ux) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Organizer A', 'organizer') returning id into mo;
  insert into member (family_id, user_id, name, role) values (fb, ux, 'Organizer B', 'organizer');
  insert into member (family_id, name, role, can_see_meds, can_see_schedule, can_see_visits, can_upload_documents)
    values (fa, 'Invitee A', 'member', false, true, false, true) returning id into ma;
  insert into member (family_id, name, role, access_starts_at) values (fa, 'Scheduled', 'member', now() + interval '3 days') returning id into mb;
  insert into member (family_id, name, role, access_status) values (fa, 'Ended', 'member', 'ended') returning id into mc;
  insert into member (family_id, name, role) values (fa, 'Late', 'member') returning id into md;
  -- the invitee already has a CURRENT membership in Fam B (I-1 refused a second family; the approved design allows it)
  insert into member (family_id, user_id, name, role) values (fb, ui, 'Invitee in B', 'member');

  -------------------------------------------------------------- 1. old token objects are gone, new shape is in place
  select count(*) into c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('preview_family_invite', 'invite_token_hash'); if c <> 0 then raise exception 'FAIL: token functions remain'; end if; n := n + 1;
  select count(*) into c from pg_proc where pronamespace = 'public'::regnamespace and proname = 'accept_family_invite' and pg_get_function_identity_arguments(oid) <> '_invite_id uuid'; if c <> 0 then raise exception 'FAIL: token accept remains'; end if; n := n + 1;
  select count(*) into c from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_family_invite' and prorettype <> 'uuid'::regtype; if c <> 0 then raise exception 'FAIL: create_family_invite still returns the token'; end if; n := n + 1;
  select count(*) into c from information_schema.columns where table_name = 'family_invite' and column_name = 'token_hash'; if c <> 0 then raise exception 'FAIL: token_hash column remains'; end if; n := n + 1;
  select count(*) into c from pg_indexes where tablename = 'family_invite' and indexname in ('family_invite_one_pending'); if c <> 0 then raise exception 'FAIL: old index remains'; end if; n := n + 1;
  select count(*) into c from pg_indexes where tablename = 'family_invite' and indexname = 'family_invite_one_open'; if c <> 1 then raise exception 'FAIL: one-open index missing'; end if; n := n + 1;
  if pg_temp.try($$insert into public.family_invite (family_id, member_id, invited_email, created_by, delivery_status) select family_id, id, 'x@test.invalid', gen_random_uuid(), 'not_sent' from public.member limit 1$$) <> '23514' then raise exception 'FAIL: not_sent accepted'; end if; n := n + 1;
  if pg_temp.try($$insert into public.family_invite (family_id, member_id, created_by) select family_id, id, gen_random_uuid() from public.member limit 1$$) <> '23502' then raise exception 'FAIL: invitation without an email accepted'; end if; n := n + 1;

  -------------------------------------------------------------- 2. the user_id guard (I-1 CRLF body replaced by the same logic)
  perform pg_temp.login(uo);
  if pg_temp.try(format('update public.member set user_id = %L where id = %L', uj, md)) <> '42501' then raise exception 'FAIL: organizer linked an arbitrary account'; end if; n := n + 1;
  if pg_temp.try(format('insert into public.member (family_id, user_id, name, role) values (%L, %L, %L, %L)', fa, uj, 'Sneaky', 'member')) <> '42501' then raise exception 'FAIL: organizer inserted a linked member'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set name = %L where id = %L', 'Renamed', md)) <> 'OK' then raise exception 'FAIL: ordinary member edits broke'; end if; n := n + 1;

  -------------------------------------------------------------- 3. access window is respected
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', mc, 'invitee@test.invalid')) <> '23514' then raise exception 'FAIL: an ended member was invited'; end if; n := n + 1;
  select public.create_family_invite(ma, 'invitee@test.invalid') into i1;
  select public.create_family_invite(mb, 'second@test.invalid') into i2;
  select public.create_family_invite(md, 'third@test.invalid') into i3;
  perform pg_temp.admin();
  update public.member set access_status = 'ended' where id = md;      -- ended AFTER the invitation was sent
  perform pg_temp.login(uk);
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: an ended member row is still offered'; end if; n := n + 1;
  if pg_temp.try(format('select public.accept_family_invite(%L)', i3)) <> 'P0001' then raise exception 'FAIL: accepted for an ended member'; end if; n := n + 1;

  -------------------------------------------------------------- 4. accept: multi-family, only user_id changes, window and permissions untouched
  perform pg_temp.login(ui);
  select count(*) into c from public.my_pending_family_invites(); if c <> 1 then raise exception 'FAIL: pending list wrong'; end if; n := n + 1;
  if pg_temp.try(format('select public.accept_family_invite(%L)', i1)) <> 'OK' then raise exception 'FAIL: second-family accept refused'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.member where user_id = ui; if c <> 2 then raise exception 'FAIL: expected 2 memberships'; end if; n := n + 1;
  select count(*) into c from public.member where id = ma and user_id = ui and role = 'member' and access_status = 'active' and access_starts_at is null
     and access_ends_at is null and can_see_meds = false and can_see_schedule = true and can_see_visits = false and can_upload_documents = true;
  if c <> 1 then raise exception 'FAIL: accepting changed more than user_id'; end if; n := n + 1;
  perform pg_temp.login(uj);
  if pg_temp.try(format('select public.accept_family_invite(%L)', i2)) <> 'OK' then raise exception 'FAIL: scheduled member accept refused'; end if; n := n + 1;
  select public.is_family_member(fa) into t; if t::boolean then raise exception 'FAIL: scheduled member has access before the window opens'; end if; n := n + 1;
  perform pg_temp.admin();
  select member_access_state(user_id, access_status, access_starts_at, access_ends_at) into t from public.member where id = mb; if t <> 'scheduled' then raise exception 'FAIL: state %', t; end if; n := n + 1;
  update public.member set access_starts_at = now() - interval '1 hour' where id = mb;
  perform pg_temp.login(uj);
  if not public.is_family_member(fa) then raise exception 'FAIL: access did not open with the window'; end if; n := n + 1;
  perform pg_temp.admin();
  update public.member set access_ends_at = now() - interval '1 minute' where id = mb;
  perform pg_temp.login(uj);
  if public.is_family_member(fa) then raise exception 'FAIL: expired window still grants access'; end if; n := n + 1;

  -------------------------------------------------------------- 5. RLS isolation after linking
  perform pg_temp.login(ui);
  select count(*) into c from public.member where family_id = fa and user_id <> ui; if c <> 0 then raise exception 'FAIL: plain member reads other members of the family'; end if; n := n + 1;
  select count(*) into c from public.family_invite; if c <> 0 then raise exception 'FAIL: plain member reads invitations'; end if; n := n + 1;
  perform pg_temp.anon();
  if pg_temp.try('select count(*) from public.family_invite') <> '42501' then raise exception 'FAIL: anon reads invitations'; end if; n := n + 1;
  perform pg_temp.login(uo);
  select count(*) into c from public.family_invite where family_id = fa; if c <> 3 then raise exception 'FAIL: organizer cannot read own family invitations'; end if; n := n + 1;
  select count(*) into c from public.family_invite where family_id = fb; if c <> 0 then raise exception 'FAIL: cross-family invitation read'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set can_upload_documents = false where id = %L', ma)) <> 'OK' then raise exception 'FAIL: organizer cannot change can_upload_documents'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end $test$;
rollback;
