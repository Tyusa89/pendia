# Care Agent — guest (judge) path: implementation record and audit handoff

Implements "Care Agent — guest (judge) enablement brief" (Oct 29, 2026). **Built, never run live, default off.** No Meta call, no migration,
no new dependency, no protected module edited, no flag enabled. Enablement is Andre's act, after Pepper's audit passes, inside Nov 5–8.

## What it is

A NEW, unauthenticated guest ask path, separate from the audited PR #54 member path. Judges enter through "Try Pendia Demo"; `/ask` sends
`isJudgeDemo()` sessions to `GuestAskPanel`, which calls `askGuestAgentFn` / `getGuestAgentStatus` (`src/lib/care-agent/guest.functions.ts`).
Server: `src/server/guest-agent.server.ts` (+ `guest-agent-limits.server.ts`). Members use the unchanged member functions.

## The five conditions

1. **Audit before enablement.** Draft PR only. Audit scope and where to look:
   - _Demo-only enforced server-side; eligibility independent of client identifiers_: the guest input has no family selector. `askGuestAgent`
     refuses any supplied `familyId` that is not the fictional snapshot's constant (`not_enabled`, before any cap spend/provider call).
     The pack is built from `judgeDemoData()` compiled into the server; the module imports no Supabase, service-role or database code.
   - _Pre-filter before pack and model_: step 4 (after input validation, before the cap, pack and provider). Refusals spend no cap.
   - _Exactly one provider call_: one `opts.fetchImpl(` call site; no retry; `redirect: "manual"`; 60 s timeout; 1 MB bound.
   - _Validation and canned fallback identical to the member path_: same `validateAgentAnswer`, `REFUSAL_COPY`, server-derived sources.
   - _No service-role client; no persistence_: structural tests in `guest-agent-isolation.test.ts`.
2. **No dose items in the guest pack, by construction.** `guestPackRows(now)` takes no doses input and returns `doses: []` from a literal; it
   drops medication `schedule` and the handoff's `meds_taken`. `buildGuestPack` additionally refuses (returns null → `context_failed`) if any
   `dose` item or `schedule:` text is present in the assembled pack. PR #54 finding F1 is therefore out of scope here.
3. **Hard global cap as the primary protection.** ≤ 60 asks/hour and ≤ 300/day across ALL guests, no per-IP/session/header key anywhere.
   Shared durable counters in the Redis REST store (atomic EVAL, fixed UTC hour/day buckets with TTL) **plus** a per-instance backstop that can
   only be stricter. Exceeded, store down, malformed reply or store unconfigured → canned unavailable (`not_enabled`), never an error leak.
4. **Judging window only.** Fails closed unless `JUDGE_AGENT_LIVE_ENABLED === "true"` exactly (and `META_API_KEY` present and the cap store
   configured). The flag is the window and the kill switch (delete it). No date logic is coded, deliberately.
5. **Freeze gate.** Not shipped by this PR; the placeholder posture stands unless the audit passes by Nov 2.

## Deviations and conflicts the audit must know about (read these first)

1. **"No new secrets" vs a global cap shared across workers.** A true global cap on Cloudflare Workers needs shared state, so the cap uses the
   Redis REST store. It reuses the secret NAMES already documented on `main` in `docs/judge-agent-activation.md`
   (`JUDGE_AGENT_REDIS_URL`, `JUDGE_AGENT_REDIS_TOKEN`) and the existing flag name `JUDGE_AGENT_LIVE_ENABLED`; this PR creates no secret and
   reads no other. If those two secrets are not provisioned, the guest path stays off. That provisioning is a new secret in practice: Andre's decision.
2. **`main` already contains unaudited Lovable judge code** (commit `d3bfad0`, "Enabled judge agent access"): `if (judge)` branches inside
   `askCareAgent` / `careAgentStatus`, `judge-agent-source.server.ts`, `judge-agent-limits.server.ts` (per-session/IP/global Redis counters), and a
   supabase-admin sign-in in `judge-demo.functions.ts`. So the member path on `main` is not byte-identical to audited PR #54. This PR does **not**
   edit any of it; it routes judges away from it (`ask.tsx`) and removes one legacy UI test for it. Recommendation: the audit decides whether to
   delete those branches; as long as they remain, they could serve a judge session if the member flags were also enabled.
3. **Pre-filter gap (shared, unchanged):** `"¿Debo darle más Lisinopril?"` is not refused (no generic Spanish medication word; specific drug names are not in
   the pattern). It falls through to the model, then to validation (which rejects advisory wording). A member-path issue; not fixed here to keep the audited module unchanged.
4. Fixed-window buckets: at an hour/day boundary up to 2× the window cap can pass across the boundary (≤ 120 in two minutes, ≤ 600 over a midnight).
5. Existing guard allow-lists were widened by exactly the new files (`spark-live-isolation`, `workflow` (spike), `care-agent-isolation`).

## Tests (offline; fake fetch also plays the Redis store)

`src/test/guest-agent.test.ts` (42), `guest-agent-isolation.test.ts` (10), `guest-agent-ui.test.tsx` (3): guest eligibility (snapshot only), dose-item
exclusion by construction, global-cap enforcement (61st/301st, shared store alone, fail-closed store), pre-filter zero-call refusals (EN/ES),
flag-absent/malformed fail-closed, cross-family identifier rejection, one-call/no-retry, canned fallback, no secrets or IPs in keys.
