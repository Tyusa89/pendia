// Builds the one POST. No network here: it returns the URL and the fetch options, so tests can inspect them.
//
// CONTRACT (documented): multipart/form-data with two parts and `Authorization: Bearer <key>`:
//   `request`  JSON: {"model": "muse-voice-transcribe-1.0", "mode": "DIARIZATION", "audioEncoding": "WAV"}
//   `audio`    the WAV recording
// STILL UNCONFIRMED: the Content-Type of the `request` part. It is sent as application/json (the usual convention for a
// JSON part); if Meta wants it untyped the first live reply will say so as an HTTP 400/415, with no retry.
import { assertStandardModel } from "../diarization/protocol.ts";
import { AUDIO_ENCODING, MODE, MODEL, REST_URL, RestSpikeError } from "./config.ts";

export interface BuiltRequest {
  url: string;
  init: RequestInit;
}

/** The JSON carried in the `request` part. Exactly these three fields, nothing else. */
export const requestPart = () => ({ model: MODEL, mode: MODE, audioEncoding: AUDIO_ENCODING });

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
  form.append("request", new Blob([JSON.stringify(requestPart())], { type: "application/json" }));
  form.append(
    "audio",
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
    parts: {
      request: requestPart(),
      audio: `synthetic-visit.wav (${wavBytes} bytes, audio/wav)`,
    },
    redirect: "error",
    retries: 0,
    note: "The Content-Type of the `request` part (application/json) is not confirmed.",
  };
}
