# Spark live provider (server-only, gated, synthetic-only)

**Status: implemented and tested offline with fake network responses. It has never called Meta. It is OFF by default and
nothing in the app links to it.** Live transcription (Voice Transcribe) stays paused and is unrelated to this path.

## What it is

A server function that sends the **doctor-mapped turns of the built-in fictional visit** to Meta Muse Spark 1.3 (Standard
tier), validates the answer with the merged Spark contract (`src/lib/visit-pipeline/spark-contract.ts`), and returns a
**draft** with its evidence. Nothing is saved, no database is touched, and Demo Mode does not know it exists.

| Piece                                                                          | File                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Request body builder, wire schema, response parser (pure)                      | `src/lib/spark/spark-http.ts`             |
| The only accepted input: the fixed fixture id                                  | `src/lib/spark/spark-live-input.ts`       |
| One-shot Meta client (server only: bounded, timeout, no redirects, no retries) | `src/server/spark-live.server.ts`         |
| Gates, fixed fixture, rate cap, contract call (server only)                    | `src/server/spark-synthetic.server.ts`    |
| Authenticated server functions                                                 | `src/lib/spark/spark-live.functions.ts`   |
| Hidden development page `/dev-spark`                                           | `src/routes/_authenticated/dev-spark.tsx` |

## Gates (all must pass, checked on the server)

1. Signed in (`requireSupabaseAuth`) on both server functions.
2. `SPARK_LIVE_ENABLED` is exactly `true` (default: off).
3. The caller's user id is in `SPARK_LIVE_USER_IDS` (comma-separated; empty = nobody). Callers who are not listed learn nothing
   about the configuration: the status is just `{ enabled: false }` (no reason, no id). Find your own id in the Supabase auth
   users list; the page does not show it.
4. `META_API_KEY` is set on the server. It is read only in `spark-synthetic.server.ts`, never returned, logged or sent to the browser.
5. Per-user rate cap (5 per 10 minutes) and a per-instance cap (20). **Both caps live in server-instance memory: they are per
   server instance, reset on restart or cold start, and are not shared between instances. They are a guard against accidental
   repeats, not a global spending limit. The real spending limit is the one set on the Meta key itself.**
6. The browser sends only `{ fixtureId: "demo-visit-1" }`; any other field or value is rejected. The server loads the fixture itself.

## Enabling it (a separate, explicit approval; not part of this PR)

Set `SPARK_LIVE_ENABLED=true`, `SPARK_LIVE_USER_IDS=<your id>` and `META_API_KEY` in the Lovable server environment, open
`/dev-spark` while signed in, and press the button once. Turn the flag off again afterwards.

## Meta API contract: what is and is not verified

Meta's own pages (`ai.developer.meta.com`) could not be opened from the build sandbox. Reported by search summaries of those
pages and by third-party integrations (LiteLLM, promptfoo, OpenClaw):

- Base URL `https://api.meta.ai/v1`, OpenAI-compatible Chat Completions (`POST /chat/completions`), Bearer key.
- Structured output on Chat Completions uses `response_format`; the Responses API's `text.format` sent there is a 400.
- Model ids `muse-spark-1.3` (Standard) and `-contributor` (never used here).
- The model always reasons: `reasoning_effort: "none"` is a 400 (this code uses `"low"`); reasoning tokens are billed as output and
  count toward the output cap (hence `max_completion_tokens: 6000`).
- Standard pricing $1.25 / $4.25 per million input / output tokens.

**Matches Meta's documented structured-output example** (muse-spark-1.3, Chat Completions): `response_format = { type: "json_schema",
json_schema: { name, schema } }`, answer read from `choices[0].message.content`. No `strict` field is sent.

**UNVERIFIED (settled only by the first live call):** which JSON-Schema keywords Meta accepts (including nullable `type` arrays; the wire schema deliberately uses only `type`, `properties`, `required`, `additionalProperties`,
`items`, `enum`, while every length/pattern/count limit is still enforced locally); the max-tokens parameter name; the refusal field;
the error-body shape; timeouts; and the Standard data-policy text for 1.3.

## Failure behaviour

Errors are fixed codes (`http_400`, `timeout`, `network_error (cause: ECONNRESET)`, `truncated`, `refused`, `invalid_answer`...).
No response body, prompt text or key is ever returned or logged. For `invalid_answer` only the answer's size and its top-level key
**names** are shown. An allowlisted provider error token (for example `invalid_request_error`) and an allowlisted transport cause
code (for example `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) are surfaced because they are non-sensitive and make a failure diagnosable.

## Not in scope

Saving anything, a user-facing screen, transcripts other than the fixture, real patient data (the data-handling gate has not
passed), Voice Transcribe, and any change to Demo Mode.
