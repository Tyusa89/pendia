// @vitest-environment node
// The reply to the one paid request is preserved BEFORE it is checked, parsed or scored. All offline: a fake fetch.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TOKEN, MAX_RAW_BYTES, MAX_RESPONSE_BYTES } from "../config.ts";
import { redactKey, readBounded, saveRaw } from "../raw.ts";
import { parseTranscribeResponse, observedShape } from "../response.ts";
import { _resetLatchForTests, transcribeOnce, type FetchLike } from "../run.ts";
import { buildScorecard } from "../scorecard.ts";
import { script } from "../../diarization/tests/helpers.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, goodTurns, wavBytes } from "./helpers.ts";
import type { RawInfo } from "../raw.ts";

let dir: string;
let paths: { body: string; meta: string };
const env = { META_API_KEY: FAKE_KEY, SPIKE_ALLOW_LIVE: APPROVAL_TOKEN };
const wav = wavBytes({ seconds: 3 });
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  blockNetwork();
  _resetLatchForTests();
  dir = mkdtempSync(join(tmpdir(), "rest-raw-"));
  paths = {
    body: join(dir, "rest-raw-response.body"),
    meta: join(dir, "rest-raw-response.meta.json"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const reply = (
  body: BodyInit | Uint8Array | null,
  status = 200,
  headers: Record<string, string> = {},
) => (async () => new Response(body as BodyInit | null, { status, headers })) as FetchLike;

async function run(f: FetchLike, over: Partial<Parameters<typeof transcribeOnce>[0]> = {}) {
  const out: {
    raw: RawInfo | null;
    err: { code: string; message: string; status: number | null } | null;
    ok: Awaited<ReturnType<typeof transcribeOnce>> | null;
  } = { raw: null, err: null, ok: null };
  try {
    out.ok = await transcribeOnce({
      wav,
      env,
      confirmOneCall: true,
      fetchImpl: f,
      lockPath: join(dir, "rest-call.lock"),
      rawPaths: paths,
      onRaw: (i) => {
        out.raw = i;
      },
      ...over,
    });
  } catch (e) {
    out.err = e as NonNullable<typeof out.err>;
  }
  return out;
}
const meta = () => JSON.parse(readFileSync(paths.meta, "utf8"));
const body = () => readFileSync(paths.body);

describe("a good reply", () => {
  it("is saved exactly, with status and allowlisted headers, and then returned", async () => {
    const text = JSON.stringify(goodTurns([["A", "hello there"]]));
    const { raw, ok, err } = await run(reply(text, 200, { "content-type": "application/json" }));
    expect(err).toBeNull();
    expect(ok!.status).toBe(200);
    expect(body().equals(Buffer.from(text))).toBe(true);
    expect(raw).toMatchObject({
      saved: true,
      status: 200,
      bytesReceived: text.length,
      bytesSaved: text.length,
      truncated: false,
      keyRedactions: 0,
    });
    expect(meta()).toMatchObject({
      status: 200,
      ok: true,
      outcome: "reply_received",
      headers: { "content-type": "application/json" },
    });
    expect(meta().body.sha256Saved).toBe(sha(Buffer.from(text)));
  });
});

describe("the reply is retained even when everything after it fails", () => {
  it("invalid JSON: malformed_response, but the exact bytes (non-UTF-8 and CRLF included) are on disk", async () => {
    const odd = Buffer.concat([
      Buffer.from("<html>\r\nnot json "),
      Buffer.from([0xff, 0xfe, 0x00, 0x80]),
      Buffer.from("\r\n"),
    ]);
    const { err, raw } = await run(reply(odd, 200, { "content-type": "text/html" }));
    expect(err!.code).toBe("malformed_response");
    expect(raw!.saved).toBe(true);
    expect(body().equals(odd)).toBe(true);
    expect(meta().status).toBe(200);
  });
  it("valid JSON of the wrong shape: the strict parser rejects it, and the raw reply was already saved", async () => {
    const wrong = JSON.stringify({ words: [{ w: "SECRET WORDS" }] });
    const { ok } = await run(reply(wrong));
    expect(body().toString()).toBe(wrong); // saved by transcribeOnce, before any parsing
    expect(() => parseTranscribeResponse(ok!.json)).toThrow();
    expect(body().toString()).toBe(wrong); // still there after the failed parse
  });
  it.each([400, 401, 403, 404, 415, 429, 500, 502, 503])(
    "HTTP %s: fails once, with the status and body kept",
    async (status) => {
      const text = JSON.stringify({ error: { message: "bad request: field x" } });
      const f = vi.fn(reply(text, status, { "content-type": "application/json" }));
      const { err, raw } = await run(f as unknown as FetchLike);
      expect(f).toHaveBeenCalledTimes(1);
      expect(err!.code).toBe(`http_${status}`);
      expect(err!.message).not.toContain("bad request"); // the body never reaches an error message
      expect(raw!.status).toBe(status);
      expect(meta()).toMatchObject({ status, ok: false });
      expect(body().toString()).toBe(text);
    },
  );
  it("an empty body is kept as an empty file with its status", async () => {
    const { err, raw } = await run(reply("", 502));
    expect(err!.code).toBe("http_502");
    expect(raw).toMatchObject({ saved: true, bytesReceived: 0 });
    expect(body().length).toBe(0);
  });
  it("a reply larger than the parse limit is rejected for parsing, yet kept IN FULL", async () => {
    const big = Buffer.alloc(MAX_RESPONSE_BYTES + 1000, 0x61);
    const { err, raw } = await run(reply(big));
    expect(err!.code).toBe("response_too_large");
    expect(raw).toMatchObject({
      saved: true,
      truncated: false,
      bytesReceived: big.length,
      bytesSaved: big.length,
    });
    expect(body().length).toBe(big.length);
  });
  it("a reply beyond the hard ceiling is cut, and the cut is recorded, never silent", async () => {
    const limit = 5000;
    const big = Buffer.alloc(limit + 777, 0x62);
    const { err, raw } = await run(reply(big), { rawLimit: limit });
    expect(err!.code).toBe("response_too_large");
    expect(raw).toMatchObject({ saved: true, truncated: true, bytesSaved: limit });
    expect(meta().body).toMatchObject({ truncated: true, bytesSaved: limit });
    expect(body().length).toBe(limit);
    expect(MAX_RAW_BYTES).toBe(32 * 1024 * 1024);
  });
  it("a body that stops mid-stream keeps what arrived and is reported as incomplete", async () => {
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (step++ === 0) c.enqueue(new TextEncoder().encode('{"partial":'));
        else c.error(new Error("connection reset"));
      },
    });
    const { err, raw } = await run(reply(stream));
    expect(err!.code).toBe("network_error");
    expect(raw).toMatchObject({ saved: true });
    expect(body().toString()).toBe('{"partial":');
    expect(meta().body.readError).toBe(true);
  });
});

describe("no credential or sensitive header reaches the saved files", () => {
  it("stores only allowlisted response headers, never cookies, tokens or request headers", async () => {
    const { raw } = await run(
      reply("{}", 429, {
        "content-type": "application/json",
        "set-cookie": "session=SECRETCOOKIE; HttpOnly",
        authorization: "Bearer SHOULD-NOT-BE-HERE",
        "x-api-key": "LEAKY-HEADER",
        "x-request-id": "req-123",
        date: "Fri, 23 Oct 2026 05:00:00 GMT",
      }),
    );
    expect(raw!.saved).toBe(true);
    const m = readFileSync(paths.meta, "utf8");
    expect(Object.keys(meta().headers).sort()).toEqual(["content-type", "date"]);
    for (const bad of [
      "SECRETCOOKIE",
      "set-cookie",
      "SHOULD-NOT-BE-HERE",
      "LEAKY-HEADER",
      "x-request-id",
      "req-123",
    ])
      expect(m).not.toContain(bad);
    expect(m).not.toMatch(/authorization|bearer/i);
  });
  it("never writes the request (its Authorization header or form) anywhere", async () => {
    await run(reply("{}", 500));
    expect(readFileSync(paths.meta, "utf8")).not.toContain(FAKE_KEY);
    expect(body().toString()).not.toContain(FAKE_KEY);
  });
  it("a body that echoes the key has it replaced by ***, and the replacement is recorded with both hashes", async () => {
    const echoed = `{"error":"invalid key ${FAKE_KEY} for Bearer ${FAKE_KEY}"}`;
    const { raw } = await run(reply(echoed, 401));
    expect(body().toString()).not.toContain(FAKE_KEY);
    expect(body().toString()).toBe('{"error":"invalid key *** for Bearer ***"}');
    expect(raw).toMatchObject({ keyRedactions: 2 });
    expect(raw!.sha256Original).toBe(sha(Buffer.from(echoed)));
    expect(raw!.sha256Saved).not.toBe(raw!.sha256Original);
    expect(readFileSync(paths.meta, "utf8")).not.toContain(FAKE_KEY);
  });
  it("redactKey leaves a clean body untouched and handles a key at the very start and end", () => {
    const clean = new Uint8Array(Buffer.from("nothing here"));
    expect(redactKey(clean, FAKE_KEY)).toEqual({ bytes: clean, count: 0 });
    expect(
      Buffer.from(
        redactKey(new Uint8Array(Buffer.from(`${FAKE_KEY}x${FAKE_KEY}`)), FAKE_KEY).bytes,
      ).toString(),
    ).toBe("***x***");
  });
  it("saved files are owner-only (POSIX) and live where the caller chose", async () => {
    await run(reply("{}", 200));
    if (process.platform !== "win32") {
      expect(statSync(paths.body).mode & 0o777).toBe(0o600);
      expect(statSync(paths.meta).mode & 0o777).toBe(0o600);
    }
  });
});

describe("no reply at all", () => {
  it("a network failure writes metadata only, with a fixed outcome code and no key", async () => {
    const f = (async () => {
      throw new Error(`socket hang up Bearer ${FAKE_KEY}`);
    }) as FetchLike;
    const { err, raw } = await run(f);
    expect(err!.code).toBe("network_error");
    expect(existsSync(paths.body)).toBe(false);
    expect(raw).toMatchObject({ saved: true, status: null, bodyFile: null });
    expect(meta()).toMatchObject({ status: null, outcome: "no_reply_network_error", body: null });
    expect(readFileSync(paths.meta, "utf8")).not.toContain(FAKE_KEY);
  });
  it("a timeout writes metadata only with the timeout outcome", async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init.signal!.addEventListener("abort", () => rej(init.signal!.reason)),
      )) as FetchLike;
    const { err } = await run(f, { timeoutMs: 20 });
    expect(err!.code).toBe("timeout");
    expect(meta().outcome).toBe("no_reply_timeout");
  });
  it("refusals before the call write nothing at all (the call was never claimed)", async () => {
    const { err } = await run(reply("{}"), { env: { META_API_KEY: FAKE_KEY } });
    expect(err!.code).toBe("live_not_approved");
    expect(existsSync(paths.body)).toBe(false);
    expect(existsSync(paths.meta)).toBe(false);
  });
});

describe("evidence is protected, and a bad raw location is refused BEFORE the call is claimed", () => {
  it("existing evidence is never overwritten: the call is refused up front, so the authorization is not spent", async () => {
    writeFileSync(paths.body, "EARLIER EVIDENCE");
    const f = vi.fn(reply("{}", 200));
    const { err } = await run(f as unknown as FetchLike);
    expect(err!.code).toBe("raw_exists");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "rest-call.lock"))).toBe(false);
    expect(readFileSync(paths.body, "utf8")).toBe("EARLIER EVIDENCE");
  });
  it("an unwritable location is refused up front (fetch not called, lock not created)", async () => {
    const blocker = join(dir, "afile");
    writeFileSync(blocker, "x");
    const f = vi.fn(reply("{}", 200));
    const { err } = await run(f as unknown as FetchLike, {
      rawPaths: { body: join(blocker, "b"), meta: join(blocker, "m.json") },
    });
    expect(err!.code).toBe("raw_unwritable");
    expect(f).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "rest-call.lock"))).toBe(false);
  });
  it("if saving still fails AFTER the reply (e.g. the disk fills), the result is not hidden and nothing throws", () => {
    const blocker = join(dir, "afile2");
    writeFileSync(blocker, "x");
    const info = saveRaw({
      bodyPath: join(blocker, "b"),
      metaPath: join(blocker, "m.json"),
      key: FAKE_KEY,
      status: 200,
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      truncated: false,
      readError: false,
      elapsedMs: 1,
      outcome: "reply_received",
    });
    expect(info).toMatchObject({
      saved: false,
      error: "raw_write_failed",
      status: 200,
      bytesReceived: 3,
    });
  });
});

describe("the scorecard describes the raw files without containing them", () => {
  it("carries names, status, sizes and hashes only", async () => {
    const text = JSON.stringify({ secretField: "CANARY TRANSCRIPT WORDS" });
    const { raw } = await run(reply(text, 200));
    const card = buildScorecard({
      live: true,
      audio: null,
      http: { status: 200, elapsedMs: 1 },
      segments: null,
      parseErrorCode: "malformed_response",
      raw,
      observed: observedShape(JSON.parse(text)),
      truth: script(),
    });
    expect(card.rawResponse).toMatchObject({
      saved: true,
      bodyFile: "rest-raw-response.body",
      metaFile: "rest-raw-response.meta.json",
      status: 200,
    });
    const out = JSON.stringify(card);
    expect(out).not.toContain("CANARY");
    expect(out).not.toContain(text);
  });
});

describe("the one-request limit is untouched", () => {
  it("raw.ts never calls fetch, and run.ts still has exactly one fetchImpl call and no loops or retries", () => {
    const raw = readFileSync(new URL("../raw.ts", import.meta.url), "utf8");
    const run = readFileSync(new URL("../run.ts", import.meta.url), "utf8");
    expect(raw).not.toMatch(/\bfetch\b|fetchImpl/);
    expect(run.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
    expect(run).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|retry\(|setTimeout/);
    expect(blockedFetch).not.toHaveBeenCalled();
  });
  it("a second call is still refused after a saved reply, and does not touch the evidence", async () => {
    await run(reply("{}", 200));
    const first = body().toString();
    const { err } = await run(reply("{}", 200), { lockPath: join(dir, "rest-call.lock") });
    expect(err!.code).toBe("second_call_refused");
    expect(body().toString()).toBe(first);
  });
  it("readBounded stops reading at the limit instead of buffering everything", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1000;
        c.enqueue(new Uint8Array(1000));
      },
    });
    const r = await readBounded(new Response(stream), 2500);
    expect(r.truncated).toBe(true);
    expect(r.bytes.length).toBe(2500);
    expect(pulled).toBeLessThan(10_000);
  });
});

describe("the command line wires the raw files into the gitignored output folder", () => {
  it("uses safeOutputPath for them and git ignores both files", () => {
    const cli = readFileSync(new URL("../cli.ts", import.meta.url), "utf8");
    expect(cli).toMatch(/safeOutputPath\(undefined, RAW_BODY_NAME\)/);
    expect(cli).toMatch(/safeOutputPath\(undefined, RAW_META_NAME\)/);
    const root = new URL("../../../", import.meta.url).pathname;
    for (const f of [
      "spike-output/rest-raw-response.body",
      "spike-output/rest-raw-response.meta.json",
    ]) {
      const r = spawnSync("git", ["check-ignore", "-q", f], { cwd: root });
      expect(r.status, f).toBe(0);
    }
  });
});
