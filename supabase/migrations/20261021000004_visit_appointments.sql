-- V1: visits become appointments (appointment lifecycle on the existing `visit` entity).
-- Additive: every existing visit row, its transcript, summary, consent and recording columns are untouched.
-- RLS is unchanged: organizer writes; members read per can_see_visits (see 20261021000001).
-- NOTE: "incomplete" and "overlap" are deliberately NOT stored; the app computes them from these columns.
-- Synthetic data only.

begin;

------------------------------------------------------------------ columns
alter table public.visit
  add column if not exists provider_name text,
  add column if not exists office_name text,
  add column if not exists office_address text,
  add column if not exists office_phone text,
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists reason text,
  add column if not exists notes text,
  -- rows that exist today are recorded visits, so they are 'completed' (applied here by the add-column default) ...
  add column if not exists status text not null default 'completed',
  add column if not exists confirmation_status text not null default 'unconfirmed',
  add column if not exists reminder_prefs jsonb not null default '{}'::jsonb,
  add column if not exists archived_at timestamptz;

-- ... and every NEW visit starts life as a scheduled appointment.
alter table public.visit alter column status set default 'scheduled';

-- `doctor` was NOT NULL. An appointment may not know its provider yet; the app flags that as incomplete.
alter table public.visit alter column doctor drop not null;

-- Carry the existing provider into the new column so historic visits are not mistaken for "missing provider".
update public.visit set provider_name = doctor where provider_name is null and doctor is not null;

------------------------------------------------------------------ constraints
alter table public.visit drop constraint if exists visit_status_check;
alter table public.visit add constraint visit_status_check
  check (status in ('scheduled', 'completed', 'canceled'));

alter table public.visit drop constraint if exists visit_confirmation_status_check;
alter table public.visit add constraint visit_confirmation_status_check
  check (confirmation_status in ('unconfirmed', 'confirmed'));

alter table public.visit drop constraint if exists visit_reminder_prefs_object;
alter table public.visit add constraint visit_reminder_prefs_object
  check (jsonb_typeof(reminder_prefs) = 'object');

-- Overlap between DIFFERENT appointments is allowed (it is flagged in the app, never blocked). An appointment cannot
-- end before it starts.
alter table public.visit drop constraint if exists visit_end_not_before_start;
alter table public.visit add constraint visit_end_not_before_start
  check (scheduled_end is null or scheduled_start is null or scheduled_end >= scheduled_start);

create index if not exists visit_family_scheduled_start_idx
  on public.visit (family_id, scheduled_start desc) where archived_at is null;

------------------------------------------------------------------ keep legacy columns coherent
-- provider_name is the source of truth. `doctor` is kept as a mirror because older screens still read it, and `date`
-- stays "the calendar day of the appointment in the family's timezone" so existing ordering and display keep working.
create or replace function public.visit_appointment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare tz text;
begin
  -- a writer that only knows the legacy column: adopt its value as the provider
  if tg_op = 'INSERT' and new.provider_name is null and new.doctor is not null then
    new.provider_name := new.doctor;
  end if;
  new.doctor := new.provider_name;

  if new.scheduled_start is not null then
    select f.timezone into tz from public.family f where f.id = new.family_id;
    if tz is null or not exists (select 1 from pg_timezone_names n where n.name = tz) then
      tz := 'America/New_York'; -- never block saving an appointment over an unrecognized family timezone
    end if;
    new.date := (new.scheduled_start at time zone tz)::date;
  end if;
  return new;
end $$;

drop trigger if exists visit_appointment_sync on public.visit;
create trigger visit_appointment_sync before insert or update on public.visit
  for each row execute function public.visit_appointment_sync();

commit;
