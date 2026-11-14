# Join an existing family with a family code

Status: draft PR, migration `20261114000001_family_join_code.sql` **not applied anywhere**. Two supported onboarding paths exist side by side: email invitations (PR #67, magic link) and this one.

## Experience
- **Member:** onboarding shows *Create a Family* / *Join an Existing Family*. Joining asks for the family code and the person's name, sends a request, then shows **Pending approval**. The screen updates by itself (10 s poll). On approval the new membership becomes the active family and the app opens it. A declined request says so and nothing more.
- **Organizer (Family Members):** *Share family code* (create, make a new code, switch off), and *Join requests* with Approve / Decline. Approve needs an explicit choice of the three viewing permissions (Medications, Schedule, Visits): **all start OFF**, and the button stays disabled until at least one is selected (the database default is also off). **Document upload is never granted by approval**; the organizer grants it afterwards on the member card.

## Security model
| Risk | Control |
|---|---|
| Code grants access | It only routes a request. Membership needs an organizer's approval. |
| Code guessing | 12 characters from a 32-symbol alphabet (60 bits, server-generated). Every wrong code is logged; 8 per account per hour returns `too_many_attempts`, even for the right code. One answer (`null`) for wrong / switched-off / replaced / recently-declined codes. |
| Code leak from the database | Only SHA-256 of the normalized code is stored; the code is shown once at creation. |
| Information leak to unapproved people | The request functions return only a request id and its status. No family name, member, recipient or permission data. Tables have RLS on, no policies and no grants. |
| Unverified accounts | `email_confirmed_at` is required to request and again to approve. |
| Wrong approver | `decide_join_request` checks `is_family_organizer` of the request's own family (row locked). |
| Replay / races | Only a `pending` request can be decided; two simultaneous approvals: one wins, the other gets `request_not_pending` (tested with real sessions). A partial unique index allows one pending request per person per family. |
| Duplicates / spam | Existing member refused (`already_member`); max 3 open requests per account; 24 h cooldown after a decline. |
| Unauthorized linking | `member.user_id` protection is untouched: approval inserts the row inside a SECURITY DEFINER function, like `accept_family_invite`. Clients still cannot link accounts. |
| Privilege escalation | New row is role `member`; `can_upload_documents` keeps its default (off). |
| Demo | Refused **in the database**: every client function starts with `family_join_assert_caller()`, which rejects the dedicated demo guest identity (`42501`, tested for all eight functions), and the seeded sample family (`is_demo`) can neither get a code nor take a request. The app wrapper `withJudgeDemo` is a second, UI-level layer. |

## Dependencies and conflicts
- Needs `family`, `member`, `is_family_organizer(uuid)` and the `member_family_user_uniq` index from the phase-1 hardening migration. Works with or without I-1 (access windows) and with or without the member-upload and invitation migrations; tested on both schemas.
- No object overlaps with `20261113000001` (`family_invite*`). The function names are `*_family_join_code`, `*_join_request*`.
- Multi-family: approval adds a membership; the switcher and `setActiveFamily` are unchanged.

## Limits
- The per-account attempt limit cannot stop an attacker who controls many verified accounts. IP-level limiting would belong in an edge or server layer (not part of this PR).
- Joining from the app is offered only to people with no family yet (onboarding). Joining a second family via a code is a possible follow-up.
