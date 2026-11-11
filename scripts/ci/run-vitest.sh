#!/usr/bin/env bash
# Runs the whole Vitest suite, then fails only on failures that are NOT in scripts/ci/known-failures.json.
set -uo pipefail
cd "$(dirname "$0")/../.."
npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json
node scripts/ci/check-vitest-known-failures.mjs vitest-results.json
