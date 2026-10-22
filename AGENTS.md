<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All Lovable Cloud data access goes through `src/services/index.ts`; routes/components never call the client directly (keeps features incremental).
- Every app table carries `family_id`; RLS uses `is_family_member()` / `is_family_organizer()` security-definer helpers.
- Demo family is seeded in the migration; users join it via the `join_demo_family()` RPC.
- The authenticated shell uses bottom tabs below 1024px and a collapsible desktop sidebar above it; shared sidebar dimensions also position the recording dock so navigation never overlaps recording controls.
- The Coverage calendar is a real time grid (`src/components/CoverageTimeline.tsx`, math in `src/lib/coverage-timeline.ts`): one event per shift per local day, placed by actual start/end in the family's time zone. Presentation only: queries, mutations, dialogs, permissions and shift validation stay in `coverage.tsx` and the services. Unscheduled time is shaded, never labeled a gap or requirement until required coverage exists.
- Coverage desktop density refinements are scoped in global CSS to the existing semantic section labels at the desktop breakpoint; the calendar does not use fixed minimum heights.
- Display preferences are browser-local and applied by the authenticated shell provider; unconnected assistant and notification capabilities stay disabled rather than implying delivery or AI access.
- The visit pipeline (`src/lib/visit-pipeline/`) has demo providers only. Demo Mode (`/demo`, `/visits/demo`) reads no family data, writes nothing, calls no service, network, microphone or SMS provider, and its modules must not import the Supabase client, `src/services`, family hooks or `AppShell` (tests enforce this). Live Meta providers will be server functions behind the same interfaces, added only after the live spike is approved; saved items will then need model/source provenance.

## Migration safety notice (read before any database work)
Merging a migration file into `main` does NOT approve applying it. Two migrations are on `main` and are **pending explicit founder approval**:
- `supabase/migrations/20261022000001_coverage_requirements.sql` (required coverage hours): pending explicit founder approval.
- `supabase/migrations/20261022000002_member_access_invites.sql` (member access window, invitation links, family directory, `member.user_id` lock): pending explicit founder approval.

Rules:
- Neither migration may be applied automatically, by a sync or "update the database" step, or as part of unrelated work. Do not run, replay or "fix" them while doing anything else.
- A **separate** approval is required for each shared-database dry-run and for each actual apply, per migration. An approval for one migration, one dry-run or one environment does not carry over to another.
- `20261022000002` must **not** be applied before the member-directory application compatibility changes (I-2: reading names through `family_directory()` instead of the `member` table) are ready. After that migration, non-organizers can only read their own `member` row, so the current app would show other people's assigned coverage shifts as **open** (with a claim action), task owners as "Unassigned", and handoff authors as "Someone".
- Each migration has tests and (for `...0002`) a rollback script under `supabase/tests/` and `supabase/rollback/`; use scratch databases only until a dry-run is approved.

