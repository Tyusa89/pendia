// AudioWorklet processor: forwards raw mono microphone samples to the main thread in ~4096-frame batches.
// Resampling to 16 kHz and WAV encoding happen on the main thread (src/lib/pcm-wav.ts, unit-tested).
// Nothing here touches the network or storage.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = [];
    this.length = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush() {
    if (this.length === 0) return;
    const out = new Float32Array(this.length);
    let offset = 0;
    for (const block of this.blocks) {
      out.set(block, offset);
      offset += block.length;
    }
    this.blocks = [];
    this.length = 0;
    this.port.postMessage({ type: "pcm", samples: out }, [out.buffer]);
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const frames = channels[0].length;
    const mono = new Float32Array(frames);
    for (const channel of channels)
      for (let i = 0; i < frames; i++) mono[i] += channel[i] / channels.length;
    this.blocks.push(mono);
    this.length += frames;
    if (this.length >= 4096) this.flush();
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
