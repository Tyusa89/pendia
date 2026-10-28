# Care Agent MVP — Specification Rev 3 (as built)

Status: **implemented on `feature/care-agent-mvp`, disabled by default, never run live.** Rev 3 folds in Pepper's complete GO review
(Oct 28); where this text and that review differ, the review controls. No Meta call has been made by this work; the live probe is a
separate, user-run step (§12).

Labels: **[F]** founder-confirmed requirement · **[P]** Pepper reviewer-mandatory ruling · **[R]** reconstructed by the build lane
(the companion documents were unavailable; every [R] item is a decision for Pepper's audit) · **[REPO]** a verified fact about `main`.

## 1. Scope [F]

Read-only, stateless, record-grounded question answering over one family's Pendia records; server-side **demo families only**
(`family.is_demo = true`); no writes, persistence, conversation storage, tables, migrations or service-role client; no real-family
data in any model request; model `muse-spark-1.3` only (the existing `META_API_KEY`, never set, rotated or exposed here); no tools,
no extra request fields. `features.assistant` stays `false`; the operative switch is the server-side `AGENT_LIVE_ENABLED`, on only
when it is exactly `"true"`. The existing `/ask` placeholder is what every non-eligible caller sees, unchanged.

## 2. Pipeline and gate order [P]

`status` and `ask` each evaluate the whole chain independently (a successful status is never authorization).

1. Authenticated caller (`requireSupabaseAuth`).
2. Configuration: `AGENT_LIVE_ENABLED === "true"` and `META_API_KEY` present.
3. Allow-list: caller in `AGENT_LIVE_USER_IDS` (a caller outside it sees `not_enabled`; no state reveals the list).
4. Membership and `is_demo` (reads only the caller's member row and the family row).
5. Question validity (1–500 characters, no control characters, no fence tokens).
6. Deterministic EN/ES advice pre-filter. A hit returns canned copy with **zero record reads and zero provider calls**.
7. Rate limit: 10 per user per hour, 60 per server instance (in-memory; resets on cold start — see §11).
8. Context-pack assembly (caller's session, RLS). **Any failed read fails the whole question** (`context_failed`); never a partial pack.
9. ONE provider request (`buildCareAgentRequest`, one POST, key only in `Authorization`, `redirect:"manual"`, 60 s timeout, 1 MB
   bounded body, no retry, fixed error codes; no question, pack, provider body, header or key text in any error or log).
10. Parse and `validateAgentAnswer`.
11. Server-derived `sources`, or canned substitution (refusal / "unverified"). The model never writes refusal prose.

Result shape: `{ ok: true, language, answer, sources } | { ok: false, code, language }`. The pack and labels of uncited items never
reach the client.

## 3. Answer contract

`AgentAnswer { answer, citations: string[], missing: string[], refusal: "medical_advice" | "out_of_scope" | null }`; schema name
`care_agent_answer`; strict zod mirror with exact parity to the JSON schema. Nullable wire-type arrays are kept [P] (evidence:
four completed live Spark extractions plus one transit failure on Oct 26 — not five successes). A fallback wire format is
considered only if the authorized probe itself rejects the schema.
Limits: question 500; answer 1,200; citations 12; missing 6 × 200; ids ≤ 80. Pack ids are typed (`med:<id>`, `visit:<id>`,
`dose:<schedule>:<date>`, …) and matched **exactly**.

## 4. Validation (`validate.ts`)

Strict JSON → shape → refusal consistency (a refusal is silent: empty answer, citations, missing) → plain text only (no markup, URLs,
contact details) → exact citation ids (no unknown, no duplicates) → cited when factual → **numeric/date/time grounding [P]**: every
number, date and time in a non-refusal answer must trace to a *cited* item or be a count of cited items → advisory/diagnostic language
screen (EN/ES) → **"Not confirmed" is never "missed", "skipped", "not taken" or noncompliant [P]**. Failure codes are fixed; the
user sees the canned "unverified" copy, never raw model text.

## 5. Context pack (`pack.ts`)

Rendered ceiling **6,000 characters [P]**; per item 600 with word-boundary truncation ending in `[truncated]`; drop order watch items →
tasks → older doses; visibility and withheld-information lines are never dropped. Dose window **last 48 hours [P]** via the existing
`dose_occurrences` RPC. Bounded sections: next + latest visit with their medication changes, follow-ups and watch items (≤ 8), active
medications (≤ 12), the 3 latest handoffs, shifts in the next 7 days, coordination tasks/watch items (≤ 8). Raw **transcripts, audio
references, consent, speaker maps and phone numbers are excluded entirely [P]**. Coverage-gap computation is omitted because the
coverage-requirement tables are not in the live database ([REPO]).

### 5.1 Category gates and Amendment A (handoffs)

Each caller's own `can_see_meds / schedule / visits` gate whole categories at **query time** (a blind member's queries are never
issued). Handoffs: schedule-blind → zero handoff items; schedule-visible but medication-blind → `id`, a generic label, timestamp
and `ate` only, with the fixed withheld line, and the protected columns (`meds_taken`, `note`, `unusual`, `watch_answers`) are not even
selected. Offline sentinel tests prove the sentinel never reaches the request or the response.

### 5.2 Q1 free-text screen

Visit notes/summary/reasons, follow-ups, tasks and watch text can mention medications the caller may not see. For a medication-blind
caller the active medication names are loaded **only for screening**, and any free-text item containing one is replaced by a fixed
withheld line. If the name set cannot be loaded the screen fails closed (all such free text withheld).

## 6. Pre-filter (`prefilter.ts`)

Internal categories (urgent/triage, dose change, treatment, diagnosis, prognosis, manipulation, action) map to the two public refusal
codes `medical_advice` / `out_of_scope`. Spanish and English patterns are both covered. Ambiguity resolves to refusal; a plain lookup
that merely mentions a medication or symptom is not refused. Record text is data, never instructions.

## 7. Language [P]

English and Spanish from the start. The answer language follows the current question; too-short or tied questions fall back to the
member's language, default `en`. Canned refusal, "unverified" and withheld/missing copy exist in both, as does the Ask page copy.

## 8. Client

`/ask` renders the unchanged placeholder unless status is `available`. Available: demo banner, 500-character question box with a
counter, examples, **AI-generated** badge, sources as links to the record pages, a "Not in the records" list, footer. Conversation
state (≤ 2 earlier exchanges, never refusals) lives only in component memory and is cleared on leaving; nothing is written to browser
storage. A failed availability check is its own error (retry), never shown as "not enabled".

## 9. Protected areas (untouched)

Spark extraction/transcription/verifier/dose modules, `features.ts`, schema and migrations, secrets, the spike lock and scorecard.
Reused unedited from `src/lib/spark/spark-http.ts`: `SPARK_CHAT_URL`, `SPARK_REASONING_EFFORT`, `SPARK_MAX_OUTPUT_TOKENS`,
`toWireSchema`, `parseChatCompletion`, `SparkHttpError`; `SPARK_MODEL_ID` from the Spark contract.

## 10. Deviations and reconstructed decisions (for Pepper's audit)

1. **Q1 literal rule vs RLS.** A blind member cannot read the medication table through RLS; names are read only for the screen and
   fail closed (no service-role path). Behavior is stricter than the brief, never looser.
2. **Coverage gaps omitted** (tables not applied live).
3. **`visit.summary` included** (screened) per Pepper's list.
4. **Three existing guard tests' allow-lists were widened by exactly the Care Agent files**: `spark-contract.test.ts`,
   `spark-live-isolation.test.ts`, `spike/rest/tests/workflow.test.ts`. `care-agent-isolation.test.ts` holds the Care Agent's own guards.
5. All [R] items above (pack section sizes, regex coverage, UI layout) are proposals.

## 11. Known risks

The probe needs a dedicated demo-only account (an existing account binds to its real, non-demo family). The Lovable preview must run
this branch. The per-instance rate limit is in-memory. Demo data is sparse (no visits, handoffs, tasks or doses seeded), so the live
probe demonstrates medication grounding only. Live acceptance of the nullable schema is unverified until the probe.

## 12. Live probe (not part of this work)

Run only after Pepper's PR audit passes and the offline payload preview is checked, by the user, through `/ask` in the preview, with a
fresh demo-only account allow-listed for the window; the question below is asked exactly once; any failure is a failed probe (no
retry, no second question); afterwards `AGENT_LIVE_ENABLED` is turned back off. Question: *"What medication is listed in these
records, and which source supports that?"*
