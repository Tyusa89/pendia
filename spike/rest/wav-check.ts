// Validates a WAV before it is allowed anywhere near an upload: uncompressed mono 16-bit PCM at 16 or 24 kHz, between
// 1 second and 10 minutes, at most 32 MB. Pure function, no I/O.
import {
  ACCEPTED_SAMPLE_RATES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_SECONDS,
  RestSpikeError,
} from "./config.ts";

export interface WavInfo {
  sampleRate: number;
  seconds: number;
  /** size of the whole file */
  bytes: number;
}

export function validateWavForUpload(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength > MAX_AUDIO_BYTES)
    throw new RestSpikeError("audio_too_large", "The audio file is over the 32 MB limit.");
  if (bytes.byteLength < 44) throw new RestSpikeError("audio_not_wav", "Not a WAV file.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new RestSpikeError("audio_not_wav", "Not a WAV file.");

  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength)
        throw new RestSpikeError("audio_bad_header", "The WAV format chunk is truncated.");
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new RestSpikeError("audio_bad_header", "The data chunk comes before fmt.");
      if (fmt.format !== 1)
        throw new RestSpikeError("audio_not_pcm", "Only uncompressed PCM WAV is accepted.");
      if (fmt.channels !== 1)
        throw new RestSpikeError(
          "audio_not_mono",
          `Expected mono audio, got ${fmt.channels} channels.`,
        );
      if (fmt.bits !== 16)
        throw new RestSpikeError(
          "audio_not_16bit",
          `Expected 16-bit samples, got ${fmt.bits}-bit.`,
        );
      if (!(ACCEPTED_SAMPLE_RATES as readonly number[]).includes(fmt.rate))
        throw new RestSpikeError("audio_bad_rate", `Expected 16 or 24 kHz, got ${fmt.rate} Hz.`);
      if (body + size > bytes.byteLength)
        throw new RestSpikeError(
          "audio_truncated",
          "The WAV data is shorter than its header says.",
        );
      if (size === 0 || size % 2 !== 0)
        throw new RestSpikeError("audio_bad_header", "The WAV data chunk is empty or misaligned.");
      const seconds = size / (fmt.rate * 2);
      if (seconds > MAX_AUDIO_SECONDS)
        throw new RestSpikeError("audio_too_long", "The audio is longer than 10 minutes.");
      if (seconds < MIN_AUDIO_SECONDS)
        throw new RestSpikeError("audio_too_short", "The audio is shorter than 1 second.");
      return { sampleRate: fmt.rate, seconds, bytes: bytes.byteLength };
    }
    off = body + size + (size % 2);
  }
  throw new RestSpikeError("audio_bad_header", "The WAV has no data chunk.");
}
