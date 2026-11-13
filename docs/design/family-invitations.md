# Family invitations with magic link sign-in

Status: **implemented in a draft PR; the migration is NOT applied anywhere.** Applying it to any database needs separate authorization.

## Flow
1. An organizer adds a family member (name, email) on **Family Members**, or presses **Send invitation** on an existing unlinked Member card.
2. The server creates the invitation (database function, organizer only) and asks **Supabase Auth** to email the person a magic link whose redirect is this site's `/invite` page.
3. The person opens the link (new accounts are created by the link; existing accounts, including password accounts, sign in). A password user can also use `/auth?redirect=/invite`.
4. `/invite` lists the pending invitations bound to the signed-in person's **verified** email and shows only the family name, the member name, the inviter's name and the expiry.
5. The person presses **Accept invitation**. The database links their account to the existing member row. The new family becomes the active one.
6. The organizer can then turn on **Upload appointment documents** (`can_upload_documents`) on that member card, as before.

## Authentication is separate from authorization
- The magic link is Supabase Auth's own credential. This code never creates, reads, stores or logs it, and the server module has no service-role key and no `generateLink`.
- The invitation is a database row (`family_invite`) bound to an email and to one member row. **There is no invitation token.** Nothing secret appears in a URL, the database or a log.

## Safeguards (all enforced in the database, `20261113000001_family_invitations.sql`)
| Requirement | How |
|---|---|
| Only an authorized organizer creates or revokes | `create_family_invite`, `revoke_family_invite`, `set_family_invite_delivery` check `is_family_organizer` for the member's family; clients have no write access to the table |
| Verified email must match | `accept_family_invite` requires `email_confirmed_at` and `lower(email) = invited_email`; a different account gets the generic `invite_invalid` |
| Explicit, single-use, atomic | accepted by an invitation id the person chose; the row is locked (`FOR UPDATE`), marked accepted in the same statement block; replay and simultaneous accepts fail (tested with two real sessions) |
| Expiring | 7 days; expired invitations are not listed and cannot be accepted; Resend replaces them |
| Revoked | Withdraw makes it unusable; revoking an accepted one is refused; a race between revoke and accept cannot undo an accept |
| Family-scoped, no cross-family grant | the invitation's `(member_id, family_id)` is a composite foreign key to that member row; accept re-checks it; one membership per person per family |
| Duplicate invitations | one open invitation per member (unique index); a new one retires the old; 30-second re-send throttle; an email already in the family is refused |
| Unauthorized membership creation | `member_user_id_guard` (same logic as I-1): only `accept_family_invite`, `join_demo_family`, the creator adding their own organizer row, and trusted roles can set `member.user_id`. Before this, an organizer could link ANY account to a member row |
| Existing permissions preserved | accepting changes only `user_id` (tested by comparing the whole row); `can_see_*` and `can_upload_documents` stay as the organizer set them; members still cannot change them |
| Several families | allowed; the family switcher chooses the active one |

## Relation to I-1 (`20261022000002_member_access_invites.sql`)
This replaces I-1's token-based invitation part with a smaller, token-free one. The two define different `family_invite` tables: **do not apply both as they stand**. If I-1 is approved later, its invitation section must first be removed or reconciled. The `member_user_id_guard` function is identical in both.

## Email delivery: not assumed production-ready
First version uses **Supabase Auth's built-in magic-link email**. Verify before relying on it:
- It has generic wording (no family name) and the platform's default sender, which may be rate limited and may land in spam. A failed send is recorded (`delivery_status = failed`) and shown as "Email not sent" with Resend.
- Magic links are short-lived (default about an hour) while an invitation lasts 7 days. An expired link shows a plain message on `/invite` and the person can request a new one there, or the organizer can Resend.
- A branded invitation email (family name, inviter) needs a sender such as Resend later; the delivery fields and server module are the place to add it.

## Checklist to verify before this is relied on (cannot be checked from the repository)
1. Supabase/Lovable Cloud Auth: email magic link / OTP sign-in is enabled and new sign-ups are allowed.
2. The published site's `/invite` URL (and the preview URL used for testing) is in the allowed redirect URLs; the Site URL is the published domain.
3. Send one invitation to a real mailbox you own and confirm: it arrives, the link opens `/invite`, a NEW address works end to end, and an EXISTING account (password or magic link) works end to end.
4. Open an expired link and confirm the explanation and re-request path.
5. Check the provider's email rate limit and consider custom SMTP before inviting many people.
6. Confirm application and server logs contain no addresses or links (the code logs nothing in this path; check the platform's own logs as well).

## Tests
- `supabase/tests/family-invitations.test.sql` (66 assertions) and `family-invitations-sessions.sh` (18 checks incl. real concurrent accept and revoke-vs-accept races) on scratch PostgreSQL.
- `src/test/family-invite-server.test.ts`, `src/test/family-invitations-ui.test.tsx` (36 tests).
- Live acceptance reuses the existing Gate B fixture: orgA1 invites `gateb-guest0@example.com` (confirmed account, no membership); the invitation is accepted through the database path; the temporary member row is then deleted so the standing fixture is unchanged. A real mailbox is used only for the single magic-link end-to-end check.
