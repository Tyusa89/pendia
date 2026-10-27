-- Family-delete guard tests: a family with dose history cannot be deleted; families without it delete exactly as before.
-- Synthetic users only. One DO block that ALWAYS ends with an exception, so nothing persists (the helper is dropped after).
-- Pass => the final error message is 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion.
-- Runs against a SCRATCH database built by supabase/tests/scratch/run-family-guard.sh.

drop function if exists public.zz_expect_err(text, text);
create function public.zz_expect_err(_sql text, _msg text) returns void language plpgsql as $f$
begin
  execute _sql;
  raise exception 'FAIL: no error (expected "%") for: %', _msg, left(_sql, 140);
exception when others then
  if sqlerrm = _msg or (_msg like '%\%' and sqlerrm like _msg) then return; end if;
  raise exception 'FAIL: expected "%" but got "%" for: %', _msg, sqlerrm, left(_sql, 140);
end $f$;

do $test$
declare
  uo uuid := gen_random_uuid();   -- organizer of family A (will have dose history)
  um uuid := gen_random_uuid();   -- plain member of family A
  ub uuid := gen_random_uuid();   -- organizer of family B (schedules but NO reports)
  uc uuid := gen_random_uuid();   -- organizer of family C (nothing dose-related at all)
  ux uuid := gen_random_uuid();   -- organizer of family X (history, used for the administrator path)
  fa uuid; fb uuid; fc uuid; fx uuid; medA uuid; medB uuid; medX uuid; sA uuid; sB uuid; sX uuid;
  lt date; n int := 0; c int; r record; guard_on boolean;
begin
  insert into auth.users (id, aud, role, email) select u, 'authenticated', 'authenticated', u || '@test.invalid' from unnest(array[uo, um, ub, uc, ux]) u;
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into family (name, created_by) values ('Fam C', uc) returning id into fc;
  insert into family (name, created_by) values ('Fam X', ux) returning id into fx;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Olive', 'organizer'), (fb, ub, 'Bea', 'organizer'), (fc, uc, 'Cy', 'organizer'), (fx, ux, 'Xia', 'organizer');
  insert into member (family_id, user_id, name, role, can_see_meds) values (fa, um, 'Carlos', 'member', true);
  insert into medication (family_id, name, dose) values (fa, 'MedA', '1') returning id into medA;
  insert into medication (family_id, name, dose) values (fb, 'MedB', '1') returning id into medB;
  insert into medication (family_id, name, dose) values (fx, 'MedX', '1') returning id into medX;
  insert into medication (family_id, name, dose) values (fc, 'MedC', '1');
  lt := (now() at time zone 'America/New_York')::date;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (fa, medA, '00:01', array[1,2,3,4,5,6,7]::smallint[], lt - 5) returning id into sA;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (fb, medB, '00:01', array[1,2,3,4,5,6,7]::smallint[], lt - 5) returning id into sB;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (fx, medX, '00:01', array[1,2,3,4,5,6,7]::smallint[], lt - 5) returning id into sX;

  -- real reports, through the real function, as real signed-in users
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform report_dose(sA, lt - 1, 'given', null, gen_random_uuid());
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform report_dose(sX, lt - 1, 'not_given', null, gen_random_uuid(), 'refused');
  reset role;
  select count(*) into c from dose_administration where family_id in (fa, fx);
  if c <> 2 then raise exception 'FAIL: fixture: expected 2 reports, found %', c; end if; n := n + 1;

  ---------------------------------------------------------------- 1. the guard itself
  select exists (select 1 from pg_trigger t where t.tgrelid = 'public.family'::regclass and t.tgname = 'family_delete_guard' and t.tgenabled = 'O' and not t.tgisinternal) into guard_on;
  if not guard_on then raise exception 'FAIL: family_delete_guard trigger is missing or disabled'; end if; n := n + 1;
  select * into r from pg_proc where proname = 'family_delete_guard' and pronamespace = 'public'::regnamespace;
  if not r.prosecdef or r.proconfig is distinct from array['search_path=public, pg_temp'] then raise exception 'FAIL: guard function must be SECURITY DEFINER with a fixed search_path (%)', r.proconfig; end if; n := n + 1;
  if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') then raise exception 'FAIL: guard function is executable by API roles'; end if; n := n + 1;

  ---------------------------------------------------------------- 2. API deletion attempts on a family WITH history are refused, and nothing is lost
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$delete from family where id = %L$q$, fa), 'family_has_dose_history'); n := n + 1;   -- the organizer, directly
  perform public.zz_expect_err($q$delete from family$q$, 'family_has_dose_history'); n := n + 1;                              -- a delete with no filter: every family the user may delete, one of which has history
  reset role;
  select count(*) into c from family where id = fa; if c <> 1 then raise exception 'FAIL: family A was deleted'; end if; n := n + 1;
  select count(*) into c from dose_administration where family_id = fa; if c <> 1 then raise exception 'FAIL: dose history changed (%)', c; end if; n := n + 1;
  select count(*) into c from member where family_id = fa; if c <> 2 then raise exception 'FAIL: members changed (%)', c; end if; n := n + 1;
  select count(*) into c from medication_schedule where family_id = fa; if c <> 1 then raise exception 'FAIL: schedules changed'; end if; n := n + 1;
  -- the same code reaches the owner/superuser: the guard is not role based
  perform public.zz_expect_err(format($q$delete from family where id = %L$q$, fx), 'family_has_dose_history'); n := n + 1;
  -- SQLSTATE is a foreign-key style violation so callers can tell it from a permission problem
  begin delete from family where id = fa; exception when others then
    if sqlstate <> '23503' then raise exception 'FAIL: expected SQLSTATE 23503, got %', sqlstate; end if; n := n + 1; end;

  ---------------------------------------------------------------- 3. other people still cannot delete it either (row-level security, as before)
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from family where id = fa; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: a plain member deleted a family'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from family where id = fa; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: another family''s organizer deleted a family'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 4. families WITHOUT history delete exactly as before
  -- B has medication and a schedule but no report; C has only a medication
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from family where id = fb; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer could not delete a family without dose history (%)', c; end if; n := n + 1;
  reset role;
  select count(*) into c from member where family_id = fb; if c <> 0 then raise exception 'FAIL: cascade left members'; end if; n := n + 1;
  select count(*) into c from medication where family_id = fb; if c <> 0 then raise exception 'FAIL: cascade left medications'; end if; n := n + 1;
  select count(*) into c from medication_schedule where family_id = fb; if c <> 0 then raise exception 'FAIL: cascade left schedules'; end if; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from family where id = fc; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer could not delete a family with no dose data'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 5. related deletes are unaffected
  -- removing a member of a family with history is still allowed (history keeps the name snapshot)
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from member where family_id = fa and user_id = um; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: could not remove a member'; end if; n := n + 1;
  reset role;
  select count(*) into c from dose_administration where family_id = fa and reporter_name = 'Carlos';
  if c <> 1 then raise exception 'FAIL: removing the member changed history'; end if; n := n + 1;
  -- a medication with history is still protected by the existing foreign key
  perform public.zz_expect_err(format($q$delete from medication where id = %L$q$, medA), 'update or delete on table "medication_schedule" violates foreign key constraint "dose_administration_schedule_id_fkey" on table "dose_administration"'); n := n + 1;
  -- history stays append-only
  perform public.zz_expect_err(format($q$delete from dose_administration where family_id = %L$q$, fa), 'dose reports are append-only: DELETE is not allowed'); n := n + 1;
  -- TRUNCATE ... CASCADE from the parent cannot wipe history either
  perform public.zz_expect_err($q$truncate family cascade$q$, 'dose reports are append-only: TRUNCATE is not allowed'); n := n + 1;
  select count(*) into c from dose_administration where family_id in (fa, fx); if c <> 2 then raise exception 'FAIL: history lost (%)', c; end if; n := n + 1;

  ---------------------------------------------------------------- 6. the deliberate administrator path still works, and is explicit
  -- (owner/superuser only): switch the guard off, delete, switch it on again. The append-only trigger then lets the cascade through.
  alter table public.family disable trigger family_delete_guard;
  delete from family where id = fx;
  alter table public.family enable trigger family_delete_guard;
  select count(*) into c from dose_administration where family_id = fx; if c <> 0 then raise exception 'FAIL: administrator erasure left history'; end if; n := n + 1;
  select t.tgenabled = 'O' into guard_on from pg_trigger t where t.tgrelid = 'public.family'::regclass and t.tgname = 'family_delete_guard';
  if not guard_on then raise exception 'FAIL: guard not re-enabled'; end if; n := n + 1;
  select count(*) into c from dose_administration where family_id = fa; if c <> 1 then raise exception 'FAIL: erasing family X touched family A'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end
$test$;

drop function if exists public.zz_expect_err(text, text);
