# Diarization spike: realtime WebSocket (offline preparation)

**Status: prepared offline. Nothing here has contacted Meta, uploaded a recording, deployed a function or run a
migration.** The proposed protocol comes from a third-party spec (Muse), not verified Meta documentation.
Synthetic data only. `META_API_KEY` is server-side only and never appears in this folder, in logs, or in captures.

## What is here

| File | Purpose |
|---|---|
| `protocol.ts` | The proposed handshake, framing constants, event/close-code classification, key redaction |
| `wav.ts` | Reads mono 16 kHz 16-bit WAV, splits into 2560-byte (80 ms) frames |
| `capture.ts` | Native WebSocket client: handshake first, real-time pacing, `endStream`, raw frame log (key scrubbed) |
| `guard.ts` | Loopback only, unless `SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL` **and** host is exactly `api.meta.ai` and pacing is real time |
| `events.ts` | Raw events -> speaker segments. Config-driven; heuristic fallback; `inspect` report of every key path |
| `groundtruth.ts`, `score.ts` | Parses `fixtures/spike/two-voice-script.md`; scores; enforces the acceptance criteria |
| `simulator.ts` | LOCAL stand-in server (RFC 6455) for tests. Its speaker-event shapes are **fictional** |
| `cli.ts` | `plan`, `simulate`, `inspect`, `score`, `capture` |

```sh
bun run spike plan                      # prints the redacted handshake; connects to nothing
bun run spike simulate --scenario leak  # whole pipeline against the local simulator
bun run spike inspect capture.jsonl     # what the server really sent
bun run spike score capture.jsonl [--adapter adapter.json] [--timings timings.json]
bun run spike:test                      # the spike's tests (no network beyond loopback)
```

## Acceptance criteria (enforced by `score.ts`)
1. **At least 90% speaker-turn accuracy** over all 12 turns (11/12 passes, 10/12 fails). Anonymous labels are matched to
   Dr. Patel / Rosa by best fit. Accuracy excluding the two deliberate-overlap turns is also reported, and seconds-weighted
   accuracy when segment times and a `timings.json` (`{"1":[start,end],...}`) are available.
2. **Zero patient-to-doctor leakage:** any patient turn (2, 4, 7, 10, 12) attributed to the doctor's speaker, **or** the
   instruction-bearing words inside the trap turns (2: "ten milligrams every morning", 7: "tell him to call the lab first",
   10: "call the office if my ankles swell") attributed to the doctor, fails the run even if accuracy is high.
3. **Fails closed:** if the events cannot be turned into speaker segments, or a turn cannot be found in the transcript, the
   run is not scorable / counts against the score. Nothing is guessed.

## Verifying the spec: what is and is not supported

Only a third-party catalog, framework docs and blogs were reachable from the sandbox; Meta's own API reference
(`dev.meta.ai/docs/api-reference/voice/realtime`, cited by one framework) was **not** reachable, so nothing below is
confirmed by Meta.

| Spec claim | Evidence | Status |
|---|---|---|
| Endpoint `wss://api.meta.ai/v1/asr/realtime?sessionId=<uuid4>` | Consistent with the project's earlier `https://api.meta.ai/v1`; path and `sessionId` only in the spec | Unverified |
| Auth is in the first JSON text frame (not an `Authorization` header), within 10 s | A framework doc says the key is sent as a Bearer token in the handshake; a blog says the header is ignored and the frame must arrive within 10 s. Browser/Deno `WebSocket` cannot set headers, which makes in-band auth plausible | Plausible, secondhand |
| `model`, `mode: DIARIZATION`, `audioEncoding: PCM_16KHZ`, `partialMode: CUMULATIVE`, `languageBias`, `keywords`, `emitAudioProgress` | Mode names (PUSH_TO_TALK, ENDPOINTING, DIARIZATION) and cumulative vs delta partials appear in a blog; exact field names do not appear anywhere I could reach | Unverified field names |
| 16 kHz mono PCM16 | A framework doc says the API accepts 24 kHz and 16 kHz | Supported (secondhand) |
| 2560 bytes = 80 ms | 16000 x 2 x 0.08 = 2560 (arithmetic checked in a test). Whether the server requires exactly 80 ms frames is unverified | Arithmetic verified; requirement unverified |
| Binary frames, real-time pacing, 1008 on bad pacing | Not found | Unverified |
| `{"type":"endStream"}` then read until close | Not found | Unverified |
| Events `transcript, speechStart, speechEnd, speechComplete, speaker, error` | Third-party text mentions endpoint/speech start/stop tokens, not these names | Unverified |
| Close codes 1000 / 1008 / 1011 / 1013 | Standard WebSocket meanings; Meta's use is unverified | Unverified |
| **`speaker` event payload** | Spec itself says unverified | **Unknown. The point of the spike.** |
| Session limit | A blog says 60 minutes, no resume | Secondhand, not needed (clip < 2 min) |

### Assumptions this code makes (each is one line to change)
- The handshake is sent immediately on open; `emitAudioProgress` is omitted (= false).
- The last partial frame is **zero-padded** to 2560 bytes (adds at most 80 ms of silence).
- Server close is awaited up to 30 s after `endStream`; the client then closes with 1000 and notes it.
- A 1013 or any non-1000 close is reported, **never retried**.
- Language bias is the word `English`, as in the spec; codes such as `en` may be what the API wants.
- Speaker labels are stable across the session and anonymous (A/B); only final transcript events are scored when events
  carry a final flag (cumulative partials would repeat text).
- **No real speaker payload is assumed:** `events.ts` tries a heuristic and otherwise reports "not recognised". After the
  first real capture, run `inspect`, then give `score` an adapter JSON with the real paths:

```json
{ "eventType": "transcript", "speakerPath": "payload.speaker.id", "textPath": "payload.text",
  "startPath": "payload.startMs", "endPath": "payload.endMs", "finalPath": "final", "unit": "ms" }
```

## Proposed storage (nothing uploaded)
The existing private `recordings` bucket policies only accept `{family_uuid}/(handoff|visit)/{uuid}/{file}`.
A path like `{family}/spike/...` would be **denied**. The compatible destination, with no migration, is
`{family_id}/visit/{random-uuid}/two-voice-spike.wav` (organizer-only write, readable by those with visit access). That
makes an orphan "visit" folder with no visit row, so it must be deleted after the spike (no automatic sweeper exists).
Alternative: stream the WAV to the function in the request body and store nothing. Either needs the owner's approval.

## Still to do, each needing separate approval
1. The thin Edge Function wrapper (owner login only, POST only, closed-by-default window, returns the redacted capture and
   the scorecard, stores nothing, reads the WAV with the caller's own session). Deliberately **not** under
   `supabase/functions/`, so merging this branch cannot trigger any deploy.
2. Deploying it, the first Meta call, and uploading the recording.
3. The optional file-endpoint comparison (`POST /v1/asr/transcribe`) on the same clip.
