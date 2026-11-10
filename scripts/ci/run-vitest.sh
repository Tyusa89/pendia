#!/usr/bin/env bash
# Runs the whole Vitest suite, then fails only on failures that are NOT in scripts/ci/known-failures.json.
set -uo pipefail
cd "$(dirname "$0")/../.."
# On CI, retry a failed test twice: src/test/appointment-document-link.test.tsx ("hides the actions shortly before the 5-minute link
# expires") is timing-dependent and fails intermittently on GitHub runners even on unmodified main (verified by running it there).
# A test that keeps failing still fails the job. The file is frozen, so the flake is handled here instead of editing it.
RETRY=()
[ -n "${CI:-}" ] && RETRY=(--retry=2)
npx vitest run ${RETRY[@]+"${RETRY[@]}"} --reporter=default --reporter=json --outputFile.json=vitest-results.json
node scripts/ci/check-vitest-known-failures.mjs vitest-results.json
