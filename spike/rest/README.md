# Meta Voice Transcribe: one-shot REST test (Phase M1, PREPARATION ONLY)

**Status:** A local live-attempt script reported a transport-level network error before receiving an HTTP response. Whether
Meta received a request is unresolved. Live Voice Transcribe is unverified and excluded from the November 4 hackathon
submission. The live call is disabled by default and needs a separate, explicit founder authorization.

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

| File           | Purpose                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `config.ts`    | Endpoint, model, mode, limits, timeout, approval token, error type                                |
| `wav-check.ts` | Validates format, duration, size                                                                  |
| `request.ts`   | Builds the single POST; `describeRequest` for the redacted plan                                   |
| `response.ts`  | Strict parser for the reply; key-name-only shape report                                           |
| `run.ts`       | The one-shot runner: guards, single-call latch + lock, timeout, no retry, redaction               |
| `raw.ts`       | Saves the raw reply (status, allowlisted headers, body bytes) before anything is parsed or scored |
| `scorecard.ts` | Sanitized scorecard; word error rate                                                              |
| `synth.ts`     | Local synthetic two-voice audio (ffmpeg `flite`), deterministic layout, real overlaps             |
| `cli.ts`       | `generate`, `check`, `plan`, `run`                                                                |
| `tests/`       | Offline tests (no network)                                                                        |

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

## Proxy authentication (opt-in): `--auth-via-proxy`

Default behaviour is unchanged: the runner reads `META_API_KEY` from the environment and sends `Authorization: Bearer <key>`.

When the test is run from a Claude Cloud session, a **network secret** can hold the key instead: the agent proxy adds the
`Authorization: Bearer` header to requests for `api.meta.ai` after they leave the session's VM, so the key never enters this
process, its environment, a file or a log. For that case `--auth-via-proxy` (opt-in, off by default) changes exactly two things:

- no `Authorization` header is built or sent, and `META_API_KEY` is not required (a key that happens to be set is never sent
  and is still redacted from anything saved);
- the run is refused with `proxy_not_configured`, before the call is claimed, unless `HTTPS_PROXY` is set and
  `NODE_USE_ENV_PROXY=1`. Without that, Node's `fetch` would bypass the proxy and Meta would receive an unauthenticated
  request, using up the single call.

Everything else is identical: the exact endpoint lock, `--live --confirm-one-call`, `SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL`, the single
call and its lock file, `redirect: "error"`, the 90 s timeout, no retry, raw-reply preservation and redaction.

```sh
node spike/rest/cli.ts plan --wav spike-output/rest-synthetic.wav --auth-via-proxy      # prints no Authorization header; sends nothing
NODE_USE_ENV_PROXY=1 SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL node spike/rest/cli.ts run \
  --wav spike-output/rest-synthetic.wav --timings spike-output/rest-synthetic.timings.json \
  --live --confirm-one-call --auth-via-proxy
```

Not verified: that the proxy attaches the header for this host and that Meta accepts the key. Only the live call shows that. If the
proxy added no header, the reply is HTTP 401 and the single call is spent. The key still passes through the cloud egress gateway
(it is not on the VM); the network secret and the allowed host should be removed afterwards.

## No GitHub Actions path

**There is no GitHub Actions workflow for this test.** Required reviewers is unavailable for this private repository on the
current GitHub plan, so GitHub cannot pause a workflow for a second approval, and a typed phrase is only a declaration. The
live-capable workflow added in #37 is removed by this branch (and a test fails if any workflow that mentions the spike, the
key or `workflow_dispatch` reappears). The one live call is made from the operator's own machine, with the key held only in
that terminal session. Until this branch is merged, the older workflow file from #37 is still on `main`; it uses the old,
wrong request format and should be left disabled.

## Raw reply preservation

The reply to the one paid request is written to disk **before anything checks the status, parses JSON or scores it**, so a
surprising reply can always be examined, even when parsing fails. Two files are created (exclusive create, owner-only mode,
never overwriting earlier evidence) in the git-ignored `spike-output\` folder, which `safeOutputPath` enforces:

| File                          | Contents                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rest-raw-response.body`      | The body exactly as received (bytes, not decoded text)                                                                                                                                                                     |
| `rest-raw-response.meta.json` | HTTP status, whether it was a success, only the headers `content-type`, `content-length`, `content-encoding` and `date`, byte counts, SHA-256 of what was received and of what was saved, elapsed time, and a capture time |

What is never stored: any request header, the Authorization value, cookies or any other response header. If the body happens to
contain the API key, it is replaced by `***` and recorded (`keyRedactions`, plus both hashes). Nothing is truncated silently: the
reply is read up to a hard ceiling of 32 MiB, and a longer reply is cut with `truncated: true` in the metadata and the
scorecard. If no reply arrives (timeout, network error) only the metadata file is written, with the outcome code. A failure to
write never hides the result: the scorecard reports `rawResponse.saved: false` with a fixed error code.

The scorecard carries only facts about these files (names, status, sizes, hashes), never their content. The body is a fictional
transcript, but treat it as local evidence: do not paste it anywhere unless asked.

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

After the run, the sanitized evidence is also on disk: `Get-Content spike-output\rest-raw-response.meta.json` shows the status, headers
and hashes (safe to paste). The body file `spike-output\rest-raw-response.body` is the raw reply; do not paste it unless asked.

Then close the terminal and revoke or rotate the key. The runner makes exactly one request and never retries; it claims a latch and
an exclusive lock file (`spike-output\rest-call.lock`) before sending, so a failed call still blocks a second attempt. Do not delete
the lock to try again: a second attempt needs a new written authorization.

**Stop conditions (no request is sent or no further action is taken):** any guard refusal; HTTP error (including 400/401/403/429);
timeout; malformed reply. Do not retry.

## Estimated cost of one call

Listed price $0.18 per audio hour (secondhand, from Meta's model page via search). The clip is about 58 s, so one call is about
$0.003; at the 2-minute ceiling about $0.006. Rate limits and any minimum charge are unknown.
