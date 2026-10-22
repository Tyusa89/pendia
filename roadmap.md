# Pendia layout repair
- [x] Present hourly Coverage timeline redesign for approval.
- [ ] Implement approved hourly timeline and verify scheduling regressions across phone, tablet and desktop; blocked until a dedicated feature branch is selected in Project settings → Git. Draft-PR creation is unavailable in this session.
- [x] Apply the supplied layout references to shared navigation and existing Family, Visits, Meds, Coverage, and Handoffs views.
- [x] Preserve existing care actions, permissions, and data; omit proposed features that are not implemented.
- [x] Run relevant tests and check signed-in pages at desktop and phone widths.
- [x] Add Ask Pendia and Preferences & Accessibility pages with header navigation, keeping unconnected capabilities unavailable.
- [x] Verify preference persistence and both pages in the signed-in app.

# Desktop and laptop experience
- [x] Compact desktop Coverage and sidebar presentation with CSS only; preserve Coverage C1 source and mobile/tablet layout.
- [x] Verify the four requested laptop/desktop sizes, mobile/tablet preservation and existing shift regression tests; do not publish.

Compact Coverage verification: desktop blocks are 40px (32.8% shorter); handoff section is about 81px instead of 166px, with a right-aligned action; content is capped at 1280px. Signed-in checks passed at 1280×720, 1366×768, 1440×900 and 1920×1080 without horizontal overflow; 360px/768px measurements are identical to before. Populated browser-only shift fixtures confirmed readability and edit controls without writes; real account has no shifts. Add-dialog focus return, sidebar collapse and handoff navigation passed; 64 existing regression tests passed and build OK. Coverage source/logic and backend unchanged; nothing published or deployed.
- [x] Add desktop sidebar and wider workspace while preserving phone/tablet navigation.
- [x] Rebalance dashboard, appointments, medications, handoffs and recording controls without touching Coverage C1 logic.
- [x] Verify tests, four requested widths, keyboard dialogs, scrolling and temporary recording/playback; report unavailable live-data checks.

Verification: 308 tests passed; final dialog-related suites also passed after focus-return improvement. Signed-in checks covered 360/768/1280/1440px, 1023/1024px transitions and 1920px; local recording/playback, sidebar collapse, keyboard dialog focus and large-text layouts passed with no care writes or page errors. Populated live appointments/medications/shifts and saved-recording playback remain unverified because the current account has no such records; isolated existing tests cover these states. Coverage source, services, database, authentication and AI remain unchanged; nothing published or deployed.