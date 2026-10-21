// PUBLIC ES256 verification key for the Pendia Supabase project (one-time read of its published signing key).
// Pinned so verification needs no network. Public components only: a JWK containing a private "d" is refused.
// If Supabase rotates the signing key, this must be re-pinned; until then the function fails closed (401).
import type { JWK } from "npm:jose@5.9.6";

/** Token issuer for this project, pinned (not derived from the runtime's SUPABASE_URL env var). */
export const PINNED_ISSUER = "https://yjcaqgwtvtmonzzzikur.supabase.co/auth/v1";

export const PINNED_JWK: JWK = {
  kty: "EC",
  crv: "P-256",
  x: "NUzgiUgNB6EKygMsqRbBQVidOw8ceTZOBSw1mAuporA",
  y: "YmsxZOSJJfuBEvW0BEC6MgfJymRwfU0kG633jgPrW30",
  kid: "72b5e943-b371-428c-83df-c19f302cb328",
  alg: "ES256",
};
