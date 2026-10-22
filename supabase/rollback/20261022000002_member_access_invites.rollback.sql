-- Rollback for 20261022000002_member_access_invites.sql. Restores the previous helper functions and member policy and
-- removes everything the migration added. DESTRUCTIVE for the new data only: invitations, relationship, agency name and
-- access dates are dropped. Existing members, shifts, handoffs and everything else are untouched.
-- Run only if no invitation or access-window data needs to be kept. Synthetic data only in tests.
begin;

drop function if exists public.create_family_invite(uuid, text);
drop function if exists public.revoke_family_invite(uuid);
drop function if exists public.preview_family_invite(text);
drop function if exists public.accept_family_invite(text);
drop function if exists public.family_directory(uuid);
drop function if exists public.my_memberships();
drop function if exists public.invite_token_hash(text);
drop table if exists public.family_invite;
drop function if exists public.has_other_current_membership(uuid, uuid);

drop trigger if exists member_user_id_guard on public.member;
drop trigger if exists member_last_organizer_guard on public.member;
drop function if exists public.member_user_id_guard();
drop function if exists public.member_last_organizer_guard();

-- the original read policy (everyone in the family reads every member row)
drop policy if exists "organizers and self read members" on public.member;
create policy "members read members" on public.member for select to authenticated using (public.is_family_member(family_id));

-- the original helper functions, without the access window
create or replace function public.is_family_member(_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid())
$$;
create or replace function public.is_family_organizer(_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid() and role = 'organizer')
$$;
create or replace function public.member_can_see(_family_id uuid, _what text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member m
    where m.family_id = _family_id and m.user_id = auth.uid()
      and (m.role = 'organizer' or case _what
             when 'meds' then m.can_see_meds
             when 'schedule' then m.can_see_schedule
             when 'visits' then m.can_see_visits
             else false end)
  )
$$;
drop function if exists public.member_is_current(text, timestamptz, timestamptz);
drop function if exists public.member_access_state(uuid, text, timestamptz, timestamptz);

alter table public.member
  drop constraint if exists member_duration_choice_check,
  drop constraint if exists member_relationship_role_check,
  drop constraint if exists member_agency_name_check,
  drop constraint if exists member_access_window_check,
  drop constraint if exists member_access_status_check,
  drop constraint if exists member_relationship_check,
  drop constraint if exists member_id_family_uniq,
  drop column if exists access_until_removed,
  drop column if exists access_ends_at,
  drop column if exists access_starts_at,
  drop column if exists access_status,
  drop column if exists agency_name,
  drop column if exists relationship;

commit;
