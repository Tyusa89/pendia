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
