// Request handler for the throwaway check-secrets probe, kept separate from Deno.serve so it can be unit-tested.
// At request time this makes NO network calls: the ES256 public key and issuer are pinned in pinned-key.ts and verification is local.
// (The only network activity is the platform resolving the `jose` package when the function is bundled/deployed.)
// Never logs headers, tokens or secret values; never calls Meta.
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK, type KeyLike } from "npm:jose@5.9.6";

/** Bumped whenever behaviour changes; sent on every response so a deploy can be confirmed without auth. */
export const VERSION = "pinned-jwk-4"; // -4: explicit window start (FROM) + UNTIL

export interface Config {
  /** Epoch ms before which the function refuses everything. Default 0. */
  activeFromMs?: number;
  /** Epoch ms from which the function refuses everything again. 0 = closed. */
  activeUntilMs: number;
  allowedUserId: string;
  /** Token issuer, e.g. https://<ref>.supabase.co/auth/v1 */
  issuer: string;
  /** Public ES256 JWK (kty/crv/x/y/kid). null = not configured, function fails closed. */
  pinnedJwk: JWK | null;
  secretNames: string[];
  getEnv: (name: string) => string | undefined;
  now: () => number;
}

export function makeHandler(cfg: Config): (req: Request) => Promise<Response> {
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-fn-version": VERSION },
    });

  let keyPromise: Promise<KeyLike | Uint8Array> | null = null;
  const pinnedKey = () => (keyPromise ??= importJWK(cfg.pinnedJwk as JWK, "ES256"));

  const jwkUsable =
    cfg.pinnedJwk != null &&
    cfg.pinnedJwk.kty === "EC" &&
    cfg.pinnedJwk.crv === "P-256" &&
    !("d" in cfg.pinnedJwk); // refuse anything carrying a private component

  return async (req) => {
    if (req.method !== "POST") return reply(405, { ok: false });
    const t = cfg.now();
    if (t < (cfg.activeFromMs ?? 0) || t >= cfg.activeUntilMs) return reply(410, { ok: false });
    if (!jwkUsable) return reply(503, { ok: false });

    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return reply(401, { ok: false });

    let payload;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "ES256") return reply(401, { ok: false });
      if (cfg.pinnedJwk!.kid && header.kid !== cfg.pinnedJwk!.kid) return reply(401, { ok: false });
      ({ payload } = await jwtVerify(token, await pinnedKey(), {
        algorithms: ["ES256"],
        issuer: cfg.issuer,
        audience: "authenticated",
        requiredClaims: ["exp", "sub"],
        clockTolerance: 5,
        currentDate: new Date(cfg.now()), // same clock as the window check
      }));
    } catch {
      return reply(401, { ok: false });
    }
    if (payload.role !== "authenticated") return reply(401, { ok: false });
    if (payload.sub !== cfg.allowedUserId) return reply(403, { ok: false });

    const present = Object.fromEntries(
      cfg.secretNames.map((n) => [n, (cfg.getEnv(n) ?? "").trim().length > 0]),
    );
    return reply(200, { present });
  };
}
