// Builds the one POST. No network here: it returns the URL and the fetch options, so tests can inspect them.
//
// CONTRACT (Meta's official example, checked by the founder against https://dev.meta.ai/docs/speech-to-text):
//   curl -F 'request={"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"};type=application/json' \
//        -F 'audio=@rest-synthetic.wav'      with  Authorization: Bearer <key>
// So `request` is a form field whose Content-Type is application/json and which carries NO filename, and `audio` is the WAV
// as a file part. The platform FormData cannot express that (it adds filename="blob" to any Blob), so the multipart body is
// written by hand below, byte for byte, and the tests parse the real bytes back.
import { assertStandardModel } from "../diarization/protocol.ts";
import { AUDIO_ENCODING, MODE, MODEL, REST_URL, RestSpikeError } from "./config.ts";

export interface BuiltRequest {
  url: string;
  init: RequestInit & {
    body: Uint8Array<ArrayBuffer>;
    headers: { Authorization: string; Accept: string; "Content-Type": string };
  };
}

/** The filename on the `audio` part, as `-F 'audio=@rest-synthetic.wav'` would send it. */
export const AUDIO_FILENAME = "rest-synthetic.wav";
export const AUDIO_CONTENT_TYPE = "audio/wav";

/** The fields of the `request` JSON, in the order of the official example. Exactly these three, nothing else. */
export const requestPart = () => ({ mode: MODE, model: MODEL, audioEncoding: AUDIO_ENCODING });
export const requestJson = () => JSON.stringify(requestPart());

const CRLF = "\r\n";
const enc = new TextEncoder();

function randomBoundary(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `----PendiaSpike${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** True when `needle` occurs inside `hay` (a boundary must never appear in the audio). */
function occursIn(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The multipart/form-data body: the JSON `request` field (no filename), then the `audio` file. */
export function buildMultipartBody(
  wav: Uint8Array,
  boundary: string = randomBoundary(),
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9'()+_,\-./:=?]{1,70}$/.test(boundary))
    throw new RestSpikeError("bad_boundary", "The multipart boundary is not valid.");
  if (occursIn(wav, enc.encode(`--${boundary}`)))
    throw new RestSpikeError("bad_boundary", "The multipart boundary occurs inside the audio.");
  const head1 = enc.encode(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="request"${CRLF}` +
      `Content-Type: application/json${CRLF}${CRLF}` +
      `${requestJson()}${CRLF}`,
  );
  const head2 = enc.encode(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="audio"; filename="${AUDIO_FILENAME}"${CRLF}` +
      `Content-Type: ${AUDIO_CONTENT_TYPE}${CRLF}${CRLF}`,
  );
  const tail = enc.encode(`${CRLF}--${boundary}--${CRLF}`);
  const out = new Uint8Array(head1.length + head2.length + wav.length + tail.length);
  out.set(head1, 0);
  out.set(head2, head1.length);
  out.set(wav, head1.length + head2.length);
  out.set(tail, head1.length + head2.length + wav.length);
  return out;
}

export function buildTranscribeRequest(
  apiKey: string,
  wav: Uint8Array,
  boundary?: string,
): BuiltRequest {
  const key = (apiKey ?? "").trim();
  if (!key) throw new RestSpikeError("missing_key", "META_API_KEY is required (server-side only).");
  // A key that could break out of the header is refused outright, without echoing it.
  if ([...key].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
    throw new RestSpikeError(
      "bad_key_format",
      "META_API_KEY contains whitespace or control characters.",
    );
  assertStandardModel(MODEL);

  const b = boundary ?? randomBoundary();
  return {
    url: REST_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${b}`,
      },
      body: buildMultipartBody(wav, b),
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
    headers: {
      Authorization: "Bearer ***",
      Accept: "application/json",
      "Content-Type": "multipart/form-data; boundary=<random>",
    },
    parts: {
      request: { contentType: "application/json", filename: null, json: requestPart() },
      audio: {
        contentType: AUDIO_CONTENT_TYPE,
        filename: AUDIO_FILENAME,
        bytes: wavBytes,
      },
    },
    redirect: "error",
    retries: 0,
    note: "Matches Meta's official multipart example (request: JSON with no filename; audio: the WAV).",
  };
}
