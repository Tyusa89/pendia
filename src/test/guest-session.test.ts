// @vitest-environment node
// Real ES256 signatures and the existing auth SDK verifier; all network/provider work is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { JUDGE_DEMO_USER_ID } from "@/lib/judge-demo";
import { isVerifiedJudgeSession } from "@/server/guest-session.server";

const state = vi.hoisted(() => ({
  authorization: "",
  jwks: { keys: [] as Record<string, unknown>[] },
  ask: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://app.example.test", {
    headers: state.authorization ? { authorization: state.authorization } : {},
  }),
}));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  createServerFn: () => {
    let middleware: Array<(opts: { next: (arg: { context: Record<string, unknown> }) => unknown }) => unknown> = [];
    let validate = (data: unknown) => data;
    const builder = {
      middleware: (m: typeof middleware) => { middleware = m; return builder; },
      inputValidator: (fn: typeof validate) => { validate = fn; return builder; },
      handler: (fn: (arg: { data: unknown; context: Record<string, unknown> }) => unknown) =>
        async ({ data }: { data?: unknown } = {}) => {
          const invoke = ({ context }: { context: Record<string, unknown> }) => fn({ data: validate(data), context });
          return middleware[0] ? middleware[0]({ next: invoke }) : invoke({ context: {} });
        },
    };
    return builder;
  },
}));
vi.mock("@supabase/supabase-js", async (original) => {
  const sdk = await original<typeof import("@supabase/supabase-js")>();
  return { ...sdk, createClient: (...args: Parameters<typeof sdk.createClient>) => {
    const client = sdk.createClient(...args);
    const verify = client.auth.getClaims.bind(client.auth);
    client.auth.getClaims = (token) => verify(token, { jwks: state.jwks });
    return client;
  } };
});
vi.mock("@/server/guest-agent.server", () => ({ askGuestAgent: state.ask, guestAgentStatus: () => ({ state: "not_enabled" }) }));

import { askGuestAgentFn } from "@/lib/care-agent/guest.functions";

const url = "https://auth.example.test";
const seconds = Math.floor(Date.now() / 1000);
const claims = {
  sub: JUDGE_DEMO_USER_ID, iss: `${url}/auth/v1`, aud: "authenticated", role: "authenticated",
  session_id: "12345678-1234-4123-8123-123456789abc", iat: seconds - 1, exp: seconds + 3599,
};
const pair = await generateKeyPair("ES256");
const foreignPair = await generateKeyPair("ES256");
const jwk = await exportJWK(pair.publicKey);
const sign = (payload: Record<string, unknown>, foreign = false) => new SignJWT(payload)
  .setProtectedHeader({ alg: "ES256", kid: "test-judge" }).sign(foreign ? foreignPair.privateKey : pair.privateKey);

beforeEach(() => {
  state.ask.mockClear(); state.authorization = "";
  state.jwks.keys = [{ ...jwk, kid: "test-judge", alg: "ES256" }];
  vi.stubEnv("SUPABASE_URL", url);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});

describe("PR #56 guest RPC authentication before allowance/provider pipeline", () => {
  it("accepts the verified dedicated judge token installed automatically by demo entry", async () => {
    state.authorization = `Bearer ${await sign(claims)}`;
    expect(await askGuestAgentFn({ data: { question: "What appointments are planned?", recentTurns: [] } })).toEqual({ ok: true });
    expect(state.ask).toHaveBeenCalledOnce();
  });
  it.each(["missing", "invalid", "expired", "forged"])("rejects %s tokens without entering Redis or Meta pipeline", async (kind) => {
    if (kind === "invalid") state.authorization = "Bearer not-a-token";
    if (kind === "expired") state.authorization = `Bearer ${await sign({ ...claims, exp: seconds - 1 })}`;
    if (kind === "forged") state.authorization = `Bearer ${await sign(claims, true)}`;
    await expect(askGuestAgentFn({ data: { question: "What appointments are planned?", recentTurns: [] } })).rejects.toThrow();
    expect(state.ask).not.toHaveBeenCalled();
  });
  it.each([
    ["ordinary account", { sub: "11111111-1111-4111-8111-111111111111" }],
    ["wrong issuer", { iss: "https://foreign.example.test/auth/v1" }],
    ["wrong audience", { aud: "anon" }],
    ["missing session", { session_id: null }],
    ["long-lived token", { exp: seconds + 7200 }],
  ])("rejects a signed token with %s before entering the pipeline", async (_label, extra) => {
    state.authorization = `Bearer ${await sign({ ...claims, ...extra })}`;
    expect(await askGuestAgentFn({ data: { question: "What appointments are planned?", recentTurns: [] } })).toEqual({ ok: false, code: "not_enabled", language: "en" });
    expect(state.ask).not.toHaveBeenCalled();
  });
  it("rejects a client marker rather than treating it as authentication", () => {
    expect(isVerifiedJudgeSession({ judgeDemo: true }, JUDGE_DEMO_USER_ID, url)).toBe(false);
  });
});