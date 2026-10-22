-- Phase 4A-1: required caregiving hours (weekly pattern + single-date overrides). Additive: no existing table, column,
-- policy or row is changed. Nothing is assumed: with no rows, no hours are required and no gap can be reported.
--   * coverage_requirement: a recurring weekly window (weekday 0 = Monday). end_time <= start_time means it ends the next day.
--   * coverage_override: one row per date it replaces; the weekly pattern is NOT added to it. An override with zero
--     windows means "no coverage required that date".
--   * coverage_override_window: the windows of an override.
-- Times are wall-clock in the family's timezone (so they hold across daylight saving) and fall on 15-minute marks.
-- Reads follow the Coverage schedule permission; writes are organizer-only; family_id never changes.
-- Synthetic data only.

begin;

-- 15-minute marks, no seconds
create or replace function public.coverage_time_ok(t time) returns boolean
language sql immutable as $$
  select extract(second from t) = 0 and extract(minute from t)::int % 15 = 0
$$;

------------------------------------------------------------------ tables
create table public.coverage_requirement (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null check (public.coverage_time_ok(start_time)),
  end_time time not null check (public.coverage_time_ok(end_time)),
  created_at timestamptz not null default now(),
  constraint coverage_requirement_nonempty check (start_time <> end_time),
  constraint coverage_requirement_unique unique (family_id, weekday, start_time, end_time)
);
create index coverage_requirement_family_idx on public.coverage_requirement (family_id, weekday);

create table public.coverage_override (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  constraint coverage_override_day_unique unique (family_id, day),
  constraint coverage_override_id_family unique (id, family_id)
);

create table public.coverage_override_window (
  id uuid primary key default gen_random_uuid(),
  override_id uuid not null,
  family_id uuid not null,
  start_time time not null check (public.coverage_time_ok(start_time)),
  end_time time not null check (public.coverage_time_ok(end_time)),
  created_at timestamptz not null default now(),
  constraint coverage_override_window_nonempty check (start_time <> end_time),
  constraint coverage_override_window_unique unique (override_id, start_time, end_time),
  -- the window and its override must be in the same family; no trigger needed
  constraint coverage_override_window_family foreign key (override_id, family_id)
    references public.coverage_override (id, family_id) on delete cascade
);
create index coverage_override_window_idx on public.coverage_override_window (override_id);

------------------------------------------------------------------ integrity
do $$ declare t text; begin
  foreach t in array array['coverage_requirement', 'coverage_override', 'coverage_override_window'] loop
    execute format('create trigger lock_family_id before update on public.%I for each row execute function public.lock_family_id()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.member_can_see(family_id, ''schedule''))', t);
    execute format('create policy "organizer insert" on public.%I for insert to authenticated with check (public.is_family_organizer(family_id))', t);
    execute format('create policy "organizer update" on public.%I for update to authenticated using (public.is_family_organizer(family_id)) with check (public.is_family_organizer(family_id))', t);
    execute format('create policy "organizer delete" on public.%I for delete to authenticated using (public.is_family_organizer(family_id))', t);
    -- same grants the rest of the schema ends up with: signed-in CRUD gated by RLS, nothing for anon
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

------------------------------------------------------------------ atomic replace (so a failed save never leaves a day half-defined)
-- SECURITY INVOKER: the caller's own RLS applies, so a non-organizer is refused exactly as for a direct write.
-- _windows: [{"start_time":"08:00","end_time":"12:00"}, ...]. An empty array clears the day's windows.
create or replace function public.replace_weekly_coverage(_family_id uuid, _weekday smallint, _windows jsonb)
returns int language plpgsql security invoker set search_path = public as $$
declare w jsonb; n int := 0;
begin
  if jsonb_typeof(_windows) is distinct from 'array' then
    raise exception 'windows must be an array' using errcode = '22023';
  end if;
  delete from public.coverage_requirement where family_id = _family_id and weekday = _weekday;
  for w in select * from jsonb_array_elements(_windows) loop
    insert into public.coverage_requirement (family_id, weekday, start_time, end_time)
    values (_family_id, _weekday, (w ->> 'start_time')::time, (w ->> 'end_time')::time)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Creates or replaces the single-date override. An empty array is a deliberate "no coverage required that date".
create or replace function public.set_coverage_override(_family_id uuid, _day date, _windows jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare ov uuid; w jsonb;
begin
  if jsonb_typeof(_windows) is distinct from 'array' then
    raise exception 'windows must be an array' using errcode = '22023';
  end if;
  insert into public.coverage_override (family_id, day) values (_family_id, _day)
    on conflict (family_id, day) do update set day = excluded.day returning id into ov;
  delete from public.coverage_override_window where override_id = ov;
  for w in select * from jsonb_array_elements(_windows) loop
    insert into public.coverage_override_window (override_id, family_id, start_time, end_time)
    values (ov, _family_id, (w ->> 'start_time')::time, (w ->> 'end_time')::time)
    on conflict do nothing;
  end loop;
  return ov;
end $$;

revoke all on function public.replace_weekly_coverage(uuid, smallint, jsonb) from public, anon;
revoke all on function public.set_coverage_override(uuid, date, jsonb) from public, anon;
grant execute on function public.replace_weekly_coverage(uuid, smallint, jsonb) to authenticated;
grant execute on function public.set_coverage_override(uuid, date, jsonb) to authenticated;

commit;
