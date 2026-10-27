// The two server functions behind the Handoff "Transcribe" button. Both require a signed-in user (requireSupabaseAuth). The
// server module is imported inside the handlers, so it (and the Meta key) is never part of the client bundle. The caller's
// right to use a family is checked here with the caller's OWN session (row-level security), never with a service key.
// Failures are returned as fixed codes, not thrown: a thrown error would reach the browser as the generic error page.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { statusInputSchema, transcribeInputSchema } from "@/lib/meta-transcribe/input";

export const getTranscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => statusInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { metaTranscribeConfigured } = await import("@/server/meta-transcribe.server");
    if (!metaTranscribeConfigured(process.env)) return { available: false };
    const { data: row } = await context.supabase
      .from("member")
      .select("role")
      .eq("family_id", data.familyId)
      .eq("user_id", context.userId)
      .maybeSingle();
    return { available: row?.role === "organizer" };
  });

export const transcribeRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => transcribeInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { transcribeRecording: run } = await import("@/server/meta-transcribe.server");
    return run({
      env: process.env,
      userId: context.userId,
      familyId: data.familyId,
      audioBase64: data.audioBase64,
      isOrganizer: async (familyId) => {
        const { data: row } = await context.supabase
          .from("member")
          .select("role")
          .eq("family_id", familyId)
          .eq("user_id", context.userId)
          .maybeSingle();
        return row?.role === "organizer";
      },
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
