// @vitest-environment node
// Proxy-authentication mode (--auth-via-proxy): the Claude Cloud agent proxy adds the Bearer header, so this process
// sends none and needs no META_API_KEY. Everything else about the one call is unchanged. All offline: fake fetch only.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TOKEN, REST_URL } from "../config.ts";
import { buildTranscribeRequest, describeRequest } from "../request.ts";
import { _resetLatchForTests, transcribeOnce, type FetchLike } from "../run.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, goodTurns, json, wavBytes } from "./helpers.ts";

const B = "----PendiaSpikeTESTBOUNDARY0123456789";
const wav = wavBytes({ seconds: 3 });
const PROXY_ENV = { HTTPS_PROXY: "http://127.0.0.1:9", NODE_USE_ENV_PROXY: "1" };
const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("request construction", () => {
  it("proxy mode builds the same request with NO Authorization header and never reads the key argument", () => {
    const direct = buildTranscribeRequest(FAKE_KEY, wav, B);
    // Even an unusable key argument is irrelevant, because it is never read.
    const viaProxy = buildTranscribeRequest("not a key\n", wav, B, { authViaProxy: true });
    expect(viaProxy.url).toBe(REST_URL);
    expect(viaProxy.init.method).toBe("POST");
    expect(Object.keys(viaProxy.init.headers).map((h) => h.toLowerCase())).not.toContain(
      "authorization",
    );
    expect(viaProxy.init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${B}`,
    });
    expect(Buffer.from(viaProxy.init.body).equals(Buffer.from(direct.init.body))).toBe(true);
    expect(viaProxy.init.redirect).toBe("error");
    expect(viaProxy.init.credentials).toBe("omit");
  });

  it("proxy mode does not put a supplied key anywhere in the request", () => {
    const { init } = buildTranscribeRequest(FAKE_KEY, wav, B, { authViaProxy: true });
    expect(JSON.stringify(init.headers)).not.toContain(FAKE_KEY);
    expect(Buffer.from(init.body).includes(Buffer.from(FAKE_KEY))).toBe(false);
  });

  it("default mode is unchanged: Bearer header, and a missing or malformed key is still refused", () => {
    expect(buildTranscribeRequest(FAKE_KEY, wav, B).init.headers.Authorization).toBe(
      `Bearer ${FAKE_KEY}`,
    );
    expect(
      buildTranscribeRequest(FAKE_KEY, wav, B, { authViaProxy: false }).init.headers,
    ).toHaveProperty("Authorization");
    expect(() => buildTranscribeRequest("", wav, B)).toThrow(/META_API_KEY is required/);
    expect(() => buildTranscribeRequest("a b", wav, B)).toThrow(/whitespace/);
  });

  it("the plan shows no Authorization header in proxy mode and is otherwise identical", () => {
    const plain = describeRequest(wav.byteLength);
    const viaProxy = describeRequest(wav.byteLength, { authViaProxy: true });
    expect(plain.headers.Authorization).toBe("Bearer ***");
    expect(viaProxy.headers).not.toHaveProperty("Authorization");
    expect(viaProxy.authentication).toMatch(/agent proxy/);
    expect(plain).not.toHaveProperty("authentication"); // default output is byte-for-byte what it was
    expect(viaProxy.url).toBe(plain.url);
    expect(viaProxy.parts).toEqual(plain.parts);
    expect(viaProxy.redirect).toBe("error");
    expect(viaProxy.retries).toBe(0);
  });
});

describe("the runner in proxy mode", () => {
  let dir: string;
  let lock: string;
  let rawPaths: { body: string; meta: string };
  beforeEach(() => {
    blockNetwork();
    _resetLatchForTests();
    dir = mkdtempSync(join(tmpdir(), "rest-proxy-"));
    lock = join(dir, "rest-call.lock");
    rawPaths = { body: join(dir, "raw.body"), meta: join(dir, "raw.meta.json") };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ok = () => vi.fn(async () => json(goodTurns([["A", "hello"]])));
  const run = (
    fetchImpl: FetchLike,
    env: Record<string, string | undefined>,
    over: Partial<Parameters<typeof transcribeOnce>[0]> = {},
  ) =>
    transcribeOnce({
      wav,
      env,
      confirmOneCall: true,
      authViaProxy: true,
      fetchImpl,
      lockPath: lock,
      rawPaths,
      ...over,
    });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as { code: string; message: string };
    }
    throw new Error("expected a rejection");
  };
  const approved = { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN, ...PROXY_ENV };

  it("makes exactly one POST to the exact endpoint with no Authorization header, no key, a timeout and no redirects", async () => {
    const f = ok();
    await run(f, approved); // note: no META_API_KEY at all
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(init.method).toBe("POST");
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain(
      "authorization",
    );
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(existsSync(lock)).toBe(true); // the single call was claimed
    expect(blockedFetch).not.toHaveBeenCalled();
  });

  it("does not send a key that happens to be in the environment, and still redacts it from the saved reply", async () => {
    const f = vi.fn(async () => json({ ...goodTurns([["A", "hello"]]), echoed: FAKE_KEY }));
    await run(f, { ...approved, META_API_KEY: FAKE_KEY });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(init.headers)).not.toContain(FAKE_KEY);
    expect(readFileSync(rawPaths.body, "utf8")).not.toContain(FAKE_KEY);
  });

  it.each([
    ["no proxy variables", { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN }],
    [
      "HTTPS_PROXY without NODE_USE_ENV_PROXY",
      { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN, HTTPS_PROXY: "http://127.0.0.1:9" },
    ],
    [
      "NODE_USE_ENV_PROXY without HTTPS_PROXY",
      { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN, NODE_USE_ENV_PROXY: "1" },
    ],
    [
      "NODE_USE_ENV_PROXY=0",
      {
        SPIKE_ALLOW_LIVE: APPROVAL_TOKEN,
        HTTPS_PROXY: "http://127.0.0.1:9",
        NODE_USE_ENV_PROXY: "0",
      },
    ],
    [
      "a blank HTTPS_PROXY",
      { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN, HTTPS_PROXY: "  ", NODE_USE_ENV_PROXY: "1" },
    ],
  ])("refuses %s before any request and does not claim the call", async (_n, env) => {
    const f = ok();
    const err = await codeOf(run(f, env));
    expect(err.code).toBe("proxy_not_configured");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false);
  });

  it("keeps the authorization gate: no approval token, or no --confirm-one-call, means no request", async () => {
    for (const [env, over, code] of [
      [PROXY_ENV, {}, "live_not_approved"],
      [{ ...PROXY_ENV, SPIKE_ALLOW_LIVE: "yes" }, {}, "live_not_approved"],
      [approved, { confirmOneCall: false }, "live_not_confirmed"],
    ] as const) {
      const f = ok();
      expect((await codeOf(run(f, env, over))).code).toBe(code);
      expect(f).not.toHaveBeenCalled();
      expect(existsSync(lock)).toBe(false);
    }
  });

  it("keeps the single-call protection: a second call, or an existing lock, is refused without a request", async () => {
    const f = ok();
    await run(f, approved);
    const again = ok();
    expect((await codeOf(run(again, approved, { lockPath: join(dir, "other.lock") }))).code).toBe(
      "second_call_refused",
    );
    expect(again).not.toHaveBeenCalled();
    _resetLatchForTests();
    writeFileSync(join(dir, "stale.lock"), "earlier");
    const third = ok();
    expect((await codeOf(run(third, approved, { lockPath: join(dir, "stale.lock") }))).code).toBe(
      "second_call_refused",
    );
    expect(third).not.toHaveBeenCalled();
  });

  it("keeps the timeout and does not retry on failure", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      await new Promise((_r, rej) =>
        init.signal!.addEventListener("abort", () => rej(init.signal!.reason)),
      );
      return json({});
    });
    const err = await codeOf(run(f as unknown as FetchLike, approved, { timeoutMs: 20 }));
    expect(err.code).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does not weaken default mode: a missing key is still refused, whatever the proxy variables say", async () => {
    const f = ok();
    const err = await codeOf(run(f, approved, { authViaProxy: false }));
    expect(err.code).toBe("missing_key");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false);
    // and with a key, default mode still sends the Bearer header
    await run(f, { ...approved, META_API_KEY: FAKE_KEY }, { authViaProxy: false });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
  });
});

describe("the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "rest-proxy-cli-"));
  const wavPath = join(dir, "t.wav");
  writeFileSync(wavPath, wavBytes({ seconds: 3 }));
  const preload = new URL("./no-network.mjs", import.meta.url).href;
  const cli = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", preload, join(root, "spike/rest/cli.ts"), ...args], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      cwd: root,
    });
  const lockFile = join(root, "spike-output/rest-call.lock");

  it("is off by default: `run --auth-via-proxy` without --live does nothing", () => {
    const r = cli(["run", "--wav", wavPath, "--auth-via-proxy"], approvedEnv());
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Disabled/);
  });
  function approvedEnv() {
    return { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN, ...PROXY_ENV };
  }
  it("`--live --auth-via-proxy` without the approval variable is refused before any request", () => {
    const before = existsSync(lockFile);
    const r = cli(
      ["run", "--wav", wavPath, "--live", "--confirm-one-call", "--auth-via-proxy"],
      PROXY_ENV,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/live_not_approved/);
    expect(existsSync(lockFile)).toBe(before);
  });
  it("without proxy routing it is refused before any request and never claims the call", () => {
    const before = existsSync(lockFile);
    const r = cli(["run", "--wav", wavPath, "--live", "--confirm-one-call", "--auth-via-proxy"], {
      SPIKE_ALLOW_LIVE: APPROVAL_TOKEN,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/proxy_not_configured/);
    expect(r.stderr).not.toMatch(/network blocked/); // it never tried the network
    expect(existsSync(lockFile)).toBe(before);
  });
  it("without the flag, an unset key is still refused (default mode unchanged)", () => {
    const before = existsSync(lockFile);
    const r = cli(["run", "--wav", wavPath, "--live", "--confirm-one-call"], approvedEnv());
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing_key/);
    expect(existsSync(lockFile)).toBe(before);
  });
  it("`plan --auth-via-proxy` works offline and shows no Authorization header", () => {
    const r = cli(["plan", "--wav", wavPath, "--auth-via-proxy"], {});
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout.slice(0, r.stdout.indexOf("\nPlan only")));
    expect(plan.headers).not.toHaveProperty("Authorization");
    const plain = cli(["plan", "--wav", wavPath], {});
    expect(
      JSON.parse(plain.stdout.slice(0, plain.stdout.indexOf("\nPlan only"))).headers.Authorization,
    ).toBe("Bearer ***");
  });
  it("cleans up", () => rmSync(dir, { recursive: true, force: true }));
});

describe("documentation", () => {
  const readme = readFileSync(join(root, "spike/rest/README.md"), "utf8");
  it("documents the proxy mode, its guard, and that it is opt-in", () => {
    expect(readme).toContain("--auth-via-proxy");
    expect(readme).toContain("NODE_USE_ENV_PROXY=1");
    expect(readme).toMatch(/proxy_not_configured/);
    expect(readme).toMatch(/opt-in/i);
  });
});
