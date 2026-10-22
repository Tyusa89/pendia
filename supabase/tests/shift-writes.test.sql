-- Coverage C1: who may create/edit/cancel shifts, and the integrity rules on `shift`. No schema change is involved;
-- this proves the existing policies and constraints. Synthetic users only. One DO block that ALWAYS ends with an
-- exception, so nothing persists. Pass => 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion.

do $test$
declare
  ua uuid := gen_random_uuid(); uj uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  fa uuid; fb uuid; ma uuid; mj uuid; mb uuid;
  s1 uuid; s2 uuid; sb uuid; sn uuid;
  n int := 0; c int; r record;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (uj, 'authenticated', 'authenticated', 'j-' || uj || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer') returning id into ma;
  insert into member (family_id, user_id, name, role, can_see_schedule) values (fa, uj, 'Member A', 'member', true) returning id into mj;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  insert into shift (family_id, start, "end", assigned_member_id, status)
    values (fb, timestamptz '2026-11-02 12:00+00', timestamptz '2026-11-02 18:00+00', mb, 'claimed') returning id into sb;

  -------------------------------------------------------------- organizer can create / edit / reassign / cancel
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into shift (family_id, start, "end") values (fa, timestamptz '2026-11-02 12:00+00', timestamptz '2026-11-02 18:00+00') returning id into s1;
  select * into r from shift where id = s1;
  if r.status <> 'open' or r.assigned_member_id is not null then raise exception 'FAIL: open shift defaults wrong (% %)', r.status, r.assigned_member_id; end if; n := n + 1;
  insert into shift (family_id, start, "end", assigned_member_id, status) values (fa, timestamptz '2026-11-02 20:00+00', timestamptz '2026-11-03 08:00+00', mj, 'claimed') returning id into sn;
  n := n + 1; -- overnight (crosses midnight) is accepted
  update shift set start = timestamptz '2026-11-02 13:00+00', "end" = timestamptz '2026-11-02 19:00+00' where id = s1; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot edit times'; end if; n := n + 1;
  update shift set assigned_member_id = mj, status = 'claimed' where id = s1; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot assign/reassign'; end if; n := n + 1;
  update shift set assigned_member_id = null, status = 'open' where id = s1; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot unassign'; end if; n := n + 1;

  -- overlapping shifts for the same member are NOT blocked by the database (the app flags them)
  insert into shift (family_id, start, "end", assigned_member_id, status) values (fa, timestamptz '2026-11-02 21:00+00', timestamptz '2026-11-02 23:00+00', mj, 'claimed');
  n := n + 1;

  -- integrity rules hold for organizers too
  begin insert into shift (family_id, start, "end") values (fa, now(), now()); raise exception 'FAIL: end = start accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into shift (family_id, start, "end") values (fa, now(), now() - interval '1 hour'); raise exception 'FAIL: end before start accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into shift (family_id, start, "end", assigned_member_id) values (fa, now(), now() + interval '1 hour', mb); raise exception 'FAIL: assignee from another family accepted';
  exception when check_violation then n := n + 1; end;
  begin update shift set assigned_member_id = mb where id = s1; raise exception 'FAIL: reassigned to another family''s member';
  exception when check_violation then n := n + 1; end;
  begin insert into shift (family_id, start, "end", status) values (fa, now(), now() + interval '1 hour', 'canceled'); raise exception 'FAIL: unknown status accepted';
  exception when check_violation then n := n + 1; end;
  begin update shift set family_id = fb where id = s1; raise exception 'FAIL: shift moved to another family';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; n := n + 1; end;

  -- organizer cannot write into, change, or delete another family's shifts
  begin insert into shift (family_id, start, "end") values (fb, now(), now() + interval '1 hour'); raise exception 'FAIL: organizer A created a shift in family B';
  exception when insufficient_privilege then n := n + 1; end;
  update shift set assigned_member_id = null where id = sb; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer A edited family B shift'; end if; n := n + 1;
  delete from shift where id = sb; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer A deleted family B shift'; end if; n := n + 1;
  select count(*) into c from shift where family_id = fb;
  if c <> 0 then raise exception 'FAIL: organizer A can read family B shifts'; end if; n := n + 1;

  -- cancel = delete
  delete from shift where id = s1; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot cancel a shift'; end if; n := n + 1;
  select count(*) into c from shift where id = s1;
  if c <> 0 then raise exception 'FAIL: canceled shift still present'; end if; n := n + 1;

  -------------------------------------------------------------- a family member (non-organizer): can read, cannot write
  reset role;
  insert into shift (family_id, start, "end") values (fa, timestamptz '2026-11-04 12:00+00', timestamptz '2026-11-04 18:00+00') returning id into s2;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from shift where family_id = fa;
  if c < 2 then raise exception 'FAIL: member with schedule access cannot read shifts (saw %)', c; end if; n := n + 1;
  begin insert into shift (family_id, start, "end") values (fa, now(), now() + interval '1 hour'); raise exception 'FAIL: member created a shift';
  exception when insufficient_privilege then n := n + 1; end;
  update shift set start = start + interval '1 hour', "end" = "end" + interval '1 hour' where id = s2; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member edited a shift'; end if; n := n + 1;
  update shift set assigned_member_id = mj, status = 'claimed' where id = s2; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member updated a shift directly (claiming goes through its own path)'; end if; n := n + 1;
  delete from shift where id = s2; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member canceled a shift'; end if; n := n + 1;

  -------------------------------------------------------------- another family's organizer
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from shift where family_id = fa;
  if c <> 0 then raise exception 'FAIL: organizer B can read family A shifts'; end if; n := n + 1;
  begin insert into shift (family_id, start, "end") values (fa, now(), now() + interval '1 hour'); raise exception 'FAIL: organizer B created a shift in family A';
  exception when insufficient_privilege then n := n + 1; end;
  update shift set assigned_member_id = mb where id = s2; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer B edited a family A shift'; end if; n := n + 1;
  delete from shift where id = s2; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer B deleted a family A shift'; end if; n := n + 1;

  -------------------------------------------------------------- anon
  reset role;
  set local role anon;
  begin select count(*) into c from shift; if c <> 0 then raise exception 'FAIL: anon reads shifts'; end if; n := n + 1;
  exception when insufficient_privilege then n := n + 1; end;
  reset role;

  select count(*) into c from shift where id = s2;
  if c <> 1 then raise exception 'FAIL: s2 was removed by someone who should not be able to'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end
$test$;
