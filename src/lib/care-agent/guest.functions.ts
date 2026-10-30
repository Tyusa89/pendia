// Server functions for the guest (judge) Ask path. INTENTIONALLY unauthenticated: the published Judge Demo has no real user. They
// grant nothing by themselves: the server module serves only the fictional in-code snapshot, behind a default-off flag and a hard
// global cap. The server module is imported inside the handlers only. Failures are fixed codes, never thrown.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  .validator((data: unknown) => guestAskInput.parse(data))
  .handler(async ({ data }) => {
    const { askGuestAgent } = await import("@/server/guest-agent.server");
    return askGuestAgent({
      env: process.env,
      input: data,
      fetchImpl: (url, init) => fetch(url, init),
    });
  });
