# Pendia

Pendia is a family caregiving coordination app. One shared workspace holds a loved one's doctor appointments, medications and
dose reports, shift coverage, caregiver handoffs and a weekly family digest view, and each family member sees only what the organizer
allows. Meta Muse Spark 1.3 helps in a few bounded places: reading an uploaded appointment letter into a **draft** appointment,
answering questions about the family's records with cited sources (Ask Pendia), and, in a synthetic walkthrough, suggesting items
from a doctor-visit transcript. Meta Voice Transcribe turns a handoff voice note into a **draft** the caregiver reviews. Every AI
result is a draft or a cited answer; nothing is saved without a person's confirmation. Pendia does **not** send text messages:
there is no SMS or Twilio integration.

Built for the Meta Global AI Developer Hackathon (Startup track). **All data in this repo is synthetic.**

> Not medical advice. Check with your doctor or pharmacist. Pendia restates what is in the family's records; it never
> suggests doses, diagnoses, interactions, or treatment.

## Status

State as of the November 2026 hackathon submission. "Off by default" means the feature is built and tested but a server-side
flag (not set in this repo) must be switched on, and it is only switched on for controlled windows.

| Area | State |
|---|---|
| Schema, RLS, auth, family and member management, per-person visibility, per-user demo family | Implemented; SQL suites below; applied to the live database |
| Appointments (create, edit, cancel, archive, computed flags) | Implemented; migration applied live |
| **Document Upload**: private upload (PDF, JPG, PNG, up to 10 MB), review-before-save, view / open / download / preview, optional Muse Spark autofill | Implemented; migration applied live. **Live Muse Spark extraction was demonstrated on October 31, 2026 and then disabled**; it is off by default (see Appointments) |
| Medication dose reporting (Given / Not given / Not confirmed, append-only history) and medication-value verification labels | Implemented and tested offline; dose migration applied live |
| Coverage: add / edit / reassign / cancel shifts, "Cover it" claim flow | Implemented |
| Handoffs: check-in, voice note, optional kept recordings, optional Meta Voice Transcribe draft (PR #51, #52) | Implemented; transcription is off by default and organizer-only |
| **Ask Pendia (Care Agent)**: read-only, cited answers, refuses medical advice; member path for allow-listed demo accounts and a separate guest path for the Judge Demo | Implemented and audited; **off by default**; the public Judge Demo shows the "not available yet" placeholder unless a server flag is on |
| Public **Judge Demo** (one click, fictional snapshot) | Live and **read-only** |
| Weekly digest | Stored digests are displayed; generating and sending them is **not built** |
| SMS, Twilio, texting family members, SMS-driven actions | **Not built** |
| Recording a real doctor visit, live visit transcription, speaker-mapping review | **Not built** for real use; a synthetic walkthrough lives at `/visits/demo` |
| Coverage requirements / gap detection; member invitations and access windows | Migrations committed (`20261022000001`, `20261022000002`), **not applied** to the live database as of October 30, 2026 |
| Preferences (text size, language, contrast, motion) | Implemented; its notification toggles are placeholders marked "Not connected" |

## Meta models (Standard tier only)

| Use | Model | Notes |
|---|---|---|
| Appointment-letter autofill (Document Upload), Ask Pendia answers, synthetic visit-extraction walkthrough | `muse-spark-1.3` | Structured JSON output validated before use; Document Upload sends rendered page images; every result is reviewed or cited; server-side and flag-gated. |
| Handoff voice-note transcription | `muse-voice-transcribe-1.0` | `DIARIZATION` mode; anonymous speaker labels and timestamps returned as a draft; organizer-only; flag-gated. |

**Privacy choice:** the app never calls any model ID containing `-contributor`. The Contributor tier trains on inputs, and
Pendia handles health information, so only Standard-tier models are used. Meta calls run server-side only, in TanStack Start
server functions (one request, no retry, redirects refused, fixed error codes). The Meta key (`META_API_KEY`) is a server
secret in Lovable Cloud, never in client code or this repo, and the client bundle is checked for it. Live document extraction and
Ask Pendia are limited to fictional demo families; real families' records are never sent. No image-generation model is used.

## Architecture

- **Front end:** React 19 + TanStack Start (Lovable scaffold), Tailwind 4, shadcn/ui. All data access goes
  through `src/services/index.ts`.
- **Back end:** Supabase through Lovable Cloud (Postgres, Auth, Storage, RLS) plus TanStack Start server functions for the Meta
  calls. Migrations live in `supabase/migrations/`. There are no Supabase Edge Functions.
- **Tables:** `family, member, care_recipient, visit, medication, med_change, task, watch_item, shift, handoff, digest`, plus
  `medication_schedule` and `dose_administration` for dose reporting. Every table carries `family_id`.
- **Storage:** two private buckets, `recordings` (handoff audio) and `appointment-docs` (appointment letters).

### Security model (enforced in Postgres, not just the UI)

- **Family isolation:** every policy is scoped by `family_id`; a member of family A cannot read or write family B.
  Cross-family foreign keys (e.g. assigning a task to another family's member) are rejected by trigger, and
  `family_id` is immutable after insert.
- **Per-person visibility:** `member.can_see_meds / can_see_visits / can_see_schedule` gate reads of
  medications + med changes, visits, and shifts + handoffs. Organizers see everything.
- **Organizer-only writes.** Appointments, shifts, handoffs, recordings and documents are written by organizers and enforced by
  RLS and storage policies. AI features read through the caller's own session; none uses a service-role client. (The Judge Demo
  entry uses a server-side admin client only to look up and sign in its dedicated, zero-membership guest identity.)
- **Confirm guard:** a med change is created `pending`; only a signed-in family member can confirm it, and the
  database stamps `confirmed_by` / `confirmed_at` (the client cannot spoof them). Confirmed changes are frozen.
- **No anonymous access:** `anon` has no table privileges.

## Setup

```sh
bun install
bun run dev        # local dev server
bun run test       # unit tests (vitest)
npx tsc --noEmit   # typecheck
```

Copy the Supabase URL and publishable key into `.env` (the Lovable scaffold already provides them). Server secrets, including
`META_API_KEY`, are added in Lovable Cloud and are never prefixed `VITE_` or committed. Every AI feature is off unless its server
flag is exactly `"true"`: `META_TRANSCRIBE_ENABLED` (handoff transcription), `AGENT_LIVE_ENABLED` with `AGENT_LIVE_USER_IDS`
(Ask Pendia for allow-listed demo accounts), `JUDGE_AGENT_LIVE_ENABLED` (Ask Pendia for the Judge Demo, which also needs its
rate-limit store), and `DOC_EXTRACT_ENABLED` with `DOC_EXTRACT_USER_IDS` (document autofill; `DOC_EXTRACT_SIMULATED` shows a
labelled sample with no Meta call). See `docs/design/` and `docs/judge-agent-activation.md`.

### Database: source of truth

- **The live Supabase database is the source of truth.** Schema changes are applied through the Lovable SQL
  tool (`query_database`); Lovable does not necessarily auto-apply files from `supabase/migrations/`.
- **`supabase/migrations/*.sql` is the committed record.** Every schema change must land as a new numbered
  file there *and* be applied to the live DB, in the same PR. To rebuild from scratch, apply the files in order
  (the Lovable scaffold's `drizzle/migrations/0000_migration.sql` comes first).
- **`src/integrations/supabase/types.ts` is generated by Lovable from the live DB.** In Phase 1 it was
  hand-edited to match the new schema; Lovable has since regenerated it and the regenerated file includes all
  Phase 1 columns. A regeneration reflects the live DB, so it can only drop columns that are missing from the
  DB. After any regeneration or merge that touches it, run `npx tsc --noEmit` and the SQL tests below.

### RLS / integrity tests

`supabase/tests/storage.test.sql` does the same for the recordings bucket and the handoff recording columns. Other suites:
`appointments`, `shift-writes`, `dose-administration`, `family-delete-guard`, and `appointment-docs` (the private document bucket in
its pending and attached states, plus the `visit.document_path` constraint). `coverage-requirements` and `member-invites` apply
only once their migrations are applied.

`supabase/tests/rls.test.sql` is a single `DO` block that builds synthetic families and users, asserts
isolation, visibility, the confirm guard, and the demo seed, then **always raises** so nothing persists.
Run it in the Supabase SQL editor (or any SQL client): the error message `PASS: N assertions` means success,
`FAIL: ...` names the broken assertion.

### Handoff dictation and kept recordings (Handoffs page)

The page follows the design: a Check-in card, a separate **Voice note** card, Save, and a Past handoffs column
(side by side from 768 px). **Quick handoff** is on the Family page and "Hand off my shift" is on Coverage; both open this
page. The voice note records in the browser (`src/hooks/use-audio-recorder.ts`, `src/components/HandoffDictation.tsx`) with a
large round Record button, a **Stop that is docked above the tab bar** while recording, playback, Record again and Discard.
The note shows its state: **Temporary** ("stays on this phone, not saved") by default, and **Saved** ("will be saved privately
with this handoff") only when the **Keep** switch is on. **By default nothing leaves the device.** Audio is uploaded only with Keep on, when
the caregiver presses Save handoff (after a one-time storage notice), or when the organizer presses Transcribe (below). For now only organizers can save a
handoff (database rule); other members see why and can read past handoffs.

**What is kept.** The browser's original recording (for playback) plus a transcription-ready **16 kHz mono 16-bit PCM
WAV**, captured in parallel from the same microphone stream with an `AudioWorklet` (`public/pcm-worklet.js`,
`src/lib/pcm-capture.ts`, `src/lib/pcm-wav.ts`). About 19.2 MB per 10 minutes for the WAV; the cap is 10 minutes.
Saved on the handoff row: `audio_path`, `audio_mime`, `audio_size_bytes`, `audio_wav_path`, `audio_wav_mime`,
`audio_wav_size_bytes`, `duration_seconds`. Past handoffs show the duration from the database.

**Storage.** One private bucket, `recordings`, path `{family_id}/{entity_type}/{entity_id}/{file}` (`handoff` now,
`visit` later). Policies on `storage.objects` (all `to authenticated`; the family and entity type are parsed from the
path by `recording_path_family()` / `recording_path_type()`, and anything that is not
`uuid/(handoff|visit)/uuid/safe-name` is denied):

| Operation | Rule |
|---|---|
| SELECT (also what signed-URL creation checks) | caller belongs to the path's family and may see that entity type: handoff recordings follow schedule visibility, visit recordings follow visits visibility; organizers always |
| INSERT | caller is an **organizer** of the path's family |
| UPDATE | same rule on the old AND the new name, so an object can never be moved into another family's folder |
| DELETE | same rule as INSERT |

**Ordering** (`src/services/recordings.ts`). Save = upload original, upload WAV, write the handoff row (with the
references), and if anything fails remove what was uploaded (retried; reported honestly if cleanup itself fails). A
row is only written after its objects exist. Delete = clear the row's references first, then remove the objects
(a missing object is fine), so a handoff never points at a missing file. Playback and download use a signed URL
created on demand under the user's own session: 5 minutes by default, never more than 10, never stored. If the
original will not play, playback retries with a fresh link and then falls back to the WAV copy.

**Transcription (PR #51, #52).** The voice note has an optional **Transcribe** action. It sends the recording's 16 kHz mono WAV
to Meta Voice Transcribe (`muse-voice-transcribe-1.0`, `DIARIZATION` mode) through one server function, and only after the
caregiver presses the button (the screen says the recording goes to Meta's speech service). Gates, in order: the flag
`META_TRANSCRIBE_ENABLED` is exactly `true` (off by default), the server key is set, the caller is an organizer of the family,
the audio is a valid mono 16-bit PCM WAV, and a small per-user rate limit applies. Then exactly one request, with a timeout,
redirects refused, a bounded reply and no retry; the reply body never reaches an error message. The result is a **draft**:
anonymous speaker labels with timestamps shown for review, and nothing is saved until the caregiver chooses to. The page explains
why transcription is unavailable (still checking, switched off, organizer-only, or a temporary error) and never calls Meta just to
check; the Judge Demo cannot transcribe. Code: `src/server/meta-transcribe.server.ts`, `src/lib/meta-transcribe/`.

**Known limits.** An upload followed by a closed tab (before the row is written) leaves an unreferenced object until a
cleanup job exists. Supabase blocks raw `DELETE` on `storage.objects`, so the storage DELETE policy is verified by
evaluating its rule function, not by a raw delete. The storage SQL tests prove the policy layer, not the HTTP storage
API. Real-device (Samsung / iOS Safari) behavior of the worklet capture needs a device test. Synthetic data only: this
stack is not set up for real patient information (no BAA).

### Appointments (Phase V1)

Visits are now appointments. `visit` gained `provider_name, office_name, office_address, office_phone, scheduled_start,
scheduled_end, reason, notes, status (scheduled|completed|canceled), confirmation_status (unconfirmed|confirmed),
reminder_prefs, archived_at`. Existing visits keep every row, transcript, speaker map and consent value; `doctor` is
kept as a mirror of `provider_name` (trigger `visit_appointment_sync`), and `date` is derived from `scheduled_start`
in the family's timezone. Organizers write; members read per `can_see_visits` (RLS unchanged).

"Incomplete" (missing provider, address or phone) and "overlaps another appointment" are **computed, never stored**,
and never block saving. A saved appointment is never created or changed automatically: the only fill-in is the optional document
autofill below, and it is a draft the organizer reviews and saves. Routes: `/visits` (Upcoming / Past / Archived), `/visits/new`,
`/visits/edit/$id`. Tests: `supabase/tests/appointments.test.sql` (same `PASS: N assertions` convention).

**Document Upload.** Route `/visits/upload` ("From a document" on the Visits page; organizers only). An organizer uploads an appointment
letter (PDF, JPG or PNG, up to 10 MB; the type is checked from the file's own bytes). It is stored in the private
`appointment-docs` bucket under `{family_id}/doc/{id}/{file}`; the file name is kept (made safe) so the document stays recognisable.
Nothing is written to the database until the organizer presses **Add appointment** on the review form; cancelling removes the
upload, and unattached uploads older than 24 hours are swept. A document is *pending* (readable only by the organizer who uploaded
it) until a saved appointment references it, then readable by members who can see visits (`visit.document_path`, migration
`20261029000001`, applied to the live database after validation on an isolated project). **View document** opens a 5-minute signed link
as **Open in new tab**, **Download**, or **Preview here** (rendered inside the page, which also works in sandboxed preview frames);
the signed link is never shown as text.

*AI-assisted autofill.* When enabled, the browser renders up to three pages to images, one server request sends them to Muse Spark 1.3
with a strict JSON schema, and the validated date, time, provider, location and instructions prefill the standard appointment form,
each field tagged *read from your document*, *hard to read* or *not found*. The reply cannot be machine-checked against the image, so
review is mandatory. If reading is off, fails or returns nothing usable, the same form opens empty with the document still attached. Live
autofill is limited to an allow-listed organizer in a demo family and is **off by default**; it was **successfully demonstrated on
October 31, 2026 with a fictional letter and then disabled**. `DOC_EXTRACT_SIMULATED` shows a clearly labelled built-in sample, never
presented as an AI reading. Details: `docs/design/document-upload.md`; SQL test: `supabase/tests/appointment-docs.test.sql`.

**Migration status:** `20261021000004_visit_appointments.sql` was applied to the live database with the owner's approval after
a rolled-back dry-run. Afterwards the appointments suite (44 assertions) and the RLS suite (40) passed against the live
schema. `types.ts`: the `visit` block was written by hand in generator format and checked column-by-column (name, type,
nullability, default) against the live schema; it matches. Lovable's own regeneration may replace it, which is fine.

### Interface (phone first)

The Claude Design canvas is the visual reference; the app already used its tokens (warm beige, deep slate, dusty blue, sage,
lavender; Fraunces + Figtree), so this is a layout and touch-target pass, not a re-skin.

- **Shell** (`src/components/AppShell.tsx`): a fixed bottom tab bar with the same six tabs at every phone and tablet width
  (56 px targets, honors the iPhone home-indicator inset, compact in landscape, two rows of three at very large text); from
  1024 px the same six become a left sidebar. Content is capped at 66 rem. Text is rem-based (`html` is 106.25%), so it follows
  the phone's text-size setting.
- **No sideways scrolling** at 320 px and up on any screen; buttons, inputs, tabs and switches are 44 px or larger. Coverage is a
  compact week grid on phones (initials) with a large **Cover it** list underneath, and first names from 768 px.
- **Family** opens with a greeting, who you are caring for, and "at a glance" tiles (next visit, open coverage blocks, latest
  handoff) built only from existing data and only for what that person may see.
- **Assistant button:** `src/lib/features.ts` keeps `assistant: false`, so the shell's reserved top-bar and sidebar button stays
  hidden; Ask Pendia is reached at `/ask`. The app is complete without any AI feature.
- **Care Agent (Ask Pendia):** `/ask` (`docs/design/care-agent.md`, `docs/design/care-agent-guest.md`). Read-only and stateless:
  it answers only from a demo family's records, with sources derived from validated citations, and refuses medical advice
  (English and Spanish) before any record is read or any model call. The member path serves allow-listed demo accounts; a separate
  guest path serves the public Judge Demo from a fictional in-code snapshot, with no dose items and a hard global usage cap. Both are
  **off by default** behind server flags; until one is switched on, `/ask` shows the "not available yet" placeholder.
- Not built: "Questions to ask", a general-purpose assistant, requests like "Ask the family" / "I'll take her", drafted-from-voice
  handoff text beyond the reviewed Transcribe draft, texting or reminders of any kind, and the digest generator.

### Coverage editing (C1)

Organizers can **add, edit, reassign and cancel** shifts on the Coverage page (the form is single-column; times are typed
in the family's timezone; a night shift ends on the next day). A shift with no caregiver (or no end time) shows **Needs
completion**, computed from its fields and cleared the moment it is filled in. Overlapping shifts for the same person are
flagged, never blocked. **Cancel deletes the shift**: `shift.status` only allows open / claimed / swap, and adding
"canceled" would be a schema change. Rules are enforced in `shiftService` (valid times, end after start, assignee in the
same family) and by the database (organizer-only writes, family isolation). The existing "Cover it" claim flow is
unchanged. Tests: `supabase/tests/shift-writes.test.sql` (29 assertions), `shift-service`, `shifts-lib`, `coverage-c1`.

### Demo data

Two fictional demo experiences exist; both use invented people and 555-01xx phone numbers, and Pendia sends no text messages.

- **Open demo family** (for a signed-in account) calls `join_demo_family()`, which creates a private copy for that user: Grandma
  Rosa; Maria (organizer, English), Carlos (Spanish), Jenny (English, no medication access); Lisinopril 10 mg daily plus other meds;
  next week's coverage with the only gap Tuesday 2–6 PM; and last week's digest in English and Spanish. It is a real, writable family
  marked `is_demo`, which is what allows the demo-only AI features (autofill and Ask Pendia) for an allow-listed organizer.
- **Try Pendia Demo** (no account) is the public, **read-only** Judge Demo: a fictional snapshot shown through service wrappers by a
  dedicated guest identity with no family membership, so it can read and write nothing real.


## Meta AI Hackathon — Judge Quick Start

**Project:** Pendia  
**Team:** EcoNest Systems  
**Track:** Startup  
**Built for:** Meta Global AI Developer Hackathon

### What is Pendia?

Pendia is an AI-assisted family caregiving coordination application. It helps families organize doctor appointments, medications, caregiving schedules, and handoffs in one shared workspace.

### Try the live demo

**Application:** https://pixel-perfect-matchmaker-36.lovable.app

1. Open the application.
2. Select **Try Pendia Demo**.
3. Explore the Pendia Hackathon — Fictional Demo Family, featuring Grandma Rosa.
4. Visit the Dashboard, Visits, Meds, Coverage, and Handoffs sections.
5. Explore Ask Pendia if available in the demo.

The public Judge Demo is read-only and uses fictional data. No account is required.

### Meta Muse Spark AI Integration

Pendia integrates **Meta Muse Spark 1.3** to help turn appointment letters into structured information.

The demonstrated workflow:

1. An authorized organizer uploads a fictional appointment letter.
2. Pendia prepares the document for AI reading.
3. Muse Spark extracts appointment details.
4. The application populates the appointment form.
5. The caregiver reviews the extracted information before saving.

**Verification:** The live extraction workflow was successfully demonstrated on October 31, 2026.

For safety, live document extraction was disabled after the controlled test. The recorded demonstration shows the real AI workflow, not a simulated result.

### Demo Video

Final hackathon demonstration video: [Watch Pendia's Hackathon Demo](https://youtu.be/qvkRY72I8C0)

### Technology

- React and TypeScript
- Lovable
- Supabase authentication, database, and private storage
- Meta Muse Spark 1.3
- Server-side AI integration with authorization controls

### Privacy and Safety

- The demonstration uses fictional family and appointment data.
- The public Judge Demo is read-only.
- Documents are stored privately with access controls.
- AI-extracted information must be reviewed before saving.
- Pendia does not provide medical advice.

### Project Status

Pendia is a working hackathon prototype. Some integrations and capabilities remain limited to controlled testing and are not available in the public Judge Demo.
