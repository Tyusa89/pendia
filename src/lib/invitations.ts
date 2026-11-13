// Pure helpers for family invitations: the status an organizer sees, and plain-language messages for the codes the database returns.
// Nothing here touches a token: invitations are bound to a verified email and have no token (see docs/design/family-invitations.md).
import type { Tables } from "@/integrations/supabase/types";

export type FamilyInvite = Pick<
  Tables<"family_invite">,
  "id" | "family_id" | "member_id" | "invited_email" | "created_at" | "expires_at" | "accepted_at" | "revoked_at" | "delivery_status" | "last_sent_at"
>;
export type InviteStatus = "pending" | "expired" | "revoked" | "accepted";

export function inviteStatus(i: Pick<FamilyInvite, "accepted_at" | "revoked_at" | "expires_at">, now: Date = new Date()): InviteStatus {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  return Date.parse(i.expires_at) <= now.getTime() ? "expired" : "pending";
}

/** The newest invitation per member row. */
export function latestInviteByMember(invites: readonly FamilyInvite[]): Map<string, FamilyInvite> {
  const out = new Map<string, FamilyInvite>();
  for (const i of [...invites].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) out.set(i.member_id, i);
  return out;
}

export const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) && v.trim().length <= 254;

/** Fixed codes returned by the send function (never raw database or provider text). */
export type SendInviteCode = "sent" | "email_failed" | "not_organizer" | "invalid_email" | "already_member" | "too_soon" | "failed";
export const SEND_MESSAGES: Record<SendInviteCode, string> = {
  sent: "Invitation sent.",
  email_failed: "The invitation was saved but the email could not be sent. Wait a minute and use Resend.",
  not_organizer: "Only an organizer can invite people.",
  invalid_email: "Enter a valid email address.",
  already_member: "That email already belongs to someone in this family, or this person already has an account linked.",
  too_soon: "An invitation was just sent. Wait a few seconds before sending another.",
  failed: "The invitation could not be sent. Please try again.",
};

/** Messages for accepting. The database deliberately uses generic codes so nobody can probe who is invited where. */
export function acceptErrorMessage(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  if (m.includes("invite_email_unverified")) return "Confirm your email address first: open the sign-in link we emailed you.";
  if (m.includes("already_member")) return "You are already a member of this family.";
  if (m.includes("invite_invalid")) return "This invitation is no longer valid. It may have expired, been withdrawn, or been used. Ask the organizer to send a new one.";
  return "We couldn't accept the invitation. Please try again.";
}
