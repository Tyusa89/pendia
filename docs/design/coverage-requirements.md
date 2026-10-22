# Phase 4 design: required coverage, date overrides, gap detection (read-only proposal)

Status: proposal only. No migration or code accompanies this document. Needs separate approval.

## Principles
- Nothing is assumed. No requirement rows means "no required hours defined": no gaps are reported and nothing is called covered.
- Only **assigned** shifts count as coverage. Open (unassigned) shifts do not.
- Required hours are wall-clock in the family's time zone (so they hold across daylight saving); shifts are instants.
- A date-specific requirement **replaces** the weekly pattern for that date; it never adds to it.

## Data model (one migration, two tables)

```sql
create table public.coverage_requirement (       -- recurring weekly pattern
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Monday
  start_time time not null,
  end_time   time not null,                                    -- end <= start means it ends the next day (overnight)
  created_at timestamptz not null default now(),
  check (start_time <> end_time)
);
create table public.coverage_override (          -- one row per date it replaces; zero windows = "no requirement that day"
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  unique (family_id, day)
);
create table public.coverage_override_window (
  id uuid primary key default gen_random_uuid(),
  override_id uuid not null references public.coverage_override(id) on delete cascade,
  family_id uuid not null references public.family(id) on delete cascade,  -- every table carries family_id (project rule)
  start_time time not null,
  end_time time not null,
  check (start_time <> end_time)
);
```
- Several windows per weekday are allowed (e.g. 08:00-12:00 and 18:00-22:00).
- Override with no windows = an explicit "nothing required that date" (e.g. a day the person is in hospital). Absent override row = the weekly pattern applies. This distinction is why the override is its own row.
- Overlapping windows in the same set are merged when computing, never rejected (consistent with the overlap-flag-not-block rule).
- Validation in the service layer as well as check constraints; `family_id` of child rows must match the parent (trigger or composite FK).

## Resolving required time for a date
1. If `coverage_override` exists for (family, date): required = its windows (possibly none).
2. Else required = `coverage_requirement` rows for that weekday (possibly none, meaning nothing defined).
3. Convert each window to instants using the family zone: start = zoned(date, start_time); end = zoned(date + (end<=start ? 1 : 0), end_time). A wall time that does not exist (spring-forward) moves to the next valid time; a repeated time (fall-back) uses the first occurrence. So a 22:00-06:00 requirement is 9 real hours on the fall-back night and 7 on spring-forward.
4. An overnight window belongs to the date it starts on; an override on the *next* date does not cancel the tail of the previous night's window (documented, tested).

## Gap detection (pure function, no I/O)
`uncovered(required[], shifts[]) -> intervals[]`
1. Required intervals: union (merge overlapping/touching).
2. Coverage intervals: union of assigned, non-canceled shifts (overlapping shifts merge; overlap is not double coverage).
3. Gaps = required minus coverage, as exact [start, end) instants, clipped to the visible range.
4. Output also: covered minutes, required minutes, and which required window each gap belongs to.
5. Open shifts are listed separately as "unfilled" and never subtract from gaps.
Summary text then becomes factual: "Required 56 h, scheduled 48 h, uncovered 8 h (Thu 8:00 AM-12:00 PM)". With no requirements it keeps the Phase 3 wording.

## UI (phase 4b)
- Organizer editor: weekly grid of windows per weekday; "Change one date" creates an override (with "No coverage needed that day").
- Calendar: uncovered intervals drawn as distinct red bars with exact hours; scheduled coverage stays as today. Phone shows the gap list as text; the grid is secondary.
- Members see gaps read-only, and can claim open shifts as today.

## RLS (same pattern as `shift`)
For all three tables:
- SELECT: `is_family_member(family_id) and member_can_see(family_id, 'schedule')`.
- INSERT/UPDATE/DELETE: `is_family_organizer(family_id)`; `with check` repeats it and rejects a changed `family_id`.
- Child window rows: `family_id` must equal the parent's (checked by trigger) so a window cannot be attached across families.
- No policy lets a member write; gap computation is client-side, so it needs no new RPC.
SQL tests (rolled-back, like `shift-writes.test.sql`): organizer CRUD; member read-only; other-family isolation; cross-family child insert refused; `end = start` refused; override uniqueness; cascade delete.

## Tests required
Pure gap tests: partial cover, overlapping shifts (no double count), overnight, DST fall-back/spring-forward, open shift ignored, canceled ignored, override replacing weekly, empty override = nothing required, no requirements = no gaps and no "covered" claim, range clipping at week edges.

## Rollout / risks
- Migration is additive; nothing existing changes. Roll back by dropping the three tables.
- Risk: users read an empty requirement set as "fully covered" - mitigated by the Phase 3 note and explicit "No required hours set" empty state.
- Open questions for approval: allow overrides to be ranges of dates (vacation) in v1, or single dates only (proposed: single dates)? Minimum granularity (proposed: 15 minutes)?
