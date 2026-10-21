// Throwaway, time-boxed probe: tells ONE allowlisted user whether the edge runtime can read META_API_KEY.
// Boolean-only response. Delete after use. Logic lives in handler.ts (unit-tested).
import { makeHandler } from "./handler.ts";
import { PINNED_ISSUER, PINNED_JWK } from "./pinned-key.ts";
import { ACTIVE_FROM_MS, ACTIVE_UNTIL_MS } from "./window.ts";

const ALLOWED_USER_ID = "5f767db9-909b-4580-8071-0d3c59909595";

Deno.serve(
  makeHandler({
    activeFromMs: ACTIVE_FROM_MS,
    activeUntilMs: ACTIVE_UNTIL_MS,
    allowedUserId: ALLOWED_USER_ID,
    issuer: PINNED_ISSUER,
    pinnedJwk: PINNED_JWK,
    secretNames: ["META_API_KEY"],
    getEnv: (n) => Deno.env.get(n),
    now: () => Date.now(),
  }),
);
