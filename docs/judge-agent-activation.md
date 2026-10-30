# Judge Ask Pendia activation

Implemented but not activated or live-tested. The existing Meta Muse Spark 1.3 provider, prompt, output caps, evidence validation and server-derived citations are reused. No family records are read from the database or written. The guest remains outside the ordinary AI allowlist and has zero memberships.

## Required configuration (only after separate authorization)

- Keep the existing `META_API_KEY` and `PENDIA_JUDGE_DEMO_PASSWORD`.
- A small Upstash-compatible Redis REST store is required for durable atomic ad-hoc counters. Store its HTTPS endpoint as `JUDGE_AGENT_REDIS_URL` and its server-only credential as `JUDGE_AGENT_REDIS_TOKEN` in Lovable secrets. No provisioning or configuration was performed in this change.
- Set `AGENT_LIVE_ENABLED=true` and `JUDGE_AGENT_LIVE_ENABLED=true` only when live testing is authorized. The ordinary `AGENT_LIVE_USER_IDS` list is unchanged; do not add the guest to it.
- Publish this app version only after approval. No Edge Function deployment or migration is needed.

## Usage guard

The authenticated JWT's signed `session_id` identifies a judge session, not browser-provided storage. An atomic Redis EVAL reserves usage before each Meta request: 10 attempts per session per rolling-start hour, 30 per trusted edge IP per rolling-start hour, 100 across all judges per rolling-start 24 hours, and 20 seconds between attempts per session. Failed model attempts count; refusals caught by the existing prefilter do not. TTLs remove counters. No question, answer, family content, key or raw IP is stored. IP keys are HMAC-derived. Reloading or rotating sessions cannot bypass the shared cap. No in-memory fallback exists.

These are ad-hoc limits, not comprehensive bot prevention or a monetary spending guarantee. Shared-network judges share the IP cap. Attackers can consume the finite global quota and deny judges access, but cannot increase that quota by rotating IPs/sessions. Restrict Redis credentials to this store; prevent external counter resets. Entry authentication still relies on existing hosted-auth protections. Missing Redis, errors, or a missing trusted `cf-connecting-ip` header prevent Meta requests. Local development lacks this trusted edge header and intentionally fails closed. No client-supplied IP headers are used.

## Authorized smoke test still required

After configuration and approval: enter through Try Pendia Demo, open Ask, ask about Lisinopril and the next appointment, confirm actual model output and working citations, and retry a transient failure manually after the cooldown. Check multiple independent judge sessions and verify normal sign-in remains separate. Confirm guest RLS still returns no live-family rows. Turn `JUDGE_AGENT_LIVE_ENABLED` off to stop judge Meta calls without changing ordinary users' configuration.

Development tests use fictional scripted provider doubles only; these are tests, not shipped answer substitutes.