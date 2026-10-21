# check-secrets probe: runbook

Throwaway probe that answers one question for one allowlisted user: *can the edge runtime read `META_API_KEY`?*
It returns booleans only, never logs, and never calls Meta. It is deleted after one use.

## Properties (what is and is not claimed)
- **Verification is local at request time.** The ES256 public key is pinned in `index.ts`; the handler makes no
  `fetch()` calls (a unit test asserts this). The only network activity is the platform resolving the `jose`
  package when the function is bundled and deployed.
- **No JWKS retrieval.** Trade-off: if Supabase rotates the signing key during the window, the pinned key stops
  matching and the function refuses everything (fail closed). That is acceptable for a 15-minute probe.
- **Default closed.** `ACTIVE_UNTIL_MS = 0` makes every POST return `410` *before* authentication. Closed-window
  behaviour and authentication behaviour are therefore tested separately (see below).
- **Fails closed on bad config:** no pinned key, or a JWK containing a private component, returns `503`.

## Status codes
| Situation | Status |
|---|---|
| Not POST | 405 |
| Window closed / expired | 410 (before any auth) |
| Window open, no pinned key (or private JWK) | 503 |
| No / malformed / invalid / wrong-alg / wrong-kid / expired token, wrong issuer/audience/role | 401 |
| Valid token, not the allowlisted user | 403 |
| Allowlisted user | 200 `{"present":{"META_API_KEY":true\|false}}` |

Every response carries `x-fn-version`, so a deploy can be confirmed with an unauthenticated GET.

## Getting the pinned key (public, safe to paste into chat)
From your own machine (the sandbox cannot reach your project):
```powershell
(Invoke-RestMethod "https://yjcaqgwtvtmonzzzikur.supabase.co/auth/v1/.well-known/jwks.json").keys | ConvertTo-Json
```
or `curl -s https://yjcaqgwtvtmonzzzikur.supabase.co/auth/v1/.well-known/jwks.json`. Paste the key whose `alg`
is `ES256` (fields `kty, crv, x, y, kid`). It must NOT contain `d`. Then confirm the `kid` equals your token's
`kid`: both run modes print the token's `alg` and `kid` (never the token).

## Local tests (no deploy, no network, no secrets)
```sh
deno test --no-config --node-modules-dir=none --allow-env supabase/functions/check-secrets/handler.test.ts
```
Covers: 405 / 410 closed-window (even with a perfect token) / window boundary; missing, garbage, tampered,
foreign-key, wrong-kid, HS256 alg-confusion, wrong issuer/audience/role, expired, no-`sub` tokens; 403 for another
user; 200 booleans-only with a sentinel secret that must never appear in the response; missing/blank secret →
`false`; 503 for no key or a private JWK; **zero `fetch()` calls at request time**.

## Deployment procedure
Deployment is a merge to `main` (Lovable syncs the repo). No tool here reports deploy status, so use the
version header instead of assuming:
1. Merge. Deploys are not instant.
2. `scripts/check-secrets-run.(sh|ps1) probe` polls `GET` until `x-fn-version` equals the expected version.
   A missing or old version means the new code is not live: stop, do not arm the window.
3. `closed` mode must pass (405 / 410 / 410 / 410) **while the window is still closed**.
4. Only then does the go-live commit set `ACTIVE_UNTIL_MS` (now + 15 min). Re-run `probe` to confirm it deployed
   (bump `VERSION` in the same commit so the probe can tell old from new).
5. `negative` mode (open window): 405, 401, 401, 401 (exit 4 means the window is still closed or has expired).
6. `authorized` mode once; report only the `present` result.
7. Deletion PR removes `supabase/functions/check-secrets/` and the `[functions.check-secrets]` config block.
   Removing files from the repo may not undeploy the function: confirm it is gone with a request that returns
   `404`, or in the Supabase dashboard, before calling it deleted.

## Limits
- Local tests run on Deno from the npm registry, not Supabase's edge runtime; a real deploy is still the first
  test of the runtime itself.
- `check-secrets-run.ps1` has not been executed in this environment (no PowerShell). The bash twin was run
  end-to-end against the real handler locally.
