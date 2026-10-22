# Pendia desktop and laptop experience

## Read-only audit findings
- Opened eight signed-in pages at **360, 768, 1280 and 1440px**: Family, Visits, Meds, Coverage, Handoffs, Digest, Ask Pendia and Preferences. No horizontal page overflow or browser page errors appeared in these 32 checks.
- Existing branding, readable type, care cards, navigation and desktop-capable controls already work. Some views already have responsive columns, including medications, appointment details and handoff entry/history.
- The main desktop limitation is the shared **816px content cap** at both 1280 and 1440px, with bottom navigation at every width. Coverage therefore remains compact even on wide monitors.
- At all four widths, keyboard activation opened Add shift, Tab remained inside the dialog, Escape closed it, navigation reached Handoffs, and scrolling revealed Save handoff without obstruction. Focus return to Add shift was not established and needs follow-up.
- Source inspection found the active handoff recording dock already assumes a desktop sidebar offset, although no sidebar is currently shown. Its placement must be coordinated with the new navigation.
- The current account has a family and a saved handoff, but no listed appointments, medications or scheduled shifts. Populated appointment/medication/shift layouts and active recording/playback were **not verified** in this audit. No care records were created or changed.
- PR #21's remote diff was not inspected. Its exact overlap with the current Coverage file is therefore unverified.

## Proposed design
### Shared navigation and screen space
- Keep the existing phone/tablet header and six bottom tabs **below 1024px**, preserving the 360px and 768px experience.
- At **1024px and above**, show a persistent left sidebar with Dashboard, Visits, Meds, Coverage, Handoffs and Digest. Dashboard opens the existing `/family` page; no new route or application is introduced.
- Use a compact sidebar, approximately 224px wide, with an accessible collapse/expand control that leaves an icon rail visible. Clearly mark the active destination and provide names/tooltips when collapsed.
- Keep Ask Pendia, Preferences & Accessibility and sign-out reachable. Ask Pendia remains unavailable for AI use; this task does not connect it.
- Remove bottom tabs only at the desktop breakpoint. Align the header and content with the sidebar, and use a generous desktop workspace capped around 1440px on larger monitors.
- Preserve Soft Harmony colors, Fraunces/Figtree typography, rounded care cards, contrast and local accessibility preferences. Do not change type size according to viewport width.

### Existing care screens
- **Dashboard:** arrange existing care-recipient information, care summaries, quick actions, upcoming visit and latest handoff into balanced desktop columns. Retain the care-team toggle and permission-based visibility; show only existing data.
- **Coverage:** let the existing weekly calendar occupy the full available workspace. Wider day columns make existing shift names, times and controls easier to scan. Preserve mobile cells and all scheduling/claim behavior.
- **Visits:** use spacious appointment cards and a comfortable list/detail split only when enough space exists; bound long reading text. Group existing appointment fields into desktop columns without changing validation or submissions.
- **Meds:** display existing medication cards in balanced columns, with dose information and existing actions kept together. Do not introduce reminders, dose tracking or new medication functionality.
- **Handoffs:** give entry/recording and past handoffs comfortable desktop columns. Align the active recording dock with the actual sidebar state; preserve recording lifecycle, consent, playback, upload and deletion behavior.
- **Dialogs:** retain existing keyboard behavior; add safe viewport margins and scrolling where needed, keeping form fields and actions reachable.
- Keep Digest, Ask and Preferences readable within the wider shell rather than stretching every text block across a monitor.

## Coverage C1 / PR #21 safeguards
- First-pass Coverage expansion comes from the shared workspace width, **without editing the Coverage page**.
- Do not edit shift helpers, services, queries, claim permissions, overlap rules, migrations or Coverage interaction tests.
- If widening alone leaves a real calendar presentation problem, pause that specific adjustment until PR #21's diff/ownership can be checked. Any agreed follow-up must be a small, isolated presentation change, not a Coverage rewrite.
- No merge, branch manipulation, deployment, publishing or database changes are part of this work.

## Verification after approval
- Run existing tests covering navigation, appointment views, handoffs, playback and preferences; retain behavioral checks rather than styling snapshots.
- Recheck all affected pages at **360, 768, 1280 and 1440px**, plus one larger desktop viewport and the desktop breakpoint boundary.
- Test sidebar expansion/collapse, active links, keyboard navigation and focus visibility; dialog Tab/Shift+Tab, Escape and focus return; long-page scrolling; large text and extra-large buttons.
- Verify the actual recording dock in an active desktop recording state and playback with an existing authorized recording where available. Use a disposable local capture without saving care data; do not silently create production records.
- Exercise populated views with existing authorized data if available. Use isolated test fixtures for missing states, never production mock functionality. Report any live populated flow that cannot be verified.
- Check current preview diagnostics after changes and fix regressions before reporting completion.

## Technical scope
- Primary presentation files: `src/components/AppShell.tsx`, `src/styles.css`, Family overview/page, appointment list/detail/form, medication page, handoff page and recording dock. Shared dialog changes only if required by verified layout issues.
- Keep route identities, leaf page metadata, service boundaries, authentication, data and permissions unchanged.
- On approval, replace the obsolete all-width-bottom-navigation architecture rule in `AGENTS.md` with the desktop-sidebar/mobile-bottom-tabs rule and track implementation in `roadmap.md`.

## Approval boundary
The audit made no application, care-data or backend changes. Only this review plan was created. Approval authorizes the frontend layout work and its tests; it does not authorize publishing, deployment, merging, database changes or AI integration.