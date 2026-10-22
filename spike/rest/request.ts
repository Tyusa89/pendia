// Builds the one POST. No network here: it returns the URL and the fetch options, so tests can inspect them.
//
// ASSUMPTION (unverified): a multipart/form-data body with fields `file`, `model` and `mode`, and
// `Authorization: Bearer <key>`. The research report gives the endpoint, model, mode and Bearer authentication but not
// the form field names; confirm them against https://dev.meta.ai/docs/speech-to-text before the live call.
import { assertStandardModel } from "../diarization/protocol.ts";
import { MODE, MODEL, REST_URL, RestSpikeError } from "./config.ts";

export interface BuiltRequest {
  url: string;
  init: RequestInit;
}

export function buildTranscribeRequest(apiKey: string, wav: Uint8Array): BuiltRequest {
  const key = (apiKey ?? "").trim();
  if (!key) throw new RestSpikeError("missing_key", "META_API_KEY is required (server-side only).");
  // A key that could break out of the header is refused outright, without echoing it.
  if ([...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
    throw new RestSpikeError(
      "bad_key_format",
      "META_API_KEY contains whitespace or control characters.",
    );
  assertStandardModel(MODEL);

  const form = new FormData();
  form.append("model", MODEL);
  form.append("mode", MODE);
  form.append(
    "file",
    new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
    "synthetic-visit.wav",
  );
  return {
    url: REST_URL,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      redirect: "error", // a redirect could carry the credential to another host
      cache: "no-store",
      referrerPolicy: "no-referrer",
      credentials: "omit",
    },
  };
}

/** What `plan` prints: the same request with the credential replaced and the audio summarized. */
export function describeRequest(wavBytes: number) {
  return {
    method: "POST",
    url: REST_URL,
    headers: { Authorization: "Bearer ***", Accept: "application/json" },
    form: { model: MODEL, mode: MODE, file: `synthetic-visit.wav (${wavBytes} bytes, audio/wav)` },
    redirect: "error",
    retries: 0,
    note: "Field names are UNVERIFIED (see request.ts).",
  };
}
