#!/usr/bin/env bash
# Frozen-files guard. Fails if the current branch changes (adds, edits, deletes or renames) any path listed in
# scripts/frozen-paths.txt relative to the base branch.
#
#   bash scripts/check-frozen.sh [base-ref]        default base: origin/main
#
# FROZEN_OVERRIDE=1 (set by CI only when the pull request carries the label "frozen-change-approved") lets a deliberately approved
# change through while still printing what it touches.
set -euo pipefail

BASE="${1:-origin/main}"
ROOT="$(git rev-parse --show-toplevel)"
LIST="${FROZEN_LIST:-$ROOT/scripts/frozen-paths.txt}"

[ -f "$LIST" ] || { echo "frozen guard: list not found: $LIST" >&2; exit 2; }
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "frozen guard: base ref '$BASE' not found (fetch it first)" >&2; exit 2; }

MERGE_BASE="$(git merge-base "$BASE" HEAD)"
# Committed + staged + unstaged changes against the merge base; renames reported as delete + add so both paths are checked.
CHANGED="$(git diff --name-only --no-renames "$MERGE_BASE")"

patterns=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "$line" | tr -d '[:space:]')"
  [ -n "$line" ] && patterns+=("$line")
done < "$LIST"

violations=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  for pat in "${patterns[@]}"; do
    case "$pat" in
      */\*\*) glob="${pat%/\*\*}/*" ;;
      *) glob="$pat" ;;
    esac
    # shellcheck disable=SC2254
    case "$file" in
      $glob) violations+=("$file"); break ;;
    esac
  done
done <<< "$CHANGED"

if [ "${#violations[@]}" -eq 0 ]; then
  echo "frozen guard: OK (no frozen path changed against $BASE)"
  exit 0
fi

echo "frozen guard: the following frozen paths were changed against $BASE:" >&2
printf '  %s\n' "${violations[@]}" >&2
if [ "${FROZEN_OVERRIDE:-}" = "1" ]; then
  echo "frozen guard: OVERRIDE active (${FROZEN_OVERRIDE_REASON:-label frozen-change-approved}); allowing." >&2
  exit 0
fi
echo "frozen guard: FAILED. These paths are frozen (Document Upload, Storage/database work). See docs/design/app-redesign-frozen-files.md." >&2
exit 1
