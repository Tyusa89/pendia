-- V1 appointment tests: new columns, constraints, legacy compatibility, timezone-derived date, and RLS behavior.
-- Synthetic users only. One DO block that ALWAYS ends with an exception, so nothing persists.
-- Pass => message starts with 'PASS'. Fail => message starts with 'FAIL' and names the assertion.

do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uj uuid := gen_random_uuid(); uk uuid := gen_random_uuid();
  fa uuid; fb uuid; ma uuid; mb uuid; mj uuid; mk uuid;
  v1 uuid; v2 uuid; v3 uuid; vlegacy uuid; vb uuid;
  r record; n int := 0; c int; d date; tr jsonb; h text;
begin
  -------------------------------------------------------------- schema facts
  select count(*) into c from information_schema.columns where table_schema = 'public' and table_name = 'visit'
    and column_name in ('provider_name','office_name','office_address','office_phone','scheduled_start','scheduled_end',
                        'reason','notes','status','confirmation_status','reminder_prefs','archived_at');
  if c <> 12 then raise exception 'FAIL: expected the 12 appointment columns on visit, found %', c; end if; n := n + 1;
  select count(*) into c from information_schema.columns where table_schema = 'public' and table_name = 'visit'
    and ((column_name = 'scheduled_start' and data_type = 'timestamp with time zone')
      or (column_name = 'scheduled_end' and data_type = 'timestamp with time zone')
      or (column_name = 'archived_at' and data_type = 'timestamp with time zone')
      or (column_name = 'reminder_prefs' and data_type = 'jsonb')
      or (column_name = 'status' and column_default like '%scheduled%')
      or (column_name = 'confirmation_status' and column_default like '%unconfirmed%')
      or (column_name = 'doctor' and is_nullable = 'YES'));
  if c <> 7 then raise exception 'FAIL: column types/defaults/nullability not as designed (matched %)', c; end if; n := n + 1;
  -- computed, not stored: there must be no persisted incomplete/overlap flag
  select count(*) into c from information_schema.columns where table_schema = 'public' and table_name = 'visit'
    and column_name ~* '(incomplete|overlap|conflict)';
  if c <> 0 then raise exception 'FAIL: an incomplete/overlap flag is stored on visit'; end if; n := n + 1;

  -------------------------------------------------------------- fixtures
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid'),
    (uj, 'authenticated', 'authenticated', 'j-' || uj || '@test.invalid'),
    (uk, 'authenticated', 'authenticated', 'k-' || uk || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer') returning id into ma;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  insert into member (family_id, user_id, name, role, can_see_visits) values (fa, uj, 'Member sees visits', 'member', true) returning id into mj;
  insert into member (family_id, user_id, name, role, can_see_visits) values (fa, uk, 'Member no visits', 'member', false) returning id into mk;

  -------------------------------------------------------------- legacy-shaped rows keep working
  tr := '[{"speaker":"A","start_s":1.5,"end_s":4.0,"text":"Synthetic doctor line"}]'::jsonb;
  insert into visit (family_id, date, doctor, transcript, summary, consent_text)
    values (fa, date '2026-09-01', 'Dr. Legacy', tr, 'Old summary', 'Consent text') returning id into vlegacy;
  select * into r from visit where id = vlegacy;
  if r.provider_name is distinct from 'Dr. Legacy' then raise exception 'FAIL: legacy doctor not adopted as provider_name'; end if; n := n + 1;
  if r.doctor is distinct from 'Dr. Legacy' then raise exception 'FAIL: legacy doctor changed'; end if; n := n + 1;
  if r.date is distinct from date '2026-09-01' then raise exception 'FAIL: legacy date changed (got %)', r.date; end if; n := n + 1;
  if r.transcript is distinct from tr or r.summary is distinct from 'Old summary' or r.consent_text is distinct from 'Consent text' then
    raise exception 'FAIL: transcript/summary/consent not preserved'; end if; n := n + 1;
  if r.status <> 'scheduled' or r.confirmation_status <> 'unconfirmed' or r.reminder_prefs <> '{}'::jsonb or r.archived_at is not null then
    raise exception 'FAIL: new-row defaults wrong (% % % %)', r.status, r.confirmation_status, r.reminder_prefs, r.archived_at; end if; n := n + 1;

  -- provider_name is the source of truth; doctor mirrors it, including when the provider is cleared
  update visit set provider_name = 'Dr. Renamed' where id = vlegacy;
  select doctor into r from visit where id = vlegacy;
  if r.doctor is distinct from 'Dr. Renamed' then raise exception 'FAIL: doctor mirror did not follow provider_name'; end if; n := n + 1;
  update visit set provider_name = null where id = vlegacy;
  select doctor into r from visit where id = vlegacy;
  if r.doctor is not null then raise exception 'FAIL: cleared provider left a stale doctor behind'; end if; n := n + 1;
  select transcript, summary into r from visit where id = vlegacy;
  if r.transcript is distinct from tr or r.summary is distinct from 'Old summary' then raise exception 'FAIL: editing the provider touched the transcript/summary'; end if; n := n + 1;

  -------------------------------------------------------------- date is derived in the family's timezone
  insert into visit (family_id, date, scheduled_start) values (fa, date '2000-01-01', timestamptz '2026-11-03 02:30:00+00') returning id into v1;
  select date into d from visit where id = v1;
  if d <> date '2026-11-02' then raise exception 'FAIL: 02:30Z on Nov 3 is Nov 2 evening in New York, got %', d; end if; n := n + 1;
  update visit set scheduled_start = timestamptz '2026-11-01 05:30:00+00' where id = v1;   -- 1:30 EDT, before the fall-back change
  select date into d from visit where id = v1;
  if d <> date '2026-11-01' then raise exception 'FAIL: date did not follow an edited start (got %)', d; end if; n := n + 1;
  update family set timezone = 'Pacific/Auckland' where id = fa;
  update visit set scheduled_start = timestamptz '2026-11-03 02:30:00+00' where id = v1;
  select date into d from visit where id = v1;
  if d <> date '2026-11-03' then raise exception 'FAIL: family timezone not honored (Auckland, got %)', d; end if; n := n + 1;
  update family set timezone = 'Mars/Phobos' where id = fa;
  update visit set scheduled_start = timestamptz '2026-11-03 02:30:00+00', provider_name = 'Dr. TZ' where id = v1;
  select date into d from visit where id = v1;
  if d <> date '2026-11-02' then raise exception 'FAIL: unrecognized timezone should fall back to New York (got %)', d; end if; n := n + 1;
  update family set timezone = 'America/New_York' where id = fa;

  -------------------------------------------------------------- constraints
  begin insert into visit (family_id, date, status) values (fa, current_date, 'rescheduled'); raise exception 'FAIL: bad status accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into visit (family_id, date, confirmation_status) values (fa, current_date, 'maybe'); raise exception 'FAIL: bad confirmation_status accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into visit (family_id, date, reminder_prefs) values (fa, current_date, '[]'::jsonb); raise exception 'FAIL: non-object reminder_prefs accepted';
  exception when check_violation then n := n + 1; end;
  begin insert into visit (family_id, date, scheduled_start, scheduled_end) values (fa, current_date, now(), now() - interval '1 minute'); raise exception 'FAIL: end before start accepted';
  exception when check_violation then n := n + 1; end;
  insert into visit (family_id, date, scheduled_start, scheduled_end) values (fa, current_date, now(), now()); n := n + 1;          -- zero-length ok
  insert into visit (family_id, date, scheduled_start) values (fa, current_date, now()); n := n + 1;                                -- no end ok
  -- an appointment with no provider/address/phone is allowed (the app flags it; the database does not invent or require values)
  insert into visit (family_id, date, scheduled_start) values (fa, current_date, now() + interval '2 days') returning id into v2;
  select * into r from visit where id = v2;
  if r.provider_name is not null or r.doctor is not null or r.office_address is not null or r.office_phone is not null then
    raise exception 'FAIL: database filled in a missing value'; end if; n := n + 1;
  -- overlap is never blocked
  insert into visit (family_id, date, scheduled_start, scheduled_end, provider_name)
    values (fa, current_date, timestamptz '2027-01-10 15:00+00', timestamptz '2027-01-10 16:00+00', 'Dr. One');
  insert into visit (family_id, date, scheduled_start, scheduled_end, provider_name)
    values (fa, current_date, timestamptz '2027-01-10 15:30+00', timestamptz '2027-01-10 16:30+00', 'Dr. Two');
  n := n + 1;

  -------------------------------------------------------------- RLS: organizer writes
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into visit (family_id, date, provider_name, office_name, office_address, office_phone, scheduled_start, scheduled_end, reason, notes, confirmation_status, reminder_prefs)
    values (fa, date '2000-01-01', 'Dr. Patel', 'Patel Family Medicine', '12 Example Rd', '555-0100', timestamptz '2026-12-01 15:00+00',
            timestamptz '2026-12-01 15:30+00', 'Blood test', 'Bring list', 'confirmed', '{"note":"x"}'::jsonb) returning id into v3;
  update visit set office_phone = '555-0199', reason = 'Blood test follow-up' where id = v3; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot edit an appointment'; end if; n := n + 1;
  update visit set status = 'canceled' where id = v3; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot cancel'; end if; n := n + 1;
  update visit set archived_at = now() where id = v3; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot archive'; end if; n := n + 1;
  -- mark completed: organizer can, and ONLY status changes
  update visit set archived_at = null, status = 'scheduled' where id = v3;
  select md5(row(v.date, v.provider_name, v.office_address, v.office_phone, v.scheduled_start, v.scheduled_end, v.reason, v.notes, v.transcript::text, v.speaker_map::text, v.consent_text, v.audio_path)::text) into h from visit v where id = v3;
  update visit set status = 'completed' where id = v3; get diagnostics c = row_count;
  if c <> 1 then raise exception 'FAIL: organizer cannot mark an appointment completed'; end if; n := n + 1;
  if (select md5(row(v.date, v.provider_name, v.office_address, v.office_phone, v.scheduled_start, v.scheduled_end, v.reason, v.notes, v.transcript::text, v.speaker_map::text, v.consent_text, v.audio_path)::text) from visit v where id = v3) <> h
     or (select status from visit where id = v3) <> 'completed' then
    raise exception 'FAIL: marking completed changed more than status'; end if; n := n + 1;
  update visit set status = 'canceled' where id = v3;
  update visit set archived_at = now() where id = v3;
  select * into r from visit where id = v3;
  if r.status <> 'canceled' or r.archived_at is null or r.office_phone <> '555-0199' or r.provider_name <> 'Dr. Patel' or r.doctor <> 'Dr. Patel' then
    raise exception 'FAIL: cancel/archive/edit results wrong'; end if; n := n + 1;
  -- cancel/archive/edit never touch the recording and transcript structures
  update visit set transcript = tr, speaker_map = '{"A":"doctor"}'::jsonb, consent_text = 'kept' where id = v3;
  update visit set status = 'completed', archived_at = null, notes = 'edited' where id = v3;
  select * into r from visit where id = v3;
  if r.transcript is distinct from tr or r.speaker_map is distinct from '{"A":"doctor"}'::jsonb or r.consent_text is distinct from 'kept' then
    raise exception 'FAIL: appointment edits changed transcript/speaker_map/consent'; end if; n := n + 1;
  begin update visit set family_id = fb where id = v3; raise exception 'FAIL: appointment moved to another family';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; n := n + 1; end;

  -------------------------------------------------------------- RLS: members read per can_see_visits, never write
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from visit where family_id = fa;
  if c < 5 then raise exception 'FAIL: member with can_see_visits cannot read appointments (saw %)', c; end if; n := n + 1;
  select count(*) into c from visit where id = v3 and notes = 'edited';
  if c <> 1 then raise exception 'FAIL: member cannot read the new columns'; end if; n := n + 1;
  begin insert into visit (family_id, date, scheduled_start) values (fa, current_date, now()); raise exception 'FAIL: member created an appointment';
  exception when insufficient_privilege then n := n + 1; end;
  update visit set status = 'completed' where id = v3; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member marked an appointment completed'; end if; n := n + 1;
  update visit set status = 'canceled' where id = v3; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member canceled an appointment'; end if; n := n + 1;
  update visit set archived_at = now() where id = v3; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member archived an appointment'; end if; n := n + 1;
  update visit set notes = 'hacked' where id = v3; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: member edited an appointment'; end if; n := n + 1;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uk, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from visit where family_id = fa;
  if c <> 0 then raise exception 'FAIL: member without can_see_visits can read appointments (saw %)', c; end if; n := n + 1;

  -------------------------------------------------------------- RLS: another family
  reset role;
  insert into visit (family_id, date, scheduled_start, provider_name) values (fb, current_date, now(), 'Dr. B') returning id into vb;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from visit where family_id = fa;
  if c <> 0 then raise exception 'FAIL: Family B can read Family A appointments (saw %)', c; end if; n := n + 1;
  update visit set status = 'canceled', archived_at = now(), notes = 'x' where family_id = fa; get diagnostics c = row_count;
  if c <> 0 then raise exception 'FAIL: Family B changed Family A appointments'; end if; n := n + 1;
  begin insert into visit (family_id, date, scheduled_start) values (fa, current_date, now()); raise exception 'FAIL: Family B created an appointment in Family A';
  exception when insufficient_privilege then n := n + 1; end;
  select count(*) into c from visit where id = vb;
  if c <> 1 then raise exception 'FAIL: Family B cannot read its own appointment'; end if; n := n + 1;

  -------------------------------------------------------------- anon
  reset role;
  set local role anon;
  begin select count(*) into c from visit; if c <> 0 then raise exception 'FAIL: anon can read visits'; end if; n := n + 1;
  exception when insufficient_privilege then n := n + 1; end;
  reset role;

  raise exception 'PASS: % assertions', n;
end
$test$;
