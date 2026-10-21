# Roadmap (planning only)

Nothing here is approved for build unless it says so. Each item needs its own plan, the owner's approval, and (where it
applies) a separate approval for new tables, permissions, external services and AI cost. Synthetic data only.

## Approved, in progress
Recovery plan after the design review, as separate small PRs (see the plan in the review thread):

| PR | Scope | Migration |
|---|---|---|
| 1 | Handoffs matches the design: Quick handoff entry, Temporary/Saved voice-note states, docked Stop | none |
| 1b | Authorized non-organizer caregivers submit handoffs as themselves (database-enforced) | yes |
| 2 | Emergency contacts in the care profile, visible to authorized family members, organizer-only edits, tap-to-call | yes |
| 3 | Coverage scheduling and editing by organizers | none |
| 3b | Authorized members claim an eligible open block only (no general schedule editing) | yes |
| 4 | Demo consistency around Maria, Carlos and Jenny, plus a demo script | seed function only |
| 5 | Remaining design improvements that need no new data | none |

Recording retention: **keep until an organizer deletes it.** There is no automatic deletion.

## Planned, not approved for build

### Pendia Smart Scan (planning only)
Placeholder only. **No scope has been written and nothing is implemented.** Before any build the owner must define:
what is scanned and by whom, what Pendia does with the result, what is stored and where, who can see it, whether any AI
or text-recognition service is involved (and its cost), how a person confirms or corrects the result before it is saved
(Pendia never saves machine output without a human confirming it), and the privacy notice shown. It will need its own
plan, its own approval, and likely new storage, permissions and tables, which would be separate migrations.

### Ask Pendia (optional assistant)
Designed; the app reserves its place (`src/lib/features.ts`, `assistant: false`) and renders nothing while off. No AI call,
integration or route exists. Needs separate approval before any activation or cost.

### Needs separate feature approval (not started)
Messaging (text invites, "message everyone"), dose confirmation and dose history, reminders, and AI-generated notes
(for example a note drafted from a voice recording).
