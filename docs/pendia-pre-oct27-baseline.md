# Pendia — Pre-Hackathon Baseline: what existed before October 27, 2026

**Purpose.** The Participant Guide (§4) allows Startup-track entrants to build on an existing product or codebase, provided the submission *clearly identifies what was newly developed during the Hackathon*. This document is the "before" half of that identification: a complete, evidence-based inventory of Pendia as it existed before the building period opened (Oct 27 – Nov 4, per Guide §3).

**Evidence basis.** Pulled directly from GitHub (repository `Tyusa89/pendia`) on Oct 26, 2026 by Pepper via the GitHub connector — full pull-request list and full commit history of `main`. Reconciled against Pepper's independently kept PR ledger: **full agreement**, with one addition from the pull (the Oct 16 template scaffold commit — see "Project creation vs. earliest repository commit" below, where its discrepancy with the verified Lovable creation date is recorded, unexplained).

**Boundary.** "Before October 27" = merged on `main` before 2026-10-27 00:00 America/Chicago (2026-10-27T05:00:00Z). There are no edge cases: the newest pre-period item (PR #43) merged Oct 24 — more than two days before the boundary in any timezone.

## Baseline anchor

- **Building-period dating note (Oct 26):** the Participant Guide (§3) dates the building period **Oct 27 – Nov 4**; the kickoff host said on the record that the 10 days of hacking start Oct 26, after the kickoff, through Nov 4. This inventory keeps the Guide's Oct 27 date as the governing, conservative standard — everything dated Oct 26 is recorded here as pre-period, and no Oct 26 item will be claimed as in-window work. The timestamps are recorded exactly, so the delineation is transparent under either reading.
- `main` **HEAD:** `b0ad28676ee7bbc2e64ea6e88b82acfc6698a0d4` ("Merge pull request #44", 2026-10-26T21:58:05Z)
- Until Oct 26 the anchor was `88ff793` (PR #43 merge, Oct 24). One commit landed on Oct 26, as this section originally anticipated: PR #44 (Spark failure diagnostics), merged 16:58 CT — still pre-period, and appended to this inventory in the second addendum below. `b0ad286` is therefore the exact state of the product when the building period opens, unless a further commit lands before Oct 27, 00:00 CT — any such commit is likewise pre-period and must be appended here.
- How to verify: `git log main` — HEAD and every merge below are visible in the repository history with these timestamps.

## Project creation vs. earliest repository commit — two different dates

These two dates must not be conflated:

- **Pendia's actual creation (Lovable): October 20, 2026, 11:20 PM Central** (October 21, 04:20 UTC) — when the Lovable project was created. Verified Oct 26 through the account owner's connected Lovable account. Lovable's internal project name is **"Pixel Perfect Matchmaker"**; the project description identifies it as Pendia, the family caregiving coordination application. The earliest Lovable conversation history is from October 20–21. Pendia's feature development begins with PR #1 on October 21.
- **Earliest GitHub commit: October 16, 2026** — commit `dad00cb77760242916c556adb1286c543648c5fe` (2026-10-16T12:25:08Z), containing the Lovable TanStack starter template ("template: tanstack_start_ts_current").

**The October 16 commit predates Pendia's verified Lovable creation by four days. Why has NOT been established.** It may be inherited template history, but that is unconfirmed, and this document records the discrepancy without explaining it. **October 16 is the date of the earliest commit in the repository's history; it is not the date Andre started developing Pendia, and it must not be cited as such.**

## Repo facts

- **174 commits** on `main`; **43 pull requests, all merged**, spanning 2026-10-21T05:16:14Z (PR #1) to 2026-10-24T16:27:38Z (PR #43).
- Repository is **private** as of this pull. (Guide §4 requires public repositories; making it public is a separate, pending decision by Andre.)

## The inventory — what existed before Oct 27

### 1. Foundations and the safety/permission model

- **PR #1** (Oct 21) — schema/RLS hardening: per-person visibility, organizer-only writes, cross-family foreign-key guard, medication-change confirmation guard, consent / speaker-map / source columns, anonymous grants revoked. Demo seed via per-user `join_demo_family()` (Maria/Carlos/Jenny, Rosa; Lisinopril 10 mg; Tuesday 2–6 PM gap; EN+ES digest). Mandatory "Not medical advice" footer. RLS test suite: 40 assertions, passing.

### 2. Handoffs and recordings

- **PR #11** (Oct 21) — handoff voice-dictation panel (on-device; transcription not connected).
- **PR #12** (Oct 21) — Android dictation playback fix.
- **PR #13** (Oct 21) — recordings storage plan (docs only).
- **PR #14** (Oct 21) — persistent handoff audio: private bucket, storage RLS, WAV capture, opt-in keep. Migration `20261021000003` **applied live**; Samsung acceptance confirmed by Andre Oct 21.

### 3. Visits become appointments

- **PR #15** (Oct 21) — V1 appointments (migration `20261021000004`).
- **PR #16** (Oct 21) — mark visit completed.
- **PR #17** (Oct 21) — README records the V1 migration as **applied**.

### 4. Design integration

- **PR #18** (Oct 21) — phone-first shell, touch targets (mobile-first design rule).
- **PR #20** (Oct 21) — Handoffs screen matched to the design.

### 5. Coverage (care-shift coordination)

- **PR #21** (Oct 22) — C1: create, edit, reassign, cancel shifts.
- **PR #24** (Oct 22) — organizer-controlled family time zone.
- **PR #25** (Oct 22) — exact shift hours and names in the coverage calendar.
- **PR #26** (Oct 22) — accurate coverage summaries (no false "covered").
- **PR #28** (Oct 22) — shift defaults in the family's time zone.
- **PR #29** (Oct 22) — real time-grid calendar, one event per shift.
- **PR #27** (Oct 22) — Phase 4 coverage requirements (proposal only).
- **PR #30** (Oct 22) — Phase 4A-1: coverage-requirements tables, RLS, validation, gap calculation. Migration `20261022000001` **merged, NOT applied**.

### 6. Member access and invitations

- **PR #34** (Oct 22) — I-1: member access windows, invitation links (SHA-256 token, fragment-based), family directory, user_id lock. Migration `20261022000002` **merged, NOT applied**.
- **PR #35** (Oct 22) — migration-safety notice in the repo naming both pending migrations (`20261022000001`, `20261022000002`).

### 7. Demo Mode (the submission's demonstration path)

- **PR #31** (Oct 22) — visit-pipeline contracts + cached synthetic visit.
- **PR #32** (Oct 22) — Demo Mode flow, public /demo route, in-app entry.
- **PR #33** (Oct 22) — Confirm/Reject review, simulated follow-through, wrap-up.
- **PR #36** (Oct 22) — session restoration after accidental reload.
- Pure client-side, offline, prerecorded synthetic data; nothing is saved.
- **Android acceptance 7/7 passed Oct 23** (Andre's phone test, incl. the simulated DONE flow) — human verification, recorded in project notes, not in git.

### 8. Transcription spike — offline only, live path paused

- **PR #2** (Oct 21) — diarization ground-truth script (synthetic; 12 turns; patient turns must yield zero extracted items).
- **PR #22 / #23** (Oct 22) — offline realtime capture tool, scorer, simulator; security hardening. No Meta calls.
- **PR #37** (Oct 22) — one-shot Meta REST transcription spike, prepared, not executed.
- **PR #38** (Oct 23) — spike corrected to Meta's documented request/response contract.
- Status at baseline: one live attempt (night of Oct 22→23) failed with a network error and never reached Meta (Meta dashboard: 0 transcription seconds). **Live transcription PAUSED until after the submission by Andre's decision (Oct 23).**
- **PRs #3–#10** (Oct 21) — the temporary `check-secrets` probe: built, hardened, and **removed** (PR #10). It exists in history only; it is not in the current tree.

### 9. Live Spark extraction path (Meta Muse Spark 1.3)

- **PR #39** (Oct 23) — extraction output contract + leakage guard (offline, unwired): doctor-turns only; patient-sourced items dropped by code, with reasons.
- **PR #40** (Oct 23) — live provider: server-only, gated (signed-in user + `SPARK_LIVE_ENABLED` + per-user allow-list), synthetic fixture only, one-call latch, model locked to `muse-spark-1.3`. "Never called" as of its merge.
- **PR #41** (Oct 23) — `json_schema` response format aligned to Meta's documented example.
- **PR #42** (Oct 24) — dev page shows the disabled reason to allow-listed users only.
- **PR #43** (Oct 24) — dev known-answer check recognises spelled-out doses ("twenty milligrams"); offline test coverage (suite reported 1,125 tests passing).
- **Milestone (operational, not a commit): FIRST LIVE SPARK EXTRACTION — Oct 24,** Andre-authorized. One call on the fixed fictional demo transcript: four findings (Lisinopril 10→20 mg; blood-test follow-up; ankle-swelling watch item), **zero items from non-doctor dialogue**, all evidence-backed, saved as unconfirmed drafts — nothing persisted.
- **Stated limitations (verbatim discipline, carried into all submission copy):** the live run used a fixed fictional transcript, not a real patient conversation; the dose-checker fix (PR #43) has offline coverage but is NOT yet reconfirmed with a second live Meta request; the evidence validator confirms doctor-sourced quotations but does not yet independently verify every medication value against its quotation; human confirmation remains essential.

### 10. Planning documents inside the repo

- PR #13 (recordings storage plan), PR #19 (Smart Scan roadmap — planning only), PR #27 (coverage requirements proposal), PR #35 (migration-safety notice).

### 11. Pre-period artifacts outside the repo

- Demo video **v5 (1:47)** — complete rough-final cut: Runway scenes 1–2, Demo Mode walkthrough footage, Warm Pebble AI narration (6 scene files), 16-cue caption sidecar; Scene 4 carries a labeled slug pending live footage.
- The Demo Mode walkthrough screen recording (74 s) used as Scenes 3 + 5 footage.
- Project plans in the workspace (master execution plan, build prompts, Twilio A2P checklist — prepared only; no account created, nothing spent).

### 12. Backend state at baseline (Supabase / Lovable)

- `META_API_KEY` set as a Supabase secret by Andre (Oct 21). `SPARK_LIVE_ENABLED` and the user allow-list gate the live path (§9).
- The Lovable project is **UNPUBLISHED** — preview is a development server; the app has no public deployment as of the baseline.

## Explicitly NOT in existence before Oct 27

- No public repository (repo is private at baseline).
- No published/deployed app.
- No second live Spark call (the Oct 24 run stands at n=1).
- No real SMS (Twilio registration prepared only; no sending).
- No real patient data anywhere in the system — synthetic data only.
- Invitations (I-1) and coverage-requirements migrations are merged but unapplied; the features they power are not live.

## Companion document

From Oct 27, a mirror log — *Built during the Hackathon (Oct 27 – Nov 4)* — records each in-window item with its date and commit. The submission's delineation section and the demo video's labeling are to be written from these two documents only.

## Re-verification (Oct 26, 2026, ~08:05 CT)

- `main` HEAD re-checked via GitHub: still `88ff7937ca806a159a212ffe34a927407f9fdb55`. Newest pull request is still #43. **No commits or pull requests have landed since Oct 24.** The baseline is unchanged. (Any commit landing later on Oct 26 remains pre-period and must be appended here; the period boundary is 2026-10-27T05:00:00Z.)

## Addendum — October 26 verification runs (still pre-period)

Two live runs were made on Oct 26, after the re-verification above. Both are **pre-period** (the building period opens Oct 27) and are recorded here, in the baseline record — they do not belong in the hackathon build log.

- **Attempt 1 (~16:25 CT, under Andre's one-call authorization to Pepper):** the UI returned `network_error` — "The request failed before a reply arrived." Code-level investigation (same day) proved the request passed all gates and exactly one POST was dispatched. Meta's dashboard (key "meta-spike") subsequently recorded the request: input tokens counted, no completed output — the generation was interrupted or its reply lost in transit. No application fault; no code change resulted.
- **Attempt 2 (Andre's own decision, completed before 17:09 CT): SUCCESS.** HTTP 200 · 9,732 ms · tokens in/out/reasoning 759/1821/1610. All known-answer checks green: Lisinopril change found; blood-test follow-up found; ankle-swelling watch item found; **items from a non-doctor turn: 0**; items kept 4, dropped for missing evidence 0. Findings identical to Oct 24: Lisinopril ten→twenty milligrams starting tomorrow (quote at 12.1 s); blood test within two weeks (31.5 s); follow-up visit after the blood test (60.5 s); watch ankles for swelling (49.6 s). Drafts only; nothing saved.
- **Consequences for the record:** (a) the Oct 24 result is now reproduced — two successful live extractions with identical findings (plus one transit-failed attempt); (b) the PR #43 spelled-out-dose check is **live-confirmed** — the medication renders "ten milligrams → twenty milligrams" and the known-answer check passes, so the baseline limitation "dose-checker fix not reconfirmed live" is RETIRED as of Oct 26. The other stated limitations stand (fixed fictional transcript; the validator does not yet independently verify every medication value — that is Feature A of the development plan); (c) Meta dashboard attribution: the app's calls run under the key labeled **"meta-spike"** (Oct 24: 1 request; Oct 26: 2 requests; range spend ≈ $0.01). The key labeled "Pendia Devel…" shows zero usage and has never served the app. **Do not revoke the "meta-spike" key in any cleanup — it is the live path's key.**

## Addendum — PR #44 merged Oct 26 (baseline HEAD moves to b0ad286)

- **PR #44** — "Spark client: classify network failures; report redirects (diagnostics only)" — merged 2026-10-26T21:58:05Z; merge commit `b0ad28676ee7bbc2e64ea6e88b82acfc6698a0d4`; change commit `f62ab928`. Verified by Pepper directly against GitHub, Oct 26.
- **What it changes** (`src/server/spark-live.server.ts` only): failures before a reply are now classified — `dns_failure`, `connection_failed`, `tls_failure`, `timeout`, or `network_error` with an allowlisted cause code — instead of one anonymous `network_error`; redirects are refused as `redirect_refused` (status + target host only, never followed, so the key cannot travel); HTTP 401/403 messages now say the key was rejected or lacks access. Docs gained a failure-code table and a "which key the app uses" note (the code reads only `META_API_KEY`; it cannot identify the stored key). Request body, model, endpoint, parser, validation, gates, rate caps, and the one-call/no-retry rule are unchanged. 49 new offline tests; suite reported 1,174/1,174 (Claude-reported; not re-run by Pepper).
- **Why it exists:** the Oct 26 `network_error` was undiagnosable beyond its class. PR #44 does not claim to fix that failure — its root cause remains unestablished (transient network/Meta fault, a previously invisible redirect, or a runtime egress issue are the standing hypotheses). The next failure, if any, will name its class.
- **Classification:** merged before Oct 27, so PR #44 is **baseline** (pre-period), not in-window work. It is the last baseline entry.

## Prepared, awaiting Andre's explicit approval — NOT executed

1. **Annotated Git tag** (prepared Oct 26; do not create or push without approval):
   - Name: `pre-hackathon-baseline`
   - Target: `b0ad28676ee7bbc2e64ea6e88b82acfc6698a0d4` (updated Oct 26 after PR #44 merged; the period-opening HEAD governs)
   - Annotation: "Pendia pre-hackathon baseline — the state of main at the opening of the Meta Global AI Developer Hackathon building period (Oct 27, 2026). All functionality at this commit pre-dates the building period. See pendia-pre-oct27-baseline.md."
   - Effect: a permanent, judge-visible marker separating pre-period work from everything built Oct 27 – Nov 4.
2. **Commit this document into the repository** (with the hackathon build log), so the delineation travels with the code when the repo becomes public.

---

*Prepared by Pepper, Oct 26, 2026, from a direct GitHub pull. Andre's review pending. Nothing in this document has been published, committed to the repo, or shared.*
