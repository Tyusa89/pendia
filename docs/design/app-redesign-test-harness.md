# App redesign test harness (PR 1A)

Purpose: let later redesign PRs (tokens, primitives, shell, pages) change how the app looks without silently changing what it does.
Appearance is expected to change, so nothing here is a pixel gate.

| Check | Where | Fails when |
| --- | --- | --- |
| Layout ratchets (horizontal overflow, small tap targets, clipped text) | `scripts/visual/specs/layout.spec.ts` | a route/width gets worse than `scripts/visual/baselines/*.json`; large-text and all-preferences-on variants included |
| Accessibility (axe-core) | `a11y.spec.ts` | violation count per route/preference rises |
| Document Upload in a real browser (14 states x 4 widths) | `doc-upload.spec.ts` + `scripts/visual/doc-upload/` | the same ratchets rise for any state |
| Document Upload accessible tree | `src/test/redesign-doc-upload-a11y.test.tsx` (class-free snapshots) | role, name, text or state changes |
| Network fence | `fence.spec.ts`, `support/test.ts` | any request leaves the local app/harness hosts |
| Frozen files | `scripts/check-frozen.sh` | frozen path changed (see `app-redesign-frozen-files.md`) |
| Unit tests | `npm run test:ci` | any failure other than the known `coverage-c1 ... edits times and reassigns` one (`scripts/ci/known-failures.json`) |

Isolation: the app runs with every backend URL pointed at a dead local port and secrets blanked; Playwright aborts and records any
non-local request (Google Fonts answered empty unless `ALLOW_FONTS=1`). The Judge Demo session is a fake local token. Document Upload
renders the real components in a separate Vite harness with faked services; no storage, AI or database is reachable. Synthetic data only.

Running: `npm run visual` (checks), `npm run visual:capture` (screenshots into `visual-artifacts/`, uploaded as CI artifacts, never
committed). In a sandbox with a preinstalled browser set `PLAYWRIGHT_CHROMIUM_PATH`.

Updating baselines: only when a change intentionally improves a count or the page set changes: `npm run visual:baselines` and commit
the JSON diff, which must be reviewed. Never raise a number to make a PR green. Known pre-existing issue recorded: `/family` overflows
by 7px at 320px width on main.

Shell tests (`design-shell.test.tsx`, the guard in `medical-integrations.test.tsx`) are deliberately untouched here; they are rewritten in PR 1D with a documented mapping.
