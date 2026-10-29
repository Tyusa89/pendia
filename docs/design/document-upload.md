# Document Upload MVP — appointment letter → reviewed appointment

Status: implemented on `feature/document-upload`, **off by default, never run live**. The migration is committed but **not applied**.
No Meta call has been made by this work; the image-input wire format is **unverified** (see §4).

## 1. Flow
1. An organizer opens **Appointments → From a document** (`/visits/upload`) and picks a PDF, JPG or PNG (≤ 10 MB; type is checked from the file's
   own bytes, and must agree with the browser's claimed type).
2. The file is stored **privately** at `appointment-docs/{family_id}/doc/{uuid}/appointment-letter.{pdf|jpg|png}`. Nothing is written to the database yet.
3. If extraction is available, the browser renders at most 3 page images (PDFs via pdf.js; images are downscaled) and calls the server function.
4. The caregiver sees the existing appointment form, **prefilled** and tagged per field: *Read from your document* / *Hard to read* / *Not found*.
   Output from the built-in sample is shown with a **Simulated sample** banner and is never described as an AI reading.
5. **Only the form's "Add appointment" button saves** (existing `visitService.createAppointment`, `document_path` set). Cancel deletes the upload.
6. If reading fails or is off, the same form opens empty and the stored document stays attached. A failed save keeps the form and the document.
7. "View document" on the appointment opens a 5-minute signed link; storage RLS decides who gets one (members who can see visits).

## 2. Modes (server env; all off by default)
| Mode | Needs | Behaviour |
|---|---|---|
| `live` | `DOC_EXTRACT_ENABLED === "true"`, `META_API_KEY`, caller in `DOC_EXTRACT_USER_IDS`, **demo family** | one Muse Spark 1.3 Standard call per document |
| `simulated` | `DOC_EXTRACT_SIMULATED === "true"` (live off) | fixed fictional sample, no Meta call, labelled simulated |
| `off` | anything else | manual entry |
Gate order: config → allow-list (live) → organizer of that family → stored path is in that family's folder → pages valid → caller can read the
object → demo family (live) → rate limit 10/user/hour, 30/instance (live) → one POST (redirects refused, 60 s timeout, 1 MB bound, no retry) → strict parse.
`META_API_KEY` is the existing secret; no new key, no model choice, no tools.

## 3. What is and is not verified about extraction
The model returns `{value, confidence, source_text}` per field, or `null`. The server verifies shape, calendar-valid dates, valid times and
plain text; anything else fails closed (`unreadable`). **It cannot machine-verify that a value is really printed on the page** (the input is an
image). That is why every extracted field is shown for human review and no appointment is created automatically.

## 4. Unverified: image input to Muse Spark
The request uses the OpenAI-compatible multimodal shape (`content: [{type:"text"},{type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}]`).
Nothing in this repository shows that Meta's endpoint accepts it, or that PDFs/native documents are accepted. Until one authorized probe
on a **fictional** letter succeeds, vision must be treated as not working. If the endpoint rejects it, the app falls back to manual entry.

## 5. Migration (not applied) — `supabase/migrations/20261029000001_appointment_documents.sql`
- private bucket `appointment-docs` (10 MB; `application/pdf`, `image/jpeg`, `image/png`)
- `appt_doc_path_family / appt_doc_can_read / appt_doc_can_write` helpers; 4 storage.objects policies (read: `member_can_see(family,'visits')`; insert/update/delete: organizer)
- `visit.document_path text null` + check constraint that the path lies in the visit's own family folder
- test: `supabase/tests/appointment-docs.test.sql` (run after applying)
Until applied: uploading fails with a clear message and manual entry (`/visits/new`) is unaffected. `src/integrations/supabase/types.ts` was edited by hand to add `document_path`.

## 6. Known limits
- A pending (unattached) upload is readable by members who can see visits until it is confirmed, cancelled or swept (no table tracks pending state).
- Abandoned uploads (closed tab) are swept by an organizer's next visit to the upload page after 24 hours.
- One document per appointment; no OCR fallback; PDFs are limited to 3 pages.
