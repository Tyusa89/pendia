# Meta Voice Transcribe: one-shot REST test (Phase M1, PREPARATION ONLY)

**Status: prepared offline. Nothing here has called Meta, spent credits, deployed, or read a secret.** The live call is
disabled by default and needs a separate, explicit founder authorization.

Synthetic data only. `META_API_KEY` is server-side only: it is read from the process environment by `cli.ts` and
nowhere else, never written to a file, log, error, scorecard or artifact.

## Contract (corrected in the follow-up to PR #37)

The first version of this runner guessed the multipart field names and the response keys. The founder supplied the documented
contract from <https://dev.meta.ai/docs/speech-to-text>, and the code follows it. **That page could not be fetched from the
build sandbox (DNS failure), so it was not re-read here.** The founder independently checked Meta's official multipart example
and reported it to this repository's maintainers; the layout below matches that example, which is:

```sh
curl -X POST https://api.meta.ai/v1/asr/transcribe -H "Authorization: Bearer $META_API_KEY" \
  -F 'request={"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"};type=application/json' \
  -F 'audio=@rest-synthetic.wav'
```

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
| Content-Type of the `request` part                 | `application/json`                                                                | Documented (official example)    |
| `filename` on the `request` part                   | none: `request` is a plain form field                                             | Documented (official example)    |
| Format of `speaker` labels                         | any non-empty text or number                                                      | Not specified                    |
| Whether this model really separates the two voices | the point of the test                                                             | Unknown                          |

The earlier guesses (`file`/`model`/`mode` parts; `text`, `start`, `end` keys; seconds) are rejected, not tolerated: a reply
in any other shape fails closed, and the scorecard reports the key names it saw (never values).

### Multipart layout (written by hand to match the official example)

The platform `FormData` cannot send a JSON field with a Content-Type but no filename (it adds `filename="blob"` to any Blob), so
`request.ts` writes the multipart body itself. On the wire:

```
--<boundary>
Content-Disposition: form-data; name="request"
Content-Type: application/json

{"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"}
--<boundary>
Content-Disposition: form-data; name="audio"; filename="rest-synthetic.wav"
Content-Type: audio/wav

<the WAV bytes>
--<boundary>--
```

The `request` part has `Content-Type: application/json` and **no filename**; `audio` is the WAV, byte for byte. The boundary is
random per request and is checked not to occur in the audio. Tests parse the real serialized bytes (and the platform's own
multipart parser) to check this. Small remaining differences from curl, none of which should matter to a server: curl's own
`Content-Type` guess for a `.wav` file may differ from `audio/wav`, and curl's boundary format differs.

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

## GitHub Actions path (NOT the chosen path)

**Required reviewers is unavailable for this private repository on the current GitHub plan, so GitHub cannot pause this workflow for a second approval.** The chosen path is a local run (next section). Anything below is only relevant if the workflow is ever used, and must not be treated as independent approval.

### One-time GitHub setup (needs a repository admin; nothing here has been configured)

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

## Running the single test locally on Windows (the chosen path)

Windows support: repository paths use `fileURLToPath` and `path.relative` (not a URL's `.pathname`), so `C:\...` paths, spaces and
other drives work; tests feed Windows paths through Node's win32 rules. **`generate` is not supported on Windows** (it needs
ffmpeg with `flite` and a POSIX temp path), so use the pre-generated clip.

Prerequisites: Node 22.18 or newer (`node --version`), Git. No `npm install` is needed (only Node built-ins are used).

```powershell
git clone https://github.com/Tyusa89/pendia.git C:\pendia-spike\pendia
cd C:\pendia-spike\pendia
git checkout feature-m1-meta-rest-contract-fix
git rev-parse HEAD        # must equal the commit the maintainers give you
```

Put the clip and its timings outside the repo, e.g. `C:\pendia-spike\audio\rest-synthetic.wav` and `rest-synthetic.timings.json`;
check with `Get-FileHash <file> -Algorithm SHA256` against the hash the maintainers give you.

Offline checks (no key set, nothing sent):

```powershell
$env:META_API_KEY            # prints nothing
node spike/rest/cli.ts check --wav C:\pendia-spike\audio\rest-synthetic.wav
node spike/rest/cli.ts plan  --wav C:\pendia-spike\audio\rest-synthetic.wav
node spike/rest/cli.ts run   --wav C:\pendia-spike\audio\rest-synthetic.wav     # "Disabled ... Nothing was sent."
```

Supply the key without printing it, committing it, or saving it in history (process-scope only; never `setx`):

```powershell
Set-PSReadLineOption -HistorySaveStyle SaveNothing
$s = Read-Host "Meta key (hidden)" -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$env:META_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); $s = $null
```

The one live call, ONLY after the founder's written go-ahead:

```powershell
$env:SPIKE_ALLOW_LIVE = "I_HAVE_APPROVAL"
node spike/rest/cli.ts run --wav C:\pendia-spike\audio\rest-synthetic.wav --timings C:\pendia-spike\audio\rest-synthetic.timings.json --live --confirm-one-call
Get-Content spike-output\rest-scorecard.json      # sanitized: numbers, codes, key names; no transcript text, no key
Remove-Item Env:META_API_KEY, Env:SPIKE_ALLOW_LIVE -ErrorAction SilentlyContinue
```

Then close the terminal and revoke or rotate the key. The runner makes exactly one request and never retries; it claims a latch and
an exclusive lock file (`spike-output\rest-call.lock`) before sending, so a failed call still blocks a second attempt. Do not delete
the lock to try again: a second attempt needs a new written authorization.

**Stop conditions (no request is sent or no further action is taken):** any guard refusal; HTTP error (including 400/401/403/429);
timeout; malformed reply. Do not retry.

## Estimated cost of one call

Listed price $0.18 per audio hour (secondhand, from Meta's model page via search). The clip is about 58 s, so one call is about
$0.003; at the 2-minute ceiling about $0.006. Rate limits and any minimum charge are unknown.
