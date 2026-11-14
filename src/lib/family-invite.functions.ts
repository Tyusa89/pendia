// Organizer-only server function behind "Send invitation" / "Resend". Requires a signed-in user; the database functions authorize the
// organizer and the family. Failures come back as fixed codes (a thrown error would reach the browser as the generic error page).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const sendFamilyInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const d = data as { memberId?: unknown; email?: unknown };
    if (typeof d?.memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.memberId) || typeof d?.email !== "string" || d.email.length > 254) throw new Error("bad input");
    return { memberId: d.memberId, email: d.email };
  })
  .handler(async ({ data, context }) => {
    const { sendFamilyInvite, authMagicLinkSender } = await import("@/server/family-invite.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    return sendFamilyInvite({ supabase: context.supabase, memberId: data.memberId, email: data.email, origin, sendMagicLink: authMagicLinkSender });
  });
