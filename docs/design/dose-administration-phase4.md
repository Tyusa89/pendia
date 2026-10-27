# Feature C Phase 4: generated types, schema comparison, smoke-test checklist

Status as of this document: the activation (`20261027000001` + `20261027000002`) is committed in the shared database and verified. Both October 22
migrations remain unapplied and excluded. `src/integrations/supabase/types.ts` has **not** been regenerated (see section 1).

## 1. Generated types: not regenerated, and why

- `types.ts` is Lovable-generated from the live database and must never be hand-edited.
- Lovable has not regenerated it on its own: its last change to the file is Oct 22 (`ca8a13c`, `gpt-engineer-app[bot]`).
- Lovable's agent was asked, in plan mode, how it would regenerate the file. Its answer (kept in `.lovable/plan.md` on `main`):
  the built-in generator (`supabase--get_types`) overwrites the whole file; it **cannot guarantee that only `types.ts` changes** (formatting or ordering inside the
  file may change, and any drift outside the new objects would appear); every Lovable change is committed and, with GitHub sync, pushed to `main` automatically.
- Because the one-file scope cannot be guaranteed, the regeneration was **not run**. Side effect to note: even in plan mode the agent wrote `.lovable/plan.md`
  and pushed two commits to `main` (`1b22bb8`, `9c60e54`, `gpt-engineer-app[bot]`); no other file changed. The agent is paused on a `plan--show` approval that nobody has answered.
- If regeneration is wanted later: run it from the Lovable editor (or the MCP `send_message`), accept that Lovable commits to `main` and spends credits, then verify with
  `git diff <before>..<after> --stat` that exactly one file changed and that the diff matches section 2. Any other file, or any change to an existing definition, is a stop.
- The application does not need the regenerated types: `src/services/dose-service.ts` uses a validated structural client, so nothing breaks while the file is stale.

## 2. Schema comparison: existing `types.ts` vs the activated database (read-only)

Compared column by column (names, nullability) for all public tables, plus functions:

- Existing 11 tables (`care_recipient`, `digest`, `family`, `handoff`, `med_change`, `medication`, `member`, `shift`, `task`, `visit`, `watch_item`): **0 drift**.
- Expected additions only:
  - tables `dose_administration` (21 columns; FKs to `family`, `medication_schedule`, and itself via `supersedes` and `disputes`) and `medication_schedule` (9 columns; FKs to `family` and `medication`; `days_of_week` is `smallint[]`);
  - functions `report_dose`, `flag_dose_disagreement`, `dose_occurrences`, `dose_scheduled_at`, `valid_iso_days` (the trigger functions are not exposed in generated types).
- Removals: none. The 8 existing functions in `types.ts` (`is_family_member`, `is_family_organizer`, `join_demo_family`, `member_can_see`, `recording_can_read`, `recording_can_write`,
  `recording_path_family`, `recording_path_type`) match the database.
- Out of scope and still absent: the October 22 objects (`coverage_*`, `family_invite`, member access columns, `family_directory`, `member_is_current`).

## 3. Checks (no files modified)

`tsc --noEmit` clean; Vitest 68 files / 1434 tests pass; `vite build` passes with no Meta URL or key names in the client bundle. ESLint over all of `src` reports 1,232 pre-existing
prettier-formatting errors (596 in `types.ts`), none in any Feature C file; `src/services/index.ts` has the same 34 as `main`.

## 4. `/demo-meds` isolation

The route's import closure is 14 files: demo code, the shared presentational components, the pure rules module, `zoned-time`, UI primitives and React/Radix packages. It reaches no
`src/services`, Supabase client, family hooks, `AppShell`, visit-pipeline or Spark module, and contains no `fetch`, RPC, WebSocket or microphone calls; its only storage is this tab's
`sessionStorage`. The root route, which wraps every page including `/demo`, subscribes to `supabase.auth.onAuthStateChange` (session handling only; it reads and writes no records).
`src/test/med-demo.test.tsx` enforces the closure.

## 5. UI smoke-test checklist for `/meds` (no permanent medication records)

**Part A: safe, creates no records** (sign in as an organizer unless stated).

1. `/meds` loads with a "Medication day" section. If it says "Dose reporting is not switched on for this family yet", the API schema cache may be stale: wait a minute and reload.
2. "Today" and the previous/next day arrows work. With no medications you see "No dose times on this day. Add dose times below."
3. "Set dose times" opens the editor. Check the messages for a bad time, no weekday chosen, and an end date before the start date. Do not press "Add dose time".
4. A member without medication access sees no dose times and no schedule controls.
5. A member with medication access who is not an organizer may see dose cards but has no "Set dose times". Press no "Report" button's Save.
6. `/demo-meds`: report as Lucía, flag as Elena, change as Carlos with a reason, the stale-view conflict, history, "Start over", the Not given reasons. Wording must say "report", never "taken" or "verified".

**Part B: creates records; needs a decision first.** The family has 0 medications and a medication cannot be removed from the UI. A real report is permanent (append-only). Run it only in a
throwaway test family: organizer adds a medication and a dose time; a caregiver with medication access reports Given; the reporter corrects with a reason; a second caregiver flags a
disagreement; history shows every entry; a member without access sees nothing; an organizer deleting that family is refused. Cleanup is the documented administrator erasure path and needs approval.
Run the rolled-back `verify` call from `docs/design/dose-administration-activation.md` before and after.

## 6. Open decisions

Whether to regenerate the types (and accept an unguaranteed scope), and whether to run Part B and in which family.
