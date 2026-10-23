// @vitest-environment node
// Inspects the ACTUAL bytes of the multipart request: nothing here trusts a FormData abstraction.
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIO_ENCODING, MODE, MODEL, REST_URL } from "../config.ts";
import {
  AUDIO_FILENAME,
  buildMultipartBody,
  buildTranscribeRequest,
  describeRequest,
  requestJson,
} from "../request.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, wavBytes } from "./helpers.ts";

beforeEach(blockNetwork);

const B = "----PendiaSpikeTESTBOUNDARY0123456789";
/** A WAV whose payload contains every byte value plus look-alikes of multipart syntax. */
function trickyWav(): Uint8Array {
  const w = wavBytes({ seconds: 3 });
  const tricky = new TextEncoder().encode("\r\n--\r\n----Pendia\r\n--boundary\r\n\r\n\r\n");
  for (let i = 0; i < 256; i++) w[100 + i] = i;
  w[w.length - 1] = 0xab; // the final byte must survive too
  w[44] = 0xcd; // and the first data byte
  w.set(tricky, 400);
  return w;
}
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const indexOfBytes = (hay: Uint8Array, needle: Uint8Array, from = 0) =>
  Buffer.from(hay).indexOf(needle, from);

const OFFICIAL_JSON =
  '{"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"}';

describe("request construction", () => {
  const wav = trickyWav();
  const { url, init } = buildTranscribeRequest(FAKE_KEY, wav, B);
  const body = init.body;

  it("is one POST to the documented endpoint, with Bearer authentication and a multipart Content-Type", () => {
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(url).toBe(REST_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.headers["Content-Type"]).toBe(`multipart/form-data; boundary=${B}`);
    expect(body).toBeInstanceOf(Uint8Array); // written by hand, not the platform FormData
    expect(body).not.toBeInstanceOf(FormData);
  });

  it("frames the body exactly: opening boundary, two parts, closing boundary, CRLF line ends", () => {
    const text = latin1(body);
    expect(text.startsWith(`--${B}\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${B}--\r\n`)).toBe(true);
    expect(text.split(`--${B}\r\n`)).toHaveLength(3); // "", request part, audio part
  });

  it("serializes `request` as JSON with Content-Type application/json and NO filename (the official example)", () => {
    const text = latin1(body);
    const start = text.indexOf(`--${B}\r\n`) + `--${B}\r\n`.length;
    const end = text.indexOf(`\r\n--${B}\r\n`);
    const part = text.slice(start, end);
    const [headers, payload] = part.split("\r\n\r\n") as [string, string];
    expect(headers).toBe(
      'Content-Disposition: form-data; name="request"\r\nContent-Type: application/json',
    );
    expect(headers).not.toMatch(/filename/i);
    expect(payload).toBe(OFFICIAL_JSON);
    expect(payload).toBe(requestJson());
    // all documented request fields, and nothing else
    expect(JSON.parse(payload)).toEqual({
      model: MODEL,
      mode: MODE,
      audioEncoding: AUDIO_ENCODING,
    });
    expect(Object.keys(JSON.parse(payload))).toEqual(["mode", "model", "audioEncoding"]);
    expect(MODEL).toBe("muse-voice-transcribe-1.0");
    expect(MODEL).not.toMatch(/contributor/i);
    expect(MODE).toBe("DIARIZATION");
    expect(AUDIO_ENCODING).toBe("WAV");
  });

  it("carries the WAV in the `audio` part byte for byte, as a named file with Content-Type audio/wav", () => {
    const marker = Buffer.from(
      `--${B}\r\nContent-Disposition: form-data; name="audio"; filename="${AUDIO_FILENAME}"\r\nContent-Type: audio/wav\r\n\r\n`,
      "latin1",
    );
    const at = indexOfBytes(body, marker);
    expect(at).toBeGreaterThan(0);
    const dataStart = at + marker.length;
    const closing = Buffer.from(`\r\n--${B}--\r\n`, "latin1");
    const dataEnd = body.length - closing.length;
    expect(Buffer.from(body.subarray(dataEnd)).equals(closing)).toBe(true);
    const sent = body.subarray(dataStart, dataEnd);
    expect(sent.length).toBe(wav.length);
    expect(Buffer.from(sent).equals(Buffer.from(wav))).toBe(true);
    expect(AUDIO_FILENAME).toBe("rest-synthetic.wav");
  });

  it("is parsed by the platform's own multipart parser as the official example would be", async () => {
    const res = new Response(body, { headers: { "content-type": init.headers["Content-Type"] } });
    const fd = await res.formData();
    const names: string[] = [];
    fd.forEach((_v, k) => names.push(k));
    expect(names).toEqual(["request", "audio"]);
    // a part WITHOUT a filename is a plain string field; with a filename it would be a File
    const request = fd.get("request");
    expect(typeof request).toBe("string");
    expect(request).toBe(OFFICIAL_JSON);
    const audio = fd.get("audio") as File;
    expect(audio).toBeInstanceOf(File);
    expect(audio.name).toBe("rest-synthetic.wav");
    expect(audio.type).toBe("audio/wav");
    expect(Buffer.from(await audio.arrayBuffer()).equals(Buffer.from(wav))).toBe(true);
    for (const old of ["file", "model", "mode"]) expect(fd.has(old)).toBe(false);
  });

  it("never puts the credential in the URL or the body, and refuses redirects", () => {
    expect(url).not.toContain(FAKE_KEY);
    expect(latin1(body)).not.toContain(FAKE_KEY);
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
  });

  it("uses a fresh random boundary per request by default, and never one that occurs in the audio", () => {
    const a = buildTranscribeRequest(FAKE_KEY, wav).init.headers["Content-Type"];
    const b = buildTranscribeRequest(FAKE_KEY, wav).init.headers["Content-Type"];
    expect(a).toMatch(/^multipart\/form-data; boundary=----PendiaSpike[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  it("refuses a boundary that occurs inside the audio or is malformed", () => {
    const w = wavBytes({ seconds: 2 });
    w.set(new TextEncoder().encode(`--${B}`), 300);
    expect(() => buildMultipartBody(w, B)).toThrow(/boundary/);
    for (const bad of ["", "has space", "x".repeat(71), 'quote"d', "semi;colon", "new\nline"])
      expect(() => buildMultipartBody(wavBytes({ seconds: 2 }), bad)).toThrow(/boundary/);
  });

  it("describes the request with the credential replaced and the official part layout", () => {
    const d = describeRequest(wav.byteLength);
    const text = JSON.stringify(d);
    expect(text).not.toContain(FAKE_KEY);
    expect(d.headers.Authorization).toBe("Bearer ***");
    expect(d.parts.request).toEqual({
      contentType: "application/json",
      filename: null,
      json: { mode: "DIARIZATION", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" },
    });
    expect(d.parts.audio).toMatchObject({
      contentType: "audio/wav",
      filename: "rest-synthetic.wav",
    });
    expect(d.retries).toBe(0);
  });

  it.each([
    ["empty", "", "missing_key"],
    ["blank", "   ", "missing_key"],
    ["a newline (header injection)", "abc\nX-Evil: 1", "bad_key_format"],
    ["a space", "abc def", "bad_key_format"],
  ])("refuses a key that is %s, without echoing it", (_n, key, code) => {
    let err: { code?: string; message?: string } = {};
    try {
      buildTranscribeRequest(key, wav, B);
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.code).toBe(code);
    if (key.trim()) expect(err.message).not.toContain(key);
  });

  it("makes no network call", () => {
    expect(blockedFetch).not.toHaveBeenCalled();
  });
});
