-- Family-member document upload capability (builds on 20261029000001_appointment_documents.sql). NOT APPLIED by the build lane.
-- Review, then apply once to pendia-hackathon-test (separate approval for any shared database). Synthetic data only.
--
-- member.can_upload_documents (default false): an ORGANIZER may grant it to a family MEMBER. Organizers always may upload.
-- Who changes it: organizers only, through the existing "organizer update members" policy. A member cannot grant themselves.
--
-- Storage rules after this migration (path scheme unchanged: {family_id}/doc/{document_id}/{safe-file-name}):
--   insert  : organizer of the path's family, OR a member of that family who currently holds can_upload_documents
--   update  : organizer only (unchanged)
--   delete  : organizer (unchanged), OR a granted member removing their OWN document that no visit references yet
--   read, attached (a visit in the same family references the path): members who may see visits (unchanged)
--   read, pending (no visit references it):
--       the organizer who uploaded it                                   (unchanged: organizer-to-organizer pending stays private)
--       NEW: any organizer of the family, when the uploader is a plain family member   (so an organizer can review and confirm it)
--       NEW: the granted member who uploaded it                          (only while the grant lasts)
-- Revocation is immediate: every rule above is evaluated per request from member.can_upload_documents.

begin;

alter table public.member add column if not exists can_upload_documents boolean not null default false;

------------------------------------------------------------------ helpers (security definer: must not depend on the caller's member RLS)
-- The caller is a MEMBER (not organizer) of the family who currently holds the grant.
create or replace function public.appt_doc_is_granted_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.member m
    where m.family_id = fam and m.user_id = auth.uid() and m.role = 'member' and m.can_upload_documents
  ), false) and coalesce(public.is_family_member(fam), false)
$$;

-- `uploader` is storage.objects.owner_id. True when it belongs to a plain member (role 'member') of the path's family.
-- Deliberately independent of the CURRENT grant, so revoking a grant never orphans a document an organizer still has to review.
create or replace function public.appt_doc_uploader_is_member(p text, uploader text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.member m
    where m.family_id = public.appt_doc_path_family(p) and m.user_id is not null
      and m.user_id::text = uploader and m.role = 'member'
  ), false)
$$;

create or replace function public.appt_doc_can_upload(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_family_organizer(public.appt_doc_path_family(p)), false)
      or coalesce(public.appt_doc_is_granted_member(public.appt_doc_path_family(p)), false)
$$;

create or replace function public.appt_doc_can_read(p text, uploader text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when public.appt_doc_is_attached(p)
        then public.member_can_see(public.appt_doc_path_family(p), 'visits')
      else
        -- pending
        (public.is_family_organizer(public.appt_doc_path_family(p)) and uploader is not null and uploader = auth.uid()::text)
        or (public.is_family_organizer(public.appt_doc_path_family(p)) and public.appt_doc_uploader_is_member(p, uploader))
        or (uploader is not null and uploader = auth.uid()::text and public.appt_doc_is_granted_member(public.appt_doc_path_family(p)))
    end, false)
$$;

-- A granted member may remove only their own, still-pending document.
create or replace function public.appt_doc_can_delete(p text, uploader text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.appt_doc_can_write(p)
      or (uploader is not null and uploader = auth.uid()::text
          and not public.appt_doc_is_attached(p)
          and public.appt_doc_is_granted_member(public.appt_doc_path_family(p)))
$$;

------------------------------------------------------------------ storage RLS (insert and delete change; select keeps its policy text)
drop policy if exists "appointment docs insert" on storage.objects;
create policy "appointment docs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'appointment-docs' and public.appt_doc_can_upload(name));

drop policy if exists "appointment docs delete" on storage.objects;
create policy "appointment docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'appointment-docs' and public.appt_doc_can_delete(name, owner_id));

------------------------------------------------------------------ organizer view: member uploads still waiting for confirmation
-- Lists pending documents uploaded by plain members of the family, newest first, for the last 30 days (older ones are left for the
-- normal 24-hour abandoned-upload sweep). Organizer of that family only; anyone else gets nothing.
create or replace function public.pending_member_documents(p_family uuid)
returns table (path text, uploader_member_id uuid, uploader_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.name, m.id, m.name, o.created_at
  from storage.objects o
  join public.member m on m.family_id = p_family and m.user_id is not null and m.user_id::text = o.owner_id and m.role = 'member'
  where public.is_family_organizer(p_family)
    and o.bucket_id = 'appointment-docs'
    and public.appt_doc_path_family(o.name) = p_family
    and not public.appt_doc_is_attached(o.name)
    and o.created_at > now() - interval '30 days'
  order by o.created_at desc
$$;
revoke all on function public.pending_member_documents(uuid) from public, anon;
grant execute on function public.pending_member_documents(uuid) to authenticated;

commit;
