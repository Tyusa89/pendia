-- RLS + integrity tests. Synthetic users only. Safe to run against the live DB:
-- everything happens inside one DO block that ALWAYS ends with an exception, so nothing is persisted.
-- Pass  => the final error message starts with 'PASS'.
-- Fail  => the error message starts with 'FAIL' and names the assertion.

do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); ujen uuid := gen_random_uuid();
  fa uuid; fb uuid; fd uuid;
  ma uuid; mb uuid; mjen_a uuid; mcar_a uuid;
  va uuid; vb uuid; mca uuid; n int := 0; c int; ok boolean; who uuid; r record;

begin
  ---------------------------------------------------------------- fixtures (as superuser)
  insert into auth.users (id, aud, role, email) values
    (ua,   'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (ub,   'authenticated', 'authenticated', 'b-' || ub || '@test.invalid'),
    (ujen, 'authenticated', 'authenticated', 'j-' || ujen || '@test.invalid');

  insert into family (name, created_by) values ('Family A', ua) returning id into fa;
  insert into family (name, created_by) values ('Family B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer') returning id into ma;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  -- Jenny: logged-in member of A with no meds / no visits access, schedule allowed
  insert into member (family_id, user_id, name, role, can_see_meds, can_see_visits, can_see_schedule)
    values (fa, ujen, 'Jenny A', 'member', false, false, true) returning id into mjen_a;
  insert into member (family_id, name, role) values (fa, 'Carlos A', 'member') returning id into mcar_a;

  insert into care_recipient (family_id, name) values (fa, 'Rosa A'), (fb, 'Rosa B');
  insert into visit (family_id, date, doctor) values (fa, current_date, 'Dr A') returning id into va;
  insert into visit (family_id, date, doctor) values (fb, current_date, 'Dr B') returning id into vb;
  insert into medication (family_id, name) values (fa, 'MedA'), (fb, 'MedB');
  insert into med_change (family_id, visit_id, medication, before, after) values (fa, va, 'MedA', '1', '2') returning id into mca;
  insert into med_change (family_id, visit_id, medication, before, after) values (fb, vb, 'MedB', '1', '2');
  insert into task (family_id, title) values (fa, 'Task A'), (fb, 'Task B');
  insert into watch_item (family_id, text) values (fa, 'Watch A'), (fb, 'Watch B');
  insert into shift (family_id, start, "end") values (fa, now(), now() + interval '1 hour'), (fb, now(), now() + interval '1 hour');
  insert into handoff (family_id, note) values (fa, 'H A'), (fb, 'H B');
  insert into digest (family_id, week, text, member_id) values (fa, current_date, 'D A', ma), (fb, current_date, 'D B', mb);

  ---------------------------------------------------------------- 1. cross-family isolation: A sees none of B
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from family where id = fb;               if c <> 0 then raise exception 'FAIL: A reads family B'; end if; n := n + 1;
  select count(*) into c from member where family_id = fb;        if c <> 0 then raise exception 'FAIL: A reads members of B'; end if; n := n + 1;
  select count(*) into c from care_recipient where family_id = fb; if c <> 0 then raise exception 'FAIL: A reads care_recipient of B'; end if; n := n + 1;
  select count(*) into c from visit where family_id = fb;         if c <> 0 then raise exception 'FAIL: A reads visits of B'; end if; n := n + 1;
  select count(*) into c from medication where family_id = fb;    if c <> 0 then raise exception 'FAIL: A reads medications of B'; end if; n := n + 1;
  select count(*) into c from med_change where family_id = fb;    if c <> 0 then raise exception 'FAIL: A reads med_change of B'; end if; n := n + 1;
  select count(*) into c from task where family_id = fb;          if c <> 0 then raise exception 'FAIL: A reads tasks of B'; end if; n := n + 1;
  select count(*) into c from watch_item where family_id = fb;    if c <> 0 then raise exception 'FAIL: A reads watch_item of B'; end if; n := n + 1;
  select count(*) into c from shift where family_id = fb;         if c <> 0 then raise exception 'FAIL: A reads shifts of B'; end if; n := n + 1;
  select count(*) into c from handoff where family_id = fb;       if c <> 0 then raise exception 'FAIL: A reads handoffs of B'; end if; n := n + 1;
  select count(*) into c from digest where family_id = fb;        if c <> 0 then raise exception 'FAIL: A reads digests of B'; end if; n := n + 1;

  -- A still sees own data
  select count(*) into c from medication where family_id = fa;    if c <> 1 then raise exception 'FAIL: A cannot read own medication'; end if; n := n + 1;

  -- A cannot write into B
  begin insert into medication (family_id, name) values (fb, 'Evil'); raise exception 'FAIL: A inserted medication into B';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into task (family_id, title) values (fb, 'Evil'); raise exception 'FAIL: A inserted task into B';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into member (family_id, user_id, name, role) values (fb, ua, 'Evil', 'organizer'); raise exception 'FAIL: A joined family B';
  exception when insufficient_privilege then n := n + 1; end;
  update medication set name = 'Hacked' where family_id = fb; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: A updated B medication'; end if; n := n + 1;
  delete from task where family_id = fb; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: A deleted B task'; end if; n := n + 1;

  -- A cannot move its own row into B
  begin update task set family_id = fb where family_id = fa; raise exception 'FAIL: A moved a task into B';
  exception when raise_exception or insufficient_privilege then
    if sqlerrm like 'FAIL%' then raise; end if; n := n + 1;
  end;

  ---------------------------------------------------------------- 2. cross-family references rejected
  begin insert into task (family_id, title, owner_member_id) values (fa, 'x', mb); raise exception 'FAIL: task owner from family B accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into med_change (family_id, visit_id, medication) values (fa, vb, 'x'); raise exception 'FAIL: med_change visit from family B accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into shift (family_id, start, "end", assigned_member_id) values (fa, now(), now() + interval '1 hour', mb); raise exception 'FAIL: shift assigned to B member accepted';
  exception when check_violation then n := n + 1; end;

  ---------------------------------------------------------------- 3. med-change confirm guard (rule 3)
  begin insert into med_change (family_id, medication, status) values (fa, 'x', 'confirmed'); raise exception 'FAIL: med_change inserted pre-confirmed';
  exception when check_violation then n := n + 1; end;
  -- client tries to spoof confirmed_by with another member: DB stamps the real caller
  update med_change set status = 'confirmed', confirmed_by = mcar_a where id = mca;
  select confirmed_by into who from med_change where id = mca;
  if who is distinct from ma then raise exception 'FAIL: confirmed_by was spoofable (got %)', who; end if; n := n + 1;
  select (confirmed_at is not null) into ok from med_change where id = mca;
  if not ok then raise exception 'FAIL: confirmed_at not stamped'; end if; n := n + 1;
  begin update med_change set after = '999' where id = mca; raise exception 'FAIL: confirmed med change editable';
  exception when check_violation then n := n + 1; end;

  ---------------------------------------------------------------- 4. per-person visibility (rule 8): Jenny (no meds, no visits)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ujen, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from medication where family_id = fa;  if c <> 0 then raise exception 'FAIL: member without meds access reads medication'; end if; n := n + 1;
  select count(*) into c from med_change where family_id = fa;  if c <> 0 then raise exception 'FAIL: member without meds access reads med_change'; end if; n := n + 1;
  select count(*) into c from visit where family_id = fa;       if c <> 0 then raise exception 'FAIL: member without visits access reads visits'; end if; n := n + 1;
  select count(*) into c from shift where family_id = fa;       if c < 1 then raise exception 'FAIL: member with schedule access cannot read shifts'; end if; n := n + 1;
  select count(*) into c from task where family_id = fa;        if c < 1 then raise exception 'FAIL: member cannot read tasks'; end if; n := n + 1;
  select count(*) into c from digest where family_id = fa;      if c <> 0 then raise exception 'FAIL: member reads another member''s digest'; end if; n := n + 1;
  begin insert into medication (family_id, name) values (fa, 'Evil'); raise exception 'FAIL: non-organizer inserted medication';
  exception when insufficient_privilege then n := n + 1; end;
  update member set can_see_meds = true where id = mjen_a; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member escalated own visibility'; end if; n := n + 1;

  -- flipping the flag as organizer opens access
  reset role;
  update member set can_see_meds = true where id = mjen_a;
  perform set_config('request.jwt.claims', json_build_object('sub', ujen, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from medication where family_id = fa;  if c <> 1 then raise exception 'FAIL: flag flip did not grant meds access'; end if; n := n + 1;

  ---------------------------------------------------------------- 5. anon sees nothing
  reset role;
  set local role anon;
  begin select count(*) into c from medication; raise exception 'FAIL: anon can query medication';
  exception when insufficient_privilege then n := n + 1; end;
  reset role;

  ---------------------------------------------------------------- 6. demo seed (as a fresh user)
  declare ud uuid := gen_random_uuid(); df uuid; names text; gaps int; gap_ok boolean;
  begin
    insert into auth.users (id, aud, role, email) values (ud, 'authenticated', 'authenticated', 'd-' || ud || '@test.invalid');
    perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
    set local role authenticated;
    df := public.join_demo_family();
    if df <> public.join_demo_family() then raise exception 'FAIL: join_demo_family not idempotent'; end if; n := n + 1;
    select string_agg(name || ':' || language || ':' || role, ',' order by name) into names from member where family_id = df;
    if names <> 'Carlos:es:member,Jenny:en:member,Maria:en:organizer' then raise exception 'FAIL: seed members wrong: %', names; end if; n := n + 1;
    select count(*) into c from medication where family_id = df and name = 'Lisinopril' and dose = '10 mg';
    if c <> 1 then raise exception 'FAIL: seed lacks Lisinopril 10 mg'; end if; n := n + 1;
    select count(*), bool_and(extract(isodow from start at time zone 'America/New_York') = 2
                              and extract(hour from start at time zone 'America/New_York') = 14
                              and extract(hour from "end" at time zone 'America/New_York') = 18)
      into gaps, gap_ok from shift where family_id = df and assigned_member_id is null;
    if gaps <> 1 or not gap_ok then raise exception 'FAIL: seed coverage gap should be exactly Tuesday 2-6 PM (gaps=%)', gaps; end if; n := n + 1;
    select count(*) into c from digest where family_id = df and language = 'es';
    if c <> 1 then raise exception 'FAIL: seed lacks Spanish digest'; end if; n := n + 1;
    reset role;
  end;

  raise exception 'PASS: % assertions', n;
end
$test$;
