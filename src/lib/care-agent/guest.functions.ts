// PR #56 guest Ask reuses the short-lived signed token installed automatically by Try Pendia Demo.
// Authentication verifies the signature/expiry first; the dedicated judge-session guard runs before
// importing the fictional evidence pipeline, spending Redis allowance or calling Meta.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const guestAskInput = z
  .object({
    question: z.string().max(4000),
    recentTurns: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }).strict())
      .max(20)
      .default([]),
    // accepted only so a crafted or real family id can be REFUSED server-side; it can never select data
    familyId: z.string().max(100).optional(),
  })
  .strict();

export const getGuestAgentStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { guestAgentStatus } = await import("@/server/guest-agent.server");
  return guestAgentStatus(process.env);
});

export const askGuestAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => guestAskInput.parse(data))
  .handler(async ({ data, context }) => {
    const { isVerifiedJudgeSession } = await import("@/server/guest-session.server");
    if (!isVerifiedJudgeSession(context.claims, context.userId, process.env["SUPABASE_URL"])) {
      return { ok: false as const, code: "not_enabled" as const, language: "en" as const };
    }
    const { askGuestAgent } = await import("@/server/guest-agent.server");
    return askGuestAgent({
      env: process.env,
      input: data,
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
