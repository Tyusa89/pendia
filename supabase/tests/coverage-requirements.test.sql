-- Phase 4A-1: required coverage tables. Proves the row-level rules, constraints and atomic-replace functions in
-- 20261022000001_coverage_requirements.sql. Synthetic users only. One DO block that ALWAYS ends with an exception, so
-- nothing persists. Pass => 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion.
-- Run it only AFTER the migration has been applied somewhere (a scratch database, or live once approved).

do $test$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); un uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  fa uuid; fb uuid; ma uuid; mm uuid; mn uuid; mb uuid;
  ra uuid; ov uuid; ovb uuid;
  n int := 0; c int; k int;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (um, 'authenticated', 'authenticated', 'm-' || um || '@test.invalid'),
    (un, 'authenticated', 'authenticated', 'n-' || un || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer') returning id into ma;
  insert into member (family_id, user_id, name, role, can_see_schedule) values (fa, um, 'Member A', 'member', true) returning id into mm;
  insert into member (family_id, user_id, name, role, can_see_schedule) values (fa, un, 'NoSched A', 'member', false) returning id into mn;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;

  -------------------------------------------------------------- organizer writes
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 0, '08:00', '12:00') returning id into ra;
  n := n + 1;
  insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 0, '18:00', '22:00'), (fa, 6, '22:00', '06:00'), (fa, 2, '22:00', '00:00');
  n := n + 1; -- several windows per weekday; overnight (end earlier than start) and end at midnight are accepted
  update coverage_requirement set end_time = '13:00' where id = ra; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot edit a window'; end if; n := n + 1;

  -- constraints hold for organizers too
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 1, '08:00', '08:00'); raise exception 'FAIL: start = end accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 1, '08:10', '12:00'); raise exception 'FAIL: non-15-minute start accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 1, '08:00', '12:05'); raise exception 'FAIL: non-15-minute end accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 1, '08:00:30', '12:00'); raise exception 'FAIL: seconds accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 7, '08:00', '12:00'); raise exception 'FAIL: weekday 7 accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 0, '18:00', '22:00'); raise exception 'FAIL: exact duplicate accepted';
  exception when unique_violation then n := n + 1; end;
  begin update coverage_requirement set family_id = fb where id = ra; raise exception 'FAIL: window moved to another family';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; n := n + 1; end;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fb, 0, '08:00', '12:00'); raise exception 'FAIL: organizer A wrote into family B';
  exception when insufficient_privilege then n := n + 1; end;

  -------------------------------------------------------------- overrides (single date) and their windows
  ov := set_coverage_override(fa, date '2026-11-02', '[{"start_time":"09:00","end_time":"12:00"},{"start_time":"14:00","end_time":"16:00"}]'::jsonb);
  select count(*) into k from coverage_override_window where override_id = ov;
  if k <> 2 then raise exception 'FAIL: override should have 2 windows, has %', k; end if; n := n + 1;
  -- replacing the same date reuses the override row and swaps its windows
  if set_coverage_override(fa, date '2026-11-02', '[{"start_time":"10:00","end_time":"11:00"}]'::jsonb) <> ov then raise exception 'FAIL: second save created a second override'; end if;
  select count(*) into k from coverage_override_window where override_id = ov;
  if k <> 1 then raise exception 'FAIL: replace left % windows', k; end if; n := n + 1;
  -- an EMPTY override is allowed and means "nothing required that date"
  perform set_coverage_override(fa, date '2026-11-03', '[]'::jsonb);
  select count(*) into k from coverage_override o where o.family_id = fa and o.day = date '2026-11-03' and not exists (select 1 from coverage_override_window w where w.override_id = o.id);
  if k <> 1 then raise exception 'FAIL: empty override not stored as an override with no windows'; end if; n := n + 1;
  begin insert into coverage_override (family_id, day) values (fa, date '2026-11-02'); raise exception 'FAIL: two overrides for one date';
  exception when unique_violation then n := n + 1; end;
  -- a failed save leaves the previous windows untouched (atomic)
  begin perform set_coverage_override(fa, date '2026-11-02', '[{"start_time":"08:00","end_time":"09:00"},{"start_time":"09:10","end_time":"10:00"}]'::jsonb); raise exception 'FAIL: bad window accepted';
  exception when check_violation then n := n + 1; end;
  select count(*) into k from coverage_override_window where override_id = ov and start_time = '10:00';
  if k <> 1 then raise exception 'FAIL: failed save damaged the existing windows'; end if; n := n + 1;
  begin perform set_coverage_override(fa, date '2026-11-04', '{"start_time":"08:00"}'::jsonb); raise exception 'FAIL: non-array windows accepted';
  exception when invalid_parameter_value then n := n + 1; end;
  -- replace_weekly_coverage swaps a weekday's windows in one step; an empty list clears it
  if replace_weekly_coverage(fa, 1::smallint, '[{"start_time":"07:00","end_time":"15:00"}]'::jsonb) <> 1 then raise exception 'FAIL: weekly replace count'; end if;
  perform replace_weekly_coverage(fa, 1::smallint, '[{"start_time":"09:00","end_time":"17:00"}]'::jsonb);
  select count(*) into k from coverage_requirement where family_id = fa and weekday = 1;
  if k <> 1 then raise exception 'FAIL: weekly replace should leave 1 window, has %', k; end if; n := n + 1;
  begin perform replace_weekly_coverage(fa, 1::smallint, '[{"start_time":"09:15","end_time":"10:00"},{"start_time":"10:07","end_time":"11:00"}]'::jsonb); raise exception 'FAIL: bad weekly window accepted';
  exception when check_violation then n := n + 1; end;
  select count(*) into k from coverage_requirement where family_id = fa and weekday = 1 and start_time = '09:00';
  if k <> 1 then raise exception 'FAIL: failed weekly replace lost the old window'; end if; n := n + 1;
  perform replace_weekly_coverage(fa, 1::smallint, '[]'::jsonb);
  select count(*) into k from coverage_requirement where family_id = fa and weekday = 1;
  if k <> 0 then raise exception 'FAIL: empty replace did not clear the weekday'; end if; n := n + 1;

  -- a window cannot hang off another family's override
  reset role;
  insert into coverage_override (family_id, day) values (fb, date '2026-11-02') returning id into ovb;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin insert into coverage_override_window (override_id, family_id, start_time, end_time) values (ovb, fa, '08:00', '09:00'); raise exception 'FAIL: window attached to another family''s override';
  exception when foreign_key_violation or insufficient_privilege then n := n + 1; end;
  begin insert into coverage_override_window (override_id, family_id, start_time, end_time) values (ov, fa, '10:00', '11:00'); raise exception 'FAIL: duplicate window accepted';
  exception when unique_violation then n := n + 1; end;
  -- deleting an override removes its windows; the weekly pattern is untouched
  delete from coverage_override where id = ov; get diagnostics c = row_count;
  select count(*) into k from coverage_override_window where override_id = ov;
  if c <> 1 or k <> 0 then raise exception 'FAIL: override delete did not cascade (% rows, % windows left)', c, k; end if; n := n + 1;
  select count(*) into k from coverage_requirement where family_id = fa;
  if k < 4 then raise exception 'FAIL: deleting an override touched the weekly pattern'; end if; n := n + 1;

  -------------------------------------------------------------- a member who can see the schedule: read-only
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  select count(*) into k from coverage_requirement; if k < 4 then raise exception 'FAIL: schedule member cannot read requirements'; end if; n := n + 1;
  select count(*) into k from coverage_override; if k < 1 then raise exception 'FAIL: schedule member cannot read overrides'; end if; n := n + 1;
  select count(*) into k from coverage_requirement where family_id = fb; if k <> 0 then raise exception 'FAIL: member read family B'; end if; n := n + 1;
  begin insert into coverage_requirement (family_id, weekday, start_time, end_time) values (fa, 3, '08:00', '12:00'); raise exception 'FAIL: member inserted a window';
  exception when insufficient_privilege then n := n + 1; end;
  update coverage_requirement set end_time = '23:00' where id = ra; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member updated a window'; end if; n := n + 1;
  delete from coverage_requirement where id = ra; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member deleted a window'; end if; n := n + 1;
  begin perform replace_weekly_coverage(fa, 4::smallint, '[{"start_time":"08:00","end_time":"12:00"}]'::jsonb); raise exception 'FAIL: member replaced weekly coverage';
  exception when insufficient_privilege then n := n + 1; end;
  begin perform set_coverage_override(fa, date '2026-12-01', '[]'::jsonb); raise exception 'FAIL: member set an override';
  exception when insufficient_privilege then n := n + 1; end;
  select count(*) into k from coverage_requirement where weekday = 4 and family_id = fa; if k <> 0 then raise exception 'FAIL: refused member write persisted'; end if; n := n + 1;

  -------------------------------------------------------------- a member without schedule visibility sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true);
  select count(*) into k from coverage_requirement; if k <> 0 then raise exception 'FAIL: member without schedule access read requirements'; end if; n := n + 1;
  select count(*) into k from coverage_override; if k <> 0 then raise exception 'FAIL: member without schedule access read overrides'; end if; n := n + 1;

  -------------------------------------------------------------- another family's organizer: no access in either direction
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into k from coverage_requirement where family_id = fa; if k <> 0 then raise exception 'FAIL: organizer B read family A requirements'; end if; n := n + 1;
  update coverage_requirement set end_time = '23:00' where id = ra; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer B updated a family A window'; end if; n := n + 1;
  delete from coverage_requirement where family_id = fa; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: organizer B deleted family A windows'; end if; n := n + 1;
  begin perform set_coverage_override(fa, date '2026-12-02', '[]'::jsonb); raise exception 'FAIL: organizer B set a family A override';
  exception when insufficient_privilege then n := n + 1; end;

  -------------------------------------------------------------- anonymous: no privileges at all
  reset role; set local role anon;
  begin perform count(*) from coverage_requirement; raise exception 'FAIL: anon can read requirements';
  exception when insufficient_privilege then n := n + 1; end;
  begin perform count(*) from coverage_override_window; raise exception 'FAIL: anon can read override windows';
  exception when insufficient_privilege then n := n + 1; end;

  -------------------------------------------------------------- nothing persists; family delete cascades
  reset role;
  delete from family where id = fa; get diagnostics c = row_count;
  select count(*) into k from coverage_requirement where family_id = fa;
  if c <> 1 or k <> 0 then raise exception 'FAIL: deleting a family left coverage rows'; end if; n := n + 1;
  select count(*) into k from coverage_override where family_id = fa;
  if k <> 0 then raise exception 'FAIL: deleting a family left overrides'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end
$test$;
