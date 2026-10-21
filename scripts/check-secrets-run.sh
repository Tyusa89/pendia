#!/usr/bin/env bash
# Coordinated run for the check-secrets probe (bash). Windows users: scripts/check-secrets-run.ps1.
#   info        no network, works with the window closed: prints your token's alg, kid, minutes to expiry and whether the
#               kid matches the pinned key. Run BEFORE go. Never prints the token.
#   probe       confirm the new code is deployed (no auth, no window needed): waits for the x-fn-version header
#   closed      window CLOSED (before go-live / after expiry): every POST must be refused with 410 before auth
#   negative    window OPEN: unauthorized-caller tests (405 / 401 / 401 / 401)
#   authorized  window OPEN: the single authorized call; prints status + boolean body only
# Env: PENDIA_FN_URL (required)  PENDIA_JWT (needed for authorized and the tampered-signature test; never printed)
#      EXPECTED_VERSION (default pinned-jwk-2)
set -uo pipefail; set +x
[ "${1:-}" = "info" ] || : "${PENDIA_FN_URL:?set PENDIA_FN_URL}"
URL="${PENDIA_FN_URL:-}"; EXPECTED="${EXPECTED_VERSION:-pinned-jwk-2}"; PINNED_KID="${PINNED_KID:-72b5e943-b371-428c-83df-c19f302cb328}"
FAILED=0
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
expect() { if [ "$2" = "$3" ]; then echo "PASS  $1 -> $3"; else echo "FAIL  $1 -> got $3, expected $2"; FAILED=1; fi; }
tamper() { # flip a MIDDLE character of the signature (the last char holds base64 padding bits and may not change the bytes)
  local h="${1%%.*}" r="${1#*.}"; local p="${r%%.*}" s="${r#*.}"
  local c="${s:10:1}"; [ "$c" = "A" ] && c="B" || c="A"
  echo "$h.$p.${s:0:10}$c${s:11}"
}

b64url_json() { local s="${1//-/+}"; s="${s//_//}"; while [ $(( ${#s} % 4 )) -ne 0 ]; do s="$s="; done; printf '%s' "$s" | base64 -d 2>/dev/null; }
token_info() { # prints alg, kid, minutes to expiry, kid match; returns 1 on kid mismatch. Never prints the token.
  local t="$1" h p alg kid exp now rc=0
  h=$(b64url_json "$(echo "$t" | cut -d. -f1)"); p=$(b64url_json "$(echo "$t" | cut -d. -f2)")
  alg=$(echo "$h" | sed -n 's/.*"alg":"\([^"]*\)".*/\1/p'); kid=$(echo "$h" | sed -n 's/.*"kid":"\([^"]*\)".*/\1/p')
  exp=$(echo "$p" | sed -n 's/.*"exp":\([0-9]*\).*/\1/p'); now=$(date +%s)
  [ -n "$exp" ] && echo "token header: alg=$alg kid=$kid; expires in $(( (exp - now) / 60 )) min" || echo "token header: alg=$alg kid=$kid; expiry unreadable"
  [ "$alg" = "ES256" ] || { echo "token is not ES256; the function will refuse it: do not arm."; rc=1; }
  if [ "$kid" = "$PINNED_KID" ]; then echo "kid MATCHES the pinned key."; else echo "kid does NOT match the pinned key ($PINNED_KID): do not arm."; rc=1; fi
  return $rc
}

case "${1:-}" in
  info)
    : "${PENDIA_JWT:?set PENDIA_JWT}"; token_info "$PENDIA_JWT"; exit $? ;;
  probe)
    for i in $(seq 1 30); do
      v=$(curl -s -D - -o /dev/null -X GET "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-fn-version"{print $2}')
      echo "attempt $i: x-fn-version='${v:-<none>}'"
      [ "$v" = "$EXPECTED" ] && { echo "Deployed version confirmed: $v"; exit 0; }
      sleep 10
    done
    echo "Expected version '$EXPECTED' not seen after 5 minutes. Do NOT proceed."; exit 1 ;;
  closed)
    expect "GET (wrong method)"     405 "$(code -X GET  "$URL")"
    expect "POST, no Authorization" 410 "$(code -X POST "$URL")"
    expect "POST, garbage bearer"   410 "$(code -X POST "$URL" -H "Authorization: Bearer not.a.jwt")"
    [ -n "${PENDIA_JWT:-}" ] && token_info "$PENDIA_JWT" || true
    [ -n "${PENDIA_JWT:-}" ] && expect "POST, real token (still refused: window closed)" 410 "$(code -X POST "$URL" -H "Authorization: Bearer $PENDIA_JWT")"
    exit "$FAILED" ;;
  negative)
    first=$(code -X POST "$URL")
    if [ "$first" = "410" ]; then echo "Window is CLOSED (410). Auth tests need an open window; use 'closed' mode or ask for go-live."; exit 4; fi
    : "${PENDIA_JWT:?set PENDIA_JWT (needed for the tampered-signature test)}"
    expect "GET (wrong method)"        405 "$(code -X GET  "$URL")"
    expect "POST, no Authorization"    401 "$first"
    expect "POST, garbage bearer"      401 "$(code -X POST "$URL" -H "Authorization: Bearer not.a.jwt")"
    expect "POST, tampered signature"  401 "$(code -X POST "$URL" -H "Authorization: Bearer $(tamper "$PENDIA_JWT")")"
    [ "$FAILED" = 0 ] && echo "All unauthorized-caller tests passed." || echo "Some tests FAILED. Do not run 'authorized'."
    exit "$FAILED" ;;
  authorized)
    : "${PENDIA_JWT:?set PENDIA_JWT}"
    out=$(curl -s -w "\n%{http_code}" -X POST "$URL" -H "Authorization: Bearer $PENDIA_JWT")
    st=$(echo "$out" | tail -n1); echo "status: $st"; echo "body:   $(echo "$out" | head -n1)"
    case "$st" in 410) echo "Window closed.";; 503) echo "No pinned key configured.";; 401|403) echo "Refused.";; esac ;;
  *) echo "usage: $0 info|probe|closed|negative|authorized"; exit 2 ;;
esac
