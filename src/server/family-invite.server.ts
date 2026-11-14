// Server-side invitation sending. The organizer's own session (RLS and the database functions) authorizes creating the invitation;
// this module then asks Supabase Auth to email the invited person a MAGIC LINK. The magic link is an authentication credential owned
// by Supabase Auth: it is never created, read, stored or logged here. The invitation itself has no token (it is a database row bound
// to the invited email). Only fixed codes leave this module: no raw provider or database text, and nothing here logs an email address.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SendInviteCode } from "@/lib/invitations";

export type SendInviteResult = { code: SendInviteCode; inviteId?: string };
export type MagicLinkSender = (email: string, redirectTo: string) => Promise<{ ok: boolean; status?: number | undefined }>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Maps a database error from create_family_invite to a fixed code. */
export function createErrorCode(e: { code?: string; message?: string } | null): SendInviteCode {
  if (!e) return "failed";
  if (e.code === "42501") return "not_organizer";
  if (e.code === "P0001" && (e.message ?? "").includes("invite_too_soon")) return "too_soon";
  if (e.code === "23514") return /valid email/i.test(e.message ?? "") ? "invalid_email" : "already_member";
  return "failed";
}

/** The redirect for the emailed link: this site's /invite page, from the trusted request origin (Supabase also enforces its own allow-list). */
export function inviteRedirect(origin: string): string | null {
  try {
    const u = new URL("/invite", origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || (local && u.protocol === "http:") ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function sendFamilyInvite(args: {
  supabase: SupabaseClient<Database>;
  memberId: string;
  email: string;
  origin: string;
  sendMagicLink: MagicLinkSender;
}): Promise<SendInviteResult> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { code: "invalid_email" };
  const redirect = inviteRedirect(args.origin);
  if (!redirect) return { code: "failed" };
  // Invitation functions are not in generated types until their migration is applied.
  const db = args.supabase as unknown as SupabaseClient;
  const created = await db.rpc("create_family_invite", { _member_id: args.memberId, _email: email });
  if (created.error || !created.data) return { code: createErrorCode(created.error) };
  const inviteId = created.data as string;
  let sent = false;
  try {
    sent = (await args.sendMagicLink(email, redirect)).ok;
  } catch {
    sent = false;
  }
  await db.rpc("set_family_invite_delivery", { _invite_id: inviteId, _status: sent ? "sent" : "failed" });
  return { code: sent ? "sent" : "email_failed", inviteId };
}

/** Asks Supabase Auth to email a magic link. Uses the publishable key and no stored session; implicit flow so no browser verifier is needed. */
export const authMagicLinkSender: MagicLinkSender = async (email, redirectTo) => {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return { ok: false };
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
  const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo } });
  // only the numeric status is ever surfaced; the provider's message can contain the address
  return error ? { ok: false, status: (error as { status?: number }).status } : { ok: true };
};
