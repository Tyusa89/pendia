// Shared fakes for the Spark live-provider tests. Nothing here touches a network: every "Meta" is a function.
import { vi } from "vitest";

export const KEY = "sk-meta-TEST-NOT-REAL-0123456789";
export const USER = "user-1";
export const ENV_ON = { SPARK_LIVE_ENABLED: "true", SPARK_LIVE_USER_IDS: USER, META_API_KEY: KEY };

export function chatBody(
  content: unknown,
  over: {
    finish_reason?: unknown;
    model?: unknown;
    message?: Record<string, unknown>;
    usage?: unknown;
  } = {},
) {
  return {
    id: "chatcmpl-test",
    model: "model" in over ? over.model : "muse-spark-1.3",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, ...(over.message ?? {}) },
        finish_reason: "finish_reason" in over ? over.finish_reason : "stop",
      },
    ],
    usage:
      "usage" in over
        ? over.usage
        : {
            prompt_tokens: 1200,
            completion_tokens: 900,
            completion_tokens_details: { reasoning_tokens: 500 },
          },
  };
}

export const chatResponse = (
  content: unknown,
  over: Parameters<typeof chatBody>[1] = {},
  status = 200,
) =>
  new Response(JSON.stringify(chatBody(content, over)), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A fake Meta that answers once with `content` as the model's text. Counts calls. */
export const fakeMeta = (content: unknown, over: Parameters<typeof chatBody>[1] = {}) =>
  vi.fn(async (_url: string, _init: RequestInit) => chatResponse(content, over));

export const failing = (status: number, body = "{}") =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(body, { status }));

export interface SentBody {
  model: string;
  reasoning_effort: string;
  messages: unknown;
  [k: string]: unknown;
}

/** The JSON body that was sent in call n of a fake fetch. */
export const sentBody = (f: ReturnType<typeof vi.fn>, n = 0) =>
  JSON.parse((f.mock.calls[n]![1] as RequestInit).body as string) as SentBody;
