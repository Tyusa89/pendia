// Browser capture of a transcription-ready PCM copy of the microphone stream, in parallel with MediaRecorder.
// Raw PCM is captured (not a transcode of the compressed recording), then resampled to 16 kHz mono and written as WAV.
// Nothing here uploads anything; the result is a Blob in memory.
import {
  encodeWav,
  floatToInt16,
  StreamingResampler,
  TARGET_SAMPLE_RATE,
  wavDurationSeconds,
} from "@/lib/pcm-wav";

export interface PcmCaptureResult {
  wav: Blob;
  sampleCount: number;
  durationSec: number;
}

export interface PcmCapture {
  /** Finishes capture and returns the WAV, or null if no audio was captured. */
  stop(): Promise<PcmCaptureResult | null>;
  /** Throws the capture away (discard / unmount). */
  abort(): void;
}

export interface PcmPrepared {
  ctx: AudioContext;
  moduleReady: Promise<void>;
}

export interface PcmProvider {
  /** Must be called synchronously inside the user's tap (iOS Safari only lets a gesture start an AudioContext). */
  prepare(): PcmPrepared | null;
  attach(
    prepared: PcmPrepared,
    stream: MediaStream,
    opts: { maxSeconds: number },
  ): Promise<PcmCapture | null>;
  /** Close a prepared context that was never attached (permission denied, cancelled). */
  release(prepared: PcmPrepared): void;
}

const workletUrl = () => `${import.meta.env.BASE_URL ?? "/"}pcm-worklet.js`;

export const browserPcm: PcmProvider = {
  prepare() {
    if (typeof window === "undefined") return null;
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
      typeof AudioContext | undefined;
    if (!Ctor || typeof AudioWorkletNode === "undefined") return null;
    try {
      const ctx = new Ctor(); // browser-native rate; we resample ourselves (Safari ignores a requested rate)
      if (!ctx.audioWorklet) {
        void ctx.close();
        return null;
      }
      void ctx.resume().catch(() => {});
      const moduleReady = ctx.audioWorklet.addModule(workletUrl());
      moduleReady.catch(() => {}); // surfaced in attach()
      return { ctx, moduleReady };
    } catch {
      return null;
    }
  },

  release(prepared) {
    void prepared.ctx.close().catch(() => {});
  },

  async attach(prepared, stream, { maxSeconds }) {
    const { ctx } = prepared;
    try {
      await prepared.moduleReady;
      await ctx.resume();
    } catch {
      void ctx.close().catch(() => {});
      return null;
    }

    const resampler = new StreamingResampler(ctx.sampleRate, TARGET_SAMPLE_RATE);
    const maxSamples = Math.floor(maxSeconds * TARGET_SAMPLE_RATE);
    const chunks: Int16Array[] = [];
    let sampleCount = 0;
    let flushed: (() => void) | null = null;
    let done = false;

    const ingest = (floats: Float32Array) => {
      if (sampleCount >= maxSamples || floats.length === 0) return;
      const ints = floatToInt16(floats);
      const part =
        ints.length > maxSamples - sampleCount ? ints.subarray(0, maxSamples - sampleCount) : ints;
      chunks.push(part);
      sampleCount += part.length;
    };

    let source: MediaStreamAudioSourceNode;
    let node: AudioWorkletNode;
    let mute: GainNode;
    try {
      source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, "pcm-capture");
      mute = ctx.createGain();
      mute.gain.value = 0; // keeps the graph pulling audio without playing the mic back
      node.port.onmessage = (event: MessageEvent) => {
        if (done) return;
        if (event.data?.type === "pcm")
          ingest(resampler.process(event.data.samples as Float32Array));
        else if (event.data?.type === "flushed") flushed?.();
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
    } catch {
      void ctx.close().catch(() => {});
      return null;
    }

    const teardown = () => {
      done = true;
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
        mute.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => {});
    };

    return {
      async stop() {
        if (done) return null;
        const flushedPromise = new Promise<void>((resolve) => {
          flushed = resolve;
          setTimeout(resolve, 1000); // never hang the UI on a stuck worklet
        });
        node.port.postMessage("flush");
        await flushedPromise;
        ingest(resampler.flush());
        teardown();
        if (sampleCount === 0) return null;
        return {
          wav: encodeWav(chunks),
          sampleCount,
          durationSec: wavDurationSeconds(sampleCount),
        };
      },
      abort() {
        if (!done) teardown();
        chunks.length = 0;
        sampleCount = 0;
      },
    };
  },
};
