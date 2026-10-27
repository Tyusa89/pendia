-- Rollback for 20261027000001_dose_administration.sql. DESTROYS every dose report and schedule (the history is append-only, so
-- this is the one deliberate way to remove it). Take an export first if the reports matter. Touches nothing else.
begin;
drop function if exists public.flag_dose_disagreement(uuid, date, uuid, uuid);
drop function if exists public.report_dose(uuid, date, text, uuid, uuid, text, text);
drop function if exists public.dose_occurrences(uuid, date, date);
drop table if exists public.dose_administration;      -- policies, triggers and indexes go with it
drop table if exists public.medication_schedule;
drop function if exists public.dose_administration_guard();
drop function if exists public.dose_administration_append_only();
drop function if exists public.medication_schedule_guard();
drop function if exists public.dose_scheduled_at(date, time, text);
drop function if exists public.valid_iso_days(smallint[]);
commit;
