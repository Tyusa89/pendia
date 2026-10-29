-- Appointment-document storage RLS + visit.document_path integrity. Synthetic users/paths only; no file bytes.
-- REQUIRES migration 20261029000001_appointment_documents.sql to be applied first. Always ends with an exception so nothing persists.
-- Pass => message starts with 'PASS'. Fail => 'FAIL: <assertion>'. (DELETE policy is checked via appt_doc_can_write, as in storage.test.sql.)
do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uj uuid := gen_random_uuid();
  fa uuid; fb uuid; da uuid := gen_random_uuid(); db uuid := gen_random_uuid();
  pa text; pb text; n int := 0; c int;
begin
  perform 1 from storage.buckets where id = 'appointment-docs' and public = false and file_size_limit = 10485760
     and allowed_mime_types @> array['application/pdf','image/jpeg','image/png'];
  if not found then raise exception 'FAIL: bucket missing, public, or misconfigured'; end if; n := n + 1;

  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid'),
    (uj, 'authenticated', 'authenticated', 'j-' || uj || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer'), (fb, ub, 'Org B', 'organizer');
  insert into member (family_id, user_id, name, role, can_see_schedule, can_see_visits) values (fa, uj, 'Jen A', 'member', true, false);
  pa := fa || '/doc/' || da || '/letter.pdf';
  pb := fb || '/doc/' || db || '/letter.png';
  insert into storage.objects (bucket_id, name) values ('appointment-docs', pa), ('appointment-docs', pb);

  select count(*) into c from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('appointment docs read','appointment docs insert','appointment docs update','appointment docs delete') and roles = '{authenticated}';
  if c <> 4 then raise exception 'FAIL: expected 4 policies, found %', c; end if; n := n + 1;

  if public.appt_doc_path_family(pa) is distinct from fa then raise exception 'FAIL: parser misses family'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/doc/' || da || '/../x.pdf') is not null then raise exception 'FAIL: ".." accepted'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/doc/' || da || '/letter.exe') is not null then raise exception 'FAIL: bad extension accepted'; end if; n := n + 1;
  if public.appt_doc_path_family(fa || '/handoff/' || da || '/letter.pdf') is not null then raise exception 'FAIL: wrong entity accepted'; end if; n := n + 1;
  if public.appt_doc_path_family('loose.pdf') is not null then raise exception 'FAIL: unscoped path accepted'; end if; n := n + 1;

  -- Family B organizer: cannot see or write A's folder
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = pa;
  if c <> 0 then raise exception 'FAIL: B can read A document'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = pb;
  if c <> 1 then raise exception 'FAIL: B cannot read own document'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/x.pdf');
    raise exception 'FAIL: B uploaded into A folder';
  exception when insufficient_privilege then n := n + 1; end;
  if public.appt_doc_can_write(pa) then raise exception 'FAIL: B satisfies write rule for A'; end if; n := n + 1;

  -- Family A member without visits visibility: no read, no write
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = pa;
  if c <> 0 then raise exception 'FAIL: member without visits visibility reads document'; end if; n := n + 1;

  -- Family A organizer: reads and writes own folder only
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name in (pa, pb);
  if c <> 1 then raise exception 'FAIL: A organizer sees % documents (expected 1)', c; end if; n := n + 1;
  insert into storage.objects (bucket_id, name) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/x.jpg'); n := n + 1;
  if not public.appt_doc_can_write(pa) then raise exception 'FAIL: A organizer fails write rule'; end if; n := n + 1;

  -- visit.document_path: own family ok; other family's path rejected by the check constraint
  reset role;
  insert into visit (family_id, date, scheduled_start, document_path) values (fa, current_date, now(), pa); n := n + 1;
  begin insert into visit (family_id, date, scheduled_start, document_path) values (fa, current_date, now(), pb);
    raise exception 'FAIL: visit accepted another family''s document path';
  exception when check_violation then n := n + 1; end;
  insert into visit (family_id, date, scheduled_start) values (fa, current_date, now()); n := n + 1; -- null path stays valid

  raise exception 'PASS: % assertions', n;
end
$test$;
