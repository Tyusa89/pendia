// Throwaway, time-boxed probe: tells ONE allowlisted user whether the edge runtime can read META_API_KEY.
// Boolean-only response; makes no calls to Meta; never logs headers, tokens or secret values. Delete after use.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

// Window is closed (0) until the coordinated run: set to Date.parse("<now + 15 min>") in the go-live commit.
const ACTIVE_UNTIL_MS = 0;
const ALLOWED_USER_ID = "5f767db9-909b-4580-8071-0d3c59909595";
const SECRET_NAMES = ["META_API_KEY"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
// Signature is verified in this function against the project's public signing keys (ES256 only).
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { ok: false });
  if (Date.now() >= ACTIVE_UNTIL_MS) return reply(410, { ok: false });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return reply(401, { ok: false });

  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      algorithms: ["ES256"],
      issuer: ISSUER,
      audience: "authenticated",
      requiredClaims: ["exp", "sub"],
      clockTolerance: 5,
    }));
  } catch {
    return reply(401, { ok: false });
  }
  if (payload.role !== "authenticated") return reply(401, { ok: false });
  if (payload.sub !== ALLOWED_USER_ID) return reply(403, { ok: false });

  const present = Object.fromEntries(
    SECRET_NAMES.map((n) => [n, (Deno.env.get(n) ?? "").trim().length > 0]),
  );
  return reply(200, { present });
});
