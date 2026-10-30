// Server functions behind Document Upload. Both require a signed-in user and the server module independently re-checks every gate
// (a successful status is never authorization). Server modules are imported inside the handlers only, so they and the Meta key are
// never part of the client bundle. Reads use the caller's own session. Failures are returned as fixed codes, not thrown.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const statusInput = z.object({ familyId: z.string().uuid() }).strict();
const extractInput = z
  .object({
    familyId: z.string().uuid(),
    path: z.string().max(200),
    // shape and size are enforced by the server module (it answers `bad_input`); loose here so a bad payload is a fixed code
    pages: z.array(z.unknown()).max(10),
  })
  .strict();

export const getDocExtractStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => statusInput.parse(data))
  .handler(async ({ data, context }) => {
    const { docExtractStatus } = await import("@/server/doc-extract.server");
    const { createSupabaseDocSource } = await import("@/server/doc-extract-source.server");
    return docExtractStatus({
      env: process.env,
      userId: context.userId,
      familyId: data.familyId,
      source: createSupabaseDocSource(context.supabase, context.userId),
    });
  });

export const extractAppointmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => extractInput.parse(data))
  .handler(async ({ data, context }) => {
    const { extractAppointmentLetter } = await import("@/server/doc-extract.server");
    const { createSupabaseDocSource } = await import("@/server/doc-extract-source.server");
    return extractAppointmentLetter({
      env: process.env,
      userId: context.userId,
      input: data,
      source: createSupabaseDocSource(context.supabase, context.userId),
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
