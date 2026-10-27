-- Rolls back 20261027000002_family_delete_guard.sql: families with dose history become deletable again (and their history is then removed
-- by the cascade). Dose data is not touched by this script.
begin;
drop trigger if exists family_delete_guard on public.family;
drop function if exists public.family_delete_guard();
commit;
