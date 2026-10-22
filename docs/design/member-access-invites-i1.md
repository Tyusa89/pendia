# I-1: member access window, invitation links, directory (database package)

Status: prepared for review. **Not applied to any shared or production database.** A dry-run on a shared environment, the real apply, merge and any app change need separate approval.

## What the migration does
- `member` gains `relationship` (family_friend | professional | agency; a label, never an authorization), `agency_name` (display only), `access_status` / `access_starts_at` / `access_ends_at` (the authorization window) and `access_until_removed` (the explicit duration choice professional/agency records must make). Existing rows default to today's behavior.
- `is_family_member`, `is_family_organizer`, `member_can_see` require a current window, so ending or expiring access takes effect in every policy at once, at query time. Rows are never deleted, so history keeps its person; nothing cancels or unassigns a shift.
- `family_invite` (hashed token, optional bound email, 7-day expiry, accepted/revoked stamps, reserved delivery fields) plus `create_family_invite`, `revoke_family_invite`, `preview_family_invite`, `accept_family_invite`, `my_memberships`, `family_directory`.
- `member.user_id` lock; last-organizer guard; `member` readable only by organizers and the person themself.
- Single-family rule: an account with another current membership cannot accept a second-family invitation (`invite_second_family`) until a family switcher exists; the preview reports it up front.

## Security model
1. **user_id lock** is a trigger keyed on the connected database role (`current_user`), not on any session variable. Trusted server roles and the two SECURITY DEFINER functions that legitimately link accounts (`join_demo_family`, `accept_family_invite`) run as owner; every other role, including `authenticated`, `anon` and any unlisted role, is denied. The family creator may still add their own organizer row. A test asserts these are the only definer functions that write `member`.
2. **family_directory** is SECURITY DEFINER with a fixed search path, checks `is_family_member` itself, and returns a fixed column list (id, family_id, name, role, relationship, agency_name, access_state). Tests assert the exact columns and the absence of phone, email, language, permission switches, user id and dates.
3. **Tokens**: 256-bit-class random hex, stored only as SHA-256; shown once; never in error messages; `token_hash` is not selectable by clients (column grants).
4. **Definer functions** check authorization themselves (they bypass RLS) and execute only for signed-in users; trigger and internal helper functions are not callable by clients.

## Verification (scratch database only)
`supabase/tests/member-invites.test.sql` (171 assertions), `member-invites-sessions.sh` (25 checks from a real non-superuser login, including a genuine concurrent double-accept and attempts to escalate with SET ROLE, SET SESSION AUTHORIZATION, set_config and session_replication_role), plus the existing rls, shift-writes, appointments and coverage-requirements suites, which still pass. `supabase/rollback/...rollback.sql` restores the previous behavior and was tested.
