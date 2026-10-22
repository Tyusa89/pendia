# Meta Voice Transcribe: one-shot REST test (Phase M1, PREPARATION ONLY)

**Status: prepared offline. Nothing here has called Meta, spent credits, deployed, or read a secret.** The live call is
disabled by default and needs a separate, explicit founder authorization.

Synthetic data only. `META_API_KEY` is server-side only: it is read from the process environment by `cli.ts` and
nowhere else, never written to a file, log, error, scorecard or artifact.

## What is verified and what is not

Meta's own page, <https://dev.meta.ai/docs/speech-to-text>, could **not** be reached from the build sandbox (DNS
failure), so **nothing below is verified against official documentation**. The Muse research report is the source.

| Item | Source | Status |
| --- | --- | --- |
| `POST https://api.meta.ai/v1/asr/transcribe` | Muse research report | Unverified |
| Model `muse-voice-transcribe-1.0` (Standard tier, never `-contributor`) | Report; project rule | Unverified ID |
| Mode `DIARIZATION` | Report | Unverified |
| `Authorization: Bearer <key>` | Report | Unverified |
| Mono 16-bit PCM WAV, 16 or 24 kHz, <= 10 min, <= 32 MB | Report | Unverified |
| **Multipart field names** `file`, `model`, `mode` | **Assumption** (`request.ts`) | **Unverified** |
| **Response field names** (`turns[].speaker/text/start/end`, seconds) | **Assumption** (`response.ts`, alias table) | **Unverified** |
| Whether the file endpoint returns speaker labels at all | Report | The point of the test |

Each assumption lives in `config.ts`, `request.ts` or `response.ts`. **Before authorizing the live call, someone with access
should read the official page and correct them.** If the real reply differs, the scorecard still reports the key *names*
it saw (never values), so the parser can be fixed without ever printing a transcript.

## Files

| File | Purpose |
| --- | --- |
| `config.ts` | Endpoint, model, mode, limits, timeout, approval token, error type |
| `wav-check.ts` | Validates format, duration, size |
| `request.ts` | Builds the single POST; `describeRequest` for the redacted plan |
| `response.ts` | Strict parser for the reply; key-name-only shape report |
| `run.ts` | The one-shot runner: guards, single-call latch + lock, timeout, no retry, redaction |
| `scorecard.ts` | Sanitized scorecard; word error rate |
| `synth.ts` | Local synthetic two-voice audio (ffmpeg `flite`), deterministic layout, real overlaps |
| `cli.ts` | `generate`, `check`, `plan`, `run` |
| `tests/` | Offline tests (no network) |
| `../../.github/workflows/meta-rest-spike.yml` | Manual, protected workflow |

Reused from `../diarization/`: the script parser and ground truth, the scorer and its thresholds (unchanged: at least
90% turn accuracy, zero patient-to-doctor leakage, fail closed), `scrubSecret`, `assertStandardModel`, `safeOutputPath`.

## Synthetic audio

`fixtures/spike/two-voice-script.md` (12 fictional turns) is the ground truth. `generate` speaks it with ffmpeg's built-in
`flite` voices (`rms` for Dr. Patel, `slt` for Rosa), places the turns with seeded pauses of 0.4-0.8 s, and **overlaps turns 7
and 8** (summed samples, up to 1.2 s), which is the script's one marked interruption (two overlap turns, as the scorer counts
them). Result: about 58 s, mono 16-bit 16 kHz, about 1.9 MB, plus a `timings.json` for seconds-weighted scoring. No paid
service, no download, no real voice. flite voices are robotic, so a pass shows the plumbing and scoring work, not how real
visits will sound.

```sh
bun run spike:rest generate                       # needs ffmpeg with libflite
bun run spike:rest check --wav spike-output/rest-synthetic.wav
bun run spike:rest plan  --wav spike-output/rest-synthetic.wav     # redacted request; sends nothing
bun run spike:test                                # all spike tests, offline
```

Audio and scorecards are written only under the git-ignored `spike-output/` (owner-only). They cannot be committed.

## Safety properties of the runner

- Disabled by default: `run` needs `--live --confirm-one-call` **and** `SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL`.
- Exactly one request: no retry loop exists; a process latch and an exclusive lock file refuse a second call.
- Endpoint locked to the exact URL (https, host `api.meta.ai`, that path, no port, credentials, query or fragment).
- Explicit 90 s timeout, `redirect: "error"`, reply size capped at 2 MB, the reply body is never copied into an error.
- Errors carry fixed codes only (`http_429`, `timeout`, `malformed_response`, ...), with the key and any `Bearer` token scrubbed.
- The scorecard holds numbers, booleans, turn numbers, fixed codes and key names. Tests prove no transcript text appears.
- Nothing in `dev`, `build`, `lint`, `test` or `spike:test` runs the CLI; the application never reads `META_API_KEY`.

## One-time GitHub setup (needs a repository admin; I have not changed any settings)

1. **Settings -> Environments -> New environment**, name exactly `meta-spike`. Create it **before** the first run: GitHub
   silently creates a missing environment with *no* protection when a workflow names it.
2. In `meta-spike`: **Required reviewers** -> add the founder (and nobody who should not be able to release a paid call).
   Leave "Prevent self-review" as appropriate for a one-person team, and tick **Prevent administrators from bypassing** if offered.
3. **Deployment branches and tags -> Selected branches -> `main`** only.
4. **Environment secrets -> Add secret** `META_API_KEY` (the Pendia Development key). Then **delete the repository-level
   `META_API_KEY`** so no other workflow can ever read it. (If you keep it, the protections above still gate this workflow,
   but any future workflow could use the repository secret.)
5. The workflow file must be on `main` to run (it refuses other refs), so it can only be used after the PR is merged.

If any step is missing, do not run it. The workflow fails closed: wrong ref, wrong approval phrase, or missing secret all stop
the job before a request is made.

## Exact approval and execution procedure (for a later, separate authorization)

1. Founder reads the official documentation and confirms or corrects the assumptions table above.
2. Founder authorizes exactly one live request in writing.
3. Merge the PR (separate approval), complete the GitHub setup above.
4. **Actions -> Meta REST spike (manual, protected) -> Run workflow** on `main`; type `I_HAVE_APPROVAL`.
5. The job pauses for the environment reviewer; approve it once.
6. The job generates the audio, validates it, prints the redacted request, makes **one** request, and writes the sanitized
   scorecard to the job summary. No artifacts are uploaded.
7. Read the scorecard. A second attempt needs a new authorization and a fresh run.

**Stop conditions (no request is sent or no further action is taken):** official docs not reviewed; environment, secret or
branch rule missing; any guard refusal; HTTP error (including 401/403/429); timeout; malformed reply. Do not retry.

## Estimated cost of one call

Listed price $0.18 per audio hour (secondhand, from Meta's model page via search). The clip is about 58 s, so one call is about
$0.003; at the 2-minute ceiling about $0.006. Rate limits and any minimum charge are unknown.
