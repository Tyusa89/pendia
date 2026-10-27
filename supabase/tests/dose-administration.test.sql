-- Feature C security + behaviour tests: medication_schedule, dose_administration, report_dose, flag_dose_disagreement, dose_occurrences.
-- Synthetic users only. One DO block that ALWAYS ends with an exception, so nothing persists (the helper function is dropped after).
-- Pass => the final error message is 'PASS: N assertions'. Fail => 'FAIL: ...' naming the assertion.
-- Runs against a SCRATCH database built by supabase/tests/scratch/run-dose.sh, with and without the other pending migrations.

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
  uo uuid := gen_random_uuid();   -- organizer A
  um uuid := gen_random_uuid();   -- member A with meds visibility ("Carlos")
  un uuid := gen_random_uuid();   -- member A WITHOUT meds visibility ("Jenny")
  ur uuid := gen_random_uuid();   -- member A with meds visibility, removed later ("Rita")
  ub uuid := gen_random_uuid();   -- organizer B (another family)
  fa uuid; fb uuid; mo uuid; mm uuid; mn uuid; mr uuid; mb uuid;
  medA uuid; medA2 uuid; medB uuid; sA uuid; sA2 uuid; sB uuid; sWed uuid; sChi uuid; medChi uuid; sFlag uuid; sRet uuid; sNC uuid;
  lt date; d1 date; d2 date; dold date; dfut date;
  n int := 0; c int; r record; r2 record; hid uuid; head1 uuid; head2 uuid; q1 uuid; snapshot text; ok boolean;
  fchi uuid; uchi uuid; mchi uuid;
begin
  ---------------------------------------------------------------- fixtures (superuser)
  insert into auth.users (id, aud, role, email) values
    (uo, 'authenticated', 'authenticated', 'o-' || uo || '@test.invalid'),
    (um, 'authenticated', 'authenticated', 'm-' || um || '@test.invalid'),
    (un, 'authenticated', 'authenticated', 'n-' || un || '@test.invalid'),
    (ur, 'authenticated', 'authenticated', 'r-' || ur || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Org Olive', 'organizer') returning id into mo;
  insert into member (family_id, user_id, name, role, can_see_meds) values (fa, um, 'Carlos', 'member', true) returning id into mm;
  insert into member (family_id, user_id, name, role, can_see_meds) values (fa, un, 'Jenny', 'member', false) returning id into mn;
  insert into member (family_id, user_id, name, role, can_see_meds) values (fa, ur, 'Rita', 'member', true) returning id into mr;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org Bea', 'organizer') returning id into mb;
  insert into medication (family_id, name, dose, schedule) values (fa, 'Lisinopril', '20 mg', 'every morning') returning id into medA;
  insert into medication (family_id, name, dose) values (fa, 'Metformin', '500 mg') returning id into medA2;
  insert into medication (family_id, name, dose) values (fb, 'MedB', '1 mg') returning id into medB;

  lt := (now() at time zone 'America/New_York')::date;     -- the family's local "today" (default zone America/New_York)
  d1 := lt - 1; d2 := lt - 2; dold := lt - 6; dfut := lt + 3;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA, '08:00', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sA;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA2, '20:00', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sA2;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fb, medB, '08:00', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sB;
  -- extra early-morning schedules so each scenario has its own occurrence inside the 48-hour window on d1
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA2, '07:00', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sFlag;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA2, '07:15', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sRet;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA2, '07:30', array[1,2,3,4,5,6,7]::smallint[], lt - 30) returning id into sNC;

  ---------------------------------------------------------------- 1. structure, grants, search paths
  if not (select relrowsecurity from pg_class where oid = 'public.dose_administration'::regclass) then raise exception 'FAIL: RLS off on dose_administration'; end if; n := n + 1;
  if not (select relrowsecurity from pg_class where oid = 'public.medication_schedule'::regclass) then raise exception 'FAIL: RLS off on medication_schedule'; end if; n := n + 1;
  for r in select unnest(array['public.medication_schedule', 'public.dose_administration']) as t loop
    if has_table_privilege('anon', r.t, 'select') or has_table_privilege('anon', r.t, 'insert')
       or has_table_privilege('anon', r.t, 'update') or has_table_privilege('anon', r.t, 'delete') then
      raise exception 'FAIL: anon has privileges on %', r.t; end if; n := n + 1;
  end loop;
  if has_table_privilege('authenticated', 'public.dose_administration', 'insert') or has_table_privilege('authenticated', 'public.dose_administration', 'update')
     or has_table_privilege('authenticated', 'public.dose_administration', 'delete') or has_table_privilege('authenticated', 'public.dose_administration', 'truncate') then
    raise exception 'FAIL: authenticated can write dose_administration directly'; end if; n := n + 1;
  if not has_table_privilege('authenticated', 'public.dose_administration', 'select') then raise exception 'FAIL: authenticated cannot read'; end if; n := n + 1;
  for r in select p.oid::regprocedure::text as f, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('report_dose', 'flag_dose_disagreement', 'medication_schedule_guard', 'dose_administration_guard') loop
    if r.proconfig is null or not exists (select 1 from unnest(r.proconfig) x where x like 'search_path=%') then
      raise exception 'FAIL: % has no fixed search_path', r.f; end if; n := n + 1;
  end loop;
  for r in select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('report_dose', 'flag_dose_disagreement', 'dose_occurrences', 'dose_scheduled_at', 'valid_iso_days',
                             'medication_schedule_guard', 'dose_administration_guard', 'dose_administration_append_only') loop
    if has_function_privilege('anon', r.f, 'execute') then raise exception 'FAIL: anon can execute %', r.f; end if; n := n + 1;
  end loop;
  for r in select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('report_dose', 'flag_dose_disagreement', 'dose_occurrences') loop
    if not has_function_privilege('authenticated', r.f, 'execute') then raise exception 'FAIL: authenticated cannot execute %', r.f; end if; n := n + 1;
  end loop;
  -- the migration added policies only on its own two tables
  select count(*) into c from pg_policies where schemaname = 'public' and tablename = 'dose_administration';
  if c <> 1 then raise exception 'FAIL: dose_administration should have exactly one (read) policy, has %', c; end if; n := n + 1;
  select count(*) into c from pg_policies where schemaname = 'public' and tablename = 'dose_administration' and cmd <> 'SELECT';
  if c <> 0 then raise exception 'FAIL: dose_administration has a write policy'; end if; n := n + 1;

  ---------------------------------------------------------------- 2. schedules: who may write, integrity
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on, created_by)
    values (fa, medA, '13:30', array[1,3,5]::smallint[], lt - 30, gen_random_uuid()) returning id into sWed;
  select * into r from medication_schedule where id = sWed;
  if r.created_by is distinct from mo then raise exception 'FAIL: created_by must be set by the server (got %)', r.created_by; end if; n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '13:30', array[3,5]::smallint[], %L)$q$, fa, medA, lt - 30), 'dose_duplicate_schedule'); n := n + 1;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, medA, '13:30', array[2,4]::smallint[], lt - 30);   -- same time, disjoint weekdays: allowed
  n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '09:00', array[]::smallint[], %L)$q$, fa, medA, lt), 'new row for relation "medication_schedule" violates check constraint "medication_schedule_days_valid"'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '09:00', array[8]::smallint[], %L)$q$, fa, medA, lt), 'new row for relation "medication_schedule" violates check constraint "medication_schedule_days_valid"'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '09:00', array[1,1]::smallint[], %L)$q$, fa, medA, lt), 'new row for relation "medication_schedule" violates check constraint "medication_schedule_days_valid"'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on, ends_on) values (%L, %L, '09:00', array[1]::smallint[], %L, %L)$q$, fa, medA, lt, lt - 1), 'new row for relation "medication_schedule" violates check constraint "medication_schedule_dates_valid"'); n := n + 1;
  -- a medication of ANOTHER family cannot be scheduled into this one
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '09:00', array[1]::smallint[], %L)$q$, fa, medB, lt), 'cross-family reference: medication_schedule.medication_id -> medication'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '09:00', array[1]::smallint[], %L)$q$, fb, medB, lt), 'new row violates row-level security policy for table "medication_schedule"'); n := n + 1;
  reset role;

  -- a member (even with meds visibility), a member without visibility, and another family's organizer cannot create or change schedules
  foreach hid in array array[um, un, ub] loop
    perform set_config('request.jwt.claims', json_build_object('sub', hid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.zz_expect_err(format($q$insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on) values (%L, %L, '10:00', array[1]::smallint[], %L)$q$, fa, medA, lt), 'new row violates row-level security policy for table "medication_schedule"'); n := n + 1;
    update medication_schedule set local_time = '23:00' where id = sA; get diagnostics c = row_count;
    if c <> 0 then raise exception 'FAIL: non-organizer updated a schedule'; end if; n := n + 1;
    delete from medication_schedule where id = sA; get diagnostics c = row_count;
    if c <> 0 then raise exception 'FAIL: non-organizer deleted a schedule'; end if; n := n + 1;
    reset role;
  end loop;

  -- read visibility: Carlos (meds) yes, Jenny (no meds visibility) no, Bea (other family) sees none of A's
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from medication_schedule where family_id = fa;
  if c < 3 then raise exception 'FAIL: a member with meds visibility cannot read schedules (%)', c; end if; n := n + 1;
  select count(*) into c from medication_schedule where family_id = fb;
  if c <> 0 then raise exception 'FAIL: Carlos reads B schedules'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from medication_schedule;
  if c <> 0 then raise exception 'FAIL: a member without meds visibility reads schedules'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from medication_schedule where family_id = fa;
  if c <> 0 then raise exception 'FAIL: Bea reads A schedules'; end if; n := n + 1;
  reset role;
  delete from medication_schedule where medication_id = medA and local_time = '13:30';   -- remove the extra schedules used above (superuser)

  ---------------------------------------------------------------- 3. occurrences are computed; Not Confirmed is a positive state
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from dose_occurrences(fa, d1, d1);
  if c <> 5 then raise exception 'FAIL: expected 5 occurrences on d1 (one per schedule), got %', c; end if; n := n + 1;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sA;
  if r.status <> 'not_confirmed' or r.head_id is not null or r.reported_by_name is not null or r.history_count <> 0 then
    raise exception 'FAIL: an unreported dose must be not_confirmed with no reporter (got % %)', r.status, r.reported_by_name; end if; n := n + 1;
  if r.medication_name <> 'Lisinopril' or r.dose_text <> '20 mg' or r.tz <> 'America/New_York' or r.time_state <> 'normal' then
    raise exception 'FAIL: occurrence details wrong'; end if; n := n + 1;
  select count(*) into c from dose_occurrences(fa, d1 - 3, d1) where schedule_id = sA;
  if c <> 4 then raise exception 'FAIL: four days should give four occurrences, got %', c; end if; n := n + 1;
  perform public.zz_expect_err(format($q$select * from dose_occurrences(%L, %L, %L)$q$, fa, d1 - 30, d1), 'dose_window_too_large'); n := n + 1;
  perform public.zz_expect_err(format($q$select * from dose_occurrences(%L, %L, %L)$q$, fa, d1, d1 - 1), 'dose_bad_request'); n := n + 1;
  select count(*) into c from dose_occurrences(fb, d1, d1);
  if c <> 0 then raise exception 'FAIL: Carlos sees occurrences of family B'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from dose_occurrences(fa, d1, d1);
  if c <> 0 then raise exception 'FAIL: a member without meds visibility sees occurrences'; end if; n := n + 1;
  reset role;
  -- a paused medication shows no unreported occurrences
  update medication set status = 'paused' where id = medA2;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from dose_occurrences(fa, d1, d1) where schedule_id = sA2;
  if c <> 0 then raise exception 'FAIL: a paused medication still lists unreported occurrences'; end if; n := n + 1;
  reset role;
  update medication set status = 'active' where id = medA2;

  ---------------------------------------------------------------- 4. reporting: allowed, refused, server-made identity and time
  -- direct writes by a signed-in user are impossible
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$insert into dose_administration (family_id, schedule_id, local_date, status, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id) values (%L, %L, %L, 'given', now(), 'UTC', 'x', %L, 'Carlos', gen_random_uuid())$q$, fa, sA, d1, mm), 'permission denied for table dose_administration'); n := n + 1;
  perform public.zz_expect_err(format($q$update dose_administration set status = 'given' where family_id = %L$q$, fa), 'permission denied for table dose_administration'); n := n + 1;
  perform public.zz_expect_err(format($q$delete from dose_administration where family_id = %L$q$, fa), 'permission denied for table dose_administration'); n := n + 1;
  reset role;

  -- Carlos reports Given (not-confirmed -> given)
  q1 := gen_random_uuid();
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sA, d1, 'given', null, q1);
  if r.status <> 'given' or r.reported_by <> mm or r.reporter_name <> 'Carlos' or r.supersedes is not null or r.entry_kind <> 'report' then
    raise exception 'FAIL: first report wrong (% % %)', r.status, r.reporter_name, r.supersedes; end if; n := n + 1;
  if r.reported_at < now() - interval '1 minute' or r.reported_at > now() + interval '1 minute' then raise exception 'FAIL: reported_at is not server time'; end if; n := n + 1;
  if r.scheduled_at <> (d1 + time '08:00') at time zone 'America/New_York' or r.tz <> 'America/New_York' or r.medication_name <> 'Lisinopril' or r.dose_text <> '20 mg' then
    raise exception 'FAIL: scheduled_at / snapshots wrong (%)', r.scheduled_at; end if; n := n + 1;
  head1 := r.id;
  select * into r2 from dose_occurrences(fa, d1, d1) where schedule_id = sA;
  if r2.status <> 'given' or r2.reported_by_name <> 'Carlos' or r2.head_id <> head1 or r2.history_count <> 1 or r2.reports_differ then
    raise exception 'FAIL: occurrence does not show the report'; end if; n := n + 1;
  -- idempotent: the same request again returns the stored report and adds nothing
  select * into r2 from report_dose(sA, d1, 'given', null, q1);
  if r2.id <> head1 then raise exception 'FAIL: replay returned a different row'; end if; n := n + 1;
  select count(*) into c from dose_administration where schedule_id = sA and local_date = d1;
  if c <> 1 then raise exception 'FAIL: replay created a second row (%)', c; end if; n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', null, %L)$q$, sA, d1, q1), 'dose_idempotency_mismatch'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, %L)$q$, sA2, d1, q1), 'dose_idempotency_mismatch'); n := n + 1;
  -- stale second report: another caregiver also saw "no report yet" (expected head = none) -> conflict, status unchanged
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', null, gen_random_uuid())$q$, sA, d1), 'dose_conflict'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', null, gen_random_uuid())$q$, sA, d1), 'dose_conflict'); n := n + 1;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sA;
  if r.status <> 'given' or r.reported_by_name <> 'Carlos' then raise exception 'FAIL: a conflicting report silently changed the status'; end if; n := n + 1;
  reset role;

  -- refusals
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA, dfut), 'dose_future_not_allowed'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA, lt - 40), 'dose_no_such_occurrence'); n := n + 1;   -- before starts_on
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sB, d1), 'dose_not_found'); n := n + 1;            -- another family's schedule
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, gen_random_uuid(), d1), 'dose_not_found'); n := n + 1; -- no such schedule: same answer
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'taken', null, gen_random_uuid())$q$, sA2, d1), 'dose_bad_request'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, null)$q$, sA2, d1), 'dose_bad_request'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_confirmed', null, gen_random_uuid())$q$, sA2, d1), 'dose_nothing_to_retract'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid(), 'refused')$q$, sA2, d1), 'dose_bad_request'); n := n + 1;   -- a reason only goes with not_given
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', null, gen_random_uuid(), 'because I said so')$q$, sA2, d1), 'dose_bad_request'); n := n + 1; -- predefined reasons only
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, dold), 'dose_window_closed'); n := n + 1;  -- 48 h for members
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true);   -- no meds visibility
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d1), 'dose_not_found'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);   -- another family's organizer
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d1), 'dose_not_found'); n := n + 1;
  select * into r from report_dose(sB, d1, 'given', null, gen_random_uuid());   -- her own family works
  if r.reporter_name <> 'Org Bea' or r.family_id <> fb then raise exception 'FAIL: Bea cannot report in her own family'; end if; n := n + 1;
  reset role;
  set local role anon;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d1), 'permission denied for function report_dose'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d1), 'dose_not_signed_in'); n := n + 1;
  reset role;

  -- Not Given with a predefined reason (Rita, evening dose)
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sA2, d1, 'not_given', null, gen_random_uuid(), 'refused');
  if r.status <> 'not_given' or r.not_given_reason <> 'refused' or r.reporter_name <> 'Rita' then raise exception 'FAIL: not_given report wrong'; end if; n := n + 1;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sA2;
  if r.status <> 'not_given' or r.not_given_reason <> 'refused' then raise exception 'FAIL: occurrence misses the reason'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 5. corrections keep history; who may correct
  -- Jenny's/Rita's stale-looking correction attempts: only the reporter or an organizer may change Carlos's report
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', %L, gen_random_uuid(), null, 'other')$q$, sA, d1, head1), 'dose_correction_not_allowed'); n := n + 1;
  reset role;
  -- Carlos corrects his own report: a reason is required, a no-op is refused, then it is allowed
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', %L, gen_random_uuid())$q$, sA, d1, head1), 'dose_reason_required'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', %L, gen_random_uuid(), null, 'other')$q$, sA, d1, head1), 'dose_no_change'); n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', %L, gen_random_uuid(), null, 'bogus')$q$, sA, d1, head1), 'dose_bad_request'); n := n + 1;
  select * into r from report_dose(sA, d1, 'not_given', head1, gen_random_uuid(), 'unwell', 'reported_by_mistake');
  if r.supersedes <> head1 or r.status <> 'not_given' or r.change_reason <> 'reported_by_mistake' or r.reported_by <> mm then raise exception 'FAIL: correction row wrong'; end if; n := n + 1;
  head2 := r.id;
  select count(*) into c from dose_administration where schedule_id = sA and local_date = d1;
  if c <> 2 then raise exception 'FAIL: a correction must ADD a row (have %)', c; end if; n := n + 1;
  select status into snapshot from dose_administration where id = head1;
  if snapshot <> 'given' then raise exception 'FAIL: the earlier report was altered'; end if; n := n + 1;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sA;
  if r.status <> 'not_given' or r.head_id <> head2 or r.history_count <> 2 or r.reports_differ then raise exception 'FAIL: occurrence after correction wrong (differ=%)', r.reports_differ; end if; n := n + 1;
  -- the earlier report can no longer be corrected (it has a successor): stale head is a conflict
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', %L, gen_random_uuid(), null, 'other')$q$, sA, d1, head1), 'dose_conflict'); n := n + 1;
  reset role;
  -- the organizer may correct Carlos's report; the chain shows two different people with different statuses: "reports differ"
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sA, d1, 'given', head2, gen_random_uuid(), null, 'information_changed');
  if r.reported_by <> mo or r.status <> 'given' then raise exception 'FAIL: organizer correction wrong'; end if; n := n + 1;
  head1 := r.id;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sA;
  if r.status <> 'given' or not r.reports_differ or r.history_count <> 3 then raise exception 'FAIL: reports_differ not shown (%)', r.reports_differ; end if; n := n + 1;
  -- "confirmed after review": the same status may be re-stated, with that reason only
  select * into r from report_dose(sA, d1, 'given', head1, gen_random_uuid(), null, 'confirmed_after_review');
  if r.status <> 'given' or r.supersedes <> head1 then raise exception 'FAIL: confirm-after-review wrong'; end if; n := n + 1;
  head2 := r.id;
  reset role;

  -- retraction back to Not Confirmed, then a fresh report by anyone with visibility
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sRet, d1, 'given', null, gen_random_uuid());
  head1 := r.id;
  select * into r from report_dose(sRet, d1, 'not_confirmed', head1, gen_random_uuid(), null, 'reported_by_mistake');
  if r.status <> 'not_confirmed' or r.supersedes <> head1 then raise exception 'FAIL: retraction row wrong'; end if; n := n + 1;
  head2 := r.id;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sRet;
  if r.status <> 'not_confirmed' or r.head_id <> head2 or r.history_count <> 2 then raise exception 'FAIL: a retraction must read as Not Confirmed with its history'; end if; n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_confirmed', %L, gen_random_uuid(), null, 'other')$q$, sRet, d1, head2), 'dose_no_change'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sRet, d1, 'given', head2, gen_random_uuid());   -- anyone authorized, no reason needed after a retraction
  if r.status <> 'given' or r.reporter_name <> 'Carlos' then raise exception 'FAIL: report after retraction wrong'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 6. disagreement flags never change the status
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sFlag, d1, 'given', null, gen_random_uuid());
  head1 := r.id;
  perform public.zz_expect_err(format($q$select flag_dose_disagreement(%L, %L, %L, gen_random_uuid())$q$, sFlag, d1, head1), 'dose_use_correction_instead'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select flag_dose_disagreement(%L, %L, null, gen_random_uuid())$q$, sFlag, d1), 'dose_conflict'); n := n + 1;
  perform public.zz_expect_err(format($q$select flag_dose_disagreement(%L, %L, null, gen_random_uuid())$q$, sNC, d1), 'dose_nothing_to_dispute'); n := n + 1;
  q1 := gen_random_uuid();
  select * into r from flag_dose_disagreement(sFlag, d1, head1, q1);
  if r.entry_kind <> 'disagreement' or r.status is not null or r.disputes <> head1 or r.reporter_name <> 'Rita' then raise exception 'FAIL: disagreement row wrong'; end if; n := n + 1;
  select * into r2 from flag_dose_disagreement(sFlag, d1, head1, q1);       -- replay
  if r2.id <> r.id then raise exception 'FAIL: disagreement replay made a new row'; end if; n := n + 1;
  select * into r2 from flag_dose_disagreement(sFlag, d1, head1, gen_random_uuid());   -- same person, same report, new request
  if r2.id <> r.id then raise exception 'FAIL: a second flag by the same person was recorded'; end if; n := n + 1;
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sFlag;
  if r.status <> 'given' or r.reported_by_name <> 'Carlos' or r.open_disagreements <> 1 or r.history_count <> 2 then
    raise exception 'FAIL: a flag must leave the status alone and be counted (status %, flags %)', r.status, r.open_disagreements; end if; n := n + 1;
  reset role;
  -- the organizer resolves it by re-stating the report; the flag stays in history but is no longer open on the new head
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sFlag, d1, 'given', head1, gen_random_uuid(), null, 'confirmed_after_review');
  select * into r from dose_occurrences(fa, d1, d1) where schedule_id = sFlag;
  if r.open_disagreements <> 0 or r.history_count <> 3 then raise exception 'FAIL: flag handling after review wrong (open %, history %)', r.open_disagreements, r.history_count; end if; n := n + 1;
  reset role;
  -- Jenny (no meds visibility) cannot flag; another family cannot flag
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select flag_dose_disagreement(%L, %L, null, gen_random_uuid())$q$, sFlag, d1), 'dose_not_found'); n := n + 1;
  reset role;

  ---------------------------------------------------------------- 6b. direct reads follow medication visibility and family isolation
  foreach hid in array array[ub, un] loop
    perform set_config('request.jwt.claims', json_build_object('sub', hid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into c from dose_administration where family_id = fa;
    if c <> 0 then raise exception 'FAIL: a person without access to family A medications read % of its reports', c; end if; n := n + 1;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from dose_administration where family_id = fa;
  if c < 5 then raise exception 'FAIL: a member with meds visibility cannot read reports (%)', c; end if; n := n + 1;
  select count(*) into c from dose_administration where family_id = fb;
  if c <> 0 then raise exception 'FAIL: Carlos reads family B reports'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 7. organizer outside the 48 h window needs an auditable reason
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA, dold), 'dose_reason_required'); n := n + 1;
  select * into r from report_dose(sA, dold, 'given', null, gen_random_uuid(), null, 'late_entry');
  if not r.outside_window or r.change_reason <> 'late_entry' or r.supersedes is not null then raise exception 'FAIL: late organizer entry not marked'; end if; n := n + 1;
  head1 := r.id;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', %L, gen_random_uuid(), null, 'other')$q$, sA, dold, head1), 'dose_window_closed'); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'not_given', %L, gen_random_uuid())$q$, sA, dold, head1), 'dose_reason_required'); n := n + 1;
  select * into r from report_dose(sA, dold, 'not_given', head1, gen_random_uuid(), null, 'wrong_occurrence');
  if not r.outside_window then raise exception 'FAIL: late correction not marked'; end if; n := n + 1;
  reset role;

  ---------------------------------------------------------------- 8. append-only, even for the superuser; frozen schedules
  perform public.zz_expect_err(format($q$update dose_administration set status = 'given' where id = %L$q$, head1), 'dose reports are append-only: UPDATE is not allowed'); n := n + 1;
  perform public.zz_expect_err(format($q$delete from dose_administration where id = %L$q$, head1), 'dose reports are append-only: DELETE is not allowed'); n := n + 1;
  perform public.zz_expect_err($q$delete from dose_administration$q$, 'dose reports are append-only: DELETE is not allowed'); n := n + 1;
  perform public.zz_expect_err($q$truncate dose_administration$q$, 'dose reports are append-only: TRUNCATE is not allowed'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into dose_administration (family_id, schedule_id, local_date, status, supersedes, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id) values (%L, %L, %L, 'given', %L, now(), 'UTC', 'x', %L, 'x', gen_random_uuid())$q$, fa, sA2, dold, head1, mo), 'a correction must follow a report of the same occurrence'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into dose_administration (family_id, schedule_id, local_date, status, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id) values (%L, %L, %L, 'given', now(), 'UTC', 'x', %L, 'x', gen_random_uuid())$q$, fb, sA, d1, mb), 'cross-family reference: dose_administration.schedule_id'); n := n + 1;
  perform public.zz_expect_err(format($q$insert into dose_administration (family_id, schedule_id, local_date, status, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id) values (%L, %L, %L, 'not_confirmed', now(), 'UTC', 'x', %L, 'x', gen_random_uuid())$q$, fa, sA, d2, mo), 'new row for relation "dose_administration" violates check constraint "dose_administration_retraction_supersedes"'); n := n + 1;
  -- two successors of one report cannot exist (race backstop)
  perform public.zz_expect_err(format($q$insert into dose_administration (family_id, schedule_id, local_date, status, supersedes, change_reason, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id) values (%L, %L, %L, 'not_given', %L, 'other', now(), 'UTC', 'x', %L, 'x', gen_random_uuid())$q$, fa, sA, d1, (select supersedes from dose_administration where schedule_id = sA and local_date = d1 and supersedes is not null limit 1), mo), 'duplicate key value violates unique constraint "dose_administration_one_successor"'); n := n + 1;
  -- frozen schedule: meaning cannot change once reports exist; it can be ended; reports cannot be orphaned
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$update medication_schedule set local_time = '09:00' where id = %L$q$, sA), 'dose_schedule_frozen'); n := n + 1;
  perform public.zz_expect_err(format($q$update medication_schedule set days_of_week = array[1]::smallint[] where id = %L$q$, sA), 'dose_schedule_frozen'); n := n + 1;
  perform public.zz_expect_err(format($q$update medication_schedule set ends_on = %L where id = %L$q$, dold, sA), 'dose_schedule_frozen'); n := n + 1;
  update medication_schedule set ends_on = lt + 10 where id = sA; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: an organizer cannot end a schedule that has reports'; end if; n := n + 1;
  perform public.zz_expect_err(format($q$delete from medication_schedule where id = %L$q$, sA), 'update or delete on table "medication_schedule" violates foreign key constraint "dose_administration_schedule_id_fkey" on table "dose_administration"'); n := n + 1;
  perform public.zz_expect_err(format($q$update medication_schedule set family_id = %L where id = %L$q$, fb, sA), 'family_id is immutable'); n := n + 1;
  reset role;
  perform public.zz_expect_err(format($q$delete from medication where id = %L$q$, medA), 'update or delete on table "medication_schedule" violates foreign key constraint "dose_administration_schedule_id_fkey" on table "dose_administration"'); n := n + 1;

  ---------------------------------------------------------------- 9. revocation: removed members lose access at once; their history stays readable
  select count(*) into c from dose_administration where reported_by = mr or reporter_name = 'Rita';
  if c < 1 then raise exception 'FAIL: fixture: Rita should have reports'; end if; n := n + 1;
  delete from member where id = mr;
  perform set_config('request.jwt.claims', json_build_object('sub', ur, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d2), 'dose_not_found'); n := n + 1;
  select count(*) into c from dose_occurrences(fa, d1, d1);
  if c <> 0 then raise exception 'FAIL: a removed member still reads occurrences'; end if; n := n + 1;
  select count(*) into c from dose_administration;
  if c <> 0 then raise exception 'FAIL: a removed member still reads reports'; end if; n := n + 1;
  reset role;
  select count(*) into c from dose_administration where reporter_name = 'Rita';
  if c < 1 then raise exception 'FAIL: removing a member erased their reports'; end if; n := n + 1;
  -- a member whose meds visibility is switched off loses access at once
  update member set can_see_meds = false where id = mm;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d2), 'dose_not_found'); n := n + 1;
  reset role;
  update member set can_see_meds = true where id = mm;
  -- when the member access window exists (migration 20261022000002), an ended window also revokes
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'member' and column_name = 'access_ends_at') then
    update member set access_ends_at = now() - interval '1 minute' where id = mm;
    perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.zz_expect_err(format($q$select report_dose(%L, %L, 'given', null, gen_random_uuid())$q$, sA2, d2), 'dose_not_found'); n := n + 1;
    select count(*) into c from dose_occurrences(fa, d1, d1);
    if c <> 0 then raise exception 'FAIL: an ended access window still reads occurrences'; end if; n := n + 1;
    reset role;
    update member set access_ends_at = null where id = mm;
  end if;

  ---------------------------------------------------------------- 10. time zones and daylight saving (pure function, fixed dates)
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  select * into r from dose_scheduled_at(date '2026-03-08', time '01:30', 'America/Chicago');
  if r.time_state <> 'normal' or r.scheduled_at <> timestamptz '2026-03-08 07:30+00' then raise exception 'FAIL: Chicago 01:30 before spring forward (% %)', r.time_state, r.scheduled_at; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-03-08', time '02:30', 'America/Chicago');
  if r.time_state <> 'skipped' or r.scheduled_at is not null then raise exception 'FAIL: Chicago 02:30 does not exist and must be skipped, not shifted (% %)', r.time_state, r.scheduled_at; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-03-08', time '03:30', 'America/Chicago');
  if r.time_state <> 'normal' or r.scheduled_at <> timestamptz '2026-03-08 08:30+00' then raise exception 'FAIL: Chicago 03:30 after spring forward'; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-11-01', time '01:30', 'America/Chicago');
  if r.time_state <> 'ambiguous' or r.scheduled_at <> timestamptz '2026-11-01 06:30+00' then raise exception 'FAIL: Chicago 01:30 repeats and must use the earlier instant (% %)', r.time_state, r.scheduled_at; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-11-01', time '00:30', 'America/Chicago');
  if r.time_state <> 'normal' then raise exception 'FAIL: Chicago 00:30 is not ambiguous'; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-11-01', time '02:30', 'America/Chicago');
  if r.time_state <> 'normal' or r.scheduled_at <> timestamptz '2026-11-01 08:30+00' then raise exception 'FAIL: Chicago 02:30 after fall back'; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-03-29', time '01:30', 'Europe/London');
  if r.time_state <> 'skipped' then raise exception 'FAIL: London 01:30 on 2026-03-29 does not exist'; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-10-25', time '01:30', 'Europe/London');
  if r.time_state <> 'ambiguous' or r.scheduled_at <> timestamptz '2026-10-25 00:30+00' then raise exception 'FAIL: London 01:30 on 2026-10-25 repeats (% %)', r.time_state, r.scheduled_at; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-04-05', time '01:45', 'Australia/Lord_Howe');   -- a 30-minute shift
  if r.time_state <> 'ambiguous' then raise exception 'FAIL: Lord Howe 01:45 on 2026-04-05 repeats (%)', r.time_state; end if; n := n + 1;
  select * into r from dose_scheduled_at(date '2026-03-08', time '02:30', 'America/Phoenix');          -- no daylight saving
  if r.time_state <> 'normal' then raise exception 'FAIL: Phoenix has no clock change'; end if; n := n + 1;
  perform public.zz_expect_err($q$select * from dose_scheduled_at(date '2026-03-08', time '02:30', 'Not/AZone')$q$, 'dose_bad_timezone'); n := n + 1;
  -- end to end: a family in Chicago with a 02:30 dose on the spring-forward day, and a 01:30 dose on a fall-back day in the past
  insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', 'c-' || gen_random_uuid() || '@test.invalid') returning id into uchi;
  insert into family (name, created_by, timezone) values ('Fam Chicago', uchi, 'America/Chicago') returning id into fchi;
  insert into member (family_id, user_id, name, role) values (fchi, uchi, 'Org Chi', 'organizer') returning id into mchi;
  insert into medication (family_id, name, dose) values (fchi, 'ChiMed', '5 mg') returning id into medChi;
  insert into medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fchi, medChi, '02:30', array[1,2,3,4,5,6,7]::smallint[], date '2025-01-01') returning id into sChi;
  perform set_config('request.jwt.claims', json_build_object('sub', uchi, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from dose_occurrences(fchi, date '2026-03-08', date '2026-03-08');
  if r.time_state <> 'skipped' or r.scheduled_at is not null or r.status <> 'not_confirmed' then raise exception 'FAIL: the skipped 02:30 occurrence must be listed, flagged and Not Confirmed'; end if; n := n + 1;
  perform public.zz_expect_err(format($q$select report_dose(%L, date '2026-03-08', 'given', null, gen_random_uuid(), null, 'late_entry')$q$, sChi), 'dose_time_skipped'); n := n + 1;
  perform public.zz_expect_err(format($q$select flag_dose_disagreement(%L, date '2026-03-08', null, gen_random_uuid())$q$, sChi), 'dose_time_skipped'); n := n + 1;
  reset role;
  update medication_schedule set local_time = '01:30' where id = sChi;
  perform set_config('request.jwt.claims', json_build_object('sub', uchi, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from report_dose(sChi, date '2025-11-02', 'given', null, gen_random_uuid(), null, 'late_entry');   -- US fall back 2025-11-02: 01:30 happened twice
  if r.scheduled_at <> timestamptz '2025-11-02 06:30+00' then raise exception 'FAIL: repeated 01:30 must use the earlier instant (%)', r.scheduled_at; end if; n := n + 1;
  select count(*) into c from dose_occurrences(fchi, date '2025-11-02', date '2025-11-02');
  if c <> 1 then raise exception 'FAIL: a repeated hour must still be ONE occurrence (%)', c; end if; n := n + 1;
  select * into r from dose_occurrences(fchi, date '2025-11-02', date '2025-11-02');
  if r.time_state <> 'ambiguous' or r.status <> 'given' then raise exception 'FAIL: ambiguous occurrence not flagged'; end if; n := n + 1;
  reset role;
  -- changing the family time zone leaves past snapshots alone
  update family set timezone = 'America/Los_Angeles' where id = fchi;
  select tz into snapshot from dose_administration where family_id = fchi limit 1;
  if snapshot <> 'America/Chicago' then raise exception 'FAIL: a time zone change rewrote history'; end if; n := n + 1;

  ---------------------------------------------------------------- 11. deleting a whole family removes its history through the cascade (the explicit deletion path)
  select count(*) into c from dose_administration where family_id = fa;
  if c < 5 then raise exception 'FAIL: fixture: family A should have reports'; end if; n := n + 1;
  delete from family where id = fa;
  select count(*) into c from dose_administration where family_id = fa;
  if c <> 0 then raise exception 'FAIL: family deletion left reports behind'; end if; n := n + 1;
  select count(*) into c from medication_schedule where family_id = fa;
  if c <> 0 then raise exception 'FAIL: family deletion left schedules behind'; end if; n := n + 1;
  delete from family where id = fchi;
  select count(*) into c from dose_administration where family_id = fchi;
  if c <> 0 then raise exception 'FAIL: family deletion left reports behind (Chicago)'; end if; n := n + 1;

  raise exception 'PASS: % assertions', n;
end
$test$;

drop function if exists public.zz_expect_err(text, text);
