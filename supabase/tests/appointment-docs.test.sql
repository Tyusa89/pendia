-- Appointment-document storage RLS + visit.document_path integrity, for BOTH document states. Synthetic users/paths only; no bytes.
--   pending  (no visit references the path): readable only by the organizer who uploaded it
--   attached (a visit in the same family references it): readable by members who may see visits
-- REQUIRES migration 20261029000001_appointment_documents.sql applied first. Always ends with an exception so nothing persists.
-- Pass => message starts with 'PASS'. Fail => 'FAIL: <assertion>'. (DELETE policy is checked via appt_doc_can_write, as in storage.test.sql.)
do $test$
declare
  ua uuid := gen_random_uuid(); uo uuid := gen_random_uuid(); um uuid := gen_random_uuid();
  uj uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  fa uuid; fb uuid;
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid();
  p_pend text; p_att text; p_b text; n int := 0; c int; va uuid;
begin
  perform 1 from storage.buckets where id = 'appointment-docs' and public = false and file_size_limit = 10485760
     and allowed_mime_types @> array['application/pdf','image/jpeg','image/png'];
  if not found then raise exception 'FAIL: bucket missing, public, or misconfigured'; end if; n := n + 1;

  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-'  || ua || '@test.invalid'),
    (uo, 'authenticated', 'authenticated', 'o-'  || uo || '@test.invalid'),
    (um, 'authenticated', 'authenticated', 'm-'  || um || '@test.invalid'),
    (uj, 'authenticated', 'authenticated', 'j-'  || uj || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-'  || ub || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer'), (fa, uo, 'Org A2', 'organizer'), (fb, ub, 'Org B', 'organizer');
  insert into member (family_id, user_id, name, role, can_see_schedule, can_see_visits) values
    (fa, um, 'Mem Visits', 'member', true, true),
    (fa, uj, 'Mem NoVisits', 'member', true, false);

  p_pend := fa || '/doc/' || d1 || '/letter.pdf';   -- uploaded by ua, not yet confirmed
  p_att  := fa || '/doc/' || d2 || '/letter.png';   -- uploaded by ua, attached below
  p_b    := fb || '/doc/' || d3 || '/letter.pdf';   -- family B's own pending upload
  insert into storage.objects (bucket_id, name, owner_id) values
    ('appointment-docs', p_pend, ua::text), ('appointment-docs', p_att, ua::text), ('appointment-docs', p_b, ub::text);
  insert into visit (family_id, date, scheduled_start, document_path) values (fa, current_date, now(), p_att) returning id into va;
  n := n + 1;

  select count(*) into c from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('appointment docs read','appointment docs insert','appointment docs update','appointment docs delete') and roles = '{authenticated}';
  if c <> 4 then raise exception 'FAIL: expected 4 policies, found %', c; end if; n := n + 1;

  if public.appt_doc_path_family(p_pend) is distinct from fa then raise exception 'FAIL: parser misses family'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/doc/' || d1 || '/../x.pdf') is not null then raise exception 'FAIL: ".." accepted'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/doc/' || d1 || '/letter.exe') is not null then raise exception 'FAIL: bad extension accepted'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/handoff/' || d1 || '/letter.pdf') is not null then raise exception 'FAIL: wrong entity accepted'; end if; n := n + 1;
  if public.appt_doc_path_family('loose.pdf') is not null then raise exception 'FAIL: unscoped path accepted'; end if; n := n + 1;
  if public.appt_doc_is_attached(p_pend) then raise exception 'FAIL: unreferenced path reported attached'; end if; n := n + 1;
  if not public.appt_doc_is_attached(p_att) then raise exception 'FAIL: referenced path not attached'; end if; n := n + 1;

  -------------------------------------------------------------- uploader (organizer A): reads pending AND attached
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name in (p_pend, p_att);
  if c <> 2 then raise exception 'FAIL: uploader sees % of own 2 documents', c; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_b;
  if c <> 0 then raise exception 'FAIL: A can read B document'; end if; n := n + 1;
  insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/x.jpg', ua::text); n := n + 1;
  if not public.appt_doc_can_write(p_pend) then raise exception 'FAIL: organizer fails write rule'; end if; n := n + 1;

  -------------------------------------------------------------- ANOTHER organizer of the same family: attached yes, pending NO
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_pend;
  if c <> 0 then raise exception 'FAIL: another organizer reads a PENDING document'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_att;
  if c <> 1 then raise exception 'FAIL: another organizer cannot read an ATTACHED document'; end if; n := n + 1;

  -------------------------------------------------------------- member who may see visits: attached yes, pending NO
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_pend;
  if c <> 0 then raise exception 'FAIL: visits-visible member reads a PENDING document'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_att;
  if c <> 1 then raise exception 'FAIL: visits-visible member cannot read an ATTACHED document'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/x.pdf', um::text);
    raise exception 'FAIL: non-organizer uploaded';
  exception when insufficient_privilege then n := n + 1; end;
  if public.appt_doc_can_write(p_att) then raise exception 'FAIL: non-organizer satisfies write rule'; end if; n := n + 1;

  -------------------------------------------------------------- member WITHOUT visits visibility: neither state
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name in (p_pend, p_att);
  if c <> 0 then raise exception 'FAIL: member without visits visibility reads a document (saw %)', c; end if; n := n + 1;

  -------------------------------------------------------------- Family B organizer: own pending only; nothing of A in either state
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name in (p_pend, p_att);
  if c <> 0 then raise exception 'FAIL: B reads A documents'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_b;
  if c <> 1 then raise exception 'FAIL: B cannot read own pending document'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/x.pdf', ub::text);
    raise exception 'FAIL: B uploaded into A folder';
  exception when insufficient_privilege then n := n + 1; end;
  if public.appt_doc_can_write(p_pend) then raise exception 'FAIL: B satisfies write rule for A'; end if; n := n + 1;

  -------------------------------------------------------------- B cannot make a visit adopt A's document (and so cannot "attach" to read it)
  reset role;
  begin insert into visit (family_id, date, scheduled_start, document_path) values (fb, current_date, now(), p_pend);
    raise exception 'FAIL: visit accepted another family''s document path';
  exception when check_violation then n := n + 1; end;
  insert into visit (family_id, date, scheduled_start) values (fa, current_date, now()); n := n + 1; -- null path stays valid

  -------------------------------------------------------------- detaching returns the document to PENDING
  delete from visit where id = va;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_att;
  if c <> 0 then raise exception 'FAIL: detached document still readable by a member'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_att;
  if c <> 1 then raise exception 'FAIL: uploader lost access to detached document'; end if; n := n + 1;

  reset role;
  raise exception 'PASS: % assertions', n;
end
$test$;
