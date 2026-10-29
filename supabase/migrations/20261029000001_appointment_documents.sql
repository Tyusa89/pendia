-- Document Upload MVP: a private bucket for appointment letters (PDF / JPG / PNG) and a nullable visit.document_path.
-- NOT APPLIED by the build lane. Review, then apply once (Lovable SQL editor or migration tool). Synthetic data only.
-- Path scheme: {family_id}/doc/{document_id}/{safe-file-name}
--   read   : family members who may see visits   (member_can_see(family, 'visits'))
--   write  : organizer of the path's family only (insert / update / delete)
-- A document is "pending" until a visit row references it (the caregiver pressing "Add appointment" is the confirmation that
-- creates that row); nothing in the database exists before then.
--   pending  (no visit references the path): readable ONLY by the organizer who uploaded it (storage.objects owner = auth.uid())
--   attached (a visit in the SAME family references the path): readable by members who may see visits, as above

begin;

------------------------------------------------------------------ bucket (private, 10 MB, three types)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('appointment-docs', 'appointment-docs', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

------------------------------------------------------------------ visit.document_path (nullable)
alter table public.visit add column if not exists document_path text;

------------------------------------------------------------------ path helper
-- Valid only for uuid/doc/uuid/safe-file-name with an allowed extension. Anything else yields NULL (denied).
create or replace function public.appt_doc_path_family(p text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/doc/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,78}\.(pdf|jpe?g|png)$'
         and p !~ '\.\.'
    then split_part(p, '/', 1)::uuid
  end
$$;

-- True once a visit in the path's own family references the path. security definer: the check must not depend on the caller's visit RLS.
create or replace function public.appt_doc_is_attached(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.visit v
    where v.document_path = p and v.family_id = public.appt_doc_path_family(p)
  ), false)
$$;

-- `uploader` is storage.objects.owner_id (set by the Storage API from the caller's JWT; never client-supplied).
create or replace function public.appt_doc_can_read(p text, uploader text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when public.appt_doc_is_attached(p)
        then public.member_can_see(public.appt_doc_path_family(p), 'visits')
      else public.is_family_organizer(public.appt_doc_path_family(p))
           and uploader is not null and uploader = auth.uid()::text
    end, false)
$$;

create or replace function public.appt_doc_can_write(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_family_organizer(public.appt_doc_path_family(p)), false)
$$;

------------------------------------------------------------------ storage RLS
drop policy if exists "appointment docs read"   on storage.objects;
drop policy if exists "appointment docs insert" on storage.objects;
drop policy if exists "appointment docs update" on storage.objects;
drop policy if exists "appointment docs delete" on storage.objects;

create policy "appointment docs read" on storage.objects for select to authenticated
  using (bucket_id = 'appointment-docs' and public.appt_doc_can_read(name, owner_id));

create policy "appointment docs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'appointment-docs' and public.appt_doc_can_write(name));

-- WITH CHECK re-evaluates the NEW name, so an object can never be renamed into another family's folder.
create policy "appointment docs update" on storage.objects for update to authenticated
  using (bucket_id = 'appointment-docs' and public.appt_doc_can_write(name))
  with check (bucket_id = 'appointment-docs' and public.appt_doc_can_write(name));

create policy "appointment docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'appointment-docs' and public.appt_doc_can_write(name));


-- A visit can only point at a document inside its OWN family's folder (needs appt_doc_path_family, created above).
alter table public.visit drop constraint if exists visit_document_path_family_check;
alter table public.visit add constraint visit_document_path_family_check
  check (document_path is null or public.appt_doc_path_family(document_path) = family_id);

commit;
