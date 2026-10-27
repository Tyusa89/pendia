-- start-of-transaction digests (the same set the final statement recomputes after ROLLBACK)
select set_config('pendia.base', jsonb_build_object(
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
  'row_counts', (select 'family=' || (select count(*) from public.family) || ' member=' || (select count(*) from public.member) || ' medication=' || (select count(*) from public.medication) || ' shift=' || (select count(*) from public.shift) || ' handoff=' || (select count(*) from public.handoff) || ' visit=' || (select count(*) from public.visit) || ' task=' || (select count(*) from public.task) || ' watch_item=' || (select count(*) from public.watch_item) || ' med_change=' || (select count(*) from public.med_change) || ' care_recipient=' || (select count(*) from public.care_recipient) || ' digest=' || (select count(*) from public.digest))
)::text, true);
