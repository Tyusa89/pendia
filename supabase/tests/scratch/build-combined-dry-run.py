#!/usr/bin/env python3
"""Builds the combined Feature C + family-delete-guard dry-run SQL from the PINNED commits (prints SQL to stdout, facts to stderr).

Refuses to build unless both migration files, read from git at the pinned commits, hash to the pinned SHA-256 values.
The output has exactly one BEGIN (first line) and exactly one ROLLBACK, and no COMMIT. It never executes anything.
  python3 supabase/tests/scratch/build-combined-dry-run.py [--expect expected-baseline.json] [--no-probes] > dry-run.sql
--no-probes drops the synthetic-row behaviour probes (no rows are inserted even inside the transaction); catalog checks remain.
"""
import hashlib, json, re, subprocess, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[3]
PINS = [  # (commit, path, sha256 of the file at that commit)
    ("3b11078ab71a12e1504a39b8bd3f2b718fcc908a", "supabase/migrations/20261027000001_dose_administration.sql",
     "753aef850fa03d9a1b0487f5f356716373179560c9c58a96791b6c5552d73f60"),
    ("20649e612b8385eed3f59093480cd3d8a230c206", "supabase/migrations/20261027000002_family_delete_guard.sql",
     "c4f999c17dc6af71567d5bfb9f281fe1c66b0e8eacc78dab5a02ff43fa564c8c"),
]
TXN_CONTROL = re.compile(r"^\s*(begin|commit|rollback|abort|start\s+transaction|savepoint\b.*|release\b.*|end)\s*;\s*$", re.I)


def git_show(commit, path):
    return subprocess.run(["git", "show", f"{commit}:{path}"], cwd=REPO, check=True, capture_output=True).stdout.decode()


def body(text, name):
    lines = text.split("\n")
    top = [(i, l) for i, l in enumerate(lines) if TXN_CONTROL.match(l) and not l.startswith((" ", "\t"))]
    if [l.strip().lower() for _, l in top] != ["begin;", "commit;"]:
        sys.exit(f"{name}: expected exactly one top-level begin; and one commit;, found {top}")
    b, c = top[0][0], top[1][0]
    inner = lines[b + 1:c]
    if any(TXN_CONTROL.match(l) and not l.startswith((" ", "\t")) for l in inner):
        sys.exit(f"{name}: transaction control remains in the body")
    return "\n".join(lines[:b] + inner)  # header comments stay; begin;/commit; dropped


def main():
    expect = "null"
    if "--expect" in sys.argv:
        expect = json.dumps(json.load(open(sys.argv[sys.argv.index("--expect") + 1])), separators=(",", ":")).replace("'", "''")
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '60s';",
             "set local idle_in_transaction_session_timeout = '90s';"]
    # start-of-transaction digests, kept in a transaction-local setting and compared after the rollback
    parts.append(open(REPO / "supabase/tests/scratch/combined-dry-run-baseline.sql").read().strip())
    for commit, path, pin in PINS:
        text = git_show(commit, path)
        got = hashlib.sha256(text.encode()).hexdigest()
        if got != pin:
            sys.exit(f"{path} at {commit[:7]} hashes to {got}, expected {pin}")
        print(f"{path} @ {commit[:7]} sha256 {got}", file=sys.stderr)
        parts.append(f"-- ===== {path} @ {commit[:7]} (begin;/commit; removed) =====\n" + body(text, path))
    vtext = (REPO / "supabase/tests/scratch/combined-dry-run-verify.sql").read_text()
    if "--no-probes" in sys.argv:
        a, b = vtext.index("  -- BEGIN PROBES"), vtext.index("  -- END PROBES")
        vtext = vtext[:a] + "  probe := '{\"skipped\": true}'::jsonb;\n" + vtext[b:]
    verify = vtext.replace("__EXPECT__", expect.replace("'", "''") if expect != "null" else "null")
    parts += [verify.strip(), "rollback;", "execute pendia_combined_result;"]
    sql = "\n".join(parts) + "\n"
    sql_lines = sql.split("\n")
    n_begin = sum(1 for l in sql_lines if re.match(r"^begin;\s*$", l, re.I))
    n_rb = sum(1 for l in sql_lines if re.match(r"^rollback;\s*$", l, re.I))
    n_commit = sum(1 for l in sql_lines if re.match(r"^\s*commit\s*;", l, re.I))
    if (n_begin, n_rb, n_commit) != (1, 1, 0) or sql_lines[0].lower() != "begin;" or sql_lines[-3].lower() != "rollback;":
        sys.exit(f"transaction shape wrong: begin={n_begin} rollback={n_rb} commit={n_commit}")
    print(f"dry-run SQL sha256 {hashlib.sha256(sql.encode()).hexdigest()} ({len(sql)} bytes); BEGIN x1, ROLLBACK x1, COMMIT x0", file=sys.stderr)
    sys.stdout.write(sql)


main()
