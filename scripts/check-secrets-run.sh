#!/usr/bin/env bash
# Coordinated run for the check-secrets probe. Run from YOUR machine.
#   ./scripts/check-secrets-run.sh negative     # unauthorized-caller tests (run first)
#   ./scripts/check-secrets-run.sh authorized   # the single authorized call
# Env: PENDIA_FN_URL  (https://<ref>.supabase.co/functions/v1/check-secrets)
#      PENDIA_JWT     (your signed-in access token; only needed for "authorized"; never printed)
set -uo pipefail
set +x
URL="${PENDIA_FN_URL:?set PENDIA_FN_URL}"

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
expect() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 -> $3"; else echo "FAIL  $1 -> got $3, expected $2"; FAILED=1; fi
}
FAILED=0

case "${1:-}" in
  negative)
    expect "GET (wrong method)"        405 "$(code -X GET  "$URL")"
    expect "POST, no Authorization"    401 "$(code -X POST "$URL")"
    expect "POST, garbage bearer"      401 "$(code -X POST "$URL" -H "Authorization: Bearer not.a.jwt")"
    if [ -n "${PENDIA_JWT:-}" ]; then
      T="$PENDIA_JWT"; BAD="${T%?}$([ "${T: -1}" = "A" ] && echo B || echo A)"   # flip last signature char
      expect "POST, tampered signature" 401 "$(code -X POST "$URL" -H "Authorization: Bearer $BAD")"
    else
      echo "SKIP  tampered-signature test (set PENDIA_JWT to include it)"
    fi
    [ "$FAILED" = 0 ] && echo "All unauthorized-caller tests passed." || echo "Some tests FAILED. Do not run 'authorized'."
    exit "$FAILED" ;;
  authorized)
    : "${PENDIA_JWT:?set PENDIA_JWT}"
    out=$(curl -s -w "\n%{http_code}" -X POST "$URL" -H "Authorization: Bearer $PENDIA_JWT")
    echo "status: $(echo "$out" | tail -n1)"; echo "body:   $(echo "$out" | head -n1)" ;;
  *) echo "usage: $0 negative|authorized"; exit 2 ;;
esac
