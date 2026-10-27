-- Verification block for the combined Feature C + family-delete-guard dry-run (see docs/design/dose-administration-combined-dry-run.md).
-- Runs INSIDE the dry-run transaction after both migration bodies, and BEFORE the final ROLLBACK. Everything it creates is rolled back.
-- The results are carried past the ROLLBACK in a session-local prepared statement (PREPARE is not transactional); the statement also
-- re-reads the live catalogs AFTER the rollback and compares them with the digests taken at the start of the transaction.
-- Placeholders: __EXPECT__ is replaced by the builder with a JSON literal (or 'null').
do $v$
declare
  j jsonb; owner_role text := current_user; uid uuid := gen_random_uuid();
  fa uuid; fb uuid; med uuid; sch uuid; ld date; probe jsonb := '{}'; msg text; st text; c int; base jsonb := nullif(current_setting('pendia.base', true), '')::jsonb;
begin
  j := jsonb_build_object(
    'owner', owner_role,
    'lock_timeout_in_txn', current_setting('lock_timeout'),
    'statement_timeout_in_txn', current_setting('statement_timeout'),
    'idle_in_txn_timeout_in_txn', current_setting('idle_in_transaction_session_timeout'),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('t', c.relname, 'rls', c.relrowsecurity, 'owner', pg_get_userbyid(c.relowner)) order by c.relname), '[]') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('medication_schedule','dose_administration')),
    'policies', (select coalesce(jsonb_agg(tablename || '.' || policyname || ':' || cmd order by tablename, policyname), '[]') from pg_policies where schemaname = 'public' and tablename in ('medication_schedule','dose_administration')),
    'functions', (select coalesce(jsonb_agg(jsonb_build_object('f', p.proname, 'definer', p.prosecdef, 'cfg', p.proconfig, 'anon_exec', has_function_privilege('anon', p.oid, 'execute'), 'auth_exec', has_function_privilege('authenticated', p.oid, 'execute'), 'owner', pg_get_userbyid(p.proowner)) order by p.proname), '[]') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('report_dose','flag_dose_disagreement','dose_occurrences','dose_scheduled_at','valid_iso_days','dose_administration_append_only','dose_administration_guard','medication_schedule_guard','family_delete_guard')),
    'triggers', (select coalesce(jsonb_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid) order by c.relname, t.tgname), '[]') from pg_trigger t join pg_class c on c.oid = t.tgrelid where (c.relname in ('medication_schedule','dose_administration') or t.tgname = 'family_delete_guard') and not t.tgisinternal),
    'non_owner_write_privs', (select coalesce(jsonb_agg(ro.rolname || ':' || p), '[]') from pg_roles ro cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where not ro.rolsuper and ro.rolname !~ '^pg_' and ro.rolname <> owner_role and has_table_privilege(ro.oid, 'public.dose_administration', p)),
    'non_owner_seq_privs', (select coalesce(jsonb_agg(ro.rolname || ':' || p), '[]') from pg_roles ro cross join unnest(array['USAGE','UPDATE']) p where not ro.rolsuper and ro.rolname !~ '^pg_' and ro.rolname <> owner_role and has_sequence_privilege(ro.oid, 'public.dose_administration_seq_seq', p)),
    'anon_table_privs', (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('medication_schedule','dose_administration') and grantee in ('anon','PUBLIC')),
    'authenticated_dose_privs', (select coalesce(jsonb_agg(privilege_type order by privilege_type), '[]') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'dose_administration' and grantee = 'authenticated'),
    'schedule_rows_before_probe', (select count(*) from public.medication_schedule),
    'history_rows_before_probe', (select count(*) from public.dose_administration),
    'new_public_relations', (select count(*) from pg_class where relnamespace = 'public'::regnamespace) - coalesce((base ->> 'class_n')::int, 0),
    'unrelated_objects_changed', jsonb_build_object(
      'class_md5_excluding_feature_c', (select md5(string_agg(c.relname || c.relkind::text || coalesce(c.relacl::text, ''), '|' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname not like 'dose\_%' and c.relname not like 'medication\_schedule%'),
      'default_acl_md5', (select md5(string_agg(defaclrole::text || defaclnamespace::text || defaclobjtype::text || defaclacl::text, '|' order by defaclrole, defaclnamespace, defaclobjtype)) from pg_default_acl),
      'event_triggers_md5', (select md5(string_agg(evtname || evtevent || coalesce(evttags::text, '') || evtfoid::regproc::text || evtenabled::text, '|' order by evtname)) from pg_event_trigger))
  );

  -- BEGIN PROBES
  -- behavioural probes on synthetic rows, all inside this transaction (nothing outside it is touched; no auth.users row is needed)
  insert into public.family (name, created_by) values ('zz dry-run A', uid) returning id into fa;
  insert into public.family (name, created_by) values ('zz dry-run B (no history)', uid) returning id into fb;
  insert into public.member (family_id, user_id, name, role) values (fa, uid, 'Probe', 'organizer');
  insert into public.member (family_id, user_id, name, role) values (fb, uid, 'Probe', 'organizer');
  insert into public.medication (family_id, name, dose) values (fa, 'Probe med', '1') returning id into med;
  insert into public.medication_schedule (family_id, medication_id, local_time, days_of_week, starts_on)
    values (fa, med, '00:01', array[1,2,3,4,5,6,7]::smallint[], current_date - 5) returning id into sch;
  ld := (now() at time zone (select timezone from public.family where id = fa))::date - 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.report_dose(sch, ld, 'given', null, gen_random_uuid());
    probe := probe || jsonb_build_object('report_as_organizer', 'accepted');
  exception when others then probe := probe || jsonb_build_object('report_as_organizer', sqlstate || ' ' || sqlerrm); end;
  reset role;
  select count(*) into c from public.dose_administration where family_id = fa;
  probe := probe || jsonb_build_object('reports_for_family_A', c);
  begin   -- the API role deleting the family that has history
    set local role authenticated;
    delete from public.family where id = fa;
    probe := probe || jsonb_build_object('api_delete_family_with_history', 'NOT REFUSED');
  exception when others then probe := probe || jsonb_build_object('api_delete_family_with_history', sqlstate || ' ' || sqlerrm); end;
  reset role;
  begin   -- the owner is refused too
    delete from public.family where id = fa;
    probe := probe || jsonb_build_object('owner_delete_family_with_history', 'NOT REFUSED');
  exception when others then probe := probe || jsonb_build_object('owner_delete_family_with_history', sqlstate || ' ' || sqlerrm); end;
  begin   -- a family without history still deletes through the API
    set local role authenticated;
    delete from public.family where id = fb;
    get diagnostics c = row_count;
    probe := probe || jsonb_build_object('api_delete_family_without_history_rows', c);
  exception when others then probe := probe || jsonb_build_object('api_delete_family_without_history_rows', sqlstate || ' ' || sqlerrm); end;
  reset role;
  begin   -- direct writes to the history table by the API role
    set local role authenticated;
    insert into public.dose_administration (family_id, schedule_id, local_date, status, scheduled_at, tz, medication_name, reported_by, reporter_name, client_request_id)
      values (fa, sch, ld, 'given', now(), 'UTC', 'x', gen_random_uuid(), 'x', gen_random_uuid());
    probe := probe || jsonb_build_object('api_direct_insert', 'NOT REFUSED');
  exception when others then probe := probe || jsonb_build_object('api_direct_insert', sqlstate || ' ' || sqlerrm); end;
  reset role;
  begin   -- history is append-only even for the owner
    update public.dose_administration set status = 'not_given' where family_id = fa;
    probe := probe || jsonb_build_object('owner_update_history', 'NOT REFUSED');
  exception when others then probe := probe || jsonb_build_object('owner_update_history', sqlstate || ' ' || sqlerrm); end;
  select count(*) into c from public.family where id = fa;
  probe := probe || jsonb_build_object('family_A_still_exists', c = 1);
  select count(*) into c from public.dose_administration where family_id = fa;
  probe := probe || jsonb_build_object('reports_for_family_A_after_attempts', c);
  -- END PROBES
  j := j || jsonb_build_object('probes', probe);

  -- carry the result past the ROLLBACK; the statement re-reads the live catalogs after it and compares with the start-of-transaction digests
  execute format($p$prepare pendia_combined_result as
    select %L::jsonb as in_txn,
      %L::jsonb as start_of_txn,
      %L::jsonb as expected_shared_baseline,
      current_setting('lock_timeout') as lock_timeout_after,
      current_setting('statement_timeout') as statement_timeout_after,
      (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('medication_schedule','dose_administration')) as feature_c_relations_after,
      (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('report_dose','flag_dose_disagreement','dose_occurrences','dose_scheduled_at','valid_iso_days','dose_administration_append_only','dose_administration_guard','medication_schedule_guard','family_delete_guard')) as feature_c_functions_after,
      (select count(*) from pg_trigger where tgname in ('family_delete_guard','dose_administration_guard','dose_administration_append_only','dose_administration_no_truncate','medication_schedule_guard') and not tgisinternal) as feature_c_triggers_after,
      (select count(*) from pg_policies where schemaname = 'public' and tablename in ('medication_schedule','dose_administration')) as feature_c_policies_after,
      (select count(*) from public.family where name like 'zz dry-run%%') as probe_families_after,
      (select jsonb_build_object(
         'class_n', (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace),
         'class_md5', (select md5(string_agg(c.relname || c.relkind::text || coalesce(c.relacl::text, ''), '|' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace),
         'proc_md5', (select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, ''), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace),
         'policy_n', (select count(*) from pg_policies where schemaname = 'public'),
         'policy_md5', (select md5(string_agg(schemaname || tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public'),
         'trig_md5', (select md5(string_agg(c.relname || t.tgname, '|' order by c.relname, t.tgname)) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
         'con_n', (select count(*) from pg_constraint where connamespace = 'public'::regnamespace),
         'type_n', (select count(*) from pg_type where typnamespace = 'public'::regnamespace),
         'default_acl_n', (select count(*) from pg_default_acl),
         'default_acl_md5', (select md5(string_agg(defaclrole::text || defaclnamespace::text || defaclobjtype::text || defaclacl::text, '|' order by defaclrole, defaclnamespace, defaclobjtype)) from pg_default_acl),
         'evt_n', (select count(*) from pg_event_trigger),
         'evt_md5', (select md5(string_agg(evtname || evtevent || coalesce(evttags::text, '') || evtfoid::regproc::text || evtenabled::text, '|' order by evtname)) from pg_event_trigger),
         'row_counts', (select 'family=' || (select count(*) from public.family) || ' member=' || (select count(*) from public.member) || ' medication=' || (select count(*) from public.medication) || ' shift=' || (select count(*) from public.shift) || ' handoff=' || (select count(*) from public.handoff) || ' visit=' || (select count(*) from public.visit) || ' task=' || (select count(*) from public.task) || ' watch_item=' || (select count(*) from public.watch_item) || ' med_change=' || (select count(*) from public.med_change) || ' care_recipient=' || (select count(*) from public.care_recipient) || ' digest=' || (select count(*) from public.digest)))) as after_rollback$p$,
    j::text, base::text, '__EXPECT__');
end $v$;
