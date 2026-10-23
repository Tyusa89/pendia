// Spark HTTP body builder and response parser: pure, offline.
import { describe, expect, it } from "vitest";
import {
  SPARK_CHAT_URL,
  SPARK_MAX_OUTPUT_TOKENS,
  SPARK_REASONING_EFFORT,
  SPARK_WIRE_SCHEMA,
  SparkHttpError,
  buildChatCompletionsBody,
  parseChatCompletion,
  toWireSchema,
} from "@/lib/spark/spark-http";
import {
  SPARK_RESPONSE_JSON_SCHEMA,
  buildExtractionRequest,
  extractWithModel,
  validateJsonSchema,
} from "@/lib/visit-pipeline/spark-contract";
import {
  PATIENT_TURNS,
  answer,
  speakerMap,
  transcript,
  turnText,
  watchItem,
} from "./spark-fixtures";
import { chatBody } from "./spark-live-helpers";

const req = buildExtractionRequest({ transcript, speakerMap });
const codeOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as SparkHttpError).code ?? String(e);
  }
  return "no error";
};

describe("the request body", () => {
  const body = buildChatCompletionsBody(req);

  it("is OpenAI-style chat completions for exactly muse-spark-1.3 with a system and a user message", () => {
    expect(SPARK_CHAT_URL).toBe("https://api.meta.ai/v1/chat/completions");
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.messages).toEqual([
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ]);
  });
  it("asks for structured output through response_format with the wire schema", () => {
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "visit_extraction", schema: SPARK_WIRE_SCHEMA },
    });
  });
  it("matches Meta's documented wrapper exactly: json_schema has only name and schema, no strict", () => {
    expect(Object.keys(body.response_format).sort()).toEqual(["json_schema", "type"]);
    expect(Object.keys(body.response_format.json_schema).sort()).toEqual(["name", "schema"]);
    expect(JSON.stringify(body)).not.toContain('"strict"');
  });
  it("never uses reasoning_effort none (a reported 400), and leaves room for the answer after reasoning", () => {
    expect(body.reasoning_effort).toBe("low");
    expect(SPARK_REASONING_EFFORT).not.toBe("none");
    expect(body.max_completion_tokens).toBe(SPARK_MAX_OUTPUT_TOKENS);
    expect(SPARK_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4000);
  });
  it("has no tools, no Responses-API text.format, no streaming and no temperature", () => {
    for (const k of ["tools", "tool_choice", "text", "stream", "temperature", "functions"])
      expect(k in body).toBe(false);
  });
  it("is plain JSON and carries no patient words (the request is doctor turns only)", () => {
    const text = JSON.stringify(body);
    expect(JSON.parse(text)).toEqual(body);
    for (const n of PATIENT_TURNS) expect(text).not.toContain(turnText(n));
  });
  it("refuses any model other than the Standard id, contributor above all", () => {
    for (const model of ["muse-spark-1.3-contributor", "muse-spark-1.2", "gpt-4"])
      expect(() => buildChatCompletionsBody({ ...req, model } as never)).toThrow();
  });
});

type SchemaNode = {
  type?: unknown;
  required?: string[];
  additionalProperties?: unknown;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  [k: string]: unknown;
};

describe("the wire schema", () => {
  const ALLOWED = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
  ]);
  const walk = (s: SchemaNode, visit: (node: SchemaNode) => void) => {
    visit(s);
    for (const p of Object.values(s.properties ?? {})) walk(p, visit);
    if (s.items) walk(s.items, visit);
  };

  it("uses only the most widely supported keywords at every level", () => {
    walk(SPARK_WIRE_SCHEMA as SchemaNode, (n) => {
      for (const k of Object.keys(n)) expect(ALLOWED.has(k), k).toBe(true);
    });
  });
  it("has the same property and required tree as the full contract schema, and stays strict", () => {
    const shape = (s: SchemaNode): unknown => ({
      type: s.type,
      required: s.required && [...s.required].sort(),
      strict: s.type === "object" ? s.additionalProperties === false : undefined,
      props:
        s.properties &&
        Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, shape(v)])),
      items: s.items && shape(s.items),
    });
    expect(shape(SPARK_WIRE_SCHEMA as SchemaNode)).toEqual(
      shape(SPARK_RESPONSE_JSON_SCHEMA as unknown as SchemaNode),
    );
  });
  it("drops the length, pattern and count limits from the wire, because they are still enforced locally", () => {
    const text = JSON.stringify(SPARK_WIRE_SCHEMA);
    for (const k of ["pattern", "minLength", "maxLength", "maxItems", "minItems"])
      expect(text).not.toContain(`"${k}"`);
    // locally the full constraints are still applied to what comes back
    const tooLong = answer({ watch_items: [watchItem({ quote: "a".repeat(401) })] });
    expect(validateJsonSchema(tooLong, SPARK_WIRE_SCHEMA)).toEqual([]);
    expect(validateJsonSchema(tooLong, SPARK_RESPONSE_JSON_SCHEMA).length).toBeGreaterThan(0);
  });
  it("still rejects missing and extra keys on the wire", () => {
    expect(validateJsonSchema(answer(), SPARK_WIRE_SCHEMA)).toEqual([]);
    expect(validateJsonSchema({ ...answer(), extra: 1 }, SPARK_WIRE_SCHEMA).length).toBeGreaterThan(
      0,
    );
    expect(validateJsonSchema({}, SPARK_WIRE_SCHEMA).length).toBeGreaterThan(0);
  });
  it("conversion does not change the schema it is given", () => {
    const before = JSON.stringify(SPARK_RESPONSE_JSON_SCHEMA);
    toWireSchema(SPARK_RESPONSE_JSON_SCHEMA);
    expect(JSON.stringify(SPARK_RESPONSE_JSON_SCHEMA)).toBe(before);
  });
});

describe("the response parser", () => {
  const text = JSON.stringify(answer());

  it("reads the answer text, finish reason and token usage (including reasoning tokens)", () => {
    expect(parseChatCompletion(chatBody(text))).toEqual({
      content: text,
      finishReason: "stop",
      usage: { promptTokens: 1200, completionTokens: 900, reasoningTokens: 500 },
    });
  });
  it("ignores extra fields and tolerates missing usage", () => {
    const r = parseChatCompletion({
      ...chatBody(text, { usage: undefined }),
      extra: { a: 1 },
      system_fingerprint: "x",
    });
    expect(r.content).toBe(text);
    expect(r.usage).toEqual({ promptTokens: null, completionTokens: null, reasoningTokens: null });
  });
  it.each([
    ["not an object", "hello", "malformed_response"],
    ["null", null, "malformed_response"],
    ["an array", [], "malformed_response"],
    ["no choices", {}, "malformed_response"],
    ["empty choices", { choices: [] }, "malformed_response"],
    ["choices that is not a list", { choices: "x" }, "malformed_response"],
    ["a choice without a message", { choices: [{ finish_reason: "stop" }] }, "malformed_response"],
    ["null content", chatBody(null), "empty_answer"],
    ["empty content", chatBody(""), "empty_answer"],
    ["blank content", chatBody("   "), "empty_answer"],
    ["numeric content", chatBody(5), "empty_answer"],
    ["an answer cut at the output limit", chatBody(text, { finish_reason: "length" }), "truncated"],
    [
      "a content-filter stop",
      chatBody(text, { finish_reason: "content_filter" }),
      "bad_finish_reason",
    ],
    ["a tool-call stop", chatBody(text, { finish_reason: "tool_calls" }), "bad_finish_reason"],
    ["no finish reason", chatBody(text, { finish_reason: undefined }), "bad_finish_reason"],
    ["a refusal", chatBody(text, { message: { refusal: "I can't help with that" } }), "refused"],
    [
      "a contributor model in the reply",
      chatBody(text, { model: "muse-spark-1.3-contributor" }),
      "contributor_model",
    ],
  ])("rejects %s", (_n, value, code) => {
    expect(codeOf(() => parseChatCompletion(value))).toBe(code);
  });
  it("a null refusal field is not a refusal", () => {
    expect(parseChatCompletion(chatBody(text, { message: { refusal: null } })).content).toBe(text);
  });
  it("the text it returns goes straight into the contract: a good answer yields items, the same text with prose fails", async () => {
    const good = await extractWithModel({
      transcript,
      speakerMap,
      complete: async () => parseChatCompletion(chatBody(text)).content,
    });
    expect(good.extraction.med_changes).toHaveLength(1);
    await expect(
      extractWithModel({
        transcript,
        speakerMap,
        complete: async () => parseChatCompletion(chatBody("Sure! " + text)).content,
      }),
    ).rejects.toThrow();
  });
});
