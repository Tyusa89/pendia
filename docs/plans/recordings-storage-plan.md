# Plan: recordings storage and PCM/WAV capture (handoffs now, visits next)

**Status: PLAN ONLY. Nothing here is implemented, migrated, or deployed. It needs owner approval (see section 1).**
Synthetic data only in this phase.

## 0. What this changes (and what it reverses)

Handoff dictation (merged in #11, playback fix in #12) is deliberately **on-device only**: no uploads, no
persistence, no schema change. This plan **lifts that on purpose**, for recordings the caregiver chooses to keep.
Everything below keeps the other guarantees: nothing is saved without an explicit tap, no Meta call is made,
transcription stays disconnected, and the audio never leaves the device unless the caregiver saves it.

## 1. Decisions needed from the owner (with recommendations)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve lifting "no persistence/no upload/no schema change" for opted-in recordings | Yes, as an explicit checkbox **"Keep the recording with this handoff"**, default **off**, plus delete |
| D2 | Sequencing | Build the storage layer + WAV capture **once, generically, for visit capture first** (it is on the Phase 2 critical path and needs exactly this); attach handoffs after. Handoff-first spends part of the Nov 4 budget on a feature outside the brief. |
| D3 | Metadata home | Columns on `handoff` (as asked), mirroring `visit`, which already has `audio_path` and `duration_seconds`. A generic `recording` table is the alternative: cleaner for reuse, but a larger change to the agreed data model. |
| D4 | Orphan sweeper (scheduled function that deletes unreferenced objects older than 24 h) | Yes, later. Client-side compensation cannot cover a tab closed between upload and DB write. Needs cron infra, so it is out of the first slices. |
| D5 | Retention and notice | Wording for a one-line notice at save time; optional auto-delete after N days (default: none) |
| D6 | Delete ordering | Clear the DB reference **first**, then remove the object (see section 5). This differs from the order in your wording, to honor "never reference a missing file". |
| D7 | WAV format | 16 kHz, mono, 16-bit PCM (about 19.2 MB per 10 min, under the 32 MB file cap). Confirm against the sample rates Meta accepts during the transcription spike. |
| D8 | Playback fallback | If the original fails to play, offer the WAV (WAV plays everywhere; Safari webm/opus is unreliable) |
| D9 | PR #12 | Merge and retest on the phone first; this plan builds on the same hook |

## 2. Capture format

- Keep the existing `MediaRecorder` take as the **original** (webm/opus on Chromium, mp4 on Safari) for playback.
- **In parallel**, tap the same `MediaStream` with an `AudioWorklet` and build a **PCM WAV** at record time.
  Capturing raw PCM is deliberately preferred over transcoding the compressed original afterwards: decoding
  lossy Opus/AAC and feeding it to speech-to-text adds artifacts that raw capture avoids.
- Worklet downsamples to 16 kHz mono with an anti-alias filter in the worklet (browsers capture at 44.1/48 kHz
  and iOS Safari ignores the requested `AudioContext` rate), accumulating Int16 (about 19 MB per 10 min).
  A 44-byte RIFF header is written at stop.
- Both MIME types are recorded: the original's (e.g. `audio/webm;codecs=opus`) and `audio/wav`.
- Same 10-minute cap as today. If the worklet fails to start, the original still records; the save then has no WAV
  copy and says so (transcription later needs the WAV, so it would be unavailable for that take).
- Fallback if the worklet proves unreliable on a target browser: decode the original with `decodeAudioData` and
  resample with `OfflineAudioContext` at stop. Simpler, but lossy-then-lossy, so only a fallback.

## 3. Data model (draft migration, not applied)

```sql
alter table public.handoff
  add column audio_path text,               -- original, for playback
  add column audio_mime text,               -- e.g. 'audio/webm;codecs=opus'
  add column audio_size_bytes bigint,
  add column audio_wav_path text,           -- PCM WAV, transcription-ready copy
  add column audio_wav_mime text,           -- 'audio/wav'
  add column audio_wav_size_bytes bigint,
  add column duration_seconds numeric(10,2);

-- all-or-nothing: a handoff either has a complete recording reference or none
alter table public.handoff add constraint handoff_audio_all_or_none check (
  (audio_path is null) = (audio_wav_path is null)
  and (audio_path is null) = (duration_seconds is null)
  and (audio_path is null) = (audio_mime is null)
  and (audio_path is null) = (audio_size_bytes is null)
  and (audio_wav_path is null) = (audio_wav_mime is null)
  and (audio_wav_path is null) = (audio_wav_size_bytes is null));

-- paths must live under this handoff's own folder (family + entity + id)
alter table public.handoff add constraint handoff_audio_path_scoped check (
  (audio_path is null or audio_path like family_id::text || '/handoff/' || id::text || '/%')
  and (audio_wav_path is null or audio_wav_path like family_id::text || '/handoff/' || id::text || '/%'));
```
Past handoffs show the duration from `duration_seconds` (the database), not from the audio element.
`visit` later gets the matching WAV columns (`audio_path` and `duration_seconds` already exist).

## 4. One private bucket, generic path scheme, explicit storage RLS

Bucket `recordings`, **private**, size limit about 40 MB, allowed types `audio/webm, audio/mp4, audio/ogg,
audio/wav, audio/x-wav` (uploads send the type without codec parameters; the full MIME lives in the DB column).

Path: `{family_id}/{entity_type}/{entity_id}/{file}`, e.g. `…/handoff/{handoff_id}/original.webm` and
`…/handoff/{handoff_id}/pcm.wav`. `entity_type` is `handoff` or `visit`. The handoff id is generated client-side
(`crypto.randomUUID()`) **before** upload and reused as the row's primary key.

Policies on `storage.objects` (family and entity are derived from the path by a strict parser; anything that does
not match `uuid/(handoff|visit)/uuid/safe-name` yields no family and is denied):

| Operation | Rule |
|---|---|
| **SELECT** (also what signed-URL creation checks) | bucket is `recordings` AND the path's family is one the caller belongs to AND the caller may see that entity type: `handoff` needs schedule visibility (same as the `handoff` table), `visit` needs visits visibility; organizers always |
| **INSERT** | bucket is `recordings` AND path parses AND caller is **organizer** of the path's family |
| **UPDATE** | same as INSERT, applied to both the old and the new name, so an object can never be moved to another family |
| **DELETE** | same as INSERT (organizer of the path's family) |

Helpers (draft): `recording_path_family(text) -> uuid`, `recording_path_type(text) -> text`, and
`recording_can_read(text) -> boolean`, built on the existing `is_family_organizer()` and `member_can_see()`.
Writes stay organizer-only, matching Phase 1 (only the organizer uses the app). Edge functions that use the service
role bypass RLS and must apply the same visibility rules themselves.

Unverified: whether the SQL runner has the rights to create policies on `storage.objects` in this project.
This is the first thing the migration slice checks.

## 5. Ordering and compensation

**Save** (only when the caregiver ticked "Keep the recording" and pressed Save handoff):
1. Generate `handoff_id`. Upload `original`, then `pcm.wav` (no upsert).
2. If the second upload fails, delete the first, then surface the error. Nothing is saved.
3. Insert the `handoff` row with the id and all recording references.
4. If the insert fails, **delete both objects** (compensation), retrying with short backoff. If compensation itself
   fails, show the error and keep the orphan paths in memory for a retry on the next attempt; the sweeper (D4)
   is the backstop.
A handoff row is therefore only ever written after its objects exist.

**Delete recording** (and the recording part of any future handoff delete):
1. Update the row: set all `audio_*` columns and `duration_seconds` to null (one statement, passes the all-or-none check).
2. Remove both objects, **tolerating "not found"**. If removal fails, retry; a leftover object is an unreferenced
   orphan for the sweeper.
This order is what guarantees a handoff never references a missing file; the opposite order (object first)
leaves a window where it would. Playback still handles a missing object gracefully (message, no crash).

## 6. Signed URLs

Created on demand by the signed-in client under the user's own JWT, so storage RLS (SELECT) decides: **5 minutes by
default, never more than 10**. Downloads use the same call (`download` option), hence the same authorization.
URLs are never stored or logged, and are refreshed when expired. A signed URL is a bearer link for its lifetime, so
the short life is the control. Playback tries the original, then the WAV (D8).

## 7. UI

- Dictation panel: checkbox "Keep the recording with this handoff" (default off), a one-line notice, and, once
  kept, the size shown to the caregiver before saving.
- Past handoffs: a Play control (signed URL fetched on tap), duration from the DB, Delete recording (confirm).
- All existing typed-note behavior and the saved payload for non-recording handoffs stay identical.

## 8. Tests

- **Storage cross-family denial (SQL, rolled-back like `rls.test.sql`).** As a Family B user: SELECT on a Family A
  recording path returns nothing (this is the check storage runs before issuing a signed URL); INSERT, UPDATE and
  DELETE on Family A's prefix are denied; a path that tries to rename across families is denied; malformed paths
  are denied; a member without schedule visibility cannot read handoff recordings; same-family organizer works.
  Limit: this proves the policy layer. An end-to-end check through the real storage API needs two real throwaway
  accounts and network access, which this sandbox does not have, so it is a short manual step for the owner.
- **Orphan check (unit, fake storage + fake DB).** A failed DB insert leaves **zero** objects; a failed second
  upload removes the first; a failing compensation is retried and reported; delete clears the reference before
  removing; delete tolerates an already-missing object; the saved row never references a path that is not in storage.
- **WAV/capture:** header and length correct; 48 kHz to 16 kHz keeps a test tone's frequency; mono; size equals
  44 + 2 x samples; worklet and recorder running together do not break the original's playback (real Chromium run,
  Android profile). Real Android and iOS Safari remain device tests.
- Existing 57 tests keep passing; no network call happens unless the box was ticked and Save was pressed.

## 9. HIPAA note (short; general information, not legal advice)

This phase uses synthetic data only, so no real PHI is handled. HIPAA applies to covered entities (providers,
plans) and their business associates. A family-run caregiving app used by relatives is generally **not** a covered
entity, but that changes if Pendia is offered through, or exchanges records with, a provider or plan, and consumer
health-privacy laws (for example the FTC Health Breach Notification Rule and state laws such as Washington's My
Health My Data Act) can apply regardless. **A BAA-covered stack is a pre-commercial decision**: it would need a
BAA with Supabase (offered on certain paid plans; verify current terms) and a confirmed position from Meta on
transcribing health audio (no BAA is assumed here; the Standard-tier "no training on inputs" choice is a privacy
control, not a BAA). Counsel should confirm before real users. **No HIPAA engineering is included in this phase.**

## 10. Risks and unknowns

- `AudioWorklet` loading under Vite/Lovable and the preview's iframe; iOS Safari requires resuming the audio
  context inside the tap and ignores the requested sample rate (hence in-worklet resampling).
- Dual capture costs CPU, battery and memory (about 19 MB of PCM plus the original per 10-minute take).
- Storage size: roughly 24 MB per 10-minute recording (original + WAV); free-tier storage fills quickly, so the
  retention decision (D5) matters.
- Meta's accepted WAV parameters are unverified until the transcription spike; 16 kHz mono PCM16 is an assumption.
- A tab closed between upload and DB write leaves an orphan until the sweeper (D4) exists.

## 11. Proposed slices (each a small reviewed PR; none starts without approval)

1. Migration: bucket, storage policies, handoff columns + SQL tests. Apply and verify in the live database.
2. PCM capture library (worklet, resampler, WAV encoder) + unit tests + real-browser check.
3. Recording storage service: upload, save, delete, signed URLs, with compensation + orphan tests.
4. UI: opt-in checkbox, save path, past-handoff playback and delete.
5. (Later) orphan sweeper; WAV columns for `visit`; wire the WAV copy into the transcription seam.
