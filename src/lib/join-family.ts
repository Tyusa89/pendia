// Pure helpers for joining a family with a family code. A code only says WHERE a request goes; it never grants membership.
// Nothing here stores or logs a code.

/** 32 symbols: no I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** What the person typed -> the 12 characters the database hashes (upper case, separators dropped, look-alikes mapped). */
export function normalizeFamilyCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** XXXX-XXXX-XXXX while typing. */
export function formatFamilyCode(input: string): string {
  return (
    normalizeFamilyCode(input)
      .slice(0, 12)
      .match(/.{1,4}/g) ?? []
  ).join("-");
}

export function isCompleteFamilyCode(input: string): boolean {
  const c = normalizeFamilyCode(input);
  return c.length === 12 && [...c].every((ch) => ALPHABET.includes(ch));
}

export type JoinRequestStatus = "pending" | "approved" | "declined" | "canceled";
export type MyJoinRequest = {
  request_id: string;
  status: JoinRequestStatus;
  created_at: string;
  decided_at: string | null;
};
export type FamilyJoinRequest = {
  request_id: string;
  requester_name: string;
  requester_email: string;
  created_at: string;
};
export type JoinCodeStatus = { enabled: boolean; rotated_at: string } | null;

/** The one answer for a code that did not work (wrong, switched off, replaced, or a recent decline): it never says which. */
export const CODE_DID_NOT_WORK =
  "That code did not work. Check it with the family organizer, or ask for a new one.";

const MESSAGES: Record<string, string> = {
  too_many_attempts:
    "Too many tries. Please wait an hour, then ask the organizer to confirm the code.",
  too_many_requests:
    "You already have several requests waiting. Cancel one or wait for an answer first.",
  email_unverified: "Confirm your email address first (use the link we sent you), then try again.",
  already_member: "You are already part of that family.",
  name_required: "Enter your name so the organizer knows who is asking.",
  request_not_pending: "That request was already answered.",
};

/** Plain-language text for a database error; unknown text is never shown raw. */
export function joinErrorMessage(message: string): string {
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  if (key) return MESSAGES[key]!;
  if (/Only an organizer/i.test(message)) return "Only a family organizer can do that.";
  return "Something went wrong. Please try again.";
}
