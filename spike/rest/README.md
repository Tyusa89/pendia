# Meta Voice Transcribe: one-shot REST test (Phase M1, PREPARATION ONLY)

**Status: prepared offline. Nothing here has called Meta, spent credits, deployed, or read a secret.** The live call is
disabled by default and needs a separate, explicit founder authorization.

Synthetic data only. `META_API_KEY` is server-side only: it is read from the process environment by `cli.ts` and
nowhere else, never written to a file, log, error, scorecard or artifact.

## Contract (corrected in the follow-up to PR #37)

The first version of this runner guessed the multipart field names and the response keys. The founder supplied the documented
contract from <https://dev.meta.ai/docs/speech-to-text>, and the code now follows it. **That page still could not be fetched
from the build sandbox (DNS failure), so it was not re-read here; the contract below is taken from the founder's
transcription of it.**

| Item                                               | Value                                                                             | Status                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| Endpoint                                           | `POST https://api.meta.ai/v1/asr/transcribe`                                      | Documented (per founder)         |
| Model / mode                                       | `muse-voice-transcribe-1.0` (Standard, never `-contributor`) / `DIARIZATION`      | Documented                       |
| Authentication                                     | `Authorization: Bearer <key>`                                                     | Documented                       |
| Multipart parts                                    | `request` (JSON) and `audio` (the WAV)                                            | Documented                       |
| `request` JSON                                     | `{"model": ..., "mode": ..., "audioEncoding": "WAV"}`, exactly these three fields | Documented                       |
| Audio                                              | mono 16-bit PCM WAV, 16 or 24 kHz, <= 10 min, <= 32 MB                            | Documented (per research report) |
| Reply                                              | `sessionId`, `transcript`, `audioDurationMs`, `turns[]`                           | Documented                       |
| Turn                                               | `turnId`, `startMs`, `endMs`, `transcript`, `speaker`                             | Documented                       |
| Timestamps                                         | **milliseconds** (converted to seconds internally)                                | Documented                       |
| Content-Type of the `request` part                 | sent as `application/json`                                                        | **Not confirmed**                |
| `filename` on the `request` part                   | the form-data API sends `filename="blob"` for a JSON Blob                         | **Not confirmed**                |
| Format of `speaker` labels                         | any non-empty text or number                                                      | Not specified                    |
| Whether this model really separates the two voices | the point of the test                                                             | Unknown                          |

The earlier guesses (`file`/`model`/`mode` parts; `text`, `start`, `end` keys; seconds) are rejected, not tolerated: a reply
in any other shape fails closed, and the scorecard reports the key names it saw (never values).

### Unverified multipart detail (deliberately NOT changed)

Serialized offline, the request goes out as:

```
request: Content-Disposition: form-data; name="request"; filename="blob"   Content-Type: application/json
audio:   Content-Disposition: form-data; name="audio"; filename="synthetic-visit.wav"   Content-Type: audio/wav
```

Two details are **not confirmed by Meta's documentation**: (1) the `Content-Type` of the `request` part (`application/json` is
the usual convention but is a guess), and (2) the `filename="blob"` that the platform adds to a JSON part, which a server could
treat as a file upload rather than a form field. **No correction has been made and none should be guessed.** Before the live
call, someone who can reach the page must compare against the **official example** (likely a `curl -F` line showing how
`request` is sent, with or without `;type=application/json`) and then change `request.ts` in one place if it differs. If the
guess is wrong the single call will most likely come back HTTP 400/415 and, as always, is not retried.

## Files

| File                                          | Purpose                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `config.ts`                                   | Endpoint, model, mode, limits, timeout, approval token, error type                    |
| `wav-check.ts`                                | Validates format, duration, size                                                      |
| `request.ts`                                  | Builds the single POST; `describeRequest` for the redacted plan                       |
| `response.ts`                                 | Strict parser for the reply; key-name-only shape report                               |
| `run.ts`                                      | The one-shot runner: guards, single-call latch + lock, timeout, no retry, redaction   |
| `scorecard.ts`                                | Sanitized scorecard; word error rate                                                  |
| `synth.ts`                                    | Local synthetic two-voice audio (ffmpeg `flite`), deterministic layout, real overlaps |
| `cli.ts`                                      | `generate`, `check`, `plan`, `run`                                                    |
| `tests/`                                      | Offline tests (no network)                                                            |
| `../../.github/workflows/meta-rest-spike.yml` | Manual, protected workflow                                                            |

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
- The workflow reads the key only from the environment secret `META_SPIKE_ENV_API_KEY` and refuses (before the CLI starts) when it is empty.

## One-time GitHub setup (needs a repository admin; nothing here has been configured)

**Order matters: do all of this, and verify it in GitHub, BEFORE this PR is merged.** Merging is the moment the workflow
becomes dispatchable. The environment can be created before the workflow file exists.

1. **Settings -> Environments -> New environment**, name exactly `meta-spike`. GitHub silently creates a missing environment
   with _no_ protection when a workflow names it, so it must already exist, configured, when the workflow first runs.
2. In `meta-spike`: **Required reviewers** -> add the founder (and nobody who should not be able to release a paid call).
   Leave "Prevent self-review" as appropriate for a one-person team, and tick **Prevent administrators from bypassing** if offered.
3. **Deployment branches and tags -> Selected branches -> `main`** only.
4. **Environment secrets -> Add secret** named exactly **`META_SPIKE_ENV_API_KEY`** (the Pendia Development key), **inside
   `meta-spike`, not as a repository secret.** The workflow reads _only_ this name. The existing repository-level `META_API_KEY`
   is **not used** by this workflow and is never read by it; whether to keep or delete that repository secret is a separate
   decision, and nothing in this repository touches it.
5. **Verify independently in GitHub** (the workflow cannot check these for you): open Settings -> Environments -> `meta-spike`
   and confirm that Required reviewers lists the right person, Deployment branches shows Selected branches = `main`, and the
   environment (not the repository) holds `META_SPIKE_ENV_API_KEY`. Only then merge.
6. The workflow file must be on `main` to run (it refuses other refs), so it can only be used after the PR is merged.

**What the workflow does if setup is incomplete.** The key comes only from `secrets.META_SPIKE_ENV_API_KEY`. If the
environment or that secret is missing, GitHub supplies an empty value, the live step's guard prints a refusal and exits
before the CLI starts, and (as a second layer) the CLI itself refuses an empty key before claiming the single call. So an
auto-created, unprotected environment cannot reach the repository-level key. **This is a second layer only:** it does not
replace the required reviewer or the main-only rule, which stop an unauthorized run from starting at all, and it cannot
detect them. Configure and verify those first.

## Exact approval and execution procedure (for a later, separate authorization)

1. Founder (or a reviewer who can reach the page) reads the official documentation once more and confirms the contract table above, in particular the Content-Type of the `request` part.
2. Founder confirms the multipart `request` part against the official example (see "Unverified multipart detail"), then authorizes exactly one live request in writing.
3. Complete and independently verify the GitHub setup above, **then** merge the PR (separate approval).
4. **Actions -> Meta REST spike (manual, protected) -> Run workflow** on `main`; type `I_HAVE_APPROVAL`.
5. The job pauses for the environment reviewer; approve it once.
6. The job generates the audio, validates it, prints the redacted request, makes **one** request, and writes the sanitized
   scorecard to the job summary. No artifacts are uploaded.
7. Read the scorecard. A second attempt needs a new authorization and a fresh run.

**Stop conditions (no request is sent or no further action is taken):** official docs not re-read by someone who can reach them; environment, secret or
branch rule missing; any guard refusal; HTTP error (including 401/403/429); timeout; malformed reply. Do not retry.

## Estimated cost of one call

Listed price $0.18 per audio hour (secondhand, from Meta's model page via search). The clip is about 58 s, so one call is about
$0.003; at the 2-minute ceiling about $0.006. Rate limits and any minimum charge are unknown.
