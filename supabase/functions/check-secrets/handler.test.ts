// Run: deno test --allow-env supabase/functions/check-secrets/handler.test.ts
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "npm:jose@5.9.6";
import { makeHandler, type Config, VERSION } from "./handler.ts";

const ISS = "https://example.supabase.co/auth/v1";
const ALLOWED = "5f767db9-909b-4580-8071-0d3c59909595";
const OTHER = "11111111-2222-3333-4444-555555555555";
const SENTINEL = "SENTINEL-SECRET-VALUE-DO-NOT-LEAK";
const NOW = 1_800_000_000_000;

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const other = await generateKeyPair("ES256");
const pub: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };

type Claims = { sub?: string; role?: string; aud?: string; iss?: string; expSec?: number };
async function token(c: Claims = {}, key = privateKey, kid = "k1", alg = "ES256") {
  const jwt = new SignJWT({ role: c.role ?? "authenticated" })
    .setProtectedHeader({ alg, kid })
    .setIssuer(c.iss ?? ISS)
    .setAudience(c.aud ?? "authenticated")
    .setIssuedAt(NOW / 1000 - 10)
    .setExpirationTime(c.expSec ?? NOW / 1000 + 600);
  if (c.sub !== null) jwt.setSubject(c.sub ?? ALLOWED);
  return await jwt.sign(key);
}

const base = (o: Partial<Config> = {}): Config => ({
  activeUntilMs: NOW + 15 * 60_000, allowedUserId: ALLOWED, issuer: ISS, pinnedJwk: pub,
  secretNames: ["META_API_KEY"], getEnv: (n) => (n === "META_API_KEY" ? SENTINEL : undefined), now: () => NOW, ...o,
});
const post = (h: ReturnType<typeof makeHandler>, t?: string) =>
  h(new Request("https://x/fn", { method: "POST", headers: t === undefined ? {} : { authorization: `Bearer ${t}` } }));
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: got ${actual}, expected ${expected}`);
}

// --- closed window (default state): refuses before authentication ---
Deno.test("closed window: non-POST -> 405", async () => {
  const h = makeHandler(base({ activeUntilMs: 0 }));
  eq((await h(new Request("https://x/fn", { method: "GET" }))).status, 405, "GET");
});
Deno.test("closed window: every POST -> 410, even with a perfect token", async () => {
  const h = makeHandler(base({ activeUntilMs: 0 }));
  eq((await post(h)).status, 410, "no auth");
  eq((await post(h, "junk")).status, 410, "junk");
  eq((await post(h, await token())).status, 410, "valid token");
});
Deno.test("window expiry is enforced at the boundary", async () => {
  const t = await token({ expSec: NOW / 1000 + 3600 }); // outlives the window, so only the window can refuse it
  eq((await post(makeHandler(base({ now: () => NOW + 15 * 60_000 - 1 })), t)).status, 200, "1ms before");
  eq((await post(makeHandler(base({ now: () => NOW + 15 * 60_000 })), t)).status, 410, "at expiry");
});

// --- active window: authentication tests ---
Deno.test("active: GET -> 405", async () => {
  eq((await makeHandler(base())(new Request("https://x/fn", { method: "GET" }))).status, 405, "GET");
});
Deno.test("active: missing / garbage / non-Bearer credentials -> 401", async () => {
  const h = makeHandler(base());
  eq((await post(h)).status, 401, "none");
  eq((await post(h, "not.a.jwt")).status, 401, "garbage");
  eq((await h(new Request("https://x/fn", { method: "POST", headers: { authorization: `Basic ${await token()}` } }))).status, 401, "Basic");
});
Deno.test("active: tampered signature (middle char) -> 401", async () => {
  const [a, b, s] = (await token()).split(".");
  const i = 10, flipped = s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  eq((await post(makeHandler(base()), `${a}.${b}.${flipped}`)).status, 401, "tampered");
});
Deno.test("active: valid claims signed by a different key -> 401", async () => {
  eq((await post(makeHandler(base()), await token({}, other.privateKey))).status, 401, "foreign key");
});
Deno.test("active: wrong kid -> 401", async () => {
  eq((await post(makeHandler(base()), await token({}, privateKey, "other-kid"))).status, 401, "kid");
});
Deno.test("active: HS256 token (alg confusion) -> 401", async () => {
  const hs = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuer(ISS).setAudience("authenticated").setSubject(ALLOWED).setExpirationTime(NOW / 1000 + 600)
    .sign(new TextEncoder().encode("shared-secret-shared-secret-shared-secret"));
  eq((await post(makeHandler(base()), hs)).status, 401, "HS256");
});
Deno.test("active: wrong issuer / audience / role / expired / no sub -> 401", async () => {
  const h = makeHandler(base());
  eq((await post(h, await token({ iss: "https://evil.example/auth/v1" }))).status, 401, "issuer");
  eq((await post(h, await token({ aud: "anon" }))).status, 401, "audience");
  eq((await post(h, await token({ role: "anon" }))).status, 401, "role");
  eq((await post(h, await token({ expSec: NOW / 1000 - 60 }))).status, 401, "expired");
  eq((await post(h, await token({ sub: null as unknown as undefined }))).status, 401, "no sub");
});
Deno.test("active: valid token for a different user -> 403", async () => {
  eq((await post(makeHandler(base()), await token({ sub: OTHER }))).status, 403, "other user");
});

// --- success path and response hygiene ---
Deno.test("allowed user: 200 with booleans only, never the secret value", async () => {
  const r = await post(makeHandler(base()), await token());
  eq(r.status, 200, "status");
  const text = await r.text();
  eq(text, '{"present":{"META_API_KEY":true}}', "body");
  eq(text.includes(SENTINEL), false, "leak");
  eq(r.headers.get("cache-control"), "no-store", "cache");
});
Deno.test("allowed user: secret missing/blank -> present false", async () => {
  for (const v of [undefined, "", "   "]) {
    const r = await post(makeHandler(base({ getEnv: () => v })), await token());
    eq(await r.text(), '{"present":{"META_API_KEY":false}}', `value ${JSON.stringify(v)}`);
  }
});
Deno.test("every response carries the version header", async () => {
  eq((await makeHandler(base())(new Request("https://x/fn", { method: "GET" }))).headers.get("x-fn-version"), VERSION, "405");
  eq((await post(makeHandler(base({ activeUntilMs: 0 })))).headers.get("x-fn-version"), VERSION, "410");
});

// --- fail closed on bad configuration ---
Deno.test("no pinned key -> 503 for POSTs in an open window", async () => {
  eq((await post(makeHandler(base({ pinnedJwk: null })), await token())).status, 503, "null key");
});
Deno.test("a JWK with a private component is refused (503)", async () => {
  const priv: JWK = { ...(await exportJWK(privateKey)), kid: "k1" };
  eq((await post(makeHandler(base({ pinnedJwk: priv })), await token())).status, 503, "private jwk");
});

// --- no network at request time ---
Deno.test("handler makes no fetch() calls at request time", async () => {
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = (() => { calls++; return Promise.reject(new Error("network disabled in test")); }) as typeof fetch;
  try {
    const h = makeHandler(base());
    await post(h, await token()); await post(h, "junk"); await post(h, await token({ sub: OTHER }));
  } finally { globalThis.fetch = real; }
  eq(calls, 0, "fetch calls");
});
