// Throwaway, time-boxed probe: tells ONE allowlisted user whether the edge runtime can read META_API_KEY.
// Boolean-only response. Delete after use. Logic lives in handler.ts (unit-tested).
import { makeHandler } from "./handler.ts";

// Window is closed (0) until the coordinated run: the go-live commit sets Date.parse("<now + 15 min>").
const ACTIVE_UNTIL_MS = 0;
const ALLOWED_USER_ID = "5f767db9-909b-4580-8071-0d3c59909595";

// PUBLIC ES256 verification key for this project (from Supabase JWT Signing Keys / the project's
// /auth/v1/.well-known/jwks.json), pinned so verification needs no network. null = fail closed (503).
// Must be the public JWK only (kty, crv, x, y, kid). A JWK containing a private "d" is refused.
const PINNED_JWK = null;

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
