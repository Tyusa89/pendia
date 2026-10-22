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
- Desktop layout work leaves the Coverage page and shift logic untouched until Coverage C1 PR #21 overlap is reviewed; calendar space is provided by the shared shell to avoid concurrent scheduling changes.
- Display preferences are browser-local and applied by the authenticated shell provider; unconnected assistant and notification capabilities stay disabled rather than implying delivery or AI access.
