-- Phase 1 hardening: per-person visibility RLS, organizer-only writes, confirm guard,
-- consent/speaker-map/source columns, cross-family integrity, per-user demo seed.
-- Synthetic data only.

begin;

-- The static shared demo family is replaced by a per-user copy (see join_demo_family below).
delete from public.family where id = '00000000-0000-0000-0000-000000000001';

------------------------------------------------------------------ columns
alter table public.family add column if not exists timezone text not null default 'America/New_York';

alter table public.member drop constraint if exists member_phone_e164;
alter table public.member add constraint member_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
create unique index if not exists member_family_phone_uniq on public.member (family_id, phone) where phone is not null;
create unique index if not exists member_family_user_uniq on public.member (family_id, user_id) where user_id is not null;

-- visit: consent log (rule 1), audio path, speaker mapping (rule 6)
alter table public.visit
  add column if not exists consent_at timestamptz,
  add column if not exists consent_by uuid references public.member(id) on delete set null,
  add column if not exists consent_text text,
  add column if not exists audio_path text,
  add column if not exists duration_seconds numeric(10,2),
  add column if not exists speaker_map jsonb not null default '{}'::jsonb,  -- {"A":"doctor","B":"patient"}
  add column if not exists speaker_map_confirmed_by uuid references public.member(id) on delete set null,
  add column if not exists speaker_map_confirmed_at timestamptz;
comment on column public.visit.transcript is
  'Array of turns: {"speaker":"A","start_s":12.4,"end_s":19.0,"text":"...","unclear":false}';

-- med_change (rules 3, 4, 5)
alter table public.med_change drop column if exists source_timestamp;
alter table public.med_change
  add column if not exists source_seconds numeric(8,2),
  add column if not exists confirmed_at timestamptz,
  add column if not exists unclear boolean not null default false;
alter table public.med_change drop constraint if exists med_change_status_check;
alter table public.med_change add constraint med_change_status_check check (status in ('pending','confirmed','dismissed'));

-- task: AI output starts as 'draft' until a human confirms
alter table public.task drop column if exists source_timestamp;
alter table public.task
  add column if not exists source_seconds numeric(8,2),
  add column if not exists speaker_label text,
  add column if not exists unclear boolean not null default false,
  add column if not exists completed_at timestamptz;
alter table public.task drop constraint if exists task_status_check;
alter table public.task add constraint task_status_check check (status in ('draft','open','done'));

-- watch_item
alter table public.watch_item
  add column if not exists source_seconds numeric(8,2),
  add column if not exists speaker_label text,
  add column if not exists unclear boolean not null default false,
  add column if not exists status text not null default 'active',
  add column if not exists confirmed_by uuid references public.member(id) on delete set null,
  add column if not exists confirmed_at timestamptz;
alter table public.watch_item drop constraint if exists watch_item_status_check;
alter table public.watch_item add constraint watch_item_status_check check (status in ('draft','active','dismissed'));

alter table public.shift drop constraint if exists shift_end_after_start;
alter table public.shift add constraint shift_end_after_start check ("end" > start);

------------------------------------------------------------------ helpers
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

------------------------------------------------------------------ RLS: rebuild all policies
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "members read family" on public.family for select to authenticated
  using (public.is_family_member(id) or created_by = auth.uid());
create policy "create family" on public.family for insert to authenticated with check (created_by = auth.uid());
create policy "organizer update family" on public.family for update to authenticated
  using (public.is_family_organizer(id)) with check (public.is_family_organizer(id));
create policy "organizer delete family" on public.family for delete to authenticated using (public.is_family_organizer(id));

create policy "members read members" on public.member for select to authenticated using (public.is_family_member(family_id));
create policy "organizer or creator adds member" on public.member for insert to authenticated with check (
  public.is_family_organizer(family_id)
  or (user_id = auth.uid() and role = 'organizer'
      and exists (select 1 from public.family f where f.id = family_id and f.created_by = auth.uid()))
);
create policy "organizer update members" on public.member for update to authenticated
  using (public.is_family_organizer(family_id)) with check (public.is_family_organizer(family_id));
create policy "organizer delete members" on public.member for delete to authenticated using (public.is_family_organizer(family_id));

-- Reads follow per-person visibility (rule 8); writes are organizer-only (only the organizer uses the app;
-- SMS-side writes go through edge functions with the service role).
do $$ declare t text; e text; begin
  for t, e in select * from (values
    ('care_recipient', $f$public.is_family_member(family_id)$f$),
    ('visit',          $f$public.member_can_see(family_id, 'visits')$f$),
    ('medication',     $f$public.member_can_see(family_id, 'meds')$f$),
    ('med_change',     $f$public.member_can_see(family_id, 'meds')$f$),
    ('task',           $f$public.is_family_member(family_id)$f$),
    ('watch_item',     $f$public.is_family_member(family_id)$f$),
    ('shift',          $f$public.member_can_see(family_id, 'schedule')$f$),
    ('handoff',        $f$public.member_can_see(family_id, 'schedule')$f$),
    ('digest',         $f$public.is_family_organizer(family_id) or member_id in (select id from public.member where user_id = auth.uid())$f$)
  ) as v(t, e) loop
    execute format('create policy "read" on public.%I for select to authenticated using (%s)', t, e);
    execute format('create policy "organizer insert" on public.%I for insert to authenticated with check (public.is_family_organizer(family_id))', t);
    execute format('create policy "organizer update" on public.%I for update to authenticated using (public.is_family_organizer(family_id)) with check (public.is_family_organizer(family_id))', t);
    execute format('create policy "organizer delete" on public.%I for delete to authenticated using (public.is_family_organizer(family_id))', t);
  end loop;
end $$;

------------------------------------------------------------------ integrity triggers
-- family_id never changes after insert
create or replace function public.lock_family_id() returns trigger language plpgsql as $$
begin
  if new.family_id is distinct from old.family_id then raise exception 'family_id is immutable'; end if;
  return new;
end $$;

-- foreign keys must stay inside the same family. args: column, referenced table, column, referenced table, ...
create or replace function public.enforce_same_family() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text; ref text; v uuid; found_row boolean; i int;
begin
  for i in 0 .. (tg_nargs / 2 - 1) loop
    col := tg_argv[2 * i]; ref := tg_argv[2 * i + 1];
    v := (to_jsonb(new) ->> col)::uuid;
    if v is not null then
      execute format('select exists (select 1 from public.%I where id = $1 and family_id = $2)', ref)
        into found_row using v, new.family_id;
      if not found_row then
        raise exception 'cross-family reference: %.% -> %', tg_table_name, col, ref using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['member','care_recipient','visit','medication','med_change','task','watch_item','shift','handoff','digest'] loop
    execute format('drop trigger if exists lock_family_id on public.%I', t);
    execute format('create trigger lock_family_id before update on public.%I for each row execute function public.lock_family_id()', t);
  end loop;
end $$;

create trigger same_family before insert or update on public.visit
  for each row execute function public.enforce_same_family('consent_by','member','speaker_map_confirmed_by','member');
create trigger same_family before insert or update on public.med_change
  for each row execute function public.enforce_same_family('visit_id','visit','confirmed_by','member');
create trigger same_family before insert or update on public.task
  for each row execute function public.enforce_same_family('owner_member_id','member','source_visit_id','visit');
create trigger same_family before insert or update on public.watch_item
  for each row execute function public.enforce_same_family('source_visit_id','visit','confirmed_by','member');
create trigger same_family before insert or update on public.shift
  for each row execute function public.enforce_same_family('assigned_member_id','member');
create trigger same_family before insert or update on public.handoff
  for each row execute function public.enforce_same_family('shift_id','shift','author_member_id','member');
create trigger same_family before insert or update on public.digest
  for each row execute function public.enforce_same_family('member_id','member');

-- Rule 3: a med change is born pending; only a signed-in family member can confirm it, and the
-- confirmer + time are stamped by the database (the client cannot spoof them). Confirmed rows are frozen.
create or replace function public.med_change_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'medication changes are created as pending drafts' using errcode = '23514';
    end if;
    new.confirmed_by := null; new.confirmed_at := null;
    return new;
  end if;

  if old.status = 'confirmed' then
    if new.status <> 'confirmed' or new.medication is distinct from old.medication
       or new.before is distinct from old.before or new.after is distinct from old.after then
      raise exception 'a confirmed medication change cannot be edited' using errcode = '23514';
    end if;
    new.confirmed_at := old.confirmed_at;
    if new.confirmed_by is not null then new.confirmed_by := old.confirmed_by; end if;  -- null only via FK on member delete
  elsif new.status = 'confirmed' then
    select id into mid from public.member where family_id = new.family_id and user_id = auth.uid();
    if mid is null then
      raise exception 'only a signed-in family member can confirm a medication change' using errcode = '42501';
    end if;
    new.confirmed_by := mid; new.confirmed_at := now();
  else
    new.confirmed_by := null; new.confirmed_at := null;
  end if;
  return new;
end $$;
create trigger med_change_guard before insert or update on public.med_change
  for each row execute function public.med_change_guard();

------------------------------------------------------------------ demo seed (one private copy per user)
create or replace function public.join_demo_family() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tz text := 'America/New_York';
  fid uuid; maria uuid; carlos uuid; jenny uuid;
  mem uuid[]; wk date; d date; i int; last_sun date;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select f.id into fid from public.family f join public.member m on m.family_id = f.id
   where f.is_demo and m.user_id = uid order by f.created_at limit 1;
  if fid is not null then return fid; end if;

  insert into public.family (name, created_by, is_demo, timezone) values ('Rosa''s Care Team', uid, true, tz) returning id into fid;

  insert into public.care_recipient (family_id, name, notes)
  values (fid, 'Grandma Rosa', 'Age 82. Lives at home. Prefers Spanish. Mild hypertension; walks with a cane.');

  -- 555-01xx numbers are reserved fictional numbers; replace Carlos's with a real phone to test SMS.
  insert into public.member (family_id, user_id, name, phone, language, role) values (fid, uid, 'Maria', '+12125550101', 'en', 'organizer') returning id into maria;
  insert into public.member (family_id, name, phone, language, role) values (fid, 'Carlos', '+12125550102', 'es', 'member') returning id into carlos;
  insert into public.member (family_id, name, phone, language, role, can_see_meds) values (fid, 'Jenny', '+12125550103', 'en', 'member', false) returning id into jenny;

  insert into public.medication (family_id, name, dose, schedule, status) values
    (fid, 'Lisinopril',   '10 mg',   'Once daily, morning',    'active'),
    (fid, 'Metformin',    '500 mg',  'Twice daily with meals', 'active'),
    (fid, 'Atorvastatin', '20 mg',   'Once daily, bedtime',    'active'),
    (fid, 'Vitamin D3',   '1000 IU', 'Once daily',             'active');

  -- Coverage for the next full Mon–Sun week (this week if today is Mon/Tue). Only gap: Tuesday 2–6 PM.
  wk := date_trunc('week', current_date)::date;
  if extract(isodow from current_date) > 2 then wk := wk + 7; end if;
  mem := array[maria, carlos, jenny];
  for d in select generate_series(wk, wk + 6, interval '1 day')::date loop
    for i in 0 .. 2 loop
      insert into public.shift (family_id, start, "end", assigned_member_id, status) values (
        fid,
        (d + (array['08:00','14:00','18:00'])[i + 1]::time) at time zone tz,
        (d + (array['14:00','18:00','22:00'])[i + 1]::time) at time zone tz,
        case when extract(isodow from d) = 2 and i = 1 then null else mem[((extract(isodow from d)::int + i) % 3) + 1] end,
        case when extract(isodow from d) = 2 and i = 1 then 'open' else 'claimed' end);
    end loop;
  end loop;

  last_sun := date_trunc('week', current_date)::date - 1;
  insert into public.digest (family_id, week, member_id, language, text) values
    (fid, last_sun, maria, 'en', E'Changed: no medication changes this week.\nDone: no tasks were completed this week.\nOpen: no open tasks.\nNext week''s gaps: Tuesday 2–6 PM needs someone.\nNext appointment: none scheduled.'),
    (fid, last_sun, carlos, 'es', E'Cambios: sin cambios de medicamentos esta semana.\nHecho: no se completaron tareas esta semana.\nPendiente: no hay tareas abiertas.\nHuecos de la próxima semana: el martes de 2 a 6 PM necesita a alguien.\nPróxima cita: ninguna programada.');

  return fid;
end $$;
revoke execute on function public.join_demo_family() from anon, public;
grant execute on function public.join_demo_family() to authenticated;

commit;
