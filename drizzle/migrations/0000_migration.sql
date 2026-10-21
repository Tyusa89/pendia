
create table public.family (id uuid primary key default gen_random_uuid(), name text not null, created_by uuid, is_demo boolean not null default false, created_at timestamptz not null default now());
create table public.member (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, user_id uuid, name text not null, phone text, language text not null default 'en' check (language in ('en','es')), role text not null default 'member' check (role in ('organizer','member')), can_see_meds boolean not null default true, can_see_schedule boolean not null default true, can_see_visits boolean not null default true, created_at timestamptz not null default now());
create table public.care_recipient (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, name text not null, notes text, created_at timestamptz not null default now());
create table public.visit (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, date date not null, doctor text not null, audio_url text, transcript jsonb not null default '[]'::jsonb, summary text, created_at timestamptz not null default now());
create table public.medication (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, name text not null, dose text, schedule text, status text not null default 'active' check (status in ('active','paused','stopped')), created_at timestamptz not null default now());
create table public.med_change (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, visit_id uuid references public.visit(id) on delete cascade, medication text not null, before text, after text, source_timestamp text, speaker_label text, status text not null default 'pending' check (status in ('pending','confirmed')), confirmed_by uuid references public.member(id) on delete set null, created_at timestamptz not null default now());
create table public.task (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, title text not null, owner_member_id uuid references public.member(id) on delete set null, due_date date, source_visit_id uuid references public.visit(id) on delete set null, source_timestamp text, status text not null default 'open' check (status in ('open','done')), created_at timestamptz not null default now());
create table public.watch_item (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, text text not null, ends_on date, source_visit_id uuid references public.visit(id) on delete set null, created_at timestamptz not null default now());
create table public.shift (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, start timestamptz not null, "end" timestamptz not null, assigned_member_id uuid references public.member(id) on delete set null, status text not null default 'open' check (status in ('open','claimed','swap')), created_at timestamptz not null default now());
create table public.handoff (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, shift_id uuid references public.shift(id) on delete set null, author_member_id uuid references public.member(id) on delete set null, ate boolean, meds_taken boolean, unusual text, watch_answers jsonb not null default '{}'::jsonb, note text, created_at timestamptz not null default now());
create table public.digest (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.family(id) on delete cascade, week date not null, member_id uuid references public.member(id) on delete set null, text text not null, language text not null default 'en' check (language in ('en','es')), sent_at timestamptz, created_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['family','member','care_recipient','visit','medication','med_change','task','watch_item','shift','handoff','digest'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create or replace function public.is_family_member(_family_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid())
$$;
create or replace function public.is_family_organizer(_family_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member where family_id = _family_id and user_id = auth.uid() and role = 'organizer')
$$;

create policy "members read family" on public.family for select to authenticated using (public.is_family_member(id) or created_by = auth.uid());
create policy "create family" on public.family for insert to authenticated with check (created_by = auth.uid());
create policy "organizer update family" on public.family for update to authenticated using (public.is_family_organizer(id));
create policy "organizer delete family" on public.family for delete to authenticated using (public.is_family_organizer(id));

create policy "members read members" on public.member for select to authenticated using (public.is_family_member(family_id));
create policy "creator adds self as organizer" on public.member for insert to authenticated with check (
  public.is_family_organizer(family_id)
  or (user_id = auth.uid() and role = 'organizer' and exists (select 1 from public.family f where f.id = family_id and f.created_by = auth.uid()))
);
create policy "organizer update members" on public.member for update to authenticated using (public.is_family_organizer(family_id));
create policy "organizer delete members" on public.member for delete to authenticated using (public.is_family_organizer(family_id));

do $$ declare t text; begin
  foreach t in array array['care_recipient','visit','medication','med_change','task','watch_item','shift','handoff','digest'] loop
    execute format('create policy "family read" on public.%I for select to authenticated using (public.is_family_member(family_id))', t);
    execute format('create policy "family insert" on public.%I for insert to authenticated with check (public.is_family_member(family_id))', t);
    execute format('create policy "family update" on public.%I for update to authenticated using (public.is_family_member(family_id))', t);
    execute format('create policy "family delete" on public.%I for delete to authenticated using (public.is_family_member(family_id))', t);
  end loop;
end $$;

-- Demo seed
insert into public.family (id, name, is_demo) values ('00000000-0000-0000-0000-000000000001', 'The Morales Family', true);
insert into public.care_recipient (family_id, name, notes) values ('00000000-0000-0000-0000-000000000001', 'Grandma Rosa', 'Age 82. Lives at home. Prefers Spanish. Mild hypertension; walks with a cane.');
insert into public.member (id, family_id, name, phone, language, role) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Elena (daughter)','+1 312 555 0101','en','organizer'),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Marco (son)','+1 312 555 0102','en','member'),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','Lucía (cousin)','+1 312 555 0103','es','member');
update public.member set can_see_meds = false where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.medication (family_id, name, dose, schedule, status) values
 ('00000000-0000-0000-0000-000000000001','Lisinopril','10 mg','Once daily, morning','active'),
 ('00000000-0000-0000-0000-000000000001','Metformin','500 mg','Twice daily with meals','active'),
 ('00000000-0000-0000-0000-000000000001','Atorvastatin','20 mg','Once daily, bedtime','active'),
 ('00000000-0000-0000-0000-000000000001','Vitamin D3','1000 IU','Once daily','active');
insert into public.visit (id, family_id, date, doctor, transcript, summary) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','2026-10-14','Dr. Patel — Primary Care',
 '[{"speaker":"Speaker A","t":"00:12","text":"Rosa, your blood pressure is still running a little high, 148 over 90."},
   {"speaker":"Speaker B","t":"00:24","text":"I have been taking the pill every morning."},
   {"speaker":"Speaker A","t":"01:05","text":"Good. Let''s increase the Lisinopril from 10 to 20 milligrams."},
   {"speaker":"Speaker A","t":"01:40","text":"I''d like a blood test in two weeks to check her kidneys."},
   {"speaker":"Speaker A","t":"02:15","text":"Watch for dizziness when she stands up, especially the first week."},
   {"speaker":"Speaker B","t":"02:30","text":"Okay. Should I keep walking every day?"},
   {"speaker":"Speaker A","t":"02:38","text":"Yes, keep walking. Twenty minutes is great."}]'::jsonb,
 'Blood pressure is still a bit high. Dr. Patel is raising the Lisinopril dose to 20 mg. Rosa needs a blood test in two weeks. Watch for dizziness when standing. Keep up daily walks.');
insert into public.med_change (family_id, visit_id, medication, before, after, source_timestamp, speaker_label) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','Lisinopril','10 mg once daily','20 mg once daily','01:05','Speaker A');
insert into public.task (family_id, title, owner_member_id, due_date, source_visit_id, source_timestamp) values
 ('00000000-0000-0000-0000-000000000001','Schedule kidney blood test','00000000-0000-0000-0000-0000000000a1','2026-10-28','00000000-0000-0000-0000-0000000000b1','01:40'),
 ('00000000-0000-0000-0000-000000000001','Pick up new Lisinopril prescription','00000000-0000-0000-0000-0000000000a2','2026-10-17','00000000-0000-0000-0000-0000000000b1','01:05');
insert into public.watch_item (family_id, text, ends_on, source_visit_id) values
 ('00000000-0000-0000-0000-000000000001','Dizziness when standing up','2026-10-28','00000000-0000-0000-0000-0000000000b1');
insert into public.shift (family_id, start, "end", assigned_member_id, status)
select '00000000-0000-0000-0000-000000000001',
  (d + b.s)::timestamptz, (d + b.e)::timestamptz,
  case when (extract(dow from d)::int + b.i) % 4 = 0 then null
       else (array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3']::uuid[])[((extract(dow from d)::int + b.i) % 3) + 1] end,
  case when (extract(dow from d)::int + b.i) % 4 = 0 then 'open' else 'claimed' end
from generate_series(date '2026-10-19', date '2026-10-25', interval '1 day') d,
 (values (0, interval '8 hours', interval '14 hours'), (1, interval '14 hours', interval '20 hours'), (2, interval '20 hours', interval '32 hours')) as b(i, s, e);
insert into public.handoff (family_id, author_member_id, ate, meds_taken, unusual, watch_answers, note, created_at) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2', true, true, null, '{"Dizziness when standing up":"No"}'::jsonb, 'Good day. Watched her novela together.', '2026-10-19 20:05+00'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3', true, true, 'A little dizzy after getting up from nap', '{"Dizziness when standing up":"Yes"}'::jsonb, 'Sat down right away, was fine after a minute.', '2026-10-20 14:10+00');
insert into public.digest (family_id, week, text, language) values
 ('00000000-0000-0000-0000-000000000001','2026-10-18', E'Grandma Rosa had a steady week.\nLisinopril goes up to 20 mg — pharmacy pickup by Fri.\nBlood test needed by Oct 28 (Elena).\nOne mild dizzy spell Tuesday; keep watching.\nThursday night still has no one — can you cover?','en'),
 ('00000000-0000-0000-0000-000000000001','2026-10-18', E'La abuela Rosa tuvo una semana estable.\nEl Lisinopril sube a 20 mg — recoger en farmacia el viernes.\nAnálisis de sangre antes del 28 de oct. (Elena).\nUn mareo leve el martes; sigan observando.\nEl jueves por la noche no hay nadie — ¿puedes cubrir?','es');

-- Let a signed-in user explore the demo family as its organizer
create or replace function public.join_demo_family() returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid := '00000000-0000-0000-0000-000000000001';
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.member where family_id = fid and user_id = auth.uid()) then
    insert into public.member (family_id, user_id, name, role, language)
    values (fid, auth.uid(), coalesce((select split_part(email,'@',1) from auth.users where id = auth.uid()),'You') || ' (you)', 'organizer', 'en');
  end if;
  return fid;
end $$;
revoke execute on function public.join_demo_family() from anon, public;
grant execute on function public.join_demo_family() to authenticated;
