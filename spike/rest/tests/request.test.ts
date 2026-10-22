// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { MODE, MODEL, REST_URL } from "../config.ts";
import { buildTranscribeRequest, describeRequest } from "../request.ts";
import { blockNetwork, blockedFetch, FAKE_KEY, wavBytes } from "./helpers.ts";

beforeEach(blockNetwork);

describe("request construction", () => {
  const wav = wavBytes({ seconds: 3 });
  const { url, init } = buildTranscribeRequest(FAKE_KEY, wav);

  it("is one POST to the documented endpoint, with Bearer authentication", () => {
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(url).toBe(REST_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
  });
  it("carries the Standard model, DIARIZATION mode and the audio as multipart fields", async () => {
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe(MODEL);
    expect(form.get("model")).not.toMatch(/contributor/i);
    expect(form.get("mode")).toBe(MODE);
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/wav");
    expect(file.size).toBe(wav.byteLength);
  });
  it("never puts the credential in the URL or the form, and refuses redirects", () => {
    expect(url).not.toContain(FAKE_KEY);
    const form = init.body as FormData;
    form.forEach((v) => {
      if (typeof v === "string") expect(v).not.toContain(FAKE_KEY);
    });
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
  });
  it("describes the request with the credential replaced", () => {
    const text = JSON.stringify(describeRequest(wav.byteLength));
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain("Bearer ***");
    expect(text).toMatch(/UNVERIFIED/);
  });
  it.each([
    ["empty", "", "missing_key"],
    ["blank", "   ", "missing_key"],
    ["a newline (header injection)", "abc\nX-Evil: 1", "bad_key_format"],
    ["a space", "abc def", "bad_key_format"],
  ])("refuses a key that is %s, without echoing it", (_n, key, code) => {
    let err: { code?: string; message?: string } = {};
    try {
      buildTranscribeRequest(key, wav);
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
