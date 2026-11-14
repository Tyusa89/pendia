-- Join with a family code (20261114000001_family_join_code.sql). Synthetic users only. ONE script that ALWAYS ends in an exception, so nothing persists.
-- Pass => 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion. Needs the invitation migration only for the final coexistence check.
-- Requests arrive as a NON-superuser login role (PostgREST's authenticator) that switches into authenticated or anon.
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
  n int := 0; c int; t text; fa uuid; fb uuid; fc uuid; fd uuid; code text; code2 text; rid uuid; rid2 uuid; rid3 uuid; mid uuid; r record; i int;
  uo uuid := gen_random_uuid();  -- organizer A
  ub uuid := gen_random_uuid();  -- organizer B
  um uuid := gen_random_uuid();  -- plain member of A
  ur uuid := gen_random_uuid();  -- the requester
  us uuid := gen_random_uuid();  -- second requester (declined / cancel paths)
  ug uuid := gen_random_uuid();  -- guesser
  uv uuid := gen_random_uuid();  -- unverified
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (uo, 'authenticated', 'authenticated', 'org-a@test.invalid', now()), (ub, 'authenticated', 'authenticated', 'org-b@test.invalid', now()),
    (um, 'authenticated', 'authenticated', 'member@test.invalid', now()), (ur, 'authenticated', 'authenticated', 'Requester@Test.invalid', now()),
    (us, 'authenticated', 'authenticated', 'second@test.invalid', now()), (ug, 'authenticated', 'authenticated', 'guesser@test.invalid', now()),
    (uv, 'authenticated', 'authenticated', 'unverified@test.invalid', null);
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into family (name, created_by) values ('Fam C', ub) returning id into fc;
  insert into family (name, created_by) values ('Fam D', ub) returning id into fd;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Organizer A', 'organizer'), (fa, um, 'Plain Member', 'member'),
    (fb, ub, 'Organizer B', 'organizer'), (fc, ub, 'Organizer B', 'organizer'), (fd, ub, 'Organizer B', 'organizer');

  -------------------------------------------------------------- 1. tables are closed to clients; functions are closed to anon
  perform pg_temp.login(uo);
  foreach t in array array['family_join_code', 'family_join_request', 'family_join_attempt'] loop
    if pg_temp.try('select * from public.' || t) <> '42501' then raise exception 'FAIL: client can read %', t; end if; n := n + 1;
    if pg_temp.try('insert into public.' || t || ' default values') <> '42501' then raise exception 'FAIL: client can write %', t; end if; n := n + 1;
  end loop;
  perform pg_temp.anon();
  if pg_temp.try($$select public.request_to_join_family('AAAA-AAAA-AAAA', 'x')$$) <> '42501' then raise exception 'FAIL: anon can request'; end if; n := n + 1;
  if pg_temp.try(format('select public.rotate_family_join_code(%L)', fa)) <> '42501' then raise exception 'FAIL: anon can rotate'; end if; n := n + 1;

  -------------------------------------------------------------- 2. the code: organizer only, random, stored only as a hash
  perform pg_temp.login(um);
  if pg_temp.try(format('select public.rotate_family_join_code(%L)', fa)) <> '42501' then raise exception 'FAIL: plain member rotated'; end if; n := n + 1;
  perform pg_temp.login(ub);
  if pg_temp.try(format('select public.rotate_family_join_code(%L)', fa)) <> '42501' then raise exception 'FAIL: other family organizer rotated'; end if; n := n + 1;
  if pg_temp.try(format('select * from public.family_join_code_status(%L)', fa)) <> '42501' then raise exception 'FAIL: other organizer read status'; end if; n := n + 1;
  perform pg_temp.login(uo);
  select public.rotate_family_join_code(fa) into code;
  if code !~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then raise exception 'FAIL: code format %', code; end if; n := n + 1;
  select public.rotate_family_join_code(fa) into code2;
  if code2 = code then raise exception 'FAIL: rotate returned the same code'; end if; n := n + 1;
  if not (select enabled from public.family_join_code_status(fa)) then raise exception 'FAIL: not enabled'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.family_join_code where family_id = fa and code_hash = sha256(convert_to(replace(code2, '-', ''), 'UTF8')); if c <> 1 then raise exception 'FAIL: stored hash is not the code hash'; end if; n := n + 1;
  select count(*) into c from public.family_join_code where position(replace(code2, '-', '') in encode(code_hash, 'escape')) > 0 or encode(code_hash, 'hex') = replace(lower(code2), '-', ''); if c <> 0 then raise exception 'FAIL: plaintext stored'; end if; n := n + 1;

  -------------------------------------------------------------- 3. request: verified accounts only; nothing about the family comes back
  perform pg_temp.login(uv);
  if pg_temp.trymsg(format('select public.request_to_join_family(%L, %L)', code2, 'Nope')) <> 'email_unverified' then raise exception 'FAIL: unverified account could request'; end if; n := n + 1;
  perform pg_temp.login(ur);
  if pg_temp.trymsg(format('select public.request_to_join_family(%L, %L)', code2, '   ')) <> 'name_required' then raise exception 'FAIL: empty name accepted'; end if; n := n + 1;
  select public.request_to_join_family(lower(replace(code2, '-', '')), 'Rita Requester') into rid;       -- lowercase, no dashes
  if rid is null then raise exception 'FAIL: valid code refused'; end if; n := n + 1;
  select public.request_to_join_family(code2, 'Rita Requester') into rid2;
  if rid2 is distinct from rid then raise exception 'FAIL: a repeated request created a second row'; end if; n := n + 1;
  select count(*) into c from public.my_join_requests() where status = 'pending'; if c <> 1 then raise exception 'FAIL: my_join_requests'; end if; n := n + 1;
  select count(*) into c from public.family; if c <> 0 then raise exception 'FAIL: requester sees a family'; end if; n := n + 1;
  select count(*) into c from public.member; if c <> 0 then raise exception 'FAIL: requester sees members'; end if; n := n + 1;
  select count(*) into c from public.care_recipient; if c <> 0 then raise exception 'FAIL: requester sees the patient'; end if; n := n + 1;
  if pg_temp.try(format('select * from public.family_join_requests(%L)', fa)) <> '42501' then raise exception 'FAIL: requester read the request list'; end if; n := n + 1;
  if pg_temp.try(format('select public.decide_join_request(%L, true)', rid)) <> '42501' then raise exception 'FAIL: requester approved their own request'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.family_join_request where family_id = fa and user_id = ur; if c <> 1 then raise exception 'FAIL: duplicate rows'; end if; n := n + 1;
  select count(*) into c from public.member where family_id = fa and user_id = ur; if c <> 0 then raise exception 'FAIL: a request alone created membership'; end if; n := n + 1;

  -------------------------------------------------------------- 4. code guessing is logged and limited
  perform pg_temp.login(ug);
  for i in 1..8 loop
    if public.request_to_join_family('2222-3333-4444', 'Guesser') is not null then raise exception 'FAIL: a wrong code worked'; end if;
  end loop; n := n + 1;
  if pg_temp.trymsg(format('select public.request_to_join_family(%L, %L)', code2, 'Guesser')) <> 'too_many_attempts' then raise exception 'FAIL: guessing is not limited (correct code after 8 misses)'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.family_join_attempt where user_id = ug; if c <> 8 then raise exception 'FAIL: attempts logged = %', c; end if; n := n + 1;
  select count(*) into c from public.family_join_request where user_id = ug; if c <> 0 then raise exception 'FAIL: guesser got a request'; end if; n := n + 1;
  update public.family_join_attempt set created_at = now() - interval '2 hours' where user_id = ug;
  perform pg_temp.login(ug);
  if public.request_to_join_family('', 'Guesser') is not null then raise exception 'FAIL: empty code worked'; end if; n := n + 1;
  if public.request_to_join_family(code || 'X', 'Guesser') is not null then raise exception 'FAIL: wrong length worked'; end if; n := n + 1;
  if public.request_to_join_family(code, 'Guesser') is not null then raise exception 'FAIL: a rotated (old) code worked'; end if; n := n + 1;

  -------------------------------------------------------------- 5. organizer side: only organizers of THAT family
  perform pg_temp.login(um);
  if pg_temp.try(format('select * from public.family_join_requests(%L)', fa)) <> '42501' then raise exception 'FAIL: plain member read requests'; end if; n := n + 1;
  if pg_temp.try(format('select public.decide_join_request(%L, true)', rid)) <> '42501' then raise exception 'FAIL: plain member approved'; end if; n := n + 1;
  perform pg_temp.login(ub);
  if pg_temp.try(format('select * from public.family_join_requests(%L)', fa)) <> '42501' then raise exception 'FAIL: other family organizer read requests'; end if; n := n + 1;
  if pg_temp.try(format('select public.decide_join_request(%L, true)', rid)) <> '42501' then raise exception 'FAIL: other family organizer approved'; end if; n := n + 1;
  perform pg_temp.login(uo);
  select * into r from public.family_join_requests(fa);
  if r.requester_name <> 'Rita Requester' or r.requester_email <> 'requester@test.invalid' then raise exception 'FAIL: request list content'; end if; n := n + 1;

  -------------------------------------------------------------- 6. approve: atomic, single-use, least surprise
  select public.decide_join_request(rid, true, false, true, false) into mid;
  if mid is null then raise exception 'FAIL: approve returned nothing'; end if; n := n + 1;
  if pg_temp.trymsg(format('select public.decide_join_request(%L, true)', rid)) <> 'request_not_pending' then raise exception 'FAIL: replay approved twice'; end if; n := n + 1;
  if pg_temp.trymsg(format('select public.decide_join_request(%L, false)', rid)) <> 'request_not_pending' then raise exception 'FAIL: declined after approval'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.member where family_id = fa and user_id = ur and role = 'member' and name = 'Rita Requester'
     and can_see_meds = false and can_see_schedule = true and can_see_visits = false and id = mid; if c <> 1 then raise exception 'FAIL: approved member row'; end if; n := n + 1;
  select count(*) into c from public.member where family_id = fa and user_id = ur; if c <> 1 then raise exception 'FAIL: duplicate membership'; end if; n := n + 1;
  if coalesce((select (to_jsonb(m) ->> 'can_upload_documents')::boolean from public.member m where id = mid), false) then raise exception 'FAIL: document upload on by default'; end if; n := n + 1;
  select count(*) into c from public.family_join_request where id = rid and status = 'approved' and member_id = mid and decided_by = uo; if c <> 1 then raise exception 'FAIL: request bookkeeping'; end if; n := n + 1;

  -------------------------------------------------------------- 7. what the new member can and cannot do
  perform pg_temp.login(ur);
  select count(*) into c from public.family where id = fa; if c <> 1 then raise exception 'FAIL: approved member cannot see own family'; end if; n := n + 1;
  select count(*) into c from public.family where id = fb; if c <> 0 then raise exception 'FAIL: approved member sees another family'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set role = %L where id = %L', 'organizer', mid)) not in ('42501', 'OK') then raise exception 'FAIL: odd result'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.member where id = mid and role = 'member'; if c <> 1 then raise exception 'FAIL: the member promoted themselves'; end if; n := n + 1;
  perform pg_temp.login(ur);
  if pg_temp.try(format('select * from public.family_join_requests(%L)', fa)) <> '42501' then raise exception 'FAIL: approved member sees requests'; end if; n := n + 1;
  if pg_temp.try(format('select public.rotate_family_join_code(%L)', fa)) <> '42501' then raise exception 'FAIL: approved member rotated the code'; end if; n := n + 1;
  if pg_temp.try(format('update public.member set user_id = %L where id = %L', um, mid)) <> '42501' and exists (select 1 from public.member where id = mid and user_id = um) then raise exception 'FAIL: user_id guard bypass'; end if; n := n + 1;
  if pg_temp.trymsg(format('select public.request_to_join_family(%L, %L)', code2, 'Rita again')) <> 'already_member' then raise exception 'FAIL: an existing member got a request through'; end if; n := n + 1;

  -------------------------------------------------------------- 8. decline, cooldown, cancel, disable, rotate
  perform pg_temp.login(uo); select public.rotate_family_join_code(fa) into code;
  perform pg_temp.login(us);
  select public.request_to_join_family(code, 'Sam Second') into rid3;
  perform pg_temp.login(uo);
  if public.decide_join_request(rid3, false) is not null then raise exception 'FAIL: decline created a member'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.member where user_id = us; if c <> 0 then raise exception 'FAIL: declined user is a member'; end if; n := n + 1;
  perform pg_temp.login(us);
  if public.request_to_join_family(code, 'Sam Second') is not null then raise exception 'FAIL: immediate re-request after decline'; end if; n := n + 1;
  perform pg_temp.admin(); update public.family_join_request set decided_at = now() - interval '25 hours' where id = rid3;
  perform pg_temp.login(us);
  select public.request_to_join_family(code, 'Sam Second') into rid3;
  if rid3 is null then raise exception 'FAIL: re-request after the cooldown refused'; end if; n := n + 1;
  perform pg_temp.admin(); update public.family_join_attempt set created_at = now() - interval '3 hours' where user_id = us;
  perform pg_temp.login(us); perform public.cancel_join_request(rid3);
  if pg_temp.trymsg(format('select public.cancel_join_request(%L)', rid3)) <> 'request_not_pending' then raise exception 'FAIL: cancel twice'; end if; n := n + 1;
  perform pg_temp.login(uo);
  if pg_temp.trymsg(format('select public.decide_join_request(%L, true)', rid3)) <> 'request_not_pending' then raise exception 'FAIL: approved a canceled request'; end if; n := n + 1;
  perform pg_temp.admin(); delete from public.family_join_request where user_id = us;
  perform pg_temp.login(uo); perform public.disable_family_join_code(fa);
  if (select enabled from public.family_join_code_status(fa)) then raise exception 'FAIL: not disabled'; end if; n := n + 1;
  perform pg_temp.login(us);
  if public.request_to_join_family(code, 'Sam Second') is not null then raise exception 'FAIL: a disabled code worked'; end if; n := n + 1;
  perform pg_temp.login(um);
  if pg_temp.try(format('select public.disable_family_join_code(%L)', fa)) <> '42501' then raise exception 'FAIL: plain member disabled the code'; end if; n := n + 1;

  -------------------------------------------------------------- 9. multi-family, pending cap, a pending request survives rotate
  perform pg_temp.login(ub);
  select public.rotate_family_join_code(fb) into code; select public.rotate_family_join_code(fc) into code2;
  perform pg_temp.login(ur);
  select public.request_to_join_family(code, 'Rita Requester') into rid;
  perform pg_temp.login(ub);
  perform public.rotate_family_join_code(fb);                       -- rotating does not cancel the request already made
  select public.decide_join_request(rid, true) into mid; if mid is null then raise exception 'FAIL: approve after rotate'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.member where user_id = ur; if c <> 2 then raise exception 'FAIL: multi-family membership'; end if; n := n + 1;
  select count(*) into c from public.member where user_id = ur and family_id = fb and can_see_meds and can_see_schedule and can_see_visits; if c <> 1 then raise exception 'FAIL: default viewing flags'; end if; n := n + 1;
  insert into public.family_join_code (family_id, code_hash, created_by) values (fd, public.family_join_code_hash('DDDD-DDDD-DDDD'), ub);
  -- the pending cap: three open requests at most per account
  perform pg_temp.login(us);
  perform public.request_to_join_family(code2, 'Sam Second');                  -- family C
  perform public.request_to_join_family('DDDD-DDDD-DDDD', 'Sam Second');       -- family D
  perform pg_temp.login(uo); select public.rotate_family_join_code(fa) into code;
  perform pg_temp.login(us); perform public.request_to_join_family(code, 'Sam Second');   -- family A (a third open request)
  perform pg_temp.login(ub); select public.rotate_family_join_code(fb) into code;
  perform pg_temp.login(us);
  if pg_temp.trymsg(format('select public.request_to_join_family(%L, %L)', code, 'Sam Second')) <> 'too_many_requests' then raise exception 'FAIL: pending cap'; end if; n := n + 1;
  perform pg_temp.admin();
  select count(*) into c from public.family_join_request where user_id = us and status = 'pending'; if c <> 3 then raise exception 'FAIL: pending count %', c; end if; n := n + 1;

  -------------------------------------------------------------- 10. coexistence with the invitation system
  select count(*) into c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_family_invite', 'accept_family_invite', 'my_pending_family_invites', 'revoke_family_invite');
  if c < 4 then raise exception 'FAIL: invitation functions missing'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end $test$;
rollback;
