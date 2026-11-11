#!/usr/bin/env bash
# Self-test for check-frozen.sh: builds a throwaway repository and proves the guard blocks and allows the right changes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/check-frozen.sh"
export FROZEN_LIST="$HERE/frozen-paths.txt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q -b main
git config user.email t@example.invalid; git config user.name test
mkdir -p src/lib/doc-upload src/services src/components src/test supabase/migrations docs/design
for f in src/lib/doc-upload/contract.ts src/services/documents.ts src/services/index.ts src/components/DocumentUploadFlow.tsx src/components/Other.tsx \
         src/test/doc-upload-flow.test.tsx src/test/other.test.ts supabase/migrations/001.sql docs/design/document-upload.md README.md; do
  echo x > "$f"
done
git add -A && git commit -q -m base
git update-ref refs/remotes/origin/main HEAD

fails=0
expect() { # expect <pass|fail> <description>
  local want="$1" desc="$2" got
  if bash "$GUARD" origin/main >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then echo "PASS  $desc"; else echo "FAIL  $desc (wanted $want, got $got)"; fails=$((fails+1)); fi
}
reset() { git checkout -q main; git reset -q --hard origin/main; git clean -qfd; }
branch() { reset; git checkout -q -b "t$RANDOM"; }

branch;                                                    expect pass "no change"
branch; echo y >> README.md; git commit -qam c;            expect pass "unrelated file edited"
branch; echo y >> src/services/index.ts; git commit -qam c; expect pass "a different service is not frozen"
branch; echo y >> src/components/Other.tsx; git commit -qam c; expect pass "a non-upload component is not frozen"
branch; echo y >> src/components/DocumentUploadFlow.tsx; git commit -qam c; expect fail "Document Upload component edited"
branch; echo y >> src/services/documents.ts; git commit -qam c; expect fail "documents service edited"
branch; echo y >> src/lib/doc-upload/contract.ts; git commit -qam c; expect fail "doc-upload library edited"
branch; echo y > src/lib/doc-upload/new.ts; git add -A; git commit -qm c; expect fail "new file added under doc-upload"
branch; echo y >> src/test/doc-upload-flow.test.tsx; git commit -qam c; expect fail "Document Upload test edited"
branch; echo y >> supabase/migrations/001.sql; git commit -qam c; expect fail "migration edited"
branch; echo y > supabase/migrations/002.sql; git add -A; git commit -qm c; expect fail "new migration added"
branch; git rm -q supabase/migrations/001.sql; git commit -qm c; expect fail "migration deleted"
branch; git mv src/services/documents.ts src/services/docs2.ts; git commit -qm c; expect fail "frozen file renamed away"
branch; echo y >> src/components/DocumentUploadFlow.tsx; expect fail "uncommitted edit to a frozen file"
branch; echo y >> src/components/DocumentUploadFlow.tsx; git commit -qam c
if FROZEN_OVERRIDE=1 FROZEN_OVERRIDE_REASON="self-test" bash "$GUARD" origin/main >/dev/null 2>&1; then echo "PASS  override lets an approved change through"; else echo "FAIL  override"; fails=$((fails+1)); fi
[ "$fails" -eq 0 ] && echo "ALL GUARD TESTS PASSED" || { echo "$fails GUARD TEST(S) FAILED"; exit 1; }
