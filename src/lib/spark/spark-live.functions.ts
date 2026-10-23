// The two server functions behind the development page. Both require a signed-in user (requireSupabaseAuth). The run function
// accepts ONLY the fixed fixture id, so a browser request cannot supply a transcript, a speaker map or anything else. The
// server module is imported inside the handlers, so it is not part of the client bundle. Disabled unless the server's
// SPARK_LIVE_ENABLED is "true" and the caller's user id is in SPARK_LIVE_USER_IDS.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sparkInputSchema } from "@/lib/spark/spark-live-input";

export const getSparkLiveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sparkStatus } = await import("@/server/spark-synthetic.server");
    return sparkStatus(process.env, context.userId);
  });

export const runSparkSyntheticExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sparkInputSchema.parse(data))
  .handler(async ({ context }) => {
    const { runSyntheticExtraction } = await import("@/server/spark-synthetic.server");
    return runSyntheticExtraction({
      env: process.env,
      userId: context.userId,
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
