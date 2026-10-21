import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RECORDING_SECONDS, useAudioRecorder } from "@/hooks/use-audio-recorder";
import {
  domError,
  FakeMediaRecorder,
  installRecorderEnv,
  type RecorderEnv,
} from "./recorder-fakes";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
});
afterEach(() => {
  env.restore();
  vi.useRealTimers();
});

const startOk = async (
  r: ReturnType<typeof renderHook<ReturnType<typeof useAudioRecorder>, unknown>>,
) => {
  await act(async () => {
    await r.result.current.start();
  });
};

describe("useAudioRecorder", () => {
  it("starts idle with no audio", () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.status).toBe("idle");
    expect(result.current.audio).toBeNull();
  });

  it("records, stops, and exposes a local playback URL; releases the microphone", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    expect(r.result.current.status).toBe("recording");
    expect(env.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.instances[0]!.mimeType).toBe("audio/webm;codecs=opus");
    act(() => r.result.current.stop());
    expect(r.result.current.status).toBe("stopped");
    expect(r.result.current.audio?.url).toMatch(/^blob:/);
    expect(r.result.current.audio?.blob.size).toBeGreaterThan(0);
    expect(env.stream.track.stop).toHaveBeenCalled();
  });

  it("never touches the network", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => r.result.current.stop());
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to another container when webm isn't supported (e.g. Safari)", async () => {
    FakeMediaRecorder.supportedTypes = ["audio/mp4"];
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    expect(FakeMediaRecorder.instances[0]!.mimeType).toBe("audio/mp4");
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no-device"],
    ["NotReadableError", "in-use"],
    ["SomethingElse", "failed"],
  ])("maps %s to %s", async (name, code) => {
    env.getUserMedia.mockRejectedValueOnce(domError(name));
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    expect(r.result.current.status).toBe("error");
    expect(r.result.current.errorCode).toBe(code);
    expect(r.result.current.audio).toBeNull();
  });

  it("reports 'unsupported' without throwing when the browser has no mediaDevices", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const r = renderHook(() => useAudioRecorder());
    expect(r.result.current.supported).toBe(false);
    await startOk(r);
    expect(r.result.current.errorCode).toBe("unsupported");
  });

  it("reports 'unsupported' when MediaRecorder is missing", async () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    expect(r.result.current.errorCode).toBe("unsupported");
  });

  it("ignores a second start while recording", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    await startOk(r);
    expect(env.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("treats an empty capture as a failure instead of offering silent playback", async () => {
    FakeMediaRecorder.emitData = false;
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => r.result.current.stop());
    expect(r.result.current.status).toBe("error");
    expect(r.result.current.errorCode).toBe("failed");
    expect(env.createObjectURL).not.toHaveBeenCalled();
  });

  it("discard throws the recording away and revokes the URL", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => r.result.current.stop());
    const url = r.result.current.audio!.url;
    act(() => r.result.current.discard());
    expect(r.result.current.status).toBe("idle");
    expect(r.result.current.audio).toBeNull();
    expect(env.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it("recording again discards the previous take", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => r.result.current.stop());
    const first = r.result.current.audio!.url;
    await startOk(r);
    expect(env.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(r.result.current.audio).toBeNull();
  });

  it("discarding while the permission prompt is open releases the mic once it resolves", async () => {
    let resolve!: (s: unknown) => void;
    env.getUserMedia.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    const r = renderHook(() => useAudioRecorder());
    let p!: Promise<void>;
    act(() => {
      p = r.result.current.start();
    });
    expect(r.result.current.status).toBe("requesting");
    act(() => r.result.current.discard());
    await act(async () => {
      resolve(env.stream);
      await p;
    });
    expect(env.stream.track.stop).toHaveBeenCalled();
    expect(r.result.current.status).toBe("idle");
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("releases the microphone and revokes URLs on unmount mid-recording", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    r.unmount();
    expect(env.stream.track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0]!.state).toBe("inactive");
  });

  it("keeps what was captured if the microphone is taken away mid-recording", async () => {
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => env.stream.track.fire("ended"));
    expect(r.result.current.status).toBe("stopped");
    expect(r.result.current.notice).toBe("interrupted");
    expect(r.result.current.audio?.url).toBeTruthy();
  });

  it("stops automatically at the maximum length", async () => {
    vi.useFakeTimers();
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => {
      vi.advanceTimersByTime((MAX_RECORDING_SECONDS + 1) * 1000);
    });
    expect(r.result.current.status).toBe("stopped");
    expect(r.result.current.notice).toBe("limit");
  });

  it("counts elapsed seconds while recording", async () => {
    vi.useFakeTimers();
    const r = renderHook(() => useAudioRecorder());
    await startOk(r);
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(r.result.current.elapsedSec).toBe(3);
  });
});
