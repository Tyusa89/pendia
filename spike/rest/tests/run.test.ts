// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TOKEN, MAX_RESPONSE_BYTES, MODE, MODEL } from "../config.ts";
import {
  _resetLatchForTests,
  assertEndpointAllowed,
  sanitize,
  transcribeOnce,
  type FetchLike,
} from "../run.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, goodTurns, json, wavBytes } from "./helpers.ts";

let dir: string;
let lock: string;
const env = { META_API_KEY: FAKE_KEY, SPIKE_ALLOW_LIVE: APPROVAL_TOKEN };
const wav = wavBytes({ seconds: 3 });

beforeEach(() => {
  blockNetwork();
  _resetLatchForTests();
  dir = mkdtempSync(join(tmpdir(), "rest-spike-test-"));
  lock = join(dir, "rest-call.lock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (fetchImpl: FetchLike, over: Partial<Parameters<typeof transcribeOnce>[0]> = {}) =>
  transcribeOnce({ wav, env, confirmOneCall: true, fetchImpl, lockPath: lock, ...over });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string; status: number | null };
  }
  throw new Error("expected a rejection");
};

describe("disabled by default", () => {
  it.each([
    ["no approval variable", { META_API_KEY: FAKE_KEY }, true, "live_not_approved"],
    [
      "a wrong approval value",
      { META_API_KEY: FAKE_KEY, SPIKE_ALLOW_LIVE: "yes" },
      true,
      "live_not_approved",
    ],
    ["no confirm flag", env, false, "live_not_confirmed"],
    ["no key", { SPIKE_ALLOW_LIVE: APPROVAL_TOKEN }, true, "missing_key"],
  ])("refuses with %s and sends nothing", async (_n, e, confirm, expected) => {
    const f = vi.fn();
    const err = await codeOf(run(f as unknown as FetchLike, { env: e, confirmOneCall: confirm }));
    expect(err.code).toBe(expected);
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false); // refused before the single call was claimed
  });
  it("refuses bad audio before claiming the call", async () => {
    const f = vi.fn();
    const err = await codeOf(run(f as unknown as FetchLike, { wav: wavBytes({ channels: 2 }) }));
    expect(err.code).toBe("audio_not_mono");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false);
  });
});

describe("the one request", () => {
  it("makes exactly one POST to the exact endpoint with a timeout, no redirects and Bearer auth", async () => {
    const f = vi.fn(async () => json(goodTurns([["A", "hello"]])));
    const r = await run(f as unknown as FetchLike);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
    const form = init.body as FormData;
    expect(form.get("model")).toBe(MODEL);
    expect(form.get("mode")).toBe(MODE);
    expect(r.status).toBe(200);
    expect(existsSync(lock)).toBe(true);
    expect(blockedFetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 429, 500, 502, 503])(
    "HTTP %s fails once and is NOT retried",
    async (status) => {
      const f = vi.fn(async () => json({ error: `echo ${FAKE_KEY}` }, status));
      const err = await codeOf(run(f as unknown as FetchLike));
      expect(f).toHaveBeenCalledTimes(1);
      expect(err.code).toBe(`http_${status}`);
      expect(err.status).toBe(status);
      expect(err.message).not.toContain(FAKE_KEY); // the reply body is never read into the error
    },
  );
  it("a network failure whose message contains the key is reported with a fixed code, once", async () => {
    const f = vi.fn(async () => {
      throw new Error(`socket hang up for Bearer ${FAKE_KEY}`);
    });
    const err = await codeOf(run(f as unknown as FetchLike));
    expect(f).toHaveBeenCalledTimes(1);
    expect(err.code).toBe("network_error");
    expect(JSON.stringify(err.message)).not.toContain(FAKE_KEY);
  });
  it("times out through the abort signal and does not retry", async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) =>
          init.signal!.addEventListener("abort", () => rej(init.signal!.reason)),
        ),
    );
    const err = await codeOf(run(f as unknown as FetchLike, { timeoutMs: 25 }));
    expect(err.code).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects a reply that is not JSON or is too large", async () => {
    expect((await codeOf(run((async () => json("<html>")) as FetchLike))).code).toBe(
      "malformed_response",
    );
    _resetLatchForTests();
    rmSync(lock);
    const big = "x".repeat(MAX_RESPONSE_BYTES + 1);
    expect((await codeOf(run((async () => json(big)) as FetchLike))).code).toBe(
      "response_too_large",
    );
  });
});

describe("at most one call per execution", () => {
  it("a second call in the same process is refused, even with a fresh lock path", async () => {
    const f = vi.fn(async () => json(goodTurns([["A", "hi"]])));
    await run(f as unknown as FetchLike);
    const err = await codeOf(run(f as unknown as FetchLike, { lockPath: join(dir, "other.lock") }));
    expect(err.code).toBe("second_call_refused");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("an existing lock file from an earlier run refuses the call", async () => {
    writeFileSync(lock, "earlier");
    const f = vi.fn();
    const err = await codeOf(run(f as unknown as FetchLike));
    expect(err.code).toBe("second_call_refused");
    expect(f).not.toHaveBeenCalled();
  });
  it("the source contains no retry loop", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../run.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|retry\(|setTimeout/);
    expect(src.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
  });
});

describe("endpoint guard", () => {
  it("allows only the documented URL", () => {
    expect(() => assertEndpointAllowed("https://api.meta.ai/v1/asr/transcribe")).not.toThrow();
  });
  it.each([
    "http://api.meta.ai/v1/asr/transcribe",
    "https://api.meta.ai.evil.com/v1/asr/transcribe",
    "https://evil.com/v1/asr/transcribe",
    "https://api.meta.ai/v1/asr/other",
    "https://api.meta.ai/v1/asr/transcribe?x=1",
    "https://api.meta.ai/v1/asr/transcribe#frag",
    "https://api.meta.ai:8443/v1/asr/transcribe",
    "https://user:pw@api.meta.ai/v1/asr/transcribe",
    "wss://api.meta.ai/v1/asr/transcribe",
    "not a url",
  ])("refuses %s", (u) => {
    expect(() => assertEndpointAllowed(u)).toThrow();
  });
});

describe("redaction", () => {
  it("scrubs the key and any Bearer token", () => {
    const t = sanitize(`oops ${FAKE_KEY} and Bearer abc.DEF-123 and Bearer ${FAKE_KEY}`, FAKE_KEY);
    expect(t).not.toContain(FAKE_KEY);
    expect(t).not.toContain("abc.DEF-123");
  });
});
