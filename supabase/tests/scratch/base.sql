-- Scratch stand-in for the pre-hardening schema (columns and base constraints, no policies); the repo migrations are replayed on top.
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema if not exists auth; create table auth.users (id uuid primary key, aud text, role text, email text, email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
grant usage on schema auth, public to authenticated, anon; grant select on auth.users to authenticated;
create table public.care_recipient (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "name" text not null,
  "notes" text,
  "created_at" timestamp with time zone not null default now(),
  primary key (id)
);
create table public.digest (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "week" date not null,
  "member_id" uuid,
  "text" text not null,
  "language" text not null default 'en'::text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  primary key (id)
);
create table public.family (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "created_by" uuid,
  "is_demo" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "timezone" text not null default 'America/New_York'::text,
  primary key (id)
);
create table public.handoff (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "shift_id" uuid,
  "author_member_id" uuid,
  "ate" boolean,
  "meds_taken" boolean,
  "unusual" text,
  "watch_answers" jsonb not null default '{}'::jsonb,
  "note" text,
  "created_at" timestamp with time zone not null default now(),
  "audio_path" text,
  "audio_mime" text,
  "audio_size_bytes" bigint,
  "audio_wav_path" text,
  "audio_wav_mime" text,
  "audio_wav_size_bytes" bigint,
  "duration_seconds" numeric,
  primary key (id)
);
create table public.med_change (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "visit_id" uuid,
  "medication" text not null,
  "before" text,
  "after" text,
  "speaker_label" text,
  "status" text not null default 'pending'::text,
  "confirmed_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "source_seconds" numeric,
  "confirmed_at" timestamp with time zone,
  "unclear" boolean not null default false,
  primary key (id)
);
create table public.medication (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "name" text not null,
  "dose" text,
  "schedule" text,
  "status" text not null default 'active'::text,
  "created_at" timestamp with time zone not null default now(),
  primary key (id)
);
create table public.member (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "user_id" uuid,
  "name" text not null,
  "phone" text,
  "language" text not null default 'en'::text,
  "role" text not null default 'member'::text,
  "can_see_meds" boolean not null default true,
  "can_see_schedule" boolean not null default true,
  "can_see_visits" boolean not null default true,
  "created_at" timestamp with time zone not null default now(),
  primary key (id)
);
create table public.shift (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "start" timestamp with time zone not null,
  "end" timestamp with time zone not null,
  "assigned_member_id" uuid,
  "status" text not null default 'open'::text,
  "created_at" timestamp with time zone not null default now(),
  primary key (id)
);
create table public.task (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "title" text not null,
  "owner_member_id" uuid,
  "due_date" date,
  "source_visit_id" uuid,
  "status" text not null default 'open'::text,
  "created_at" timestamp with time zone not null default now(),
  "source_seconds" numeric,
  "speaker_label" text,
  "unclear" boolean not null default false,
  "completed_at" timestamp with time zone,
  primary key (id)
);
create table public.visit (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "date" date not null,
  "doctor" text,
  "audio_url" text,
  "transcript" jsonb not null default '[]'::jsonb,
  "summary" text,
  "created_at" timestamp with time zone not null default now(),
  "consent_at" timestamp with time zone,
  "consent_by" uuid,
  "consent_text" text,
  "audio_path" text,
  "duration_seconds" numeric,
  "speaker_map" jsonb not null default '{}'::jsonb,
  "speaker_map_confirmed_by" uuid,
  "speaker_map_confirmed_at" timestamp with time zone,
  primary key (id)
);
create table public.watch_item (
  "id" uuid not null default gen_random_uuid(),
  "family_id" uuid not null,
  "text" text not null,
  "ends_on" date,
  "source_visit_id" uuid,
  "created_at" timestamp with time zone not null default now(),
  "source_seconds" numeric,
  "speaker_label" text,
  "unclear" boolean not null default false,
  "status" text not null default 'active'::text,
  "confirmed_by" uuid,
  "confirmed_at" timestamp with time zone,
  primary key (id)
);
alter table public.care_recipient add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.digest add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.digest add foreign key ("member_id") references public.member(id) on delete set null;
alter table public.handoff add foreign key ("author_member_id") references public.member(id) on delete set null;
alter table public.handoff add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.handoff add foreign key ("shift_id") references public.shift(id) on delete set null;
alter table public.med_change add foreign key ("confirmed_by") references public.member(id) on delete set null;
alter table public.med_change add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.med_change add foreign key ("visit_id") references public.visit(id) on delete cascade;
alter table public.medication add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.member add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.shift add foreign key ("assigned_member_id") references public.member(id) on delete set null;
alter table public.shift add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.task add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.task add foreign key ("owner_member_id") references public.member(id) on delete set null;
alter table public.task add foreign key ("source_visit_id") references public.visit(id) on delete set null;
alter table public.visit add foreign key ("consent_by") references public.member(id) on delete set null;
alter table public.visit add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.visit add foreign key ("speaker_map_confirmed_by") references public.member(id) on delete set null;
alter table public.watch_item add foreign key ("confirmed_by") references public.member(id) on delete set null;
alter table public.watch_item add foreign key ("family_id") references public.family(id) on delete cascade;
alter table public.watch_item add foreign key ("source_visit_id") references public.visit(id) on delete set null;
alter table public.digest add check (language in ('en','es'));
alter table public.med_change add check (status in ('pending','confirmed','dismissed'));
alter table public.medication add check (status in ('active','paused','stopped'));
alter table public.member add check (language in ('en','es'));
alter table public.member add check (role in ('organizer','member'));
alter table public.shift add check (status in ('open','claimed','swap'));
alter table public.task add check (status in ('draft','open','done'));
alter table public.watch_item add check (status in ('draft','active','dismissed'));
alter table public.care_recipient enable row level security;
alter table public.digest enable row level security;
alter table public.family enable row level security;
alter table public.handoff enable row level security;
alter table public.med_change enable row level security;
alter table public.medication enable row level security;
alter table public.member enable row level security;
alter table public.shift enable row level security;
alter table public.task enable row level security;
alter table public.visit enable row level security;
alter table public.watch_item enable row level security;
create or replace function public.is_family_member(_family_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$ select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid()) $$;
create or replace function public.is_family_organizer(_family_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$ select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid() and role = 'organizer') $$;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
-- the live project also lets the API roles execute public functions by default
grant execute on all functions in schema public to anon, authenticated, public;
alter default privileges in schema public grant execute on functions to anon, authenticated, public;
