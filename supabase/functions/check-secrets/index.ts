// Throwaway, time-boxed probe: tells ONE allowlisted user whether the edge runtime can read META_API_KEY.
// Boolean-only response. Delete after use. Logic lives in handler.ts (unit-tested).
import { makeHandler } from "./handler.ts";
import { PINNED_JWK } from "./pinned-key.ts";

// Window is closed (0) until the coordinated run: the go-live commit sets Date.parse("<now + 15 min>").
const ACTIVE_UNTIL_MS = 0;
const ALLOWED_USER_ID = "5f767db9-909b-4580-8071-0d3c59909595";

Deno.serve(
  makeHandler({
    activeUntilMs: ACTIVE_UNTIL_MS,
    allowedUserId: ALLOWED_USER_ID,
    issuer: `${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1`,
    pinnedJwk: PINNED_JWK,
    secretNames: ["META_API_KEY"],
    getEnv: (n) => Deno.env.get(n),
    now: () => Date.now(),
  }),
);
