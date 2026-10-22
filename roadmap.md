# Pendia layout repair
- [x] Apply the supplied layout references to shared navigation and existing Family, Visits, Meds, Coverage, and Handoffs views.
- [x] Preserve existing care actions, permissions, and data; omit proposed features that are not implemented.
- [x] Run relevant tests and check signed-in pages at desktop and phone widths.
- [x] Add Ask Pendia and Preferences & Accessibility pages with header navigation, keeping unconnected capabilities unavailable.
- [x] Verify preference persistence and both pages in the signed-in app.

# Desktop and laptop experience
- [x] Add desktop sidebar and wider workspace while preserving phone/tablet navigation.
- [x] Rebalance dashboard, appointments, medications, handoffs and recording controls without touching Coverage C1 logic.
- [x] Verify tests, four requested widths, keyboard dialogs, scrolling and temporary recording/playback; report unavailable live-data checks.

Verification: 308 tests passed; final dialog-related suites also passed after focus-return improvement. Signed-in checks covered 360/768/1280/1440px, 1023/1024px transitions and 1920px; local recording/playback, sidebar collapse, keyboard dialog focus and large-text layouts passed with no care writes or page errors. Populated live appointments/medications/shifts and saved-recording playback remain unverified because the current account has no such records; isolated existing tests cover these states. Coverage source, services, database, authentication and AI remain unchanged; nothing published or deployed.