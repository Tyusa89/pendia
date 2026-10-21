-- Phase A: persistent handoff audio.
-- One private bucket, family-scoped storage RLS derived from the object path, and recording metadata on handoff.
-- Path scheme: {family_id}/{entity_type}/{entity_id}/{file}   (entity_type: handoff | visit)
-- Synthetic data only.

begin;

------------------------------------------------------------------ bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 41943040,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

------------------------------------------------------------------ path helpers
-- A path is only valid if it matches uuid/(handoff|visit)/uuid/safe-file-name. Everything else yields NULL (denied).
create or replace function public.recording_path_family(p text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(handoff|visit)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_.-]{1,80}$'
         and p !~ '\.\.'
    then split_part(p, '/', 1)::uuid
  end
$$;

create or replace function public.recording_path_type(p text) returns text
language sql immutable set search_path = public as $$
  select case when public.recording_path_family(p) is not null then split_part(p, '/', 2) end
$$;

-- Read: family members who may see that entity type (handoffs follow schedule visibility, visits follow visits visibility).
create or replace function public.recording_can_read(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case public.recording_path_type(p)
      when 'handoff' then public.member_can_see(public.recording_path_family(p), 'schedule')
      when 'visit'   then public.member_can_see(public.recording_path_family(p), 'visits')
    end, false)
$$;

-- Write (insert/update/delete): organizer of the path's family only.
create or replace function public.recording_can_write(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_family_organizer(public.recording_path_family(p)), false)
$$;

------------------------------------------------------------------ storage RLS (storage.objects)
drop policy if exists "recordings read"   on storage.objects;
drop policy if exists "recordings insert" on storage.objects;
drop policy if exists "recordings update" on storage.objects;
drop policy if exists "recordings delete" on storage.objects;

create policy "recordings read" on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and public.recording_can_read(name));

create policy "recordings insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and public.recording_can_write(name));

-- WITH CHECK re-evaluates the NEW name, so an object can never be renamed into another family's folder.
create policy "recordings update" on storage.objects for update to authenticated
  using (bucket_id = 'recordings' and public.recording_can_write(name))
  with check (bucket_id = 'recordings' and public.recording_can_write(name));

create policy "recordings delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and public.recording_can_write(name));

------------------------------------------------------------------ handoff recording metadata
alter table public.handoff
  add column if not exists audio_path text,
  add column if not exists audio_mime text,
  add column if not exists audio_size_bytes bigint,
  add column if not exists audio_wav_path text,
  add column if not exists audio_wav_mime text,
  add column if not exists audio_wav_size_bytes bigint,
  add column if not exists duration_seconds numeric(10, 2);

-- A handoff either has a complete recording reference (original + WAV + metadata) or none.
alter table public.handoff drop constraint if exists handoff_audio_all_or_none;
alter table public.handoff add constraint handoff_audio_all_or_none check (
  (audio_path is null) = (audio_wav_path is null)
  and (audio_path is null) = (duration_seconds is null)
  and (audio_path is null) = (audio_mime is null)
  and (audio_path is null) = (audio_size_bytes is null)
  and (audio_wav_path is null) = (audio_wav_mime is null)
  and (audio_wav_path is null) = (audio_wav_size_bytes is null));

-- Paths must live inside this handoff's own folder: {family_id}/handoff/{handoff_id}/...
alter table public.handoff drop constraint if exists handoff_audio_path_scoped;
alter table public.handoff add constraint handoff_audio_path_scoped check (
  (audio_path is null or audio_path like family_id::text || '/handoff/' || id::text || '/%')
  and (audio_wav_path is null or audio_wav_path like family_id::text || '/handoff/' || id::text || '/%')
  and (audio_path is null or audio_path is distinct from audio_wav_path));

commit;
