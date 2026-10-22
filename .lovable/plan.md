# Pendia hourly Coverage calendar

## Inspection findings
- The calendar currently repeats each shift in every Morning/Afternoon/Evening block it overlaps. Fixed minimum heights make short shifts appear to fill whole periods.
- Coverage already owns the validated Add/Edit/Reassign/Cancel dialogs, claim actions, weekly queries and refresh behavior. These will remain in place.
- The existing desktop CSS targets the old grid and imposes 40px minimum heights; those selectors must not stretch proportional timeline events.
- Coverage C1 PR #21 appears in local merged history, along with the subsequent family-time-zone, exact-time and counts-only summary work. The redesign must preserve those rules and regression tests.
- Required-coverage rules are only a proposal. Empty timeline space will not be labeled a gap, failure or fully covered period.

## Proposed experience
- **Desktop (1024px+):** seven Monday–Sunday columns, hourly vertical labels, sticky day headings and a bounded vertically scrollable calendar. Each shift occupies only its actual interval; 11 AM–1 PM and 1 PM–4 PM are separate adjacent events.
- **Tablet:** a width-adapted weekly timeline with compact labels; use the day view when text size or available space makes seven columns unreadable. No horizontal page overflow.
- **Phone:** one selected day's hourly timeline, a compact date strip and previous/next-day controls. Keep previous/next-week navigation and the weekly shift list.
- Show caregiver name or initials, exact hours, existing You/Family/Open colors, needs-completion status and an organizer Edit action. Short events retain true duration; an accessible detail popover can expose full information and touch-sized actions without enlarging the event's time interval.
- Put overlapping events in parallel lanes, not on top of one another. Split overnight events at family-local midnight and identify continuation on both dates.
- Display the family time zone next to the calendar. Handle skipped and repeated daylight-saving hours explicitly, with offset labels where necessary; never compress a 25-hour day into an ordinary 24-hour assumption.
- Preserve Pendia's Soft Harmony palette, Fraunces/Figtree typography, accessibility preferences, keyboard focus and compact desktop spacing.

## Technical component changes
1. Add a pure `src/lib/coverage-timeline.ts` presentation helper for local-day clipping, hourly ticks, proportional placement and overlap lanes. Reuse existing timezone conversion utilities; do not change shift validation or service logic.
2. Add `src/components/CoverageTimeline.tsx` with small event/day-view components as needed. Accept shifts, members, family timezone, organizer/member identity and callbacks from Coverage; no direct data access.
3. Replace only the old period-grid rendering in `src/routes/_authenticated/coverage.tsx`. Keep queries, mutations, dialogs, list, summary and permissions. Add selected-day navigation as presentation state.
4. Update timeline-specific CSS in `src/styles.css`; remove obsolete grid minimum-height overrides while preserving sidebar and other compact desktop refinements.
5. Update the architecture rules to replace the old C1 presentation hold with the new isolated timeline boundary. No migrations, schema/RLS/auth changes, AI/SMS, shift-data edits or unrelated pages.

## Validation
- Add concrete placement tests: 11 AM–1 PM occupies 120 minutes; 1 PM–4 PM begins at the same endpoint and occupies 180 minutes; adjacent shifts do not share overlap lanes.
- Test partial overlaps, midnight splits, clipping at week boundaries, Chicago versus device timezone, and March 8/November 1, 2026 daylight-saving days (23/25 real hours).
- Update old block-specific calendar UI tests to assert interval semantics. Run existing C1, shift-service, summary, timezone and scheduling tests; exercise organizer editing and member/open-shift claiming without relaxing permissions.
- Test Add/Edit/Reassign/Cancel and query refresh in isolated fixtures. Do not write test shifts into the live family. Live populated verification will be reported as unavailable if the account still has no shifts.
- Browser checks: 360px phone, 768px tablet, and 1280×720, 1366×768, 1440×900, 1920×1080 desktop; check no page overflow, readable events, calendar scrolling, keyboard actions, dialogs and large-text preferences.
- Inspect automatically generated production-build/typecheck results and fix errors; this environment does not permit manual project build/typecheck commands.

## Approval and delivery boundary
Implementation waits for approval of this plan.

The requested dedicated feature branch and draft GitHub PR cannot currently be created from this session: the PR tool is unavailable and branch-switching/pushing through shell is prohibited. Before implementation, switch/create a feature branch in **Project settings → Git**, or supply a supported draft/PR workflow. Do not implement on the main synced branch as a substitute. If that workflow remains unavailable, draft-PR delivery is blocked and will not be reported as complete.

Stop after verified draft-PR delivery; never merge, deploy or publish.