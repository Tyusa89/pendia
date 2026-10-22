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
