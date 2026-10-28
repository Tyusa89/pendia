// The two server functions behind the Handoff "Transcribe" button. Both require a signed-in user (requireSupabaseAuth). The
// server module is imported inside the handlers, so it (and the Meta key) is never part of the client bundle. The caller's
// right to use a family is checked here with the caller's OWN session (row-level security), never with a service key.
// Failures are returned as fixed codes, not thrown: a thrown error would reach the browser as the generic error page.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { statusInputSchema, transcribeInputSchema } from "@/lib/meta-transcribe/input";

/**
 * True only for an organizer of that family, looked up with the caller's own session. A FAILED lookup throws: it must never be
 * answered as "not an organizer" (that would turn a temporary database error into a confident no).
 */
export async function memberIsOrganizer(
  supabase: Pick<SupabaseClient<Database>, "from">,
  userId: string,
  familyId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("member")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("member_lookup_failed");
  return data?.role === "organizer";
}

export const getTranscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => statusInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { transcriptionStatus } = await import("@/server/meta-transcribe.server");
    return transcriptionStatus({
      env: process.env,
      familyId: data.familyId,
      isOrganizer: (familyId) => memberIsOrganizer(context.supabase, context.userId, familyId),
    });
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
      isOrganizer: (familyId) => memberIsOrganizer(context.supabase, context.userId, familyId),
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
