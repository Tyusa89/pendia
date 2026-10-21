-- Storage-layer RLS + handoff recording integrity tests. Synthetic users/paths only; no audio bytes.
-- Runs inside one DO block that ALWAYS ends with an exception, so nothing persists.
-- Pass => message starts with 'PASS'. Fail => message starts with 'FAIL' and names the assertion.
--
-- Supabase blocks raw DELETE on storage.objects (storage.protect_delete trigger: "use the Storage API"), so the DELETE
-- policy cannot be exercised with SQL. It is verified by (1) asserting it exists in pg_policies and uses
-- recording_can_write(), and (2) evaluating recording_can_write() as each caller, since that is exactly its predicate.
--
-- What this proves: the policies on storage.objects. The storage API checks exactly these before it uploads,
-- lists, deletes, or issues a signed URL (it runs those statements under the caller's own JWT), so "Family B cannot
-- SELECT Family A's object row" is the signed-URL denial. It does NOT exercise the HTTP storage API itself.

do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uj uuid := gen_random_uuid();
  fa uuid; fb uuid; ma uuid; mb uuid; mj uuid;
  ha uuid := gen_random_uuid(); hb uuid := gen_random_uuid(); va uuid := gen_random_uuid();
  pa_o text; pa_w text; pa_v text; pb_o text;
  n int := 0; c int;
begin
  -- bucket configuration
  perform 1 from storage.buckets where id = 'recordings' and public = false and file_size_limit = 41943040
     and allowed_mime_types @> array['audio/webm','audio/mp4','audio/wav'];
  if not found then raise exception 'FAIL: bucket "recordings" missing, public, or misconfigured'; end if; n := n + 1;

  -- fixtures (as the owner role)
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'a-' || ua || '@test.invalid'),
    (ub, 'authenticated', 'authenticated', 'b-' || ub || '@test.invalid'),
    (uj, 'authenticated', 'authenticated', 'j-' || uj || '@test.invalid');
  insert into family (name, created_by) values ('Fam A', ua) returning id into fa;
  insert into family (name, created_by) values ('Fam B', ub) returning id into fb;
  insert into member (family_id, user_id, name, role) values (fa, ua, 'Org A', 'organizer') returning id into ma;
  insert into member (family_id, user_id, name, role) values (fb, ub, 'Org B', 'organizer') returning id into mb;
  insert into member (family_id, user_id, name, role, can_see_schedule, can_see_visits)
    values (fa, uj, 'Jen A', 'member', true, false) returning id into mj;

  pa_o := fa || '/handoff/' || ha || '/original.webm';
  pa_w := fa || '/handoff/' || ha || '/pcm.wav';
  pa_v := fa || '/visit/'   || va || '/original.webm';
  pb_o := fb || '/handoff/' || hb || '/original.webm';
  insert into storage.objects (bucket_id, name) values ('recordings', pa_o), ('recordings', pa_w), ('recordings', pa_v), ('recordings', pb_o);

  -- the four policies exist, are scoped to authenticated, and DELETE uses the same write rule as INSERT/UPDATE
  select count(*) into c from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('recordings read', 'recordings insert', 'recordings update', 'recordings delete')
    and roles = '{authenticated}';
  if c <> 4 then raise exception 'FAIL: expected 4 recordings policies for role authenticated, found %', c; end if; n := n + 1;
  perform 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'recordings delete'
    and cmd = 'DELETE' and qual like '%recording_can_write%';
  if not found then raise exception 'FAIL: DELETE policy does not use recording_can_write'; end if; n := n + 1;

  -- path parser
  if public.recording_path_family(pa_o) is distinct from fa then raise exception 'FAIL: parser misses family'; end if; n := n + 1;
  if public.recording_path_family(fa || '/handoff/' || ha || '/../x') is not null then raise exception 'FAIL: parser accepts ".." path'; end if; n := n + 1;
  if public.recording_path_family(fa || '/photo/' || ha || '/x.webm') is not null then raise exception 'FAIL: parser accepts unknown entity type'; end if; n := n + 1;
  if public.recording_path_family('x/' || ha || '/original.webm') is not null then raise exception 'FAIL: parser accepts non-uuid family'; end if; n := n + 1;

  -------------------------------------------------------------- Family B user vs Family A's recordings
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name in (pa_o, pa_w, pa_v);
  if c <> 0 then raise exception 'FAIL: B can SELECT (=> sign a URL for) A recordings (saw %)', c; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name = pb_o;
  if c <> 1 then raise exception 'FAIL: B cannot read its own recording'; end if; n := n + 1;

  begin insert into storage.objects (bucket_id, name) values ('recordings', fa || '/handoff/' || gen_random_uuid() || '/original.webm');
    raise exception 'FAIL: B uploaded into A''s folder';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into storage.objects (bucket_id, name) values ('recordings', fb || '/photo/' || gen_random_uuid() || '/original.webm');
    raise exception 'FAIL: unknown entity type accepted';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into storage.objects (bucket_id, name) values ('recordings', fb || '/handoff/' || gen_random_uuid() || '/../x');
    raise exception 'FAIL: traversal path accepted';
  exception when insufficient_privilege then n := n + 1; end;
  begin insert into storage.objects (bucket_id, name) values ('recordings', 'loose-file.webm');
    raise exception 'FAIL: unscoped path accepted';
  exception when insufficient_privilege then n := n + 1; end;

  update storage.objects set name = fa || '/handoff/' || ha || '/hijack.webm' where bucket_id = 'recordings' and name = pa_o;
  get diagnostics c = row_count; if c <> 0 then raise exception 'FAIL: B updated A''s object'; end if; n := n + 1;
  begin update storage.objects set name = fa || '/handoff/' || hb || '/moved.webm' where bucket_id = 'recordings' and name = pb_o;
    raise exception 'FAIL: B moved its own object into A''s folder';
  exception when insufficient_privilege then n := n + 1; end;
  -- DELETE rule (see header): B must not satisfy it for A's objects, and must for its own
  if public.recording_can_write(pa_o) or public.recording_can_write(pa_w) or public.recording_can_write(pa_v) then
    raise exception 'FAIL: B satisfies the DELETE/write rule for A''s objects'; end if; n := n + 1;
  insert into storage.objects (bucket_id, name) values ('recordings', fb || '/handoff/' || hb || '/pcm.wav');
  if not public.recording_can_write(fb || '/handoff/' || hb || '/pcm.wav') then raise exception 'FAIL: B cannot delete its own object'; end if; n := n + 1;

  -------------------------------------------------------------- Family A organizer
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name in (pa_o, pa_w, pa_v);
  if c <> 3 then raise exception 'FAIL: A organizer cannot read own recordings (saw %)', c; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name = pb_o;
  if c <> 0 then raise exception 'FAIL: A can read B''s recording'; end if; n := n + 1;
  insert into storage.objects (bucket_id, name) values ('recordings', fa || '/handoff/' || gen_random_uuid() || '/original.webm');
  n := n + 1;
  if not public.recording_can_write(pa_o) then raise exception 'FAIL: A organizer does not satisfy the DELETE/write rule for own object'; end if; n := n + 1;

  -------------------------------------------------------------- Family A member without write access, per-person visibility
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name in (pa_o, pa_w);
  if c <> 2 then raise exception 'FAIL: member with schedule visibility cannot read handoff recordings'; end if; n := n + 1;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name = pa_v;
  if c <> 0 then raise exception 'FAIL: member without visits visibility reads a visit recording'; end if; n := n + 1;
  begin insert into storage.objects (bucket_id, name) values ('recordings', fa || '/handoff/' || gen_random_uuid() || '/original.webm');
    raise exception 'FAIL: non-organizer uploaded';
  exception when insufficient_privilege then n := n + 1; end;
  if public.recording_can_write(pa_o) then raise exception 'FAIL: non-organizer satisfies the DELETE/write rule'; end if; n := n + 1;

  reset role;
  update member set can_see_schedule = false where id = mj;
  perform set_config('request.jwt.claims', json_build_object('sub', uj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from storage.objects where bucket_id = 'recordings' and name in (pa_o, pa_w);
  if c <> 0 then raise exception 'FAIL: revoking schedule visibility did not hide handoff recordings'; end if; n := n + 1;

  -------------------------------------------------------------- anon
  reset role;
  set local role anon;
  select count(*) into c from storage.objects where bucket_id = 'recordings';
  if c <> 0 then raise exception 'FAIL: anon can see recordings'; end if; n := n + 1;
  reset role;

  -------------------------------------------------------------- handoff metadata integrity
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into handoff (id, family_id, author_member_id, ate, meds_taken, audio_path, audio_mime, audio_size_bytes,
                       audio_wav_path, audio_wav_mime, audio_wav_size_bytes, duration_seconds)
  values (ha, fa, ma, true, true, pa_o, 'audio/webm;codecs=opus', 1000, pa_w, 'audio/wav', 2000, 8.25);
  n := n + 1;
  begin update handoff set audio_wav_path = null where id = ha; raise exception 'FAIL: half-set recording reference accepted';
  exception when check_violation then n := n + 1; end;
  begin update handoff set audio_path = fb || '/handoff/' || ha || '/original.webm' where id = ha; raise exception 'FAIL: foreign-family path accepted on a handoff';
  exception when check_violation then n := n + 1; end;
  begin insert into handoff (id, family_id, audio_path, audio_mime, audio_size_bytes, audio_wav_path, audio_wav_mime, audio_wav_size_bytes, duration_seconds)
        values (gen_random_uuid(), fa, pa_o, 'audio/webm', 1, pa_w, 'audio/wav', 1, 1);
    raise exception 'FAIL: path belonging to a different handoff id accepted';
  exception when check_violation then n := n + 1; end;
  update handoff set audio_path = null, audio_mime = null, audio_size_bytes = null, audio_wav_path = null,
                     audio_wav_mime = null, audio_wav_size_bytes = null, duration_seconds = null where id = ha;
  get diagnostics c = row_count; if c <> 1 then raise exception 'FAIL: clearing the recording reference failed'; end if; n := n + 1;
  reset role;

  raise exception 'PASS: % assertions', n;
end
$test$;
