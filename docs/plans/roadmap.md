# Pendia Roadmap

Consolidated from the owner-approved plans (Oct 21, 2026). Individual plan documents live in this folder and in the owner's workspace; this file is the ordering index. Nothing here authorizes merges, deploys, production migrations, or paid API calls — each phase proceeds on the owner's separate approval.

## Design rule (binding on all phases)

Mobile-first and responsive: design/test primarily for Samsung Android phones; every screen also renders cleanly at tablet (~768px) and desktop (~1280px). Wider layouts may rearrange (list+detail on tablet, left sidebar ≥1024px, content ≤1120px centered) but never gain features. Touch targets ≥44px, body text ≥16px, respect OS text scaling. Core principle: AI is an option, not an obligation — every essential workflow works without AI; the AI never makes care or medical decisions, never invents missing facts, and runs on Meta Standard tier only (never `-contributor` model IDs).

## Core platform phases (approved order)

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundations hardening (RLS, visibility, confirm guards) | Merged |
| A | Persistent handoff audio (private storage, WAV capture) | Merged (PR #14) |
| V0 | Care-recipient scoping (multi-recipient foundation) | Planned — precedes/folds into V1 |
| V1 | Visits become appointments (lifecycle on `visit`) | Merged (PR #15); migration 20261021000004 pending owner approval to apply |
| M1 | Medication depth + administration records (incl. explicit unconfirmed state; capture via handoffs and Medications page) | Planned |
| N1 | Notification center (in-app; push N2 and email N3 follow) | Planned |
| R1 | Incomplete-information reminders (computed flags, capped, stop-on-resolve) | Planned |
| D1 | Weekly digest generation (template-first, per-recipient, EN/ES) | Planned |

## Dual-experience (AI) phases

| Phase | Scope | Status |
|---|---|---|
| B | Dictation transcription via Meta Voice Transcribe (file endpoint) | Planned — first Meta call in the product |
| C | Diarization spike verdict (streaming vs file for visit capture) | Blocked on spike inputs |
| D | Visit loop: record → diarized transcript → Spark extraction → human review/Confirm, with cached Demo Mode | **Demo Mode built** (public `/demo` + in-app `/visits/demo`; PRs #31-#33, drafts). Live providers (Muse Voice Transcribe, Spark 1.3) wait on the live spike; the speaker-WAV spike is paused. |
| E | SMS loop (Twilio): task assignment, DONE replies, gap claim | Planned |
| F | Digest + `ask` (visibility-scoped, cited answers) | Planned |
| G | Invitation/sharing audit (least-privilege defaults) | Planned |

## Proposed addition

| Phase | Scope | Status |
|---|---|---|
| S | **Pendia Smart Scan** — photograph/upload visit paperwork; Muse Spark 1.3 (Standard, image input) extracts medication instructions, follow-ups, watch items, care instructions; compared against records; per-item human approval before anything is written; never overwrites, never prescribes; consent-gated; synthetic documents only until the data-handling gate passes | **PROPOSED** — see `smart-scan-plan.md`; sequenced after Phase D, reusing its extraction/review infrastructure |

## Research track (no implementation authorized)

| Track | Scope |
|---|---|
| F1 | Epic FHIR / Duly Health and Care (MyChart): direct patient-access route first. Consent is the care recipient's or their legal proxy's. Manual entry remains fully functional regardless. |

## Standing gates

- Demo path end-to-end by Oct 30 or the pre-agreed cut order executes. Feature freeze end of Nov 2; demo video Nov 3; submit Nov 4 mid-afternoon CT.
- No real patient data reaches any AI provider until the data-handling gate (terms re-verified, consent flows shipped, retention/deletion shipped and tested, owner sign-off) passes.
