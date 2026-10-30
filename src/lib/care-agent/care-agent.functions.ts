// The two server functions behind Ask Pendia. Both require a signed-in user (requireSupabaseAuth) and independently enforce the FULL
// gate chain inside the server module; a successful status is never authorization for a later ask. The server modules are imported
// inside the handlers only (never at module scope), so they and the Meta key are never part of the client bundle. Reads use the
// caller's own session (context.supabase): row-level security applies and no service-role client exists in this path.
// Failures are returned as fixed codes, not thrown (a thrown error would reach the browser as the generic error page).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { askInputSchema, statusInputSchema } from "@/lib/care-agent/contract";

export const getCareAgentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => statusInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { careAgentStatus } = await import("@/server/care-agent.server");
    const { createSupabasePackSource } = await import("@/server/care-agent-source.server");
    return careAgentStatus({
      judgeSessionId: typeof context.claims.session_id === "string" ? context.claims.session_id : undefined,
      env: process.env,
      userId: context.userId,
      familyId: data.familyId,
      source: createSupabasePackSource(context.supabase, context.userId),
    });
  });

export const askCareAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => askInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { askCareAgent } = await import("@/server/care-agent.server");
    const { createSupabasePackSource } = await import("@/server/care-agent-source.server");
    const { takeJudgeRateSlot } = await import("@/server/judge-agent-limits.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const sessionId = typeof context.claims.session_id === "string" ? context.claims.session_id : undefined;
    return askCareAgent({
      judgeSessionId: sessionId,
      takeJudgeSlot: () => takeJudgeRateSlot(process.env, sessionId ?? "", getRequestHeader("cf-connecting-ip")),
      env: process.env,
      userId: context.userId,
      input: data,
      source: createSupabasePackSource(context.supabase, context.userId),
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
