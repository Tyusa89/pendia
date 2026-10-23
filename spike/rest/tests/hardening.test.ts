// @vitest-environment node
// Runner hardening: required inputs are validated BEFORE the one call is claimed, and our own bugs are never reported as
// network failures. All offline: fake fetch only.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TOKEN } from "../config.ts";
import { _resetLatchForTests, transcribeOnce, type FetchLike } from "../run.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, goodTurns, wavBytes } from "./helpers.ts";

let dir: string;
let lock: string;
let raw: { body: string; meta: string };
const env = { META_API_KEY: FAKE_KEY, SPIKE_ALLOW_LIVE: APPROVAL_TOKEN };
const wav = wavBytes({ seconds: 3 });
const good = () => new Response(JSON.stringify(goodTurns([["A", "hi"]])), { status: 200 });

beforeEach(() => {
  blockNetwork();
  _resetLatchForTests();
  dir = mkdtempSync(join(tmpdir(), "rest-hard-"));
  lock = join(dir, "rest-call.lock");
  raw = { body: join(dir, "raw.body"), meta: join(dir, "raw.meta.json") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Opts = Parameters<typeof transcribeOnce>[0];
const call = (fetchImpl: FetchLike, over: Record<string, unknown> = {}) =>
  transcribeOnce({
    wav,
    env,
    confirmOneCall: true,
    fetchImpl,
    lockPath: lock,
    rawPaths: raw,
    ...over,
  } as Opts);
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string; status: number | null };
  }
  throw new Error("expected a rejection");
};

describe("rawPaths is validated before the one call is claimed", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["an empty object", {}],
    ["no meta path", { body: "x" }],
    ["no body path", { meta: "x" }],
    ["empty strings", { body: "", meta: "" }],
    ["blank strings", { body: "  ", meta: "  " }],
    ["non-text paths", { body: 1, meta: 2 }],
    ["the same file for both", { body: "same", meta: "same" }],
  ])("%s: refused as raw_paths_missing, nothing claimed, nothing sent", async (_n, rawPaths) => {
    const f = vi.fn(async () => good());
    const e = await fail(call(f as unknown as FetchLike, { rawPaths }));
    expect(e.code).toBe("raw_paths_missing");
    expect(e.code).not.toBe("network_error");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false);
  });

  it("the authorization is not consumed by such a mistake: the next, correct call still goes through", async () => {
    const f = vi.fn(async () => good());
    await fail(call(f as unknown as FetchLike, { rawPaths: undefined }));
    const r = await call(f as unknown as FetchLike);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(existsSync(lock)).toBe(true);
  });

  it("is the regression for the stale Windows check script (it called transcribeOnce without rawPaths)", async () => {
    const { rawPaths: _omit, ...withoutRaw } = {
      wav,
      env,
      confirmOneCall: true,
      fetchImpl: (async () => good()) as FetchLike,
      lockPath: lock,
      rawPaths: raw,
    };
    const e = await fail(transcribeOnce(withoutRaw as unknown as Opts));
    expect(e.code).toBe("raw_paths_missing");
    expect(existsSync(lock)).toBe(false);
  });

  it("the approval check still comes first: no approval means live_not_approved even with bad paths", async () => {
    const e = await fail(
      call((async () => good()) as FetchLike, {
        env: { META_API_KEY: FAKE_KEY },
        rawPaths: undefined,
      }),
    );
    expect(e.code).toBe("live_not_approved");
  });

  it("an earlier completed call is reported as second_call_refused, not as a raw-path problem", async () => {
    const f = vi.fn(async () => good());
    await call(f as unknown as FetchLike);
    const e = await fail(call(f as unknown as FetchLike));
    expect(e.code).toBe("second_call_refused");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("our own failures are internal_error, never network_error", () => {
  const boom = () =>
    ({
      get status(): number {
        throw new TypeError(`boom Bearer ${FAKE_KEY}`);
      },
    }) as unknown as Response;

  it("a bug after the reply arrives is internal_error: class name only, no message, one fetch, call stays claimed", async () => {
    const f = vi.fn(async () => boom());
    const e = await fail(call(f as unknown as FetchLike));
    expect(e.code).toBe("internal_error");
    expect(e.message).toContain("TypeError");
    expect(e.message).not.toContain("boom");
    expect(e.message).not.toContain(FAKE_KEY);
    expect(e.message).toMatch(/not a network failure/);
    expect(f).toHaveBeenCalledTimes(1); // no retry
    expect(existsSync(lock)).toBe(true); // the call really was claimed
    const again = await fail(call((async () => good()) as FetchLike));
    expect(again.code).toBe("second_call_refused");
    // and the failure left a metadata record with a fixed outcome and no secret
    const meta = readFileSync(raw.meta, "utf8");
    expect(JSON.parse(meta)).toMatchObject({ outcome: "internal_error", status: null });
    expect(meta).not.toContain(FAKE_KEY);
    expect(existsSync(raw.body)).toBe(false);
  });

  it("a bug BEFORE the call is claimed is internal_error and says nothing was sent", async () => {
    const f = vi.fn(async () => good());
    const e = await fail(call(f as unknown as FetchLike, { wav: null }));
    expect(e.code).toBe("internal_error");
    expect(e.message).toMatch(/Nothing was sent/);
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(false);
  });

  it("a failure of the request itself is still a network failure (undici's 'fetch failed' TypeError included)", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const e = await fail(call(f as unknown as FetchLike));
    expect(e.code).toBe("network_error");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("the no-reply record is written even when the caller passes no onRaw callback", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await fail(call(f as unknown as FetchLike)); // call() passes no onRaw
    expect(JSON.parse(readFileSync(raw.meta, "utf8"))).toMatchObject({
      outcome: "no_reply_network_error",
      status: null,
    });
  });

  it("an abort or timeout from the request is a timeout", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    expect((await fail(call(f as unknown as FetchLike))).code).toBe("timeout");
  });

  it("known errors keep their own codes (an HTTP failure is not relabelled)", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 503 }));
    expect((await fail(call(f as unknown as FetchLike))).code).toBe("http_503");
  });
});

describe("the one-call guarantees are intact", () => {
  it("run.ts still has exactly one fetchImpl call, no loops or retries, and checks the lock before validating paths", () => {
    const src = readFileSync(new URL("../run.ts", import.meta.url), "utf8");
    expect(src.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|retry\(|setTimeout/);
    const iLockCheck = src.indexOf("A live call was already made from this folder");
    const iRaw = src.indexOf("assertRawPathsUsable(opts.rawPaths)");
    const iClaim = src.indexOf('flag: "wx"');
    const iFetch = src.indexOf("opts.fetchImpl(");
    expect(iLockCheck).toBeGreaterThan(-1);
    expect(iLockCheck).toBeLessThan(iRaw);
    expect(iRaw).toBeLessThan(iClaim); // validated BEFORE the call is claimed
    expect(iClaim).toBeLessThan(iFetch);
  });
  it("the timeout, redirect refusal and secret scrubbing are unchanged", () => {
    const src = readFileSync(new URL("../run.ts", import.meta.url), "utf8");
    expect(src).toMatch(/AbortSignal\.timeout\(opts\.timeoutMs \?\? REQUEST_TIMEOUT_MS\)/);
    expect(src).toMatch(/sanitize\(e\.message, key\)/);
    expect(readFileSync(new URL("../request.ts", import.meta.url), "utf8")).toMatch(
      /redirect: "error"/,
    );
    expect(blockedFetch).not.toHaveBeenCalled();
  });
  it("writing a stale lock by hand still refuses before anything else", async () => {
    writeFileSync(lock, "earlier");
    const f = vi.fn(async () => good());
    expect((await fail(call(f as unknown as FetchLike))).code).toBe("second_call_refused");
    expect(f).not.toHaveBeenCalled();
  });
});
