# Pendia hackathon development log

Meta Global AI Developer Hackathon, Startup track. Building period: October 27 - November 4, 2026.

This log records **what was started when, from which baseline**, so newly built functionality can be told apart from what existed
before October 27. Append-only: add a new entry, never rewrite an old one. Times are given in UTC and in Central Time (CDT, UTC-5).
Nothing here describes behavior as working unless it was observed; see each PR for evidence.

## Pre-period baseline

Everything merged before the building period began is **not** new hackathon work: Demo Mode, the Spark extraction contract and
leakage guard, the gated live provider and its network diagnostics, the dev-page known-answer check, Confirm/Reject review, coverage
scheduling, handoffs and recordings, appointments, and the first live extraction (October 24). The baseline commit for the building
period is `main` @ `b0ad286` (merge of PR #44, October 26, 2026).

## Entries

### 2026-10-27 05:06:40 UTC (00:06:40 CDT): Feature A started

- **Feature:** A, independent medication-value verification (priority 1 in the hackathon development plan).
- **Authorization:** the founder's approval for the Oct 27 00:00 CDT (05:00 UTC) start, baseline `b0ad286`.
- **Start check:** clock read 2026-10-27 05:06:40 UTC; `origin/main` was `b0ad286`, unchanged since approval.
- **Baseline:** `main` @ `b0ad286`.
- **Branch:** `feature-a-med-value-verification`, branched from `b0ad286`.
- **Scope:** medication items only; labels each accepted item `value-verified` or `unverified` by reading the doctor's quote on its own.
  Timing, frequency and the instruction as a whole are not verified. Unverified items stay visible.
- **Restrictions in force:** no live Meta calls, migrations, merges, deployments or publishing without separate approval.
- **Pull request:** draft PR #45 (see the PR for tests and limitations).

### 2026-10-27 05:49:40 UTC (00:49:40 CDT): Feature C started

- **Feature:** C, medication administration reporting (Option B: persistent, permission-controlled; not demo-only).
- **Authorization:** the founder's "Feature C Full Implementation Authorization".
- **Baseline:** `main` @ `12af319` (merge of PR #46).
- **Branch:** `feature-c-dose-administration`.
- **Scope:** organizer-defined fixed-time schedules; occurrences computed, never stored or inferred from free text; Given / Not given /
  Not confirmed as a family member's report (never "verified"); append-only history; corrections and disagreement flags; synthetic Demo Mode
  at `/demo-meds`. Feature A verification stays independent.
- **Restrictions in force:** the migration `20261027000001_dose_administration.sql` is committed but **not applied**; no merges,
  deployments, publishing, credential changes or live Meta calls without separate approval.

### 2026-10-28: Care Agent MVP implemented (draft PR; not enabled)

- **Feature:** read-only, stateless, record-grounded Care Agent ("Ask Pendia") for demo families only, using Muse Spark 1.3 Standard.
- **Authorization:** the founder's Oct 28 approval under Pepper's complete GO review (Rev 3 specification: `docs/design/care-agent.md`).
- **Baseline:** `main` @ `35ccecafd7b21fe26a86f699eb9c5130045fed23`; branch `feature/care-agent-mvp`.
- **State:** built and tested offline only. `AGENT_LIVE_ENABLED` is off, `features.assistant` is `false`, no secret was touched and no Meta
  call was made. It is enabled only on the server, for the demo family, during the controlled test window.
- **Restrictions in force:** no merge, deployment, enablement or live probe without separate approval; stops for Pepper's code audit.
