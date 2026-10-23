// @vitest-environment node
// The server-only Meta client, driven entirely by fake fetch functions. Nothing here can reach a network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildExtractionRequest } from "@/lib/visit-pipeline/spark-contract";
import { SPARK_CHAT_URL, SparkHttpError, buildChatCompletionsBody } from "@/lib/spark/spark-http";
import {
  SPARK_MAX_RESPONSE_BYTES,
  assertSparkUrl,
  callSparkOnce,
  causeCode,
  makeSparkComplete,
  providerErrorToken,
  type FetchLike,
} from "@/server/spark-live.server";
import { answer, speakerMap, transcript } from "./spark-fixtures";
import { KEY, chatResponse, failing, fakeMeta, sentBody } from "./spark-live-helpers";

const request = buildExtractionRequest({ transcript, speakerMap });
const text = JSON.stringify(answer());
const call = (fetchImpl: unknown, over: Record<string, unknown> = {}) =>
  callSparkOnce({ request, apiKey: KEY, fetchImpl: fetchImpl as FetchLike, ...over });
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SparkHttpError;
  }
  throw new Error("expected a rejection");
};

describe("the one request", () => {
  it("is a single POST to the exact URL with the key only in the Authorization header", async () => {
    const f = fakeMeta(text);
    const r = await call(f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(h["Content-Type"]).toBe("application/json");
    expect(String(init.body)).not.toContain(KEY);
    expect(url).not.toContain(KEY);
    expect(sentBody(f)).toEqual(buildChatCompletionsBody(request));
    expect(r.status).toBe(200);
    expect(r.parsed.content).toBe(text);
  });
  it("refuses redirects and sets a timeout signal", async () => {
    const f = fakeMeta(text);
    await call(f);
    const init = f.mock.calls[0]![1];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("measures elapsed time with the injected clock", async () => {
    let t = 1000;
    const r = await call(fakeMeta(text), { now: () => (t += 250) });
    expect(r.elapsedMs).toBe(250);
  });
  it.each([
    "http://api.meta.ai/v1/chat/completions",
    "https://api.meta.ai.evil.com/v1/chat/completions",
    "https://evil.com/v1/chat/completions",
    "https://api.meta.ai/v1/other",
    "https://api.meta.ai/v1/chat/completions?x=1",
    "https://api.meta.ai/v1/chat/completions#f",
    "https://api.meta.ai:8443/v1/chat/completions",
    "https://u:p@api.meta.ai/v1/chat/completions",
    "not a url",
  ])("refuses the URL %s", (u) => {
    expect(() => assertSparkUrl(u)).toThrow(SparkHttpError);
  });
  it("accepts only the one documented URL", () => {
    expect(() => assertSparkUrl(SPARK_CHAT_URL)).not.toThrow();
  });
});

describe("a missing or malformed key stops it before any request", () => {
  it.each([
    ["empty", "", "missing_key"],
    ["blank", "   ", "missing_key"],
    ["with a newline", "abc\nX-Evil: 1", "bad_key_format"],
    ["with a space", "abc def", "bad_key_format"],
  ])("%s", async (_n, apiKey, code) => {
    const f = fakeMeta(text);
    const e = await fail(call(f, { apiKey }));
    expect(e.code).toBe(code);
    expect(f).not.toHaveBeenCalled();
    if (apiKey.trim()) expect(e.message).not.toContain(apiKey);
  });
});

describe("failures are fixed codes, never raw responses", () => {
  it.each([400, 401, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504])(
    "HTTP %s: one attempt, no retry, nothing from the body in the message",
    async (status) => {
      const f = failing(
        status,
        JSON.stringify({ error: { message: `echo of the prompt and ${KEY}` } }),
      );
      const e = await fail(call(f));
      expect(f).toHaveBeenCalledTimes(1);
      expect(e.code).toBe(`http_${status}`);
      expect(e.status).toBe(status);
      expect(e.message).not.toContain("echo of the prompt");
      expect(e.message).not.toContain(KEY);
    },
  );
  it("surfaces only an allowlisted provider error token, never its message", async () => {
    const f = failing(
      400,
      JSON.stringify({
        error: { code: "invalid_request_error", message: "leaky: the user said X" },
      }),
    );
    const e = await fail(call(f));
    expect(e.message).toContain("invalid_request_error");
    expect(e.message).not.toContain("leaky");
    expect(providerErrorToken('{"error":{"code":"has spaces and punctuation!"}}')).toBeNull();
    expect(providerErrorToken("not json")).toBeNull();
    expect(providerErrorToken('{"error":{"type":"rate_limit_exceeded"}}')).toBe(
      "rate_limit_exceeded",
    );
  });
  it("a transport failure reports the safe cause code (so TLS vs reset is diagnosable) and nothing else", async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new TypeError(`fetch failed for Bearer ${KEY}`), {
        cause: { code: "ECONNRESET", message: "secret detail" },
      });
    });
    const e = await fail(call(f));
    expect(e.code).toBe("network_error");
    expect(e.message).toContain("(cause: ECONNRESET)");
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain("secret detail");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a cause that is not a short upper-case code is not surfaced", () => {
    expect(causeCode({ cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } })).toBe(
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    );
    for (const c of ["lower case", "has spaces", "x".repeat(80), 5, null, undefined])
      expect(causeCode({ cause: { code: c } })).toBeNull();
    expect(causeCode(null)).toBeNull();
  });
  it("an abort or timeout is a timeout, once", async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, rej) =>
          init.signal!.addEventListener("abort", () => rej(init.signal!.reason)),
        ),
    );
    const e = await fail(call(f, { timeoutMs: 20 }));
    expect(e.code).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a body that is not JSON is malformed_response", async () => {
    expect((await fail(call(vi.fn(async () => new Response("<html>"))))).code).toBe(
      "malformed_response",
    );
  });
  it("a body over the size cap is refused and the stream is cancelled, not buffered", async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 256 * 1024;
        c.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const e = await fail(call(vi.fn(async () => new Response(stream, { status: 200 }))));
    expect(e.code).toBe("response_too_large");
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(SPARK_MAX_RESPONSE_BYTES * 3);
  });
  it("model-level failures keep their own fixed codes", async () => {
    expect((await fail(call(fakeMeta(text, { finish_reason: "length" })))).code).toBe("truncated");
    expect((await fail(call(fakeMeta(text, { message: { refusal: "no" } })))).code).toBe("refused");
    expect((await fail(call(fakeMeta(null)))).code).toBe("empty_answer");
  });
});

describe("the model function used by the contract", () => {
  it("returns the answer text and reports the call", async () => {
    const seen: number[] = [];
    const complete = makeSparkComplete({
      apiKey: KEY,
      fetchImpl: fakeMeta(text) as never,
      onResult: (r) => seen.push(r.status),
    });
    expect(await complete(request)).toBe(text);
    expect(seen).toEqual([200]);
  });
  it("allows ONE call: a second is refused even after a failure, and the failure is reported first", async () => {
    const f = failing(503);
    const errors: string[] = [];
    const complete = makeSparkComplete({
      apiKey: KEY,
      fetchImpl: f as never,
      onError: (e) => errors.push(e.code),
    });
    await expect(complete(request)).rejects.toThrow(SparkHttpError);
    await expect(complete(request)).rejects.toMatchObject({ code: "second_call_refused" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(["http_503"]);
  });
});

describe("no retries, no secrets in the source", () => {
  const src = readFileSync(join(__dirname, "../server/spark-live.server.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  it("has one request call site and no retry or timer", () => {
    expect(src.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/retry|setTimeout|setInterval|while\s*\(/);
  });
  it("reads no environment, logs nothing and touches no database or storage", () => {
    expect(src).not.toMatch(
      /process\.env|import\.meta\.env|console\.|supabase|localStorage|sessionStorage|cookies/i,
    );
  });
  it("a chat response helper sanity check: the fake returns what it is given", async () => {
    expect(await chatResponse("hello").json()).toMatchObject({
      choices: [{ message: { content: "hello" } }],
    });
  });
});
