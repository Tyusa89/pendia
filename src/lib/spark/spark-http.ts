// The HTTP-facing side of the Spark contract: the request BODY and the response PARSER. Pure functions: no fetch, no env, no
// key. Used only by server code. Not imported by Demo Mode, the routes' UI or index.ts.
//
// WHAT IS KNOWN AND WHAT IS NOT. Meta's own API pages (ai.developer.meta.com) could not be opened from the build sandbox, so
// the following comes from search summaries of those pages and from third-party integrations (LiteLLM, promptfoo, OpenClaw):
//   reported:   base URL https://api.meta.ai/v1, OpenAI-compatible Chat Completions (POST /chat/completions), Bearer key;
//               structured output through `response_format` on Chat Completions (the Responses API's `text.format` sent here
//               is a 400); the model always reasons and `reasoning_effort: "none"` is a 400; reasoning tokens are billed as
//               output and count toward the output cap.
//   UNVERIFIED: the exact `response_format.json_schema` wrapper (name / strict / schema), which JSON-Schema keywords strict mode
//               accepts, the max-tokens parameter name, the refusal field, the error-body shape, any timeout limits.
// Every UNVERIFIED item is a one-line change here. The first live call exists to settle them; nothing is presented as fact.
import {
  SPARK_MODEL_ID,
  SPARK_RESPONSE_JSON_SCHEMA,
  assertSparkModel,
  type SparkRequest,
} from "@/lib/visit-pipeline/spark-contract";

/** UNVERIFIED path (reported by third-party gateways): https://api.meta.ai/v1/chat/completions */
export const SPARK_CHAT_URL = "https://api.meta.ai/v1/chat/completions";
export const SPARK_ALLOWED_HOST = "api.meta.ai";
export const SPARK_ALLOWED_PATH = "/v1/chat/completions";

/** Valid per third-party docs: minimal | low | medium | high | xhigh. NEVER "none" (a reported 400). */
export const SPARK_REASONING_EFFORT = "low";
/** UNVERIFIED parameter name. Reasoning tokens count toward it, so it must leave room for the JSON answer. */
export const SPARK_MAX_OUTPUT_TOKENS = 6000;

export class SparkHttpError extends Error {
  /** A short fixed code. Only this code (never a message that could echo input) leaves the server. */
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "SparkHttpError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The wire schema: the same shape as the full contract schema but with ONLY the most widely supported keywords. Everything
// else (lengths, patterns, item caps) is still enforced locally by validateJsonSchema + zod, so an unsupported keyword on
// Meta's side can never weaken safety, only the model's guidance.
// ---------------------------------------------------------------------------------------------------------------------
const WIRE_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
]);

export function toWireSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toWireSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "properties") {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([name, s]) => [name, toWireSchema(s)]),
      );
    } else if (k === "items") {
      out[k] = toWireSchema(v);
    } else if (WIRE_KEYWORDS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

export const SPARK_WIRE_SCHEMA = toWireSchema(SPARK_RESPONSE_JSON_SCHEMA);

export interface ChatCompletionsBody {
  model: typeof SPARK_MODEL_ID;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: {
    type: "json_schema";
    json_schema: { name: string; strict: true; schema: unknown };
  };
  reasoning_effort: typeof SPARK_REASONING_EFFORT;
  max_completion_tokens: number;
}

/** The JSON body of the one request. No tools, no `text.format`, no temperature, never `reasoning_effort: "none"`. */
export function buildChatCompletionsBody(req: SparkRequest): ChatCompletionsBody {
  assertSparkModel(req.model);
  return {
    model: SPARK_MODEL_ID,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "visit_extraction", strict: true, schema: SPARK_WIRE_SCHEMA },
    },
    reasoning_effort: SPARK_REASONING_EFFORT,
    max_completion_tokens: SPARK_MAX_OUTPUT_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The response parser (strict). Extra fields are ignored; every field relied on is required.
// ---------------------------------------------------------------------------------------------------------------------
export interface ParsedChatCompletion {
  /** The model's text: it must be exactly the JSON object, which extractWithModel then validates. */
  content: string;
  finishReason: "stop";
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    reasoningTokens: number | null;
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export function parseChatCompletion(json: unknown): ParsedChatCompletion {
  if (!isObject(json))
    throw new SparkHttpError("malformed_response", "The reply is not a JSON object.");
  const model = json["model"];
  if (typeof model === "string" && /contributor/i.test(model))
    throw new SparkHttpError(
      "contributor_model",
      "The reply came from a contributor model; it is discarded.",
    );
  const choices = json["choices"];
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!isObject(first)) throw new SparkHttpError("malformed_response", "The reply has no choices.");
  const message = first["message"];
  if (!isObject(message))
    throw new SparkHttpError("malformed_response", "The reply has no message.");
  if (message["refusal"] !== undefined && message["refusal"] !== null)
    throw new SparkHttpError("refused", "The model declined to answer.");
  const finish = first["finish_reason"];
  if (finish === "length")
    throw new SparkHttpError(
      "truncated",
      "The answer was cut off at the output limit (reasoning tokens count toward it).",
    );
  if (finish !== "stop")
    throw new SparkHttpError("bad_finish_reason", "The model did not finish normally.");
  const content = message["content"];
  if (typeof content !== "string" || content.trim() === "")
    throw new SparkHttpError("empty_answer", "The reply has no answer text.");
  const usage = isObject(json["usage"]) ? json["usage"] : {};
  const details = isObject(usage["completion_tokens_details"])
    ? usage["completion_tokens_details"]
    : {};
  return {
    content,
    finishReason: "stop",
    usage: {
      promptTokens: num(usage["prompt_tokens"]),
      completionTokens: num(usage["completion_tokens"]),
      reasoningTokens: num(details["reasoning_tokens"]),
    },
  };
}
