-- Feature C: structured medication schedules and an append-only log of caregiver REPORTS that a scheduled dose was given or not.
--
-- NOT APPLIED. Merging this file does not approve applying it (see AGENTS.md): a shared-database dry-run and the apply each need the
-- founder's separate approval. Tested on scratch databases only, both with and without the other pending migrations
-- (20261022000001, 20261022000002). Additive: no existing table, policy, trigger or grant is changed.
--
-- WHAT THIS RECORDS: "a family member reported that a dose was given / not given". It is never proof that the medication was taken,
-- is never created by a model, a transcript, a reminder or an acknowledgement, and is kept apart from Feature A's value verification.
--
--   medication_schedule  organizer-defined fixed time of day + weekdays (family-local). Never inferred from free text.
--   dose_administration  append-only reports, corrections and disagreement flags. Written ONLY through the two RPCs below.
--   occurrences          computed, not stored: schedule x date. A dose with no report is reported as 'not_confirmed' by
--                        dose_occurrences(), so an occurrence can never be missing and silence never reads as "given".
--
-- Identity and time are server-made: the reporter comes from auth.uid(), reported_at from now(), scheduled_at from the schedule and
-- the family's time zone. Nonexistent local times (spring forward) are refused, never shifted; repeated times (fall back) use the
-- earlier instant and are flagged, mirroring src/lib/zoned-time.ts.

begin;

------------------------------------------------------------------ helpers
create or replace function public.valid_iso_days(_d smallint[]) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select _d is not null and array_ndims(_d) = 1 and cardinality(_d) between 1 and 7
     and not exists (select 1 from unnest(_d) x where x is null or x not between 1 and 7)
     and (select count(distinct x) from unnest(_d) x) = cardinality(_d)
$$;

-- The instant a family-local wall time happens on a date. time_state: normal | ambiguous (clocks fell back: the earlier instant is
-- used) | skipped (the time does not exist, clocks sprang forward: scheduled_at is null and no report may be made).
create or replace function public.dose_scheduled_at(_date date, _time time, _tz text, out scheduled_at timestamptz, out time_state text)
language plpgsql stable set search_path = pg_catalog, public as $$
declare naive timestamp := _date + _time; t1 timestamptz; cand timestamptz; k interval;
begin
  if _tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = _tz) then
    raise exception 'dose_bad_timezone' using errcode = '22023';
  end if;
  t1 := naive at time zone _tz;
  if (t1 at time zone _tz) is distinct from naive then   -- Postgres silently moves a nonexistent time; we refuse to
    scheduled_at := null; time_state := 'skipped'; return;
  end if;
  scheduled_at := t1; time_state := 'normal';
  foreach k in array array[interval '-1 hour', interval '1 hour', interval '-30 minutes', interval '30 minutes'] loop
    cand := t1 + k;
    if (cand at time zone _tz) = naive then
      time_state := 'ambiguous'; scheduled_at := least(t1, cand);
    end if;
  end loop;
end $$;

------------------------------------------------------------------ tables
create table public.medication_schedule (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  medication_id uuid not null references public.medication(id) on delete cascade,
  local_time time(0) not null,
  days_of_week smallint[] not null,
  starts_on date not null,
  ends_on date,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint medication_schedule_days_valid check (public.valid_iso_days(days_of_week)),
  constraint medication_schedule_dates_valid check (ends_on is null or ends_on >= starts_on)
);
comment on table public.medication_schedule is
  'Organizer-defined fixed time + weekdays, family-local time. ISO weekdays 1=Mon..7=Sun. Never derived from medication.schedule free text.';
create index medication_schedule_family_med on public.medication_schedule (family_id, medication_id);

create table public.dose_administration (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  family_id uuid not null references public.family(id) on delete cascade,
  schedule_id uuid not null references public.medication_schedule(id),
  local_date date not null,
  entry_kind text not null default 'report' check (entry_kind in ('report', 'disagreement')),
  status text check (status in ('given', 'not_given', 'not_confirmed')),
  not_given_reason text check (not_given_reason in ('refused', 'unwell', 'unavailable', 'skipped_on_purpose', 'other')),
  supersedes uuid references public.dose_administration(id),
  disputes uuid references public.dose_administration(id),
  change_reason text check (change_reason in
    ('reported_by_mistake', 'wrong_occurrence', 'information_changed', 'confirmed_after_review', 'late_entry', 'other')),
  outside_window boolean not null default false,
  scheduled_at timestamptz not null,
  tz text not null,
  medication_name text not null,
  dose_text text,
  reported_by uuid not null,       -- member id at the time; deliberately no FK: history must outlive the member
  reporter_name text not null,     -- snapshot, so history stays readable after the member is removed
  reported_at timestamptz not null default now(),
  reported_via text not null default 'app' check (reported_via = 'app'),
  client_request_id uuid not null,
  constraint dose_administration_request_once unique (family_id, client_request_id),
  constraint dose_administration_shape check (
    (entry_kind = 'report' and status is not null and disputes is null)
    or (entry_kind = 'disagreement' and status is null and supersedes is null and disputes is not null
        and not_given_reason is null and change_reason is null)),
  constraint dose_administration_reason_only_for_not_given check (not_given_reason is null or status = 'not_given'),
  constraint dose_administration_retraction_supersedes check (status is distinct from 'not_confirmed' or supersedes is not null),
  constraint dose_administration_outside_window_reason check (not outside_window or change_reason is not null),
  constraint dose_administration_no_self_reference check (supersedes is distinct from id and disputes is distinct from id)
);
comment on table public.dose_administration is
  'Append-only. A family member''s REPORT that a scheduled dose was given / not given, a correction of one, or a disagreement flag. Not proof of ingestion.';
-- one successor per report: two caregivers cannot both extend the same chain
create unique index dose_administration_one_successor on public.dose_administration
  (schedule_id, local_date, coalesce(supersedes, '00000000-0000-0000-0000-000000000000'::uuid)) where entry_kind = 'report';
-- one disagreement flag per person per report
create unique index dose_administration_one_flag_each on public.dose_administration (disputes, reported_by) where entry_kind = 'disagreement';
create index dose_administration_occurrence on public.dose_administration (family_id, schedule_id, local_date, seq);

------------------------------------------------------------------ triggers
-- schedules: server-made creator; same-family medication; no two overlapping schedules for the same medication and time;
-- once a report exists the schedule's meaning is frozen (end it and start a new one instead).
create or replace function public.medication_schedule_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare last_date date;
begin
  if tg_op = 'INSERT' then
    select m.id into new.created_by from public.member m where m.family_id = new.family_id and m.user_id = auth.uid() limit 1;
  else
    new.created_by := old.created_by;
    select max(d.local_date) into last_date from public.dose_administration d where d.schedule_id = old.id;
    if last_date is not null then
      if new.medication_id is distinct from old.medication_id or new.local_time is distinct from old.local_time
         or new.days_of_week is distinct from old.days_of_week or new.starts_on is distinct from old.starts_on then
        raise exception 'dose_schedule_frozen' using errcode = '23514',
          hint = 'Reports exist for this schedule. End it and add a new one.';
      end if;
      if new.ends_on is not null and new.ends_on < last_date then
        raise exception 'dose_schedule_frozen' using errcode = '23514', hint = 'A report exists after that end date.';
      end if;
    end if;
  end if;
  if exists (
    select 1 from public.medication_schedule o
     where o.id is distinct from new.id and o.medication_id = new.medication_id and o.local_time = new.local_time
       and o.days_of_week && new.days_of_week
       and daterange(o.starts_on, o.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
    raise exception 'dose_duplicate_schedule' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger medication_schedule_guard before insert or update on public.medication_schedule
  for each row execute function public.medication_schedule_guard();
create trigger lock_family_id before update on public.medication_schedule
  for each row execute function public.lock_family_id();
create trigger same_family before insert or update on public.medication_schedule
  for each row execute function public.enforce_same_family('medication_id', 'medication');

-- reports: every link stays inside one occurrence of one family
create or replace function public.dose_administration_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare fam uuid; r public.dose_administration;
begin
  select s.family_id into fam from public.medication_schedule s where s.id = new.schedule_id;
  if fam is distinct from new.family_id then
    raise exception 'cross-family reference: dose_administration.schedule_id' using errcode = '23514';
  end if;
  if new.supersedes is not null then
    select * into r from public.dose_administration where id = new.supersedes;
    if not found or r.family_id <> new.family_id or r.schedule_id <> new.schedule_id or r.local_date <> new.local_date
       or r.entry_kind <> 'report' then
      raise exception 'a correction must follow a report of the same occurrence' using errcode = '23514';
    end if;
    if r.status <> 'not_confirmed' and new.change_reason is null then
      raise exception 'a correction needs a reason' using errcode = '23514';
    end if;
  end if;
  if new.disputes is not null then
    select * into r from public.dose_administration where id = new.disputes;
    if not found or r.family_id <> new.family_id or r.schedule_id <> new.schedule_id or r.local_date <> new.local_date
       or r.entry_kind <> 'report' then
      raise exception 'a disagreement must point at a report of the same occurrence' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger dose_administration_guard before insert on public.dose_administration
  for each row execute function public.dose_administration_guard();

-- append-only for EVERY role. The only exception is removal by the foreign-key cascade when the whole family is deleted
-- (the explicit family-data deletion path): the delete must come from a nested trigger AND the family row must already be gone.
-- A direct DELETE, a DELETE issued from some other trigger while the family still exists, and any UPDATE all fail.
-- SECURITY DEFINER only so that the family lookup is not hidden by row-level security from whoever is deleting.
create or replace function public.dose_administration_append_only() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1
     and not exists (select 1 from public.family f where f.id = old.family_id) then
    return old;
  end if;
  raise exception 'dose reports are append-only: % is not allowed', tg_op using errcode = '42501';
end $$;
create trigger dose_administration_append_only before update or delete on public.dose_administration
  for each row execute function public.dose_administration_append_only();
create trigger dose_administration_no_truncate before truncate on public.dose_administration
  for each statement execute function public.dose_administration_append_only();

------------------------------------------------------------------ RLS and grants
alter table public.medication_schedule enable row level security;
alter table public.dose_administration enable row level security;

create policy "read" on public.medication_schedule for select to authenticated
  using (public.member_can_see(family_id, 'meds'));
create policy "organizer insert" on public.medication_schedule for insert to authenticated
  with check (public.is_family_organizer(family_id));
create policy "organizer update" on public.medication_schedule for update to authenticated
  using (public.is_family_organizer(family_id)) with check (public.is_family_organizer(family_id));
create policy "organizer delete" on public.medication_schedule for delete to authenticated
  using (public.is_family_organizer(family_id));

-- dose_administration: readable by people who may see medications; NO write policy at all. Writes go through the RPCs only.
create policy "read" on public.dose_administration for select to authenticated
  using (public.member_can_see(family_id, 'meds'));

revoke all on public.medication_schedule from anon, public;
grant select, insert, update, delete on public.medication_schedule to authenticated;
revoke all on public.dose_administration from anon, public, authenticated;
grant select on public.dose_administration to authenticated;
-- Hosted projects hand every new table to service_role (everything) and to tooling roles (SELECT, INSERT) through default privileges.
-- A direct INSERT would let such a role write a report under any name and time, so only the SECURITY DEFINER functions (running as the
-- owner) may write this table. Reading stays open to service_role. The roles are guarded because they exist only on hosted projects.
revoke all on sequence public.dose_administration_seq_seq from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke insert, update, delete, truncate, references, trigger on public.dose_administration from service_role;
    revoke all on sequence public.dose_administration_seq_seq from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    revoke all on public.dose_administration from sandbox_exec;
    revoke all on sequence public.dose_administration_seq_seq from sandbox_exec;
  end if;
end $$;

------------------------------------------------------------------ reading: computed occurrences
create or replace function public.dose_occurrences(_family_id uuid, _from date, _to date)
returns table (
  schedule_id uuid, medication_id uuid, medication_name text, dose_text text,
  local_date date, local_time time, tz text, scheduled_at timestamptz, time_state text,
  status text, head_id uuid, reported_by uuid, reported_by_name text, reported_at timestamptz,
  not_given_reason text, change_reason text, outside_window boolean,
  reports_differ boolean, open_disagreements int, history_count int
)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare zone text;
begin
  if _family_id is null or _from is null or _to is null or _to < _from then
    raise exception 'dose_bad_request' using errcode = '22023';
  end if;
  if _to - _from > 14 then raise exception 'dose_window_too_large' using errcode = '22023'; end if;
  if not public.member_can_see(_family_id, 'meds') then return; end if;
  select f.timezone into zone from public.family f where f.id = _family_id;
  if zone is null then return; end if;
  return query
  select o.sid, o.medication_id, o.mname, o.mdose, o.d, o.local_time, zone, o.sched_at, o.time_state,
         coalesce(h.status, 'not_confirmed'), h.id, h.reported_by, h.reporter_name, h.reported_at,
         h.not_given_reason, h.change_reason, coalesce(h.outside_window, false),
         coalesce(p.id is not null and p.reported_by <> h.reported_by and p.status is distinct from h.status, false),
         (select count(*)::int from public.dose_administration g where g.disputes = h.id),
         (select count(*)::int from public.dose_administration a where a.schedule_id = o.sid and a.local_date = o.d)
    from (
      select s.id as sid, s.medication_id, m.name as mname, m.dose as mdose, m.status as mstatus, s.local_time, g.d,
             (public.dose_scheduled_at(g.d, s.local_time, zone)).scheduled_at as sched_at,
             (public.dose_scheduled_at(g.d, s.local_time, zone)).time_state as time_state
        from public.medication_schedule s
        join public.medication m on m.id = s.medication_id
        cross join lateral (select _from + n as d from generate_series(0, _to - _from) n) g
       where s.family_id = _family_id and g.d >= s.starts_on and (s.ends_on is null or g.d <= s.ends_on)
         and extract(isodow from g.d)::smallint = any (s.days_of_week)
    ) o
    left join lateral (
      select d.* from public.dose_administration d
       where d.schedule_id = o.sid and d.local_date = o.d and d.entry_kind = 'report'
         and not exists (select 1 from public.dose_administration x where x.supersedes = d.id)
    ) h on true
    left join public.dose_administration p on p.id = h.supersedes
   where o.mstatus = 'active' or h.id is not null
   order by o.d, o.local_time, o.mname;
end $$;

------------------------------------------------------------------ writing: the two RPCs
create or replace function public.report_dose(
  _schedule_id uuid, _local_date date, _status text, _expected_head uuid, _client_request_id uuid,
  _not_given_reason text default null, _change_reason text default null)
returns public.dose_administration
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  s public.medication_schedule; med public.medication; zone text;
  me_id uuid; me_name text; is_org boolean;
  occ record; head public.dose_administration; prior public.dose_administration; out_row public.dose_administration;
  outside boolean;
begin
  if uid is null then raise exception 'dose_not_signed_in' using errcode = '42501'; end if;
  if _client_request_id is null or _status not in ('given', 'not_given', 'not_confirmed')
     or (_not_given_reason is not null and _status <> 'not_given')
     or (_not_given_reason is not null and _not_given_reason not in ('refused', 'unwell', 'unavailable', 'skipped_on_purpose', 'other'))
     or (_change_reason is not null and _change_reason not in
         ('reported_by_mistake', 'wrong_occurrence', 'information_changed', 'confirmed_after_review', 'late_entry', 'other')) then
    raise exception 'dose_bad_request' using errcode = '22023';
  end if;

  -- authorization first, and the same answer whether the schedule is missing, in another family, or not visible to the caller
  select * into s from public.medication_schedule where id = _schedule_id;
  if not found or not public.member_can_see(s.family_id, 'meds') then
    raise exception 'dose_not_found' using errcode = 'P0002';
  end if;
  select m.id, m.name into me_id, me_name from public.member m where m.family_id = s.family_id and m.user_id = uid limit 1;
  if me_id is null then raise exception 'dose_not_found' using errcode = 'P0002'; end if;
  is_org := public.is_family_organizer(s.family_id);

  -- the occurrence must exist, in this family's time zone, and not be in the future
  if _local_date < s.starts_on or (s.ends_on is not null and _local_date > s.ends_on)
     or not (extract(isodow from _local_date)::smallint = any (s.days_of_week)) then
    raise exception 'dose_no_such_occurrence' using errcode = 'P0001';
  end if;
  select f.timezone into zone from public.family f where f.id = s.family_id;
  select * into occ from public.dose_scheduled_at(_local_date, s.local_time, zone);
  if occ.time_state = 'skipped' then raise exception 'dose_time_skipped' using errcode = 'P0001'; end if;
  if occ.scheduled_at > now() then raise exception 'dose_future_not_allowed' using errcode = 'P0001'; end if;
  select * into med from public.medication where id = s.medication_id;

  -- one writer at a time per occurrence
  perform pg_advisory_xact_lock(hashtextextended(_schedule_id::text || ':' || _local_date::text, 0));

  select * into prior from public.dose_administration where family_id = s.family_id and client_request_id = _client_request_id;
  if found then   -- a repeated submission returns the stored report; a different payload under the same id is refused
    if prior.entry_kind = 'report' and prior.schedule_id = _schedule_id and prior.local_date = _local_date
       and prior.status = _status and prior.reported_by = me_id and prior.supersedes is not distinct from _expected_head
       and prior.not_given_reason is not distinct from _not_given_reason
       and prior.change_reason is not distinct from _change_reason then
      return prior;
    end if;
    raise exception 'dose_idempotency_mismatch' using errcode = 'P0001';
  end if;

  select d.* into head from public.dose_administration d
   where d.schedule_id = _schedule_id and d.local_date = _local_date and d.entry_kind = 'report'
     and not exists (select 1 from public.dose_administration x where x.supersedes = d.id);
  if head.id is distinct from _expected_head then
    raise exception 'dose_conflict' using errcode = 'P0001', detail = coalesce(head.id::text, 'none');
  end if;

  outside := (now() - occ.scheduled_at) > interval '48 hours';
  if outside and not is_org then raise exception 'dose_window_closed' using errcode = 'P0001'; end if;
  if outside and _change_reason is null then raise exception 'dose_reason_required' using errcode = 'P0001'; end if;

  if head.id is null then
    if _status = 'not_confirmed' then raise exception 'dose_nothing_to_retract' using errcode = 'P0001'; end if;
  elsif head.status = 'not_confirmed' then
    if _status = 'not_confirmed' then raise exception 'dose_no_change' using errcode = 'P0001'; end if;
  else
    if head.reported_by is distinct from me_id and not is_org then
      raise exception 'dose_correction_not_allowed' using errcode = 'P0001',
        hint = 'Only the person who reported it or an organizer can change a report. Flag a disagreement instead.';
    end if;
    if _change_reason is null then raise exception 'dose_reason_required' using errcode = 'P0001'; end if;
    if _status = head.status and _change_reason <> 'confirmed_after_review' then
      raise exception 'dose_no_change' using errcode = 'P0001';
    end if;
  end if;

  insert into public.dose_administration
    (family_id, schedule_id, local_date, entry_kind, status, not_given_reason, supersedes, change_reason, outside_window,
     scheduled_at, tz, medication_name, dose_text, reported_by, reporter_name, client_request_id)
  values
    (s.family_id, _schedule_id, _local_date, 'report', _status, _not_given_reason, head.id, _change_reason, outside,
     occ.scheduled_at, zone, med.name, med.dose, me_id, me_name, _client_request_id)
  returning * into out_row;
  return out_row;
end $$;

create or replace function public.flag_dose_disagreement(
  _schedule_id uuid, _local_date date, _expected_head uuid, _client_request_id uuid)
returns public.dose_administration
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  s public.medication_schedule; med public.medication; zone text; me_id uuid; me_name text;
  occ record; head public.dose_administration; prior public.dose_administration; out_row public.dose_administration;
begin
  if uid is null then raise exception 'dose_not_signed_in' using errcode = '42501'; end if;
  if _client_request_id is null then raise exception 'dose_bad_request' using errcode = '22023'; end if;
  select * into s from public.medication_schedule where id = _schedule_id;
  if not found or not public.member_can_see(s.family_id, 'meds') then
    raise exception 'dose_not_found' using errcode = 'P0002';
  end if;
  select m.id, m.name into me_id, me_name from public.member m where m.family_id = s.family_id and m.user_id = uid limit 1;
  if me_id is null then raise exception 'dose_not_found' using errcode = 'P0002'; end if;
  -- the same occurrence checks as report_dose(), in the same order: a flag is only ever about a real, due occurrence
  if _local_date < s.starts_on or (s.ends_on is not null and _local_date > s.ends_on)
     or not (extract(isodow from _local_date)::smallint = any (s.days_of_week)) then
    raise exception 'dose_no_such_occurrence' using errcode = 'P0001';
  end if;
  select f.timezone into zone from public.family f where f.id = s.family_id;
  select * into occ from public.dose_scheduled_at(_local_date, s.local_time, zone);
  if occ.time_state = 'skipped' then raise exception 'dose_time_skipped' using errcode = 'P0001'; end if;
  if occ.scheduled_at > now() then raise exception 'dose_future_not_allowed' using errcode = 'P0001'; end if;
  select * into med from public.medication where id = s.medication_id;

  perform pg_advisory_xact_lock(hashtextextended(_schedule_id::text || ':' || _local_date::text, 0));

  select * into prior from public.dose_administration where family_id = s.family_id and client_request_id = _client_request_id;
  if found then
    if prior.entry_kind = 'disagreement' and prior.schedule_id = _schedule_id and prior.local_date = _local_date
       and prior.reported_by = me_id and prior.disputes is not distinct from _expected_head then
      return prior;
    end if;
    raise exception 'dose_idempotency_mismatch' using errcode = 'P0001';
  end if;

  select d.* into head from public.dose_administration d
   where d.schedule_id = _schedule_id and d.local_date = _local_date and d.entry_kind = 'report'
     and not exists (select 1 from public.dose_administration x where x.supersedes = d.id);
  if head.id is null or head.status = 'not_confirmed' then raise exception 'dose_nothing_to_dispute' using errcode = 'P0001'; end if;
  if head.id is distinct from _expected_head then
    raise exception 'dose_conflict' using errcode = 'P0001', detail = head.id::text;
  end if;
  if head.reported_by = me_id then raise exception 'dose_use_correction_instead' using errcode = 'P0001'; end if;

  select * into prior from public.dose_administration where entry_kind = 'disagreement' and disputes = head.id and reported_by = me_id;
  if found then return prior; end if;   -- already flagged by this person: nothing new to record

  insert into public.dose_administration
    (family_id, schedule_id, local_date, entry_kind, status, disputes, scheduled_at, tz, medication_name, dose_text,
     reported_by, reporter_name, client_request_id)
  values
    (s.family_id, _schedule_id, _local_date, 'disagreement', null, head.id, head.scheduled_at, head.tz, head.medication_name, head.dose_text,
     me_id, me_name, _client_request_id)
  returning * into out_row;
  return out_row;
end $$;

------------------------------------------------------------------ function privileges
-- Postgres grants EXECUTE to PUBLIC by default; close that for everything here, then open only what callers need.
revoke all on function public.valid_iso_days(smallint[]) from public, anon;
revoke all on function public.dose_scheduled_at(date, time, text) from public, anon;
revoke all on function public.dose_occurrences(uuid, date, date) from public, anon;
revoke all on function public.report_dose(uuid, date, text, uuid, uuid, text, text) from public, anon;
revoke all on function public.flag_dose_disagreement(uuid, date, uuid, uuid) from public, anon;
revoke all on function public.medication_schedule_guard() from public, anon, authenticated;
revoke all on function public.dose_administration_guard() from public, anon, authenticated;
revoke all on function public.dose_administration_append_only() from public, anon, authenticated;
grant execute on function public.valid_iso_days(smallint[]) to authenticated;
grant execute on function public.dose_scheduled_at(date, time, text) to authenticated;
grant execute on function public.dose_occurrences(uuid, date, date) to authenticated;
grant execute on function public.report_dose(uuid, date, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.flag_dose_disagreement(uuid, date, uuid, uuid) to authenticated;

commit;
