# Frozen files during the app redesign

The redesign (App-1 onward) changes tokens, shared UI primitives and the shell. It must not change Document Upload behaviour, services,
or anything under `supabase/**` (database, authentication, Storage policies, migrations). Gate B is not authorised.

- The list lives in `scripts/frozen-paths.txt` (globs, one per line; `**` crosses directories).
- `bash scripts/check-frozen.sh [base-ref]` fails if the branch adds, edits, deletes or renames any listed path versus the merge base
  with `origin/main`. `npm run check:frozen` runs it; `npm run check:frozen:selftest` runs its 15 self-tests.
- CI (`.github/workflows/app-redesign-checks.yml`, job "Frozen-files guard") runs both on every pull request.
- Override: a maintainer may add the PR label `frozen-change-approved`, which sets `FROZEN_OVERRIDE=1`. The guard still prints what is
  touched. Use it only for a change the founder has explicitly approved; shared token/primitives PRs do not need it because they do not
  edit the frozen files (Document Upload inherits them through CSS variables and shared components).
- Document Upload is protected in two other ways: the existing functional tests are unchanged, and `src/test/redesign-doc-upload-a11y.test.tsx`
  plus `scripts/visual/specs/doc-upload.spec.ts` check its accessible structure and layout.
