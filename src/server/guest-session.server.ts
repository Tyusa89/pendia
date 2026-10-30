import { JUDGE_DEMO_USER_ID } from "@/lib/judge-demo";

// Only call with claims returned by requireSupabaseAuth's cryptographic verifier.
// Browser markers, decoded-only JWTs and client-supplied identities are not evidence.
export function isVerifiedJudgeSession(
  claims: Record<string, unknown>,
  userId: string,
  authUrl: string | undefined,
  now = Date.now(),
): boolean {
  if (!authUrl || userId !== JUDGE_DEMO_USER_ID || claims["sub"] !== JUDGE_DEMO_USER_ID) return false;
  const seconds = Math.floor(now / 1000);
  const { iat, exp, session_id: sessionId } = claims;
  return (
    claims["iss"] === `${authUrl.replace(/\/$/, "")}/auth/v1` &&
    claims["aud"] === "authenticated" && claims["role"] === "authenticated" &&
    typeof sessionId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) &&
    typeof iat === "number" && Number.isInteger(iat) && iat <= seconds &&
    typeof exp === "number" && Number.isInteger(exp) && exp > seconds &&
    exp > iat && exp - iat <= 3600
  );
}