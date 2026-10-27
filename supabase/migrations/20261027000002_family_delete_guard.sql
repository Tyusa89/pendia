-- Family-delete guard: a family that has dose administration history cannot be deleted.
--
-- NOT APPLIED. Merging this file does not approve applying it (see AGENTS.md); a shared-database dry-run and the apply each need the
-- founder's separate approval. REQUIRES 20261027000001_dose_administration.sql to be applied first (it reads public.dose_administration).
-- Independent of 20261022000001 and 20261022000002. Additive: one function and one trigger; no existing table, policy or grant changes.
--
-- Why: the existing "organizer delete family" policy and DELETE grant let an organizer erase a family through the API, and the foreign-key
-- cascade then removes everything it owns, including the append-only dose reports. Families without dose history are unaffected.
-- The guard is not role based: it refuses the owner and superusers too. Deliberate erasure is an explicit administrator act (see
-- docs/design/dose-administration.md): disable this trigger, delete, enable it again.
begin;

-- Refuse to install without Feature C: the guard reads public.dose_administration, and without it every family delete would fail.
-- Raised inside the transaction, so nothing below is created.
do $$ begin
  if to_regclass('public.dose_administration') is null then
    raise exception 'family_delete_guard requires 20261027000001_dose_administration.sql to be applied first (public.dose_administration is missing)'
      using errcode = '55000';
  end if;
end $$;

create or replace function public.family_delete_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.dose_administration d where d.family_id = old.id) then
    raise exception 'family_has_dose_history' using errcode = '23503',
      hint = 'This family has medication dose reports, which are kept. Deleting it needs an administrator.';
  end if;
  return old;
end $$;

revoke all on function public.family_delete_guard() from public, anon, authenticated;

create trigger family_delete_guard before delete on public.family
  for each row execute function public.family_delete_guard();

commit;
