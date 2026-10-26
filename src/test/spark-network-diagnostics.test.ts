// @vitest-environment node
// What a failed request says about WHY, with fake fetch functions only. Every case: one attempt, no retry, a fixed code, and no
// text from the error, the request, the response or the key.
import { describe, expect, it, vi } from "vitest";
import { buildExtractionRequest } from "@/lib/visit-pipeline/spark-contract";
import { SparkHttpError } from "@/lib/spark/spark-http";
import { callSparkOnce, classifyTransportError, type FetchLike } from "@/server/spark-live.server";
import { _resetSparkRateForTests, runSyntheticExtraction } from "@/server/spark-synthetic.server";
import { speakerMap, transcript } from "./spark-fixtures";
import { ENV_ON, KEY, USER } from "./spark-live-helpers";

const request = buildExtractionRequest({ transcript, speakerMap });
const call = (fetchImpl: unknown) =>
  callSparkOnce({ request, apiKey: KEY, fetchImpl: fetchImpl as FetchLike });
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SparkHttpError;
  }
  throw new Error("expected a rejection");
};
const throwing = (e: unknown) =>
  vi.fn(async (_u: string, _i: RequestInit) => {
    throw e;
  });
const withCause = (message: string, code?: string, name = "TypeError") =>
  Object.assign(new Error(message), { name, ...(code ? { cause: { code } } : {}) });

describe("redirects are reported as redirects, and never followed", () => {
  it.each([301, 302, 303, 307, 308])(
    "HTTP %s -> redirect_refused, one call, host only",
    async (status) => {
      const f = vi.fn(
        async (_u: string, _i: RequestInit) =>
          new Response(`echo of the prompt ${KEY}`, {
            status,
            headers: { location: "https://other.example.com/v2/secret-path?token=abc" },
          }),
      );
      const e = await fail(call(f));
      expect(e).toBeInstanceOf(SparkHttpError);
      expect(e.code).toBe("redirect_refused");
      expect(e.status).toBe(status);
      expect(e.message).toContain(`HTTP ${status}`);
      expect(e.message).toContain("other.example.com");
      expect(e.message).not.toMatch(/secret-path|token=abc|echo of the prompt/);
      expect(e.message).not.toContain(KEY);
      expect(f).toHaveBeenCalledTimes(1); // the redirect target is never requested
      expect(f.mock.calls[0]![1].redirect).toBe("manual");
    },
  );
  it("a redirect with no usable Location still reports the status", async () => {
    for (const location of [null, "", "http://", "https://exa mple.com/"]) {
      const f = vi.fn(
        async () =>
          new Response("", { status: 302, headers: location === null ? {} : { location } }),
      );
      const e = await fail(call(f));
      expect(e.code).toBe("redirect_refused");
      expect(e.message).toContain("HTTP 302");
    }
  });
  it("an opaque redirect (status 0) is also refused", async () => {
    const f = vi.fn(async () => ({
      status: 0,
      type: "opaqueredirect",
      headers: new Headers(),
      body: null,
    }));
    const e = await fail(call(f));
    expect(e.code).toBe("redirect_refused");
  });
  it("a runtime that throws on redirect is still recognised", async () => {
    const e = await fail(call(throwing(new TypeError("fetch failed: unexpected redirect"))));
    expect(e.code).toBe("redirect_refused");
  });
});

describe("a failure before any reply says which kind", () => {
  it.each([
    ["ENOTFOUND", "dns_failure"],
    ["EAI_AGAIN", "dns_failure"],
    ["ECONNREFUSED", "connection_failed"],
    ["ECONNRESET", "connection_failed"],
    ["ETIMEDOUT", "connection_failed"],
    ["UND_ERR_CONNECT_TIMEOUT", "connection_failed"],
    ["EHOSTUNREACH", "connection_failed"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_failure"],
    ["CERT_HAS_EXPIRED", "tls_failure"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_failure"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_failure"],
    ["EPROTO", "tls_failure"],
    ["SOMETHING_ELSE", "network_error"],
  ])("cause %s -> %s, with the cause code and no error text", async (code, expected) => {
    const f = throwing(withCause(`fetch failed ${KEY} Bearer ${KEY} the whole prompt`, code));
    const e = await fail(call(f));
    expect(e.code).toBe(expected);
    expect(e.message).toContain(`cause: ${code}`);
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toMatch(/Bearer|whole prompt/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["Network connection lost.", "connection_failed"],
    ["Connection reset by peer", "connection_failed"],
    ["getaddrinfo ENOTFOUND api.meta.ai", "dns_failure"],
    ["could not resolve host", "dns_failure"],
    ["SSL handshake failed", "tls_failure"],
    ["self signed certificate", "tls_failure"],
    ["fetch failed", "network_error"],
    ["", "network_error"],
  ])(
    "runtime error text %j -> %s (text is used to choose, never shown)",
    async (message, expected) => {
      const e = await fail(call(throwing(new TypeError(message))));
      expect(e.code).toBe(expected);
      expect(e.message).not.toContain(message || "\u0000");
    },
  );
  it("an unclassified failure names only the error class and the cause code", async () => {
    const e = await fail(call(throwing(withCause("boom", "WEIRD_CODE", "TypeError"))));
    expect(e.code).toBe("network_error");
    expect(e.message).toBe(
      "The request failed before a reply arrived (error: TypeError; cause: WEIRD_CODE).",
    );
  });
  it("a hostile error name or cause is not surfaced", async () => {
    const e = await fail(
      call(throwing(withCause("x", "has spaces and Bearer " + KEY, `Evil ${KEY}`))),
    );
    expect(e.code).toBe("network_error");
    expect(e.message).toBe("The request failed before a reply arrived.");
  });
  it.each([
    ["a string", "boom " + KEY],
    ["null", null],
    ["a number", 42],
    ["undefined", undefined],
  ])("a thrown %s is a plain network_error", async (_n, thrown) => {
    const e = await fail(call(throwing(thrown)));
    expect(e.code).toBe("network_error");
    expect(e.message).not.toContain(KEY);
  });
  it("a timeout stays a timeout", async () => {
    expect(
      classifyTransportError(Object.assign(new Error("x"), { name: "TimeoutError" })).code,
    ).toBe("timeout");
    expect(classifyTransportError(Object.assign(new Error("x"), { name: "AbortError" })).code).toBe(
      "timeout",
    );
  });
  it("a body that fails after the headers uses the same classes", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(withCause("terminated", "ECONNRESET"));
      },
    });
    const f = vi.fn(async () => new Response(stream, { status: 200 }));
    const e = await fail(call(f));
    expect(e.code).toBe("connection_failed");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("authentication and unexpected server replies", () => {
  it.each([401, 403])(
    "HTTP %s says the key was rejected, without the body or the key",
    async (status) => {
      const f = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "invalid_api_key", message: `bad ${KEY}` } }),
            {
              status,
            },
          ),
      );
      const e = await fail(call(f));
      expect(e.code).toBe(`http_${status}`);
      expect(e.message).toContain("API key was rejected or lacks access");
      expect(e.message).toContain("invalid_api_key");
      expect(e.message).not.toContain(KEY);
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it.each([404, 429, 500, 503])("HTTP %s keeps its own code and no key hint", async (status) => {
    const e = await fail(call(vi.fn(async () => new Response("{}", { status }))));
    expect(e.code).toBe(`http_${status}`);
    expect(e.message).not.toContain("API key");
  });
  it("a 200 that is not JSON is malformed_response", async () => {
    const e = await fail(
      call(vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 }))),
    );
    expect(e.code).toBe("malformed_response");
    expect(e.message).not.toContain("maintenance");
  });
});

describe("through the gated handler: the same fixed codes, one call, nothing leaked", () => {
  it.each([
    [throwing(withCause("x", "ENOTFOUND")), "dns_failure"],
    [throwing(withCause("x", "ECONNRESET")), "connection_failed"],
    [throwing(withCause("x", "CERT_HAS_EXPIRED")), "tls_failure"],
    [
      vi.fn(
        async () =>
          new Response("", { status: 308, headers: { location: "https://elsewhere.example/" } }),
      ),
      "redirect_refused",
    ],
    [vi.fn(async () => new Response("{}", { status: 401 })), "http_401"],
  ])("%#", async (f, code) => {
    _resetSparkRateForTests();
    const r = await runSyntheticExtraction({
      env: ENV_ON,
      userId: USER,
      fetchImpl: f as unknown as FetchLike,
    });
    expect(r).toMatchObject({ ok: false, code });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});
