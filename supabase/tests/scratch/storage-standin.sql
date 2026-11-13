-- Minimal stand-in for Supabase's `storage` schema, enough to load migration 20261029000001 / 20261112000001 and run
-- appointment-docs.test.sql and member-upload-capability.test.sql on a SCRATCH database. It models only the columns and RLS the
-- tests touch (bucket settings, objects with owner_id and created_at). It proves nothing about real Supabase Storage.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner_id text, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
