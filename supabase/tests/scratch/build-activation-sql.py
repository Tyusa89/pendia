#!/usr/bin/env python3
"""Builds the SQL for the Feature C production activation (prints SQL to stdout, facts to stderr). It NEVER executes anything.

  python3 build-activation-sql.py step1|step2|both|both-dryrun|rollback-0002|rollback-0001-empty|verify|digests [--expect baseline.json] [--owner role]

step1 / step2   apply 20261027000001 / 20261027000002 verbatim, each in ONE transaction (exactly one BEGIN, one COMMIT, no ROLLBACK),
                preceded by a guard that aborts if the database is not exactly in the expected state and followed (still inside the
                transaction) by assertions that abort -> roll back if anything is not as designed.
rollback-*      the recovery scripts, guarded (0001: refuses if any dose data exists or the family guard is still installed).
verify          post-activation behavioural check on synthetic rows: ONE transaction, ONE BEGIN, ONE ROLLBACK, no COMMIT.
The migration/rollback files are read from git at the pinned merge commit and must hash to the pinned SHA-256 values.
"""
import hashlib, json, pathlib, re, subprocess, sys

REPO = pathlib.Path(__file__).resolve().parents[3]
MAIN = "82c6395ffd66657741f00695a8e550f5df2fa6e2"
FILES = {
    "m1": ("supabase/migrations/20261027000001_dose_administration.sql", "753aef850fa03d9a1b0487f5f356716373179560c9c58a96791b6c5552d73f60"),
    "m2": ("supabase/migrations/20261027000002_family_delete_guard.sql", "c4f999c17dc6af71567d5bfb9f281fe1c66b0e8eacc78dab5a02ff43fa564c8c"),
    "r1": ("supabase/rollback/20261027000001_dose_administration.rollback.sql", "0b89f80e7156f758f1c62525a22787a502d40de1e8d22196d1206758e9cebf8d"),
    "r2": ("supabase/rollback/20261027000002_family_delete_guard.rollback.sql", "c453a18bc1540a814fb3d0565c95d1dcc58874a58a2a2d1535fe023b17c9370f"),
}
TXN = re.compile(r"^(begin|commit|rollback|abort|start\s+transaction|savepoint\b.*|release\b.*|end)\s*;\s*$", re.I)
FC_FUNCS = ["report_dose", "flag_dose_disagreement", "dose_occurrences", "dose_scheduled_at", "valid_iso_days",
            "dose_administration_append_only", "dose_administration_guard", "medication_schedule_guard", "family_delete_guard"]
FC_TABLES = ["medication_schedule", "dose_administration"]
q = lambda xs: ", ".join("'%s'" % x for x in xs)

# Digests of everything EXCEPT Feature C's own objects, so the same expression is valid before, between and after the two steps.
DIGEST = f"""jsonb_build_object(
  'class_md5', (select md5(string_agg(c.relname || c.relkind::text || coalesce(c.relacl::text, ''), '|' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname not like 'dose\\_administration%' and c.relname not like 'medication\\_schedule%'),
  'proc_md5', (select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, ''), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in ({q(FC_FUNCS)})),
  'policy_md5', (select md5(string_agg(schemaname || tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename not in ({q(FC_TABLES)})),
  'trig_md5', (select md5(string_agg(c.relname || t.tgname, '|' order by c.relname, t.tgname)) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname not in ({q(FC_TABLES)}) and t.tgname <> 'family_delete_guard'),
  'con_n', (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and conname not like 'dose\\_administration%' and conname not like 'medication\\_schedule%'),
  'type_n', (select count(*) from pg_type where typnamespace = 'public'::regnamespace and typname not in ('dose_administration', '_dose_administration', 'medication_schedule', '_medication_schedule')),
  'default_acl_md5', (select md5(string_agg(defaclrole::text || defaclnamespace::text || defaclobjtype::text || defaclacl::text, '|' order by defaclrole, defaclnamespace, defaclobjtype)) from pg_default_acl),
  'evt_md5', (select md5(string_agg(evtname || evtevent || coalesce(evttags::text, '') || evtfoid::regproc::text || evtenabled::text, '|' order by evtname)) from pg_event_trigger))"""

NO_OCT22 = ("not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname in ('coverage_requirement','coverage_override','coverage_override_window','family_invite')) "
            "and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'member' and column_name in ('access_ends_at','access_status','relationship','access_starts_at','access_until_removed','agency_name')) "
            "and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('family_directory','member_is_current'))")
FC_COUNT = lambda kind: {
    "tables": f"(select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ({q(FC_TABLES)}))",
    "funcs": f"(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ({q(FC_FUNCS)}))",
    "guard_fn": "(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'family_delete_guard')",
    "guard_trg": "(select count(*) from pg_trigger where tgname = 'family_delete_guard' and tgrelid = 'public.family'::regclass)",
}[kind]
OWNER = sys.argv[sys.argv.index("--owner") + 1] if "--owner" in sys.argv else "postgres"   # --owner is for local rehearsals only
OWNER_OK = f"current_user = '{OWNER}'"


def do_block(tag, checks, intro):
    body = "\n".join(f"  if not coalesce(({expr}), false) then bad := bad || array['{name}']::text[]; end if;" for name, expr in checks)
    return (f"-- {intro}\ndo ${tag}$\ndeclare bad text[] := '{{}}';\nbegin\n{body}\n"
            f"  if cardinality(bad) > 0 then raise exception 'activation check failed: %', array_to_string(bad, ', '); end if;\nend ${tag}$;")


def read(key):
    path, pin = FILES[key]
    text = subprocess.run(["git", "show", f"{MAIN}:{path}"], cwd=REPO, check=True, capture_output=True).stdout.decode()
    got = hashlib.sha256(text.encode()).hexdigest()
    if got != pin:
        sys.exit(f"{path} at {MAIN[:7]} hashes to {got}, expected {pin}")
    print(f"{path} @ {MAIN[:7]} sha256 {got}", file=sys.stderr)
    return text


def body(text, name):
    lines = text.split("\n")
    top = [(i, l.strip().lower()) for i, l in enumerate(lines) if TXN.match(l)]
    if [l for _, l in top] != ["begin;", "commit;"]:
        sys.exit(f"{name}: expected exactly one top-level begin; and commit;, found {top}")
    return "\n".join(lines[:top[0][0]] + lines[top[0][0] + 1:top[1][0]])


def expected(path):
    return "'" + json.dumps(json.load(open(path)), separators=(",", ":")).replace("'", "''") + "'::jsonb"


HEAD = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '60s';", "set local idle_in_transaction_session_timeout = '90s';"]


def guard(exp, extra):
    checks = [("role is postgres", OWNER_OK), ("no Oct-22 objects", NO_OCT22),
              ("schema digests equal the expected baseline", f"{DIGEST} = {exp}")] + extra
    return do_block("g", checks, "GUARD: abort before any change unless the database is in exactly the expected state")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
    exp_path = sys.argv[sys.argv.index("--expect") + 1] if "--expect" in sys.argv else str(REPO / "supabase/tests/scratch/activation-expected-baseline.json")
    exp = expected(exp_path)
    parts = []
    if mode == "step1":
        parts = HEAD + [guard(exp, [("no Feature C tables", f"{FC_COUNT('tables')} = 0"), ("no Feature C functions", f"{FC_COUNT('funcs')} = 0"), ("no guard trigger", f"{FC_COUNT('guard_trg')} = 0")]),
                        "-- ===== 20261027000001_dose_administration.sql (begin;/commit; removed) =====", body(read("m1"), "m1"),
                        do_block("a", STEP1_ASSERT(exp), "ASSERT inside the transaction: anything off -> exception -> everything rolls back"), "commit;", STEP_RESULT(1)]
    elif mode == "step2":
        parts = HEAD + [guard(exp, [("Feature C tables present", f"{FC_COUNT('tables')} = 2"), ("0001 functions present, guard absent", f"{FC_COUNT('funcs')} = 8"),
                                    ("no guard trigger", f"{FC_COUNT('guard_trg')} = 0")]),
                        "-- ===== 20261027000002_family_delete_guard.sql (begin;/commit; removed) =====", body(read("m2"), "m2"),
                        do_block("a", STEP2_ASSERT(exp), "ASSERT inside the transaction"), "commit;", STEP_RESULT(2)]
    elif mode in ("both", "both-dryrun"):
        # one transaction: 0001 then 0002, with the intermediate assertions; "both-dryrun" ends in ROLLBACK instead of COMMIT
        end = ["commit;", STEP_RESULT(2)] if mode == "both" else ["rollback;", STEP_RESULT(-1)]
        parts = HEAD + [guard(exp, [("no Feature C tables", f"{FC_COUNT('tables')} = 0"), ("no Feature C functions", f"{FC_COUNT('funcs')} = 0"), ("no guard trigger", f"{FC_COUNT('guard_trg')} = 0")]),
                        "-- ===== 20261027000001_dose_administration.sql (begin;/commit; removed) =====", body(read("m1"), "m1"),
                        do_block("a", STEP1_ASSERT(exp), "ASSERT after 0001: anything off -> exception -> everything rolls back"),
                        "-- ===== 20261027000002_family_delete_guard.sql (begin;/commit; removed) =====", body(read("m2"), "m2"),
                        do_block("b", STEP2_ASSERT(exp), "ASSERT after 0002")] + end
    elif mode == "rollback-0002":
        parts = HEAD + [do_block("g", [("role is postgres", OWNER_OK), ("guard installed", f"{FC_COUNT('guard_trg')} = 1")], "GUARD"),
                        "-- ===== 20261027000002 rollback (begin;/commit; removed) =====", body(read("r2"), "r2"), "commit;", STEP_RESULT(0)]
    elif mode == "rollback-0001-empty":
        parts = HEAD + [do_block("g", [("role is postgres", OWNER_OK), ("family guard already rolled back", f"{FC_COUNT('guard_trg')} = 0 and {FC_COUNT('guard_fn')} = 0"),
                                       ("NO dose history", "case when to_regclass('public.dose_administration') is null then false else (select count(*) from public.dose_administration) = 0 end"), ("NO schedules", "case when to_regclass('public.medication_schedule') is null then false else (select count(*) from public.medication_schedule) = 0 end")],
                                "GUARD: refuses if any dose data exists (the rollback destroys it)"),
                        "-- ===== 20261027000001 rollback (begin;/commit; removed) =====", body(read("r1"), "r1"),
                        do_block("a", [("digests back to baseline", f"{DIGEST} = {exp}")], "ASSERT"), "commit;", STEP_RESULT(0)]
    elif mode == "digests":   # read-only query returning the digest JSON (used to record or re-check the expected baseline)
        sys.stdout.write(f"select {DIGEST} as digests;\n")
        return
    elif mode == "verify":
        base = (REPO / "supabase/tests/scratch/combined-dry-run-baseline.sql").read_text().strip()
        ver = (REPO / "supabase/tests/scratch/combined-dry-run-verify.sql").read_text().replace("'__EXPECT__'", "'null'").strip()
        parts = HEAD + [base, ver, "rollback;", "execute pendia_combined_result;"]
    else:
        sys.exit(__doc__)
    sql = "\n".join(parts) + "\n"
    lines = sql.split("\n")
    n = lambda w: sum(1 for l in lines if re.match(rf"^{w};\s*$", l, re.I))
    want = {"verify": (1, 0, 1), "both-dryrun": (1, 0, 1)}.get(mode, (1, 1, 0))
    if (n("begin"), n("commit"), n("rollback")) != want:
        sys.exit(f"transaction shape wrong for {mode}: begin={n('begin')} commit={n('commit')} rollback={n('rollback')}")
    print(f"{mode}: sha256 {hashlib.sha256(sql.encode()).hexdigest()} ({len(sql)} bytes) BEGIN x{n('begin')} COMMIT x{n('commit')} ROLLBACK x{n('rollback')}", file=sys.stderr)
    sys.stdout.write(sql)


def STEP_RESULT(step):
    return (f"select jsonb_build_object('step', {step}, 'feature_c_tables', {FC_COUNT('tables')}, 'feature_c_functions', {FC_COUNT('funcs')}, "
            f"'guard_trigger', {FC_COUNT('guard_trg')}, 'committed_digests', {DIGEST}, 'now', now()) as activation_result;")


def STEP1_ASSERT(exp):
    fn = lambda name, col, val: f"(select {col} from pg_proc where pronamespace = 'public'::regnamespace and proname = '{name}') = {val}"
    c = [("2 tables with RLS, owned by postgres", f"(select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ({q(FC_TABLES)}) and relrowsecurity and pg_get_userbyid(relowner) = current_user) = 2"),
         ("8 functions", f"{FC_COUNT('funcs')} = 8"),
         ("5 policies", f"(select count(*) from pg_policies where schemaname = 'public' and tablename in ({q(FC_TABLES)})) = 5"),
         ("6 triggers enabled", f"(select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ({q(FC_TABLES)}) and not t.tgisinternal and t.tgenabled = 'O') = 6"),
         ("no guard yet", f"{FC_COUNT('guard_trg')} = 0"),
         ("definer functions have fixed search_path", "(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('report_dose','flag_dose_disagreement','dose_administration_append_only','dose_administration_guard','medication_schedule_guard') and prosecdef and proconfig = array['search_path=public, pg_temp']) = 5"),
         ("anon can execute none", f"not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ({q(FC_FUNCS)}) and has_function_privilege('anon', oid, 'execute'))"),
         ("authenticated executes exactly the 5 intended", "(select array_agg(proname::text order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in (" + q(FC_FUNCS) + ") and has_function_privilege('authenticated', oid, 'execute')) = array['dose_occurrences','dose_scheduled_at','flag_dose_disagreement','report_dose','valid_iso_days']::text[]"),
         ("no non-owner write privileges on history", "not exists (select 1 from pg_roles ro cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where not ro.rolsuper and ro.rolname !~ '^pg_' and ro.rolname <> current_user and has_table_privilege(ro.oid, 'public.dose_administration', p))"),
         ("no sequence privileges for others", "not exists (select 1 from pg_roles ro cross join unnest(array['USAGE','UPDATE']) p where not ro.rolsuper and ro.rolname !~ '^pg_' and ro.rolname <> current_user and has_sequence_privilege(ro.oid, 'public.dose_administration_seq_seq', p))"),
         ("authenticated has SELECT only on history", "(select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'dose_administration' and grantee = 'authenticated') = array['SELECT']::text[]"),
         ("anon has no table grants", "not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('medication_schedule','dose_administration') and grantee in ('anon','PUBLIC'))"),
         ("no rows", "(select count(*) from public.dose_administration) = 0 and (select count(*) from public.medication_schedule) = 0"),
         ("everything else unchanged", f"{DIGEST} = {exp}")]
    return c


def STEP2_ASSERT(exp):
    return [("guard trigger enabled BEFORE DELETE row on family", "(select count(*) from pg_trigger t where t.tgrelid = 'public.family'::regclass and t.tgname = 'family_delete_guard' and t.tgenabled = 'O' and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and (t.tgtype & 1) = 1) = 1"),
            ("guard function definer, fixed search_path, owner postgres", "(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'family_delete_guard' and prosecdef and proconfig = array['search_path=public, pg_temp'] and pg_get_userbyid(proowner) = current_user) = 1"),
            ("guard function not executable by API roles", "not exists (select 1 from pg_proc where proname = 'family_delete_guard' and pronamespace = 'public'::regnamespace and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')))"),
            ("Feature C objects still present", f"{FC_COUNT('tables')} = 2 and {FC_COUNT('funcs')} = 9"),
            ("everything else unchanged", f"{DIGEST} = {exp}")]


main()
