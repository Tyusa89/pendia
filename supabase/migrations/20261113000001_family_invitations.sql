-- Family invitations: email-bound, no invitation token. NOT APPLIED by the build lane. Review, then apply to pendia-hackathon-test first;
-- any shared database needs separate authorization. Synthetic data only.
--
-- Model: authentication proves an EMAIL (Supabase Auth: magic link or password). Authorization to join a family is a separate database
-- row (family_invite) bound to that email and to one existing, unlinked member row. There is no invitation token to leak.
--   create / revoke / resend : organizers of that family only (definer functions check; clients have no write access to the table)
--   see pending invitations  : the signed-in person whose VERIFIED email equals invited_email (my_pending_family_invites)
--   accept                   : explicit, single-use, atomic, expiring (7 days), family-scoped; sets ONLY member.user_id
-- Also closes an existing gap: before this migration an organizer could insert or update member rows with ANY user_id. After it, a member
-- row can only be linked to an account by accept_family_invite (or the family creator adding their own organizer row, or join_demo_family).
-- A person may belong to several families (the app has a family switcher). Existing member permissions (can_see_*, can_upload_documents)
-- are not touched by invitations.
-- RELATION TO 20261022000002 (I-1, still unapplied): this is the smaller, token-free replacement for I-1's INVITATION part. The two define
-- different family_invite tables, so do NOT apply both as they stand: if I-1 is ever approved, its invitation section (table, token functions)
-- must first be removed or reconciled with this one. The user_id guard function below is identical to I-1's. Re-running this file is safe.

begin;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'member_id_family_uniq' and conrelid = 'public.member'::regclass) then
    alter table public.member add constraint member_id_family_uniq unique (id, family_id);
  end if;
end $$;

------------------------------------------------------------------ user_id lock (same logic as 20261022000002)
-- Keyed on the connected database role, not on a session variable: trusted roles and the SECURITY DEFINER functions (owner) may link accounts;
-- every other role, including authenticated and anon, may not.
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
revoke all on function public.member_user_id_guard() from public, anon, authenticated;

------------------------------------------------------------------ the invitation table (no token)
create table if not exists public.family_invite (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  member_id uuid not null,
  invited_email text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  delivery_status text,
  last_sent_at timestamptz,
  constraint family_invite_member_family foreign key (member_id, family_id)
    references public.member (id, family_id) on delete cascade,
  constraint family_invite_expiry check (expires_at > created_at),
  constraint family_invite_email check (invited_email = lower(invited_email) and char_length(invited_email) <= 254
    and invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint family_invite_delivery check (delivery_status is null or delivery_status in ('queued', 'sent', 'failed')),
  constraint family_invite_one_outcome check (not (accepted_at is not null and revoked_at is not null))
);
-- one open (not accepted, not revoked) invitation per member row; an expired one is replaced when a new one is created
create unique index if not exists family_invite_one_open on public.family_invite (member_id) where accepted_at is null and revoked_at is null;
create index if not exists family_invite_family_idx on public.family_invite (family_id);
create index if not exists family_invite_email_idx on public.family_invite (invited_email) where accepted_at is null and revoked_at is null;

alter table public.family_invite enable row level security;
drop policy if exists "organizers read invites" on public.family_invite;
create policy "organizers read invites" on public.family_invite for select to authenticated using (public.is_family_organizer(family_id));
-- no insert/update/delete policy: clients can only use the functions below
revoke all on public.family_invite from anon, public, authenticated;
grant select (id, family_id, member_id, invited_email, created_by, created_at, expires_at, accepted_at, accepted_by,
              revoked_at, revoked_by, delivery_status, last_sent_at) on public.family_invite to authenticated;

------------------------------------------------------------------ functions (SECURITY DEFINER, fixed search path, each checks authorization itself)
-- Messages are deliberately generic: they never reveal who else is in a family or whether an email has an account.

-- Organizer only. Creates (or replaces) the open invitation for one unlinked member row and returns its id. 30-second throttle against spam.
create or replace function public.create_family_invite(_member_id uuid, _email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.member; mail text; new_id uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into m from public.member where id = _member_id for update;
  if not found or not public.is_family_organizer(m.family_id) then
    raise exception 'Only an organizer can invite people.' using errcode = '42501';
  end if;
  if m.user_id is not null then raise exception 'That person already has an account linked.' using errcode = '23514'; end if;
  if m.role <> 'member' then raise exception 'Invitations can only be created for the Member role.' using errcode = '23514'; end if;
  mail := lower(btrim(coalesce(_email, '')));
  if mail = '' or char_length(mail) > 254 or mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = '23514';
  end if;
  -- the same person cannot be invited twice into one family
  if exists (select 1 from public.member x join auth.users u on u.id = x.user_id
             where x.family_id = m.family_id and lower(u.email) = mail) then
    raise exception 'That email already belongs to someone in this family.' using errcode = '23514';
  end if;
  if exists (select 1 from public.family_invite i where i.member_id = m.id and i.created_at > now() - interval '30 seconds') then
    raise exception 'invite_too_soon' using errcode = 'P0001';
  end if;
  update public.family_invite set revoked_at = now(), revoked_by = uid
   where member_id = m.id and accepted_at is null and revoked_at is null;
  insert into public.family_invite (family_id, member_id, invited_email, created_by, delivery_status)
  values (m.family_id, m.id, mail, uid, 'queued') returning id into new_id;
  return new_id;
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

-- Organizer only: records whether the sign-in email left (the server function calls this after sending).
create or replace function public.set_family_invite_delivery(_invite_id uuid, _status text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.family_invite;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if _status not in ('sent', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into i from public.family_invite where id = _invite_id for update;
  if not found or not public.is_family_organizer(i.family_id) then
    raise exception 'Only an organizer can update invitations.' using errcode = '42501';
  end if;
  update public.family_invite set delivery_status = _status, last_sent_at = case when _status = 'sent' then now() else last_sent_at end where id = i.id;
end $$;

-- What the signed-in person may see: ONLY invitations bound to their own VERIFIED email, and only the family name, member name, inviter's
-- name and expiry. Nothing about the care recipient or anyone else.
create or replace function public.my_pending_family_invites()
returns table (invite_id uuid, family_name text, member_name text, invited_by_name text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); u_email text; u_confirmed timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select lower(u.email), u.email_confirmed_at into u_email, u_confirmed from auth.users u where u.id = uid;
  if u_email is null or u_confirmed is null then return; end if;
  return query
    select i.id, f.name, m.name,
           (select x.name from public.member x where x.family_id = i.family_id and x.user_id = i.created_by limit 1),
           i.expires_at
    from public.family_invite i
    join public.family f on f.id = i.family_id
    join public.member m on m.id = i.member_id and m.family_id = i.family_id
    where i.invited_email = u_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      and m.user_id is null and m.role = 'member'
    order by i.created_at desc;
end $$;

-- Explicit, single-use, atomic accept. Sets only member.user_id.
create or replace function public.accept_family_invite(_invite_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.family_invite; m public.member; u_email text; u_confirmed timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  -- lock the invitation so two simultaneous accepts cannot both win
  select * into i from public.family_invite where id = _invite_id for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  select lower(u.email), u.email_confirmed_at into u_email, u_confirmed from auth.users u where u.id = uid;
  if u_confirmed is null then raise exception 'invite_email_unverified' using errcode = 'P0001'; end if;
  if u_email is distinct from i.invited_email then raise exception 'invite_invalid' using errcode = 'P0001'; end if; -- generic on purpose
  select * into m from public.member where id = i.member_id and family_id = i.family_id for update;
  if not found or m.user_id is not null or m.role <> 'member' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  -- one membership per person per family
  if exists (select 1 from public.member x where x.family_id = i.family_id and x.user_id = uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  update public.member set user_id = uid where id = m.id;
  update public.family_invite set accepted_at = now(), accepted_by = uid where id = i.id;
  return i.family_id;
end $$;

do $$ declare fn text; begin
  foreach fn in array array['create_family_invite(uuid, text)', 'revoke_family_invite(uuid)', 'set_family_invite_delivery(uuid, text)',
                            'my_pending_family_invites()', 'accept_family_invite(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

commit;
