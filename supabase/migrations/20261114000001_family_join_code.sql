-- Join an existing family with a FAMILY CODE. NOT APPLIED by the build lane: review, then apply to pendia-hackathon-test first; any shared database
-- needs separate authorization. Synthetic data only.
--
-- Model: a family code only says WHERE a request goes. It never grants membership. An authenticated person with a VERIFIED email submits a
-- request; an organizer of that family approves or declines it; approval (atomic, single-use) inserts a plain Member row for that account.
--   code        : 12 random characters (60 bits), shown to the organizer once; only its SHA-256 is stored, so it cannot be read back (rotate to get a new one)
--   request     : sees NOTHING about the family (no name, members, patient or permissions) until approved; the answer is only "pending/declined/approved"
--   attempts    : every wrong code is logged; 8 wrong codes per account per hour => 'too_many_attempts' (fails closed even for a correct code)
--   approval    : organizer of THAT family only; request row is locked, so two organizers or a replay cannot approve twice; the new member row has
--                 role member, the viewing flags the organizer chose, and can_upload_documents left at its default (off)
-- Clients have no direct access to the three tables; every operation is a SECURITY DEFINER function with a fixed search path.
-- DEPENDENCIES: public.family, public.member, public.is_family_organizer(uuid), the unique index member_family_user_uniq (phase-1 hardening).
-- No dependency on, and no conflict with, the invitation migration 20261113000001 (family_invite*): different objects. member.user_id stays protected:
-- the insert below runs inside a definer function owned by the migration role, the same way accept_family_invite links an account. Re-running is safe.

begin;

create table if not exists public.family_join_code (
  family_id uuid primary key references public.family(id) on delete cascade,
  code_hash bytea not null unique,
  enabled boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

create table if not exists public.family_join_request (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null check (char_length(btrim(requester_name)) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'canceled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  member_id uuid references public.member(id) on delete set null
);
-- one open request per person per family: repeating a request cannot stack up
create unique index if not exists family_join_request_one_pending on public.family_join_request (family_id, user_id) where status = 'pending';
create index if not exists family_join_request_user_idx on public.family_join_request (user_id, created_at desc);
create index if not exists family_join_request_family_idx on public.family_join_request (family_id, status);

create table if not exists public.family_join_attempt (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists family_join_attempt_user_idx on public.family_join_attempt (user_id, created_at desc);

alter table public.family_join_code enable row level security;
alter table public.family_join_request enable row level security;
alter table public.family_join_attempt enable row level security;
-- no policies and no grants: only the functions below can touch these tables
revoke all on public.family_join_code, public.family_join_request, public.family_join_attempt from anon, public, authenticated;

------------------------------------------------------------------ helpers (not callable by clients)
-- upper-case, drop separators, map the look-alikes (O->0, I/L->1); the hash is over the cleaned 12 characters
create or replace function public.family_join_code_normalize(_code text) returns text
language sql immutable set search_path = public as $$
  select translate(regexp_replace(upper(coalesce(_code, '')), '[^A-Z0-9]', '', 'g'), 'OIL', '011')
$$;
create or replace function public.family_join_code_hash(_code text) returns bytea
language sql immutable set search_path = public as $$
  select sha256(convert_to(public.family_join_code_normalize(_code), 'UTF8'))
$$;

------------------------------------------------------------------ organizer functions
-- Creates or replaces the family's code (turning it on) and returns it ONCE as XXXX-XXXX-XXXX. The previous code stops working immediately.
create or replace function public.rotate_family_join_code(_family_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   -- 32 symbols, no I L O U
  raw bytea; code text := ''; i int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_family_organizer(_family_id) then
    raise exception 'Only an organizer can manage the family code.' using errcode = '42501';
  end if;
  raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');            -- 16 random bytes from the server's strong generator
  for i in 0..11 loop code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1); end loop;   -- 256 is a multiple of 32: no bias
  insert into public.family_join_code (family_id, code_hash, enabled, created_by)
  values (_family_id, public.family_join_code_hash(code), true, uid)
  on conflict (family_id) do update set code_hash = excluded.code_hash, enabled = true, created_by = uid, rotated_at = now();
  return substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4);
end $$;

create or replace function public.disable_family_join_code(_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_family_organizer(_family_id) then
    raise exception 'Only an organizer can manage the family code.' using errcode = '42501';
  end if;
  update public.family_join_code set enabled = false where family_id = _family_id;
end $$;

-- Whether a code exists and is on; never the code itself.
create or replace function public.family_join_code_status(_family_id uuid)
returns table (enabled boolean, rotated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_family_organizer(_family_id) then
    raise exception 'Only an organizer can manage the family code.' using errcode = '42501';
  end if;
  return query select c.enabled, c.rotated_at from public.family_join_code c where c.family_id = _family_id;
end $$;

create or replace function public.family_join_requests(_family_id uuid)
returns table (request_id uuid, requester_name text, requester_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_family_organizer(_family_id) then
    raise exception 'Only an organizer can see join requests.' using errcode = '42501';
  end if;
  return query
    select r.id, r.requester_name, lower(u.email), r.created_at
    from public.family_join_request r join auth.users u on u.id = r.user_id
    where r.family_id = _family_id and r.status = 'pending'
    order by r.created_at;
end $$;

-- Approve (creates the Member row) or decline. Single-use: only a PENDING request can be decided, and the row is locked while it is.
create or replace function public.decide_join_request(_request_id uuid, _approve boolean,
    _can_see_meds boolean default true, _can_see_schedule boolean default true, _can_see_visits boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.family_join_request; confirmed timestamptz; new_member uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into r from public.family_join_request where id = _request_id for update;
  if not found or not public.is_family_organizer(r.family_id) then
    raise exception 'Only an organizer can decide join requests.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'request_not_pending' using errcode = 'P0001'; end if;
  if not _approve then
    update public.family_join_request set status = 'declined', decided_at = now(), decided_by = uid where id = r.id;
    return null;
  end if;
  select u.email_confirmed_at into confirmed from auth.users u where u.id = r.user_id;
  if confirmed is null then raise exception 'email_unverified' using errcode = 'P0001'; end if;
  if exists (select 1 from public.member x where x.family_id = r.family_id and x.user_id = r.user_id) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  -- role member; the three viewing flags are the organizer's choice; every other column (including can_upload_documents) keeps its default
  insert into public.member (family_id, user_id, name, role, can_see_meds, can_see_schedule, can_see_visits)
  values (r.family_id, r.user_id, btrim(r.requester_name), 'member',
          coalesce(_can_see_meds, false), coalesce(_can_see_schedule, false), coalesce(_can_see_visits, false))
  returning id into new_member;
  update public.family_join_request set status = 'approved', decided_at = now(), decided_by = uid, member_id = new_member where id = r.id;
  return new_member;
end $$;

------------------------------------------------------------------ requester functions (verified account; no family information is ever returned)
-- Returns the request id, or NULL when the code did not work (wrong, switched off, replaced, or a recent decline): one answer for all of them.
create or replace function public.request_to_join_family(_code text, _name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); confirmed timestamptz; clean text; fam uuid; nm text := btrim(coalesce(_name, '')); rid uuid; fails int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select u.email_confirmed_at into confirmed from auth.users u where u.id = uid;
  if confirmed is null then raise exception 'email_unverified' using errcode = 'P0001'; end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then raise exception 'name_required' using errcode = '23514'; end if;
  delete from public.family_join_attempt where user_id = uid and created_at < now() - interval '2 days';
  select count(*) into fails from public.family_join_attempt where user_id = uid and created_at > now() - interval '1 hour';
  if fails >= 8 then raise exception 'too_many_attempts' using errcode = 'P0001'; end if;
  clean := public.family_join_code_normalize(_code);
  select c.family_id into fam from public.family_join_code c
   where c.enabled and char_length(clean) = 12 and c.code_hash = public.family_join_code_hash(clean);
  if fam is null then
    -- the attempt is logged and the function RETURNS (a raise would roll the log back); null = "that code did not work", said the same way
    -- whether the code is wrong, switched off or replaced
    insert into public.family_join_attempt (user_id) values (uid);
    return null;
  end if;
  if exists (select 1 from public.member x where x.family_id = fam and x.user_id = uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if (select count(*) from public.family_join_request where user_id = uid and status = 'pending') >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  -- a declined request cannot be resubmitted straight away
  if exists (select 1 from public.family_join_request where family_id = fam and user_id = uid and status = 'declined' and decided_at > now() - interval '24 hours') then
    return null;
  end if;
  insert into public.family_join_request (family_id, user_id, requester_name) values (fam, uid, nm)
  on conflict (family_id, user_id) where status = 'pending' do nothing returning id into rid;
  if rid is null then select id into rid from public.family_join_request where family_id = fam and user_id = uid and status = 'pending'; end if;
  return rid;
end $$;

create or replace function public.my_join_requests()
returns table (request_id uuid, status text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select r.id, r.status, r.created_at, r.decided_at from public.family_join_request r
    where r.user_id = auth.uid() and r.created_at > now() - interval '30 days' order by r.created_at desc;
end $$;

create or replace function public.cancel_join_request(_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.family_join_request;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into r from public.family_join_request where id = _request_id and user_id = uid for update;
  if not found or r.status <> 'pending' then raise exception 'request_not_pending' using errcode = 'P0001'; end if;
  update public.family_join_request set status = 'canceled', decided_at = now() where id = r.id;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'rotate_family_join_code(uuid)', 'disable_family_join_code(uuid)', 'family_join_code_status(uuid)', 'family_join_requests(uuid)',
    'decide_join_request(uuid, boolean, boolean, boolean, boolean)', 'request_to_join_family(text, text)', 'my_join_requests()', 'cancel_join_request(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
revoke all on function public.family_join_code_normalize(text) from public, anon, authenticated;
revoke all on function public.family_join_code_hash(text) from public, anon, authenticated;

commit;
