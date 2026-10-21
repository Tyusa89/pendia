import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RECORDING_SECONDS, useAudioRecorder } from "@/hooks/use-audio-recorder";
import { browserPcm, type PcmCapture, type PcmProvider } from "@/lib/pcm-capture";
import { domError, installRecorderEnv, type RecorderEnv } from "./recorder-fakes";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
});
afterEach(() => env.restore());

function fakePcm(
  opts: { prepared?: boolean; attach?: "ok" | "null"; stopResult?: "wav" | "null" } = {},
) {
  const { prepared = true, attach = "ok", stopResult = "wav" } = opts;
  const calls: string[] = [];
  const capture: PcmCapture = {
    stop: vi.fn(async () => {
      calls.push("capture.stop");
      return stopResult === "wav"
        ? { wav: new Blob(["RIFFfake"], { type: "audio/wav" }), sampleCount: 16000, durationSec: 1 }
        : null;
    }),
    abort: vi.fn(() => void calls.push("capture.abort")),
  };
  const ctx = {} as AudioContext;
  const provider: PcmProvider = {
    prepare: vi.fn(() => {
      calls.push("prepare");
      return prepared ? { ctx, moduleReady: Promise.resolve() } : null;
    }),
    attach: vi.fn(async () => {
      calls.push("attach");
      return attach === "ok" ? capture : null;
    }),
    release: vi.fn(() => void calls.push("release")),
  };
  return { provider, capture, calls };
}

const startOk = async (
  r: ReturnType<typeof renderHook<ReturnType<typeof useAudioRecorder>, unknown>>,
) => {
  await act(async () => {
    await r.result.current.start();
  });
};
const stopOk = async (
  r: ReturnType<typeof renderHook<ReturnType<typeof useAudioRecorder>, unknown>>,
) => {
  await act(async () => {
    r.result.current.stop();
  });
};

describe("useAudioRecorder + PCM/WAV capture", () => {
  it("returns the original recording AND a WAV copy", async () => {
    const { provider } = fakePcm();
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    await stopOk(r);
    expect(r.result.current.status).toBe("stopped");
    expect(r.result.current.audio?.blob.size).toBeGreaterThan(0);
    expect(r.result.current.audio?.wav?.type).toBe("audio/wav");
    expect(r.result.current.wavUnavailable).toBe(false);
  });

  it("creates the audio context synchronously inside the tap, before the permission prompt resolves (iOS Safari)", async () => {
    const { provider } = fakePcm();
    let resolveStream!: (s: unknown) => void;
    env.getUserMedia.mockReturnValueOnce(new Promise((res) => (resolveStream = res)));
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    let p!: Promise<void>;
    act(() => {
      p = r.result.current.start();
    });
    expect(provider.prepare).toHaveBeenCalledTimes(1); // already called; getUserMedia has not resolved
    expect(provider.attach).not.toHaveBeenCalled();
    await act(async () => {
      resolveStream(env.stream);
      await p;
    });
    expect(provider.attach).toHaveBeenCalledTimes(1);
  });

  it("starts the PCM tap before MediaRecorder and passes the same stream and the 10-minute cap", async () => {
    const { provider, calls } = fakePcm();
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    expect(calls.indexOf("attach")).toBeGreaterThan(calls.indexOf("prepare"));
    const [, stream, opts] = (provider.attach as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(stream).toBe(env.stream);
    expect(opts).toEqual({ maxSeconds: MAX_RECORDING_SECONDS });
  });

  it("waits for the WAV to be finalized before reporting 'stopped'", async () => {
    const { provider, capture } = fakePcm();
    let finish!: (v: unknown) => void;
    (capture.stop as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((res) => (finish = res)),
    );
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    await stopOk(r);
    expect(r.result.current.status).not.toBe("stopped");
    await act(async () =>
      finish({ wav: new Blob(["x"], { type: "audio/wav" }), sampleCount: 1, durationSec: 0 }),
    );
    expect(r.result.current.status).toBe("stopped");
    expect(r.result.current.audio?.wav).toBeTruthy();
  });

  it("if PCM capture is unavailable the original still records and plays; the WAV is reported missing", async () => {
    for (const p of [
      fakePcm({ prepared: false }),
      fakePcm({ attach: "null" }),
      fakePcm({ stopResult: "null" }),
    ]) {
      const r = renderHook(() => useAudioRecorder({ pcm: p.provider }));
      await startOk(r);
      await stopOk(r);
      expect(r.result.current.status).toBe("stopped");
      expect(r.result.current.audio?.url).toMatch(/^blob:/);
      expect(r.result.current.audio?.wav).toBeNull();
      expect(r.result.current.wavUnavailable).toBe(true);
      r.unmount();
    }
  });

  it("the default browser provider reports itself unavailable where there is no AudioWorklet (e.g. jsdom)", () => {
    expect(browserPcm.prepare()).toBeNull();
  });

  it("releases the prepared audio context when microphone permission is denied", async () => {
    const { provider, calls } = fakePcm();
    env.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    expect(r.result.current.errorCode).toBe("denied");
    expect(calls).toContain("release");
    expect(provider.attach).not.toHaveBeenCalled();
  });

  it("discarding while the permission prompt is open releases the audio context", async () => {
    const { provider, calls } = fakePcm();
    let resolveStream!: (s: unknown) => void;
    env.getUserMedia.mockReturnValueOnce(new Promise((res) => (resolveStream = res)));
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    let p!: Promise<void>;
    act(() => {
      p = r.result.current.start();
    });
    act(() => r.result.current.discard());
    await act(async () => {
      resolveStream(env.stream);
      await p;
    });
    expect(calls).toContain("release");
    expect(provider.attach).not.toHaveBeenCalled();
    expect(env.stream.track.stop).toHaveBeenCalled();
  });

  it("discarding mid-recording aborts the capture", async () => {
    const { provider, capture } = fakePcm();
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    await act(async () => r.result.current.discard());
    expect(capture.abort).toHaveBeenCalled();
    expect(capture.stop).not.toHaveBeenCalled();
    expect(r.result.current.status).toBe("idle");
  });

  it("unmounting mid-recording aborts the capture and releases the microphone", async () => {
    const { provider, capture } = fakePcm();
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    r.unmount();
    expect(capture.abort).toHaveBeenCalled();
    expect(env.stream.track.stop).toHaveBeenCalled();
  });

  it("an empty MediaRecorder result aborts the capture and fails cleanly", async () => {
    const { provider, capture } = fakePcm();
    const { FakeMediaRecorder } = await import("./recorder-fakes");
    FakeMediaRecorder.emitData = false;
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    await stopOk(r);
    expect(r.result.current.status).toBe("error");
    expect(capture.abort).toHaveBeenCalled();
  });

  it("makes no network calls", async () => {
    const { provider } = fakePcm();
    const r = renderHook(() => useAudioRecorder({ pcm: provider }));
    await startOk(r);
    await stopOk(r);
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });
});
