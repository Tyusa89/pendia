-- I-1: caregiver relationship + access window on `member`, single-use invitation links, a protected member directory,
-- and the member.user_id lock. Additive: existing rows keep today's behavior (family/friend, active, no dates).
--
--   * relationship (family_friend | professional | agency) is a LABEL. It never authorizes anything. Role and the three
--     visibility switches stay the only privileges. agency_name is display text, never used for authorization.
--   * access_status / access_starts_at / access_ends_at are the AUTHORIZATION WINDOW. The helper functions every policy
--     uses (is_family_member, is_family_organizer, member_can_see) now require a current window, so ending or expiring
--     access takes effect everywhere at once, at query time, with no scheduled job. Rows are never deleted by this, so
--     shifts, handoffs and confirmations keep their person.
--   * An invitation (family_invite) expires after 7 days. That is separate from the access window above.
--   * member.user_id can no longer be set by client roles except: the family creator's own organizer row, or through
--     accept_family_invite(). The rule keys off the connected database role (current_user), never a session variable, so
--     it cannot be switched on from a request.
--   * Members read the roster through family_directory() (name, role, relationship only). The member table itself is
--     readable only by organizers and the person themself, so phone, email, permissions and dates stay private.
-- Synthetic data only. Not applied to any shared database by this PR.

begin;

------------------------------------------------------------------ member: relationship + access window
alter table public.member
  add column if not exists relationship text not null default 'family_friend',
  add column if not exists agency_name text,
  add column if not exists access_status text not null default 'active',
  add column if not exists access_starts_at timestamptz,
  add column if not exists access_ends_at timestamptz,
  -- professional/agency access must record an explicit choice: an end date, or "until removed"
  add column if not exists access_until_removed boolean not null default false;

alter table public.member drop constraint if exists member_relationship_check;
alter table public.member add constraint member_relationship_check
  check (relationship in ('family_friend', 'professional', 'agency'));
alter table public.member drop constraint if exists member_access_status_check;
alter table public.member add constraint member_access_status_check
  check (access_status in ('active', 'suspended', 'ended'));
alter table public.member drop constraint if exists member_access_window_check;
alter table public.member add constraint member_access_window_check
  check (access_starts_at is null or access_ends_at is null or access_ends_at > access_starts_at);
alter table public.member drop constraint if exists member_agency_name_check;
alter table public.member add constraint member_agency_name_check
  check (agency_name is null or char_length(agency_name) between 1 and 120);
-- Being a professional or agency contact never carries management privilege.
alter table public.member drop constraint if exists member_relationship_role_check;
alter table public.member add constraint member_relationship_role_check
  check (relationship = 'family_friend' or role = 'member');
alter table public.member drop constraint if exists member_duration_choice_check;
alter table public.member add constraint member_duration_choice_check
  check (relationship = 'family_friend' or access_ends_at is not null or access_until_removed);
-- lets family_invite point at (member, family) together, so an invite can never cross families
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'member_id_family_uniq' and conrelid = 'public.member'::regclass) then
    alter table public.member add constraint member_id_family_uniq unique (id, family_id);
  end if;
end $$;

------------------------------------------------------------------ the authorization window
create or replace function public.member_is_current(_status text, _starts timestamptz, _ends timestamptz)
returns boolean language sql stable as $$
  select _status = 'active'
     and (_starts is null or _starts <= now())
     and (_ends is null or _ends > now())
$$;

create or replace function public.member_access_state(_user_id uuid, _status text, _starts timestamptz, _ends timestamptz)
returns text language sql stable as $$
  select case
    when _status = 'ended' then 'ended'
    when _status = 'suspended' then 'suspended'
    when _user_id is null then 'not_joined'
    when _starts is not null and _starts > now() then 'scheduled'
    when _ends is not null and _ends <= now() then 'expired'
    else 'active' end
$$;

-- Same signatures and bodies as before, plus the window. Every existing policy keeps working unchanged.
create or replace function public.is_family_member(_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member m
    where m.family_id = _family_id and m.user_id = auth.uid()
      and public.member_is_current(m.access_status, m.access_starts_at, m.access_ends_at))
$$;

create or replace function public.is_family_organizer(_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member m
    where m.family_id = _family_id and m.user_id = auth.uid() and m.role = 'organizer'
      and public.member_is_current(m.access_status, m.access_starts_at, m.access_ends_at))
$$;

create or replace function public.member_can_see(_family_id uuid, _what text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member m
    where m.family_id = _family_id and m.user_id = auth.uid()
      and public.member_is_current(m.access_status, m.access_starts_at, m.access_ends_at)
      and (m.role = 'organizer' or case _what
             when 'meds' then m.can_see_meds
             when 'schedule' then m.can_see_schedule
             when 'visits' then m.can_see_visits
             else false end)
  )
$$;

------------------------------------------------------------------ member.user_id lock (no session variables)
-- Only trusted server roles and SECURITY DEFINER functions owned by them (join_demo_family, accept_family_invite) run as
-- one of the roles below. Everyone else, including organizers, runs as `authenticated`/`anon` and is held to the rule.
-- Deny by default: an unlisted role is restricted too.
create or replace function public.member_user_id_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is null then return new; end if;
    -- the family creator adding their own organizer row (mirrors the insert policy)
    if new.user_id = auth.uid() and new.role = 'organizer'
       and exists (select 1 from public.family f where f.id = new.family_id and f.created_by = auth.uid()) then
      return new;
    end if;
    raise exception 'A member can only be linked to an account by accepting an invitation.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'A member can only be linked to an account by accepting an invitation.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists member_user_id_guard on public.member;
create trigger member_user_id_guard before insert or update on public.member
  for each row execute function public.member_user_id_guard();

-- A family always keeps at least one current organizer: the last one cannot be demoted, ended, suspended or deleted.
-- (Deleting a whole family cascades to its members; the family row is already gone then, so that is allowed.)
create or replace function public.member_last_organizer_guard() returns trigger
language plpgsql set search_path = public as $$
declare keeps boolean;
begin
  if old.role <> 'organizer' or old.user_id is null
     or not public.member_is_current(old.access_status, old.access_starts_at, old.access_ends_at) then
    return coalesce(new, old);
  end if;
  keeps := tg_op = 'UPDATE' and new.role = 'organizer' and new.user_id is not null
           and public.member_is_current(new.access_status, new.access_starts_at, new.access_ends_at);
  if keeps then return new; end if;
  if not exists (select 1 from public.family f where f.id = old.family_id) then return coalesce(new, old); end if;
  if not exists (
    select 1 from public.member o
    where o.family_id = old.family_id and o.id <> old.id and o.role = 'organizer' and o.user_id is not null
      and public.member_is_current(o.access_status, o.access_starts_at, o.access_ends_at)) then
    raise exception 'A family needs at least one current organizer.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists member_last_organizer_guard on public.member;
create trigger member_last_organizer_guard before update or delete on public.member
  for each row execute function public.member_last_organizer_guard();

------------------------------------------------------------------ member visibility: organizers and the person themself
-- Everyone else reads names through family_directory(). Phone, email, permissions and access dates stay private.
drop policy if exists "members read members" on public.member;
create policy "organizers and self read members" on public.member for select to authenticated
  using (public.is_family_member(family_id)
         and (user_id = auth.uid() or public.is_family_organizer(family_id)));

------------------------------------------------------------------ invitations
create table public.family_invite (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  member_id uuid not null,
  token_hash bytea not null unique,                       -- sha256 of the token; the token itself is never stored
  invited_email text,                                     -- optional; when set, only this VERIFIED email can accept
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  -- reserved for automated email delivery later; nothing sends anything today
  delivery_status text,
  last_sent_at timestamptz,
  constraint family_invite_member_family foreign key (member_id, family_id)
    references public.member (id, family_id) on delete cascade,
  constraint family_invite_expiry check (expires_at > created_at),
  constraint family_invite_email check (invited_email is null
    or (invited_email = lower(invited_email) and char_length(invited_email) <= 254 and invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  constraint family_invite_delivery check (delivery_status is null or delivery_status in ('not_sent', 'queued', 'sent', 'failed')),
  constraint family_invite_one_outcome check (not (accepted_at is not null and revoked_at is not null))
);
create unique index family_invite_one_pending on public.family_invite (member_id)
  where accepted_at is null and revoked_at is null;
create index family_invite_family_idx on public.family_invite (family_id);

alter table public.family_invite enable row level security;
create policy "organizers read invites" on public.family_invite for select to authenticated
  using (public.is_family_organizer(family_id));
-- No insert/update/delete policy: clients can only use the functions below.
revoke all on public.family_invite from anon, public, authenticated;
grant select (id, family_id, member_id, invited_email, created_by, created_at, expires_at, accepted_at, accepted_by,
              revoked_at, revoked_by, delivery_status, last_sent_at) on public.family_invite to authenticated;

-- True when the person already has a membership in a DIFFERENT family that is not ended and has not run out
-- (a not-yet-started one counts: it will become current). Used to keep the single-family app honest.
create or replace function public.has_other_current_membership(_user_id uuid, _family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member x
    where x.user_id = _user_id and x.family_id <> _family_id
      and x.access_status <> 'ended' and (x.access_ends_at is null or x.access_ends_at > now()))
$$;

------------------------------------------------------------------ invitation functions
-- All SECURITY DEFINER with a fixed search path; each checks authorization itself (definer bypasses RLS).
-- Messages are deliberately generic and never contain the token.

create or replace function public.invite_token_hash(_token text) returns bytea
language sql immutable as $$ select sha256(convert_to(lower(coalesce(_token, '')), 'UTF8')) $$;

create or replace function public.create_family_invite(_member_id uuid, _email text default null) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.member; token text; mail text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into m from public.member where id = _member_id for update;
  if not found or not public.is_family_organizer(m.family_id) then
    raise exception 'Only an organizer can invite people.' using errcode = '42501';
  end if;
  if m.user_id is not null then raise exception 'That person already has an account linked.' using errcode = '23514'; end if;
  if m.role <> 'member' then raise exception 'Invitations can only be created for the Member role.' using errcode = '23514'; end if;
  if m.access_status = 'ended' then raise exception 'Restore this person''s access before inviting them.' using errcode = '23514'; end if;
  mail := nullif(lower(btrim(coalesce(_email, ''))), '');
  -- one pending invite per member: a new link replaces the old one
  update public.family_invite set revoked_at = now(), revoked_by = uid
   where member_id = m.id and accepted_at is null and revoked_at is null;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.family_invite (family_id, member_id, token_hash, invited_email, created_by)
  values (m.family_id, m.id, public.invite_token_hash(token), mail, uid);
  return token;
end $$;

create or replace function public.revoke_family_invite(_invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.family_invite;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into i from public.family_invite where id = _invite_id for update;
  if not found or not public.is_family_organizer(i.family_id) then
    raise exception 'Only an organizer can revoke invitations.' using errcode = '42501';
  end if;
  if i.accepted_at is not null then raise exception 'That invitation was already accepted.' using errcode = '23514'; end if;
  update public.family_invite set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, uid) where id = i.id;
end $$;

-- What a signed-in person may see about an invitation BEFORE accepting: nothing about the care recipient or anyone else.
create or replace function public.preview_family_invite(_token text)
returns table (family_name text, member_name text, relationship text, agency_name text,
               access_starts_at timestamptz, access_ends_at timestamptz, access_until_removed boolean,
               email_bound boolean, email_matches boolean, second_family_blocked boolean, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.family_invite; m public.member; f public.family;
        u_email text; u_confirmed timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into i from public.family_invite where token_hash = public.invite_token_hash(_token);
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  select * into m from public.member where id = i.member_id;
  select * into f from public.family where id = i.family_id;
  select lower(u.email), u.email_confirmed_at into u_email, u_confirmed from auth.users u where u.id = uid;
  return query select f.name, m.name, m.relationship, m.agency_name, m.access_starts_at, m.access_ends_at,
    m.access_until_removed, i.invited_email is not null,
    (i.invited_email is null or (u_confirmed is not null and u_email = i.invited_email)),
    public.has_other_current_membership(uid, i.family_id), i.expires_at;
end $$;

create or replace function public.accept_family_invite(_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.family_invite; m public.member; u_email text; u_confirmed timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  -- lock the invite so two simultaneous accepts cannot both win
  select * into i from public.family_invite where token_hash = public.invite_token_hash(_token) for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if i.invited_email is not null then
    select lower(u.email), u.email_confirmed_at into u_email, u_confirmed from auth.users u where u.id = uid;
    if u_confirmed is null then raise exception 'invite_email_unverified' using errcode = 'P0001'; end if;
    if u_email is distinct from i.invited_email then raise exception 'invite_email_mismatch' using errcode = 'P0001'; end if;
  end if;
  select * into m from public.member where id = i.member_id and family_id = i.family_id for update;
  if not found or m.user_id is not null or m.role <> 'member' or m.access_status = 'ended' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  -- one membership per person per family, including an ended one (the organizer restores that row instead)
  if exists (select 1 from public.member x where x.family_id = i.family_id and x.user_id = uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  -- The app can show one family at a time and has no family switcher yet, so linking a second CURRENT membership would
  -- create access nobody can reach. Refuse it explicitly. Ended or expired memberships do not count.
  if public.has_other_current_membership(uid, i.family_id) then
    raise exception 'invite_second_family' using errcode = 'P0001';
  end if;
  update public.member set user_id = uid where id = m.id;
  update public.family_invite set accepted_at = now(), accepted_by = uid where id = i.id;
  return i.family_id;
end $$;

------------------------------------------------------------------ directory and own memberships
-- The ONLY way a non-organizer reads the roster. Fixed column list: no select *, no phone, email, language,
-- permission switches, user id or access dates. It checks active membership of the family itself.
create or replace function public.family_directory(_family_id uuid)
returns table (id uuid, family_id uuid, name text, role text, relationship text, agency_name text, access_state text)
language sql stable security definer set search_path = public as $$
  select m.id, m.family_id, m.name, m.role, m.relationship, m.agency_name,
         public.member_access_state(m.user_id, m.access_status, m.access_starts_at, m.access_ends_at)
  from public.member m
  where m.family_id = _family_id
    and public.is_family_member(_family_id)
  order by m.created_at, m.id
$$;

-- The caller's own memberships, including ended or not-yet-started ones, so the app can show "your access ended".
create or replace function public.my_memberships()
returns table (member_id uuid, family_id uuid, family_name text, role text, relationship text, access_state text,
               access_starts_at timestamptz, access_ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.family_id, f.name, m.role, m.relationship,
         public.member_access_state(m.user_id, m.access_status, m.access_starts_at, m.access_ends_at),
         m.access_starts_at, m.access_ends_at
  from public.member m join public.family f on f.id = m.family_id
  where m.user_id = auth.uid()
  order by m.created_at, m.id
$$;

------------------------------------------------------------------ execute privileges: signed-in users only
do $$ declare fn text; begin
  foreach fn in array array[
    'create_family_invite(uuid, text)', 'revoke_family_invite(uuid)', 'preview_family_invite(text)',
    'accept_family_invite(text)', 'family_directory(uuid)', 'my_memberships()',
    'invite_token_hash(text)', 'member_is_current(text, timestamptz, timestamptz)',
    'member_access_state(uuid, text, timestamptz, timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
-- internal helper: callable only from the definer functions above, never by a client (it would reveal other people's memberships)
revoke all on function public.has_other_current_membership(uuid, uuid) from public, anon, authenticated;
-- trigger functions are never called directly
revoke all on function public.member_user_id_guard() from public, anon, authenticated;
revoke all on function public.member_last_organizer_guard() from public, anon, authenticated;

commit;
