// @vitest-environment node
// Access control and failure handling for appointment-letter extraction. No network: fetch is a recorded fake.
import { beforeEach, describe, expect, it } from "vitest";
import {
  docExtractMode,
  docExtractStatus,
  extractAppointmentLetter,
  resetDocExtractLimits,
  validatePages,
} from "@/server/doc-extract.server";
import { buildDocExtractRequest } from "@/lib/doc-upload/prompt";
import {
  CANARY_KEY,
  ENV_LIVE,
  ENV_SIM,
  FAM_A,
  FAM_B,
  JPEG_PAGE,
  PATH_A,
  PATH_B,
  PNG_PAGE,
  USER,
  goodExtraction,
  mockFetch,
  providerReply,
  source,
} from "./doc-upload-helpers";

beforeEach(resetDocExtractLimits);
const run = (
  over: Partial<Parameters<typeof extractAppointmentLetter>[0]["input"]> = {},
  o: {
    env?: typeof ENV_LIVE;
    src?: ReturnType<typeof source>;
    fetch?: ReturnType<typeof mockFetch>;
    userId?: string;
  } = {},
) => {
  const f = o.fetch ?? mockFetch(() => providerReply(goodExtraction));
  return extractAppointmentLetter({
    env: o.env ?? ENV_LIVE,
    userId: o.userId ?? USER,
    input: { familyId: FAM_A, path: PATH_A, pages: [JPEG_PAGE], ...over },
    source: o.src ?? source(),
    fetchImpl: f.fn,
  }).then((r) => ({ r, f }));
};

describe("modes", () => {
  it("is off by default and live only with the exact flag and a key", () => {
    expect(docExtractMode({})).toBe("off");
    expect(docExtractMode({ DOC_EXTRACT_ENABLED: "TRUE", META_API_KEY: "k" })).toBe("off");
    expect(docExtractMode({ DOC_EXTRACT_ENABLED: "true" })).toBe("off");
    expect(docExtractMode({ DOC_EXTRACT_ENABLED: "true", META_API_KEY: "has space" })).toBe("off");
    expect(docExtractMode(ENV_LIVE)).toBe("live");
    expect(docExtractMode(ENV_SIM)).toBe("simulated");
    expect(docExtractMode({ ...ENV_LIVE, DOC_EXTRACT_SIMULATED: "true" })).toBe("live");
  });
});

describe("access control (zero provider calls on every denial)", () => {
  const denied = async (code: string, ...args: Parameters<typeof run>) => {
    const { r, f } = await run(...args);
    expect(r).toEqual({ ok: false, code });
    expect(f.calls).toHaveLength(0);
  };
  it("disabled -> not_enabled", () => denied("not_enabled", {}, { env: {} }));
  it("live caller outside the allow-list -> not_enabled", () =>
    denied("not_enabled", {}, { userId: "99999999-9999-4999-8999-999999999999" }));
  it("empty allow-list means nobody", () =>
    denied("not_enabled", {}, { env: { ...ENV_LIVE, DOC_EXTRACT_USER_IDS: "" } }));
  it("not a member of the family -> not_member", () =>
    denied("not_member", {}, { src: source({ getMember: async () => null }) }));
  it("member but not organizer -> not_organizer", () =>
    denied("not_organizer", {}, { src: source({ role: "member" }) }));
  it("a path in ANOTHER family's folder -> bad_path", () => denied("bad_path", { path: PATH_B }));
  it("traversal or malformed path -> bad_path", async () => {
    await denied("bad_path", { path: `${FAM_A}/doc/../${FAM_B}/x.pdf` });
    await denied("bad_path", { path: "loose.pdf" });
  });
  it("a document the caller cannot read -> document_not_found", () =>
    denied("document_not_found", {}, { src: source({ readable: false }) }));
  it("a failed lookup is lookup_failed, never a denial", async () => {
    await denied(
      "lookup_failed",
      {},
      {
        src: source({
          getMember: async () => {
            throw new Error("x");
          },
        }),
      },
    );
    await denied(
      "lookup_failed",
      {},
      {
        src: source({
          canReadDocument: async () => {
            throw new Error("x");
          },
        }),
      },
    );
  });
  it("live mode never sends a real (non-demo) family's document", () =>
    denied("not_demo_family", {}, { src: source({ isDemo: false }) }));
  it("bad pages: none, too many, wrong type, forged bytes, not base64", async () => {
    await denied("bad_input", { pages: [] });
    await denied("bad_input", { pages: [JPEG_PAGE, JPEG_PAGE, JPEG_PAGE, JPEG_PAGE] });
    await denied("bad_input", { pages: [{ mime: "application/pdf", base64: JPEG_PAGE.base64 }] });
    await denied("bad_input", { pages: [{ mime: "image/png", base64: JPEG_PAGE.base64 }] });
    await denied("bad_input", { pages: [{ mime: "image/jpeg", base64: "not base64 !!" }] });
    await denied("bad_input", { pages: "x" as never });
  });
  it("oversize pages -> bad_input", async () => {
    const big = JPEG_PAGE.base64.slice(0, 8) + "A".repeat(2_100_000);
    expect(validatePages([{ mime: "image/jpeg", base64: big }])).toBeNull();
  });
  it("status never authorizes: non-organizer sees not_organizer, non-demo live family sees not_enabled", async () => {
    expect(
      await docExtractStatus({
        env: ENV_LIVE,
        userId: USER,
        familyId: FAM_A,
        source: source({ role: "member" }),
      }),
    ).toMatchObject({ mode: "off", state: "not_organizer" });
    expect(
      await docExtractStatus({
        env: ENV_LIVE,
        userId: USER,
        familyId: FAM_A,
        source: source({ isDemo: false }),
      }),
    ).toMatchObject({ mode: "off", state: "not_enabled" });
    expect(
      await docExtractStatus({ env: ENV_LIVE, userId: USER, familyId: FAM_A, source: source() }),
    ).toMatchObject({ mode: "live", state: "available" });
  });
});

describe("simulated mode is labelled and never calls Meta", () => {
  it("returns the fixed sample with source 'simulated' and no fetch, even without a key", async () => {
    const { r, f } = await run(
      {},
      { env: ENV_SIM, userId: "99999999-9999-4999-8999-999999999999" },
    );
    expect(r).toMatchObject({ ok: true, source: "simulated" });
    expect(f.calls).toHaveLength(0);
  });
  it("still enforces organizer and family path", async () => {
    expect((await run({}, { env: ENV_SIM, src: source({ role: "member" }) })).r).toEqual({
      ok: false,
      code: "not_organizer",
    });
    expect((await run({ path: PATH_B }, { env: ENV_SIM })).r).toEqual({
      ok: false,
      code: "bad_path",
    });
  });
});

describe("live request", () => {
  it("makes exactly one POST with the key only in Authorization, image parts, no tools, and returns source 'meta'", async () => {
    const { r, f } = await run();
    expect(r).toMatchObject({ ok: true, source: "meta" });
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${CANARY_KEY}`);
    expect(String(init.body)).not.toContain(CANARY_KEY);
    expect(JSON.stringify(r)).not.toContain(CANARY_KEY);
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual([
      "max_completion_tokens",
      "messages",
      "model",
      "reasoning_effort",
      "response_format",
    ]);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.response_format.json_schema.name).toBe("appointment_letter_extraction");
    const parts = body.messages[1].content;
    expect(parts[0].type).toBe("text");
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${JPEG_PAGE.base64}` },
    });
    expect(JSON.stringify(body)).not.toMatch(/"tools"|tool_choice|"stream"/);
  });
  it("request builder: PNG pages and several pages keep order and type", () => {
    const b = buildDocExtractRequest([JPEG_PAGE, PNG_PAGE], "America/Chicago");
    const parts = (
      b.messages[1] as { content: Array<{ type: string; image_url?: { url: string } }> }
    ).content;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url", "image_url"]);
    expect(parts[2]!.image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("rate limits per user (10/hour) without another call", async () => {
    const f = mockFetch(() => providerReply(goodExtraction));
    for (let i = 0; i < 10; i++) expect((await run({}, { fetch: f })).r.ok).toBe(true);
    expect((await run({}, { fetch: f })).r).toEqual({ ok: false, code: "rate_limited" });
    expect(f.calls).toHaveLength(10);
  });
});

describe("extraction failures are fixed codes with no leaked detail, and no retry", () => {
  const cases: Array<[string, () => Response | Promise<Response>, string]> = [
    ["HTTP 500", () => new Response("upstream secret detail", { status: 500 }), "provider_error"],
    ["HTTP 401", () => new Response("bad key", { status: 401 }), "provider_error"],
    [
      "redirect",
      () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }),
      "provider_error",
    ],
    ["non-JSON body", () => new Response("<html>", { status: 200 }), "provider_error"],
    [
      "network error",
      () => {
        throw new TypeError("fetch failed");
      },
      "provider_error",
    ],
    [
      "model prose instead of JSON",
      () => providerReply("I think the date is Nov 12"),
      "unreadable",
    ],
    ["wrong shape", () => providerReply({ date: "2026-11-12" }), "unreadable"],
    [
      "impossible date",
      () =>
        providerReply({
          ...goodExtraction,
          date: { value: "2026-13-45", confidence: "clear", source_text: "x" },
        }),
      "unreadable",
    ],
    [
      "not an appointment letter",
      () => providerReply({ ...goodExtraction, appointment_letter: false }),
      "not_a_letter",
    ],
  ];
  for (const [name, impl, code] of cases)
    it(`${name} -> ${code}`, async () => {
      const f = mockFetch(impl);
      const { r } = await run({}, { fetch: f });
      expect(r).toEqual({ ok: false, code });
      expect(f.calls).toHaveLength(1);
      expect(JSON.stringify(r)).not.toMatch(/secret detail|bad key|elsewhere|CANARY/);
    });
  it("a timeout is provider_error", async () => {
    const f = mockFetch(() => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    expect((await run({}, { fetch: f })).r).toEqual({ ok: false, code: "provider_error" });
  });
});
