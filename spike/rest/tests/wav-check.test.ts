// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES } from "../config.ts";
import { validateWavForUpload } from "../wav-check.ts";
import { wavBytes } from "./helpers.ts";

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "no error";
};

describe("audio validation", () => {
  it("accepts mono 16-bit PCM at 16 kHz and 24 kHz", () => {
    expect(validateWavForUpload(wavBytes({ seconds: 5, rate: 16000 }))).toMatchObject({
      sampleRate: 16000,
      seconds: 5,
    });
    expect(validateWavForUpload(wavBytes({ seconds: 5, rate: 24000 })).sampleRate).toBe(24000);
  });
  it.each([
    ["stereo", { channels: 2 }, "audio_not_mono"],
    ["8-bit", { bits: 8 }, "audio_not_16bit"],
    ["44.1 kHz", { rate: 44100 }, "audio_bad_rate"],
    ["8 kHz", { rate: 8000 }, "audio_bad_rate"],
    ["compressed or float", { format: 3 }, "audio_not_pcm"],
    ["empty data", { dataBytes: 0 }, "audio_bad_header"],
    ["half a second", { seconds: 0.5 }, "audio_too_short"],
    ["over 10 minutes", { seconds: 601 }, "audio_too_long"],
    [
      "header promises more than the file holds",
      { dataBytes: 3200, declaredData: 64000 },
      "audio_truncated",
    ],
  ] as const)("rejects %s", (_n, o, expected) => {
    expect(code(() => validateWavForUpload(wavBytes(o)))).toBe(expected);
  });
  it("accepts exactly 10 minutes and rejects one second more", () => {
    expect(code(() => validateWavForUpload(wavBytes({ seconds: 600 })))).toBe("no error");
    expect(code(() => validateWavForUpload(wavBytes({ seconds: 601 })))).toBe("audio_too_long");
  });
  it("rejects a file over 32 MB before reading it", () => {
    expect(code(() => validateWavForUpload(new Uint8Array(MAX_AUDIO_BYTES + 1)))).toBe(
      "audio_too_large",
    );
  });
  it("rejects things that are not WAV files", () => {
    expect(code(() => validateWavForUpload(new Uint8Array(100)))).toBe("audio_not_wav");
    expect(
      code(() => validateWavForUpload(new TextEncoder().encode("RIFFxxxxWAVE".padEnd(60, "x")))),
    ).toBe("audio_bad_header");
    expect(code(() => validateWavForUpload(new Uint8Array(10)))).toBe("audio_not_wav");
  });
});
