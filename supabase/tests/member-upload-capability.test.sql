-- Family-member document upload capability: ungranted denial, granted upload with the intended reads, immediate denial after
-- revocation, and the privacy boundaries that must NOT change. Synthetic users/paths only; no bytes.
-- REQUIRES 20261029000001_appointment_documents.sql and 20261112000001_member_upload_capability.sql applied first.
-- Always ends with an exception so nothing persists. Pass => message starts with 'PASS'. Fail => 'FAIL: <assertion>'.
do $test$
declare
  uo uuid := gen_random_uuid();  -- organizer of Family A
  uo2 uuid := gen_random_uuid(); -- a second organizer of Family A
  ua uuid := gen_random_uuid();  -- Member A (visits visible; granted during the test)
  ub uuid := gen_random_uuid();  -- Member B (visits visible; never granted)
  ux uuid := gen_random_uuid();  -- organizer of Family B
  fa uuid; fb uuid; ma uuid; mb uuid;
  p_a text; p_org text; p_b text; p_after text; p_x text;
  n int := 0; c int; rc int; va uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (uo, 'authenticated', 'authenticated', 'o-'  || uo  || '@test.invalid'),
    (uo2,'authenticated', 'authenticated', 'o2-' || uo2 || '@test.invalid'),
    (ua, 'authenticated', 'authenticated', 'a-'  || ua  || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-'  || ub  || '@test.invalid'),
    (ux, 'authenticated', 'authenticated', 'x-'  || ux  || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', uo) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ux) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, uo, 'Org A', 'organizer'), (fa, uo2, 'Org A2', 'organizer'), (fb, ux, 'Org B', 'organizer');
  insert into member (family_id, user_id, name, role, can_see_schedule, can_see_visits) values (fa, ua, 'Member A', 'member', true, true) returning id into ma;
  insert into member (family_id, user_id, name, role, can_see_schedule, can_see_visits) values (fa, ub, 'Member B', 'member', true, true) returning id into mb;
  p_a   := fa || '/doc/' || gen_random_uuid() || '/memberA.pdf';
  p_org := fa || '/doc/' || gen_random_uuid() || '/organizer.pdf';
  p_b   := fa || '/doc/' || gen_random_uuid() || '/memberB.pdf';
  p_after := fa || '/doc/' || gen_random_uuid() || '/afterrevoke.pdf';
  p_x   := fb || '/doc/' || gen_random_uuid() || '/other.pdf';

  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'member' and column_name = 'can_upload_documents' and column_default = 'false' and is_nullable = 'NO';
  if not found then raise exception 'FAIL: member.can_upload_documents missing or not "not null default false"'; end if; n := n + 1;
  select count(*) into c from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'appointment docs%' and roles = '{authenticated}';
  if c <> 4 then raise exception 'FAIL: expected 4 appointment docs policies, found %', c; end if; n := n + 1;
  if (select can_upload_documents from member where id = ma) or (select can_upload_documents from member where id = mb) then raise exception 'FAIL: a new member starts granted'; end if; n := n + 1;

  ---------------------------------------------------------------- 1. UNGRANTED member: denied
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_a, ua::text);
    raise exception 'FAIL: ungranted member uploaded';
  exception when insufficient_privilege then n := n + 1; end;
  if public.appt_doc_can_upload(p_a) then raise exception 'FAIL: ungranted member satisfies the upload rule'; end if; n := n + 1;

  ---------------------------------------------------------------- 2. a member cannot grant anyone, including themselves
  update member set can_upload_documents = true where id = ma; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: member changed their own grant'; end if; n := n + 1;
  update member set can_upload_documents = true where id = mb; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: member changed another member grant'; end if; n := n + 1;

  ---------------------------------------------------------------- 3. organizer grants Member A only
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update member set can_upload_documents = true where id = ma and family_id = fa; get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL: organizer could not grant Member A'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update member set can_upload_documents = true where id = mb; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: an organizer of ANOTHER family changed a grant'; end if; n := n + 1;

  ---------------------------------------------------------------- 4. GRANTED Member A: uploads, reads own pending
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_a, ua::text); n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 1 then raise exception 'FAIL: granted member cannot read own pending upload'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_x, ua::text);
    raise exception 'FAIL: granted member uploaded into ANOTHER family folder';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/../x.pdf', ua::text);
    raise exception 'FAIL: granted member uploaded a traversal path';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/loose.pdf', ua::text);
    raise exception 'FAIL: granted member uploaded an unscoped path';
  exception when insufficient_privilege then n := n + 1; end;
  update storage.objects set name = name where bucket_id = 'appointment-docs' and name = p_a; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: granted member updated (overwrote) an object'; end if; n := n + 1;

  ---------------------------------------------------------------- 5. Member B (never granted) cannot read A's pending, cannot upload
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 0 then raise exception 'FAIL: another member reads a granted member pending upload'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_b, ub::text);
    raise exception 'FAIL: Member B (ungranted) uploaded';
  exception when insufficient_privilege then n := n + 1; end;
  delete from storage.objects where bucket_id = 'appointment-docs' and name = p_a; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: another member deleted a pending upload'; end if; n := n + 1;

  ---------------------------------------------------------------- 6. ORGANIZERS of the family read the member's pending upload; organizer-to-organizer privacy is unchanged
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 1 then raise exception 'FAIL: organizer cannot read a member pending upload'; end if; n := n + 1;
  insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_org, uo::text); n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 1 then raise exception 'FAIL: second organizer cannot read a member pending upload'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_org;
  if c <> 0 then raise exception 'FAIL: organizer reads ANOTHER ORGANIZER pending upload (B-14 rule broken)'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_org;
  if c <> 0 then raise exception 'FAIL: granted member reads an organizer pending upload'; end if; n := n + 1;
  delete from storage.objects where bucket_id = 'appointment-docs' and name = p_org; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: granted member deleted an organizer document'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ux, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name in (p_a, p_org);
  if c <> 0 then raise exception 'FAIL: another family organizer reads Family A pending documents'; end if; n := n + 1;

  ---------------------------------------------------------------- 7. organizer view of waiting member uploads
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from public.pending_member_documents(fa) where path = p_a and uploader_name = 'Member A';
  if c <> 1 then raise exception 'FAIL: organizer list lacks the member pending upload'; end if; n := n + 1;
  select count(*) into c from public.pending_member_documents(fa) where path = p_org;
  if c <> 0 then raise exception 'FAIL: organizer list shows an organizer upload'; end if; n := n + 1;
  select count(*) into c from public.pending_member_documents(fb);
  if c <> 0 then raise exception 'FAIL: organizer lists another family'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from public.pending_member_documents(fa);
  if c <> 0 then raise exception 'FAIL: a member can list waiting documents'; end if; n := n + 1;

  ---------------------------------------------------------------- 8. granted member deletes their OWN pending upload; not once attached
  insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/tmp.pdf', ua::text);
  delete from storage.objects where bucket_id = 'appointment-docs' and name like fa || '/doc/%/tmp.pdf'; get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL: granted member cannot remove own pending upload'; end if; n := n + 1;

  ---------------------------------------------------------------- 9. organizer confirms: attaches the document to a visit. Attached rules are unchanged.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into visit (family_id, date, scheduled_start, document_path) values (fa, current_date, now(), p_a) returning id into va; n := n + 1;
  select count(*) into c from public.pending_member_documents(fa) where path = p_a;
  if c <> 0 then raise exception 'FAIL: attached document still listed as waiting'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 1 then raise exception 'FAIL: visits-visible member cannot read an ATTACHED document'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'appointment-docs' and name = p_a; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: granted member deleted an ATTACHED document'; end if; n := n + 1;

  ---------------------------------------------------------------- 10. REVOCATION is immediate
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', p_after, ua::text);  -- still granted: allowed
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update member set can_upload_documents = false where id = ma and family_id = fa; get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL: organizer could not revoke'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('appointment-docs', fa || '/doc/' || gen_random_uuid() || '/late.pdf', ua::text);
    raise exception 'FAIL: revoked member uploaded';
  exception when insufficient_privilege then n := n + 1; end;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_after;
  if c <> 0 then raise exception 'FAIL: revoked member still reads own pending upload'; end if; n := n + 1;
  delete from storage.objects where bucket_id = 'appointment-docs' and name = p_after; get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: revoked member deleted a pending upload'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_a;
  if c <> 1 then raise exception 'FAIL: revoked member lost read of an ATTACHED document they may see through visits'; end if; n := n + 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'appointment-docs' and name = p_after;
  if c <> 1 then raise exception 'FAIL: revoking orphaned a pending upload the organizer still has to review'; end if; n := n + 1;
  select count(*) into c from public.pending_member_documents(fa) where path = p_after;
  if c <> 1 then raise exception 'FAIL: revoked member pending upload missing from the organizer list'; end if; n := n + 1;

  ---------------------------------------------------------------- 11. Member B stayed ungranted throughout
  reset role;
  if (select can_upload_documents from member where id = mb) then raise exception 'FAIL: Member B was granted'; end if; n := n + 1;

  reset role;
  raise exception 'PASS: % assertions', n;
end
$test$;
