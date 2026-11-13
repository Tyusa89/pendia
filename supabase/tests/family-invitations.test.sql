-- Family invitations (20261113000001_family_invitations.sql): email-bound, no token. Synthetic users only. ONE script that ALWAYS ends in an
-- exception, so nothing persists. Pass => 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion. Scratch database or a rolled-back dry run.
-- The concurrent double-accept race needs separate committed sessions: see family-invitations-sessions.sh.
-- Requests arrive as a NON-superuser login role (PostgREST's `authenticator`) that switches into `authenticated` or `anon`, as in member-invites.test.sql.
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
  n int := 0; c int; t text; fa uuid; fb uuid; i1 uuid; i2 uuid; ib uuid; r record; fam uuid; before_row jsonb; after_row jsonb;
  uo uuid := gen_random_uuid();   -- organizer of Family A
  ux uuid := gen_random_uuid();   -- organizer of Family B
  um uuid := gen_random_uuid();   -- an existing plain member of A (has an account)
  ui uuid := gen_random_uuid();   -- the invitee (confirmed)
  ue uuid := gen_random_uuid();   -- some other confirmed account
  uu uuid := gen_random_uuid();   -- an UNCONFIRMED account
  ma uuid; mb uuid; mc uuid; mo uuid; mx uuid; md uuid;
  ok_ constant text := 'OK';
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (uo, 'authenticated', 'authenticated', 'org-a@test.invalid', now()),
    (ux, 'authenticated', 'authenticated', 'org-b@test.invalid', now()),
    (um, 'authenticated', 'authenticated', 'member@test.invalid', now()),
    (ui, 'authenticated', 'authenticated', 'invitee@test.invalid', now()),
    (ue, 'authenticated', 'authenticated', 'other@test.invalid', now()),
    (uu, 'authenticated', 'authenticated', 'unverified@test.invalid', null);
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ux) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Organizer A', 'organizer') returning id into mo;
  insert into member (family_id, user_id, name, role) values (fb, ux, 'Organizer B', 'organizer') returning id into mx;
  insert into member (family_id, user_id, name, role) values (fa, um, 'Existing Member', 'member');
  insert into member (family_id, name, role, can_see_meds, can_see_schedule, can_see_visits) values (fa, 'Invitee A', 'member', false, true, false) returning id into ma;
  insert into member (family_id, name, role) values (fa, 'Second A', 'member') returning id into mb;
  insert into member (family_id, name, role) values (fb, 'Invitee B', 'member') returning id into md;
  insert into member (family_id, name, role) values (fa, 'Another Organizer Slot', 'organizer') returning id into mc;

  -------------------------------------------------------------- 1. the user_id gap is closed
  perform pg_temp.login(uo);
  if pg_temp.try(format('insert into public.member (family_id, user_id, name) values (%L, %L, %L)', fa, ue, 'Planted')) <> '42501' then raise exception 'FAIL: organizer inserted a member linked to an arbitrary account'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set user_id = %L where id = %L', ue, ma)) <> '42501' then raise exception 'FAIL: organizer linked an arbitrary account to a member row'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set user_id = null where id = (select id from public.member where user_id = %L)', um)) <> '42501' then raise exception 'FAIL: organizer unlinked a member account'; end if; n := n + 1;
  if pg_temp.try(format('insert into public.member (family_id, name, role) values (%L, %L, %L)', fa, 'Unlinked member', 'member')) <> ok_ then raise exception 'FAIL: organizer can no longer add an unlinked member'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set can_see_meds = true where id = %L', mb)) <> ok_ then raise exception 'FAIL: organizer lost the ability to change permission switches'; end if; n := n + 1;
  perform pg_temp.login(ue);
  insert into public.family (name, created_by) values ('Fam E', ue) returning id into fam;
  if pg_temp.try(format('insert into public.member (family_id, user_id, name, role) values (%L, %L, %L, %L)', fam, ue, 'Me', 'organizer')) <> ok_ then raise exception 'FAIL: the family creator can no longer add their own organizer row'; end if; n := n + 1;
  perform pg_temp.admin();
  delete from public.family where id = fam;

  -------------------------------------------------------------- 2. create: organizer only, validated, throttled
  perform pg_temp.login(um);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', ma, 'invitee@test.invalid')) <> '42501' then raise exception 'FAIL: a plain member created an invitation'; end if; n := n + 1;
  perform pg_temp.login(ux);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', ma, 'invitee@test.invalid')) <> '42501' then raise exception 'FAIL: an organizer of ANOTHER family created an invitation'; end if; n := n + 1;
  perform pg_temp.anon();
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', ma, 'invitee@test.invalid')) not in ('42501') then raise exception 'FAIL: anon reached create_family_invite'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', ma, 'not-an-email')) <> '23514' then raise exception 'FAIL: invalid email accepted'; end if; n := n + 1;
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', mc, 'x@test.invalid')) <> '23514' then raise exception 'FAIL: invitation created for an organizer-role row'; end if; n := n + 1;
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', mb, 'member@test.invalid')) <> '23514' then raise exception 'FAIL: invited an email that already belongs to someone in this family'; end if; n := n + 1;
  select public.create_family_invite(ma, '  Invitee@Test.Invalid ') into i1; n := n + 1;
  perform pg_temp.admin();
  select * into r from public.family_invite where id = i1;
  if r.invited_email <> 'invitee@test.invalid' or r.delivery_status <> 'queued' or r.expires_at <= now() + interval '6 days' or r.family_id <> fa or r.member_id <> ma then raise exception 'FAIL: invitation row wrong (email lowercased and trimmed, queued, 7 days, family and member)'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', ma, 'invitee@test.invalid')) <> 'P0001' then raise exception 'FAIL: no throttle on rapid re-invites'; end if; n := n + 1;

  -------------------------------------------------------------- 3. clients cannot touch the table; organizers read only their own family
  if pg_temp.try(format('update public.family_invite set expires_at = now() + interval ''99 days'' where id = %L', i1)) = ok_ then raise exception 'FAIL: client updated family_invite'; end if; n := n + 1;
  if pg_temp.try(format('delete from public.family_invite where id = %L', i1)) = ok_ then raise exception 'FAIL: client deleted family_invite'; end if; n := n + 1;
  if pg_temp.try(format('insert into public.family_invite (family_id, member_id, invited_email, created_by) values (%L, %L, %L, %L)', fa, mb, 'x@test.invalid', uo)) = ok_ then raise exception 'FAIL: client inserted family_invite'; end if; n := n + 1;
  select count(*) into c from public.family_invite; if c <> 1 then raise exception 'FAIL: organizer sees % invitations, expected 1', c; end if; n := n + 1;
  perform pg_temp.login(ux);
  select count(*) into c from public.family_invite; if c <> 0 then raise exception 'FAIL: another family organizer sees invitations'; end if; n := n + 1;
  perform pg_temp.login(um);
  select count(*) into c from public.family_invite; if c <> 0 then raise exception 'FAIL: a plain member sees invitations'; end if; n := n + 1;
  perform pg_temp.anon();
  if pg_temp.try('select count(*) from public.family_invite') = ok_ then raise exception 'FAIL: anon can read family_invite'; end if; n := n + 1;

  -------------------------------------------------------------- 4. what the invitee may see before accepting
  perform pg_temp.login(ui);
  select * into r from public.my_pending_family_invites();
  if r.invite_id is distinct from i1 or r.family_name <> 'Fam A' or r.member_name <> 'Invitee A' or r.invited_by_name <> 'Organizer A' then raise exception 'FAIL: pending invitation not shown correctly to its invitee'; end if; n := n + 1;
  select count(*) into c from (select * from public.my_pending_family_invites()) s; if c <> 1 then raise exception 'FAIL: invitee sees % invitations', c; end if; n := n + 1;
  perform pg_temp.login(ue);
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: another account sees someone else''s invitation'; end if; n := n + 1;
  perform pg_temp.login(uu);
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: an unverified account sees invitations'; end if; n := n + 1;
  perform pg_temp.anon();
  if pg_temp.try('select * from public.my_pending_family_invites()') not in ('42501') then raise exception 'FAIL: anon reached my_pending_family_invites'; end if; n := n + 1;

  -------------------------------------------------------------- 5. accept: only the verified, matching account; explicit; single-use; changes only user_id
  perform pg_temp.admin();
  select to_jsonb(m) - 'user_id' into before_row from public.member m where id = ma;
  perform pg_temp.login(ue);
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i1)) <> 'invite_invalid' then raise exception 'FAIL: a different account accepted (or leaked a distinct error)'; end if; n := n + 1;
  perform pg_temp.login(um);
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i1)) <> 'invite_invalid' then raise exception 'FAIL: an existing member of the family accepted someone else''s invitation'; end if; n := n + 1;
  perform pg_temp.admin();
  update auth.users set email = 'invitee@test.invalid' where id = uu;  -- an unverified account claims the invited email (email unique in real auth; stub has no constraint)
  perform pg_temp.login(uu);
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i1)) <> 'invite_email_unverified' then raise exception 'FAIL: an UNVERIFIED account accepted'; end if; n := n + 1;
  perform pg_temp.admin();
  update auth.users set email = 'unverified@test.invalid' where id = uu;
  perform pg_temp.anon();
  if pg_temp.try(format('select public.accept_family_invite(%L)', i1)) <> '42501' then raise exception 'FAIL: anon reached accept_family_invite'; end if; n := n + 1;
  perform pg_temp.login(ui);
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', gen_random_uuid())) <> 'invite_invalid' then raise exception 'FAIL: unknown invitation id not generic'; end if; n := n + 1;
  select public.accept_family_invite(i1) into fam;
  if fam <> fa then raise exception 'FAIL: accept returned the wrong family'; end if; n := n + 1;
  perform pg_temp.admin();
  if (select user_id from public.member where id = ma) is distinct from ui then raise exception 'FAIL: member row not linked to the accepting account'; end if; n := n + 1;
  select to_jsonb(m) - 'user_id' into after_row from public.member m where id = ma;
  if before_row is distinct from after_row then raise exception 'FAIL: accepting changed more than user_id (permissions or fields moved)'; end if; n := n + 1;
  if (select accepted_by from public.family_invite where id = i1) is distinct from ui or (select accepted_at from public.family_invite where id = i1) is null then raise exception 'FAIL: invitation not marked accepted'; end if; n := n + 1;
  perform pg_temp.login(ui);
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i1)) <> 'invite_invalid' then raise exception 'FAIL: replay of an accepted invitation'; end if; n := n + 1;
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: accepted invitation still listed'; end if; n := n + 1;
  select count(*) into c from public.family where id = fa; if c <> 1 then raise exception 'FAIL: the new member cannot see their family'; end if; n := n + 1;
  select count(*) into c from public.family where id = fb; if c <> 0 then raise exception 'FAIL: the new member sees another family'; end if; n := n + 1;
  perform pg_temp.try(format('update public.member set can_see_meds = true where id = %L', ma));
  perform pg_temp.admin();
  if (select can_see_meds from public.member where id = ma) then raise exception 'FAIL: the new member changed their own permission'; end if; n := n + 1;

  -------------------------------------------------------------- 6. expiry, resend, revoke
  perform pg_temp.login(ue);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', mb, 'other@test.invalid')) <> '42501' then raise exception 'FAIL: a zero-membership account created an invitation'; end if; n := n + 1;
  perform pg_temp.login(uo);
  select public.create_family_invite(mb, 'other@test.invalid') into i2; n := n + 1;
  perform pg_temp.admin();
  update public.family_invite set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where id = i2;
  perform pg_temp.login(ue);
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: an expired invitation is still listed'; end if; n := n + 1;
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i2)) <> 'invite_invalid' then raise exception 'FAIL: an expired invitation was accepted'; end if; n := n + 1;
  perform pg_temp.login(uo);
  select public.create_family_invite(mb, 'other@test.invalid') into i2;   -- resend after expiry: a fresh invitation replaces the expired one
  perform pg_temp.admin();
  select count(*) into c from public.family_invite where member_id = mb and accepted_at is null and revoked_at is null; if c <> 1 then raise exception 'FAIL: % open invitations for one member after resend', c; end if; n := n + 1;
  select count(*) into c from public.family_invite where member_id = mb and revoked_at is not null; if c <> 1 then raise exception 'FAIL: the expired invitation was not retired on resend'; end if; n := n + 1;
  -- revoke
  perform pg_temp.login(um);
  if pg_temp.try(format('select public.revoke_family_invite(%L)', i2)) <> '42501' then raise exception 'FAIL: a plain member revoked an invitation'; end if; n := n + 1;
  perform pg_temp.login(ux);
  if pg_temp.try(format('select public.revoke_family_invite(%L)', i2)) <> '42501' then raise exception 'FAIL: another family organizer revoked an invitation'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.try(format('select public.revoke_family_invite(%L)', i1)) <> '23514' then raise exception 'FAIL: revoked an already accepted invitation'; end if; n := n + 1;
  perform pg_temp.admin(); update public.family_invite set created_at = now() - interval '1 hour' where id = i2; perform pg_temp.login(uo);
  perform public.revoke_family_invite(i2); perform public.revoke_family_invite(i2); n := n + 1;  -- idempotent
  perform pg_temp.login(ue);
  select count(*) into c from public.my_pending_family_invites(); if c <> 0 then raise exception 'FAIL: a revoked invitation is still listed'; end if; n := n + 1;
  if pg_temp.trymsg(format('select public.accept_family_invite(%L)', i2)) <> 'invite_invalid' then raise exception 'FAIL: a revoked invitation was accepted'; end if; n := n + 1;
  -- resend after revoke works and the new invitation is accepted by the right account
  perform pg_temp.login(uo);
  select public.create_family_invite(mb, 'other@test.invalid') into i2;
  perform pg_temp.login(ue);
  if public.accept_family_invite(i2) <> fa then raise exception 'FAIL: resent invitation not accepted'; end if; n := n + 1;

  -------------------------------------------------------------- 7. delivery status (organizer only, fixed values)
  perform pg_temp.login(ux);
  select public.create_family_invite(md, 'invitee@test.invalid') into ib; n := n + 1;   -- the SAME person is invited into a second family
  if pg_temp.try(format('select public.set_family_invite_delivery(%L, %L)', ib, 'delivered')) <> '22023' then raise exception 'FAIL: arbitrary delivery status accepted'; end if; n := n + 1;
  perform pg_temp.login(um);
  if pg_temp.try(format('select public.set_family_invite_delivery(%L, %L)', ib, 'sent')) <> '42501' then raise exception 'FAIL: a non-organizer set the delivery status'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.try(format('select public.set_family_invite_delivery(%L, %L)', ib, 'sent')) <> '42501' then raise exception 'FAIL: another family organizer set the delivery status'; end if; n := n + 1;
  perform pg_temp.login(ux);
  perform public.set_family_invite_delivery(ib, 'failed');
  perform public.set_family_invite_delivery(ib, 'sent'); n := n + 1;
  perform pg_temp.admin();
  if (select delivery_status from public.family_invite where id = ib) <> 'sent' or (select last_sent_at from public.family_invite where id = ib) is null then raise exception 'FAIL: delivery status not recorded'; end if; n := n + 1;

  -------------------------------------------------------------- 8. more than one family; no duplicate or cross-family grants
  perform pg_temp.login(ui);
  if public.accept_family_invite(ib) <> fb then raise exception 'FAIL: second-family invitation not accepted'; end if; n := n + 1;
  select count(*) into c from public.member where user_id = ui; if c <> 2 then raise exception 'FAIL: expected 2 memberships, found %', c; end if; n := n + 1;
  select count(*) into c from public.family; if c <> 2 then raise exception 'FAIL: the person cannot see both of their families'; end if; n := n + 1;
  perform pg_temp.admin();
  if (select count(*) from public.member where user_id = ui and family_id = fa) <> 1 or (select count(*) from public.member where user_id = ui and family_id = fb) <> 1 then raise exception 'FAIL: duplicate membership in one family'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.try(format('select public.create_family_invite(%L, %L)', (select id from public.member where family_id = fa and name = 'Unlinked member'), 'invitee@test.invalid')) <> '23514' then raise exception 'FAIL: a person already in the family was invited again'; end if; n := n + 1;
  -- an invitation can never point at a member row of another family (composite foreign key), even for a trusted role
  perform pg_temp.admin();
  if pg_temp.try(format('update public.family_invite set member_id = %L where id = %L', ma, ib)) <> '23503' then raise exception 'FAIL: an invitation was re-pointed at a member row of another family'; end if; n := n + 1;

  perform pg_temp.admin();
  raise exception 'PASS: % assertions', n;
end
$test$;
