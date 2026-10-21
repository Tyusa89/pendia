// Pure helpers for the transcription-ready copy of a recording: a streaming resampler (mic rate -> 16 kHz) and a
// mono 16-bit PCM WAV encoder. No browser APIs here, so everything is unit-testable.

export const TARGET_SAMPLE_RATE = 16000;

/**
 * Streaming windowed-sinc resampler (mono). Anti-aliases when downsampling, so a tone above the new Nyquist is
 * attenuated instead of folding back into the speech band. Chunk boundaries do not affect the output.
 */
export class StreamingResampler {
  private readonly ratio: number; // input samples per output sample
  private readonly cutoff: number; // low-pass cutoff relative to the input Nyquist (<= 1)
  private readonly halfWidth: number; // kernel half-width in input samples
  private history = new Float32Array(0);
  private historyStart = 0; // absolute input index of history[0]
  private nextOut = 0; // next output index to produce
  private totalIn = 0;

  constructor(
    readonly inRate: number,
    readonly outRate: number = TARGET_SAMPLE_RATE,
    private readonly zeroCrossings = 16,
  ) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("sample rates must be positive");
    this.ratio = inRate / outRate;
    this.cutoff = Math.min(1, outRate / inRate);
    this.halfWidth = zeroCrossings / this.cutoff;
  }

  private kernel(u: number): number {
    const x = Math.PI * this.cutoff * u;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    const window = 0.5 * (1 + Math.cos((Math.PI * u) / this.halfWidth));
    return this.cutoff * sinc * window;
  }

  private produce(limitT: number): Float32Array {
    const out: number[] = [];
    for (;;) {
      const t = this.nextOut * this.ratio;
      if (t >= limitT) break;
      const lastNeeded = Math.floor(t + this.halfWidth);
      if (lastNeeded >= this.historyStart + this.history.length) break; // wait for more input
      let acc = 0;
      for (let i = Math.max(0, Math.ceil(t - this.halfWidth)); i <= lastNeeded; i++) {
        const idx = i - this.historyStart;
        if (idx >= 0) acc += (this.history[idx] ?? 0) * this.kernel(t - i);
      }
      out.push(acc);
      this.nextOut++;
    }
    const keepFrom = Math.max(
      this.historyStart,
      Math.floor(this.nextOut * this.ratio - this.halfWidth),
    );
    if (keepFrom > this.historyStart) {
      this.history = this.history.slice(keepFrom - this.historyStart);
      this.historyStart = keepFrom;
    }
    return Float32Array.from(out);
  }

  process(input: Float32Array): Float32Array {
    const merged = new Float32Array(this.history.length + input.length);
    merged.set(this.history);
    merged.set(input, this.history.length);
    this.history = merged;
    this.totalIn += input.length;
    return this.produce(Infinity);
  }

  /** Emit the tail (the last input samples need look-ahead) without inventing audio past the end of the input. */
  flush(): Float32Array {
    const pad = new Float32Array(Math.ceil(this.halfWidth) + 2);
    const merged = new Float32Array(this.history.length + pad.length);
    merged.set(this.history);
    merged.set(pad, this.history.length);
    this.history = merged;
    return this.produce(this.totalIn);
  }
}

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

export const WAV_HEADER_BYTES = 44;

/** Mono 16-bit PCM WAV. */
export function encodeWav(chunks: Int16Array[], sampleRate: number = TARGET_SAMPLE_RATE): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const dataBytes = samples * 2;
  const header = new ArrayBuffer(WAV_HEADER_BYTES);
  const v = new DataView(header);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Blob([header, ...chunks.map((c) => c as BlobPart)], { type: "audio/wav" });
}

/** Parse the header of a WAV produced by encodeWav (used by tests and as a sanity check before upload). */
export function readWavHeader(
  bytes: Uint8Array,
): { channels: number; sampleRate: number; bits: number; dataBytes: number } | null {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    tag(12) !== "fmt " ||
    tag(36) !== "data" ||
    v.getUint16(20, true) !== 1
  )
    return null;
  return {
    channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true),
    bits: v.getUint16(34, true),
    dataBytes: v.getUint32(40, true),
  };
}

export function wavDurationSeconds(
  sampleCount: number,
  sampleRate: number = TARGET_SAMPLE_RATE,
): number {
  return sampleCount / sampleRate;
}
