// Test doubles for the browser recording APIs. Fictional/empty audio only: bytes are placeholders, never real speech.
import { vi } from "vitest";

export class FakeTrack {
  stop = vi.fn();
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  fire(type: string) {
    (this.listeners.get(type) ?? []).forEach((fn) => fn());
  }
}

export class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes = ["audio/webm;codecs=opus", "audio/webm"];
  /** When false, stop() produces no audio data (simulates an empty capture). */
  static emitData = true;
  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supportedTypes.includes(t);
  }
  static reset() {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = ["audio/webm;codecs=opus", "audio/webm"];
    FakeMediaRecorder.emitData = true;
  }

  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  startArgs: unknown[] = [];
  constructor(
    public stream: FakeStream,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }
  start(...args: unknown[]) {
    this.startArgs = args;
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    if (FakeMediaRecorder.emitData)
      this.ondataavailable?.({
        data: new Blob(["fake-audio-bytes"], { type: this.mimeType || "audio/webm" }),
      });
    this.onstop?.();
  }
}

export interface RecorderEnv {
  getUserMedia: ReturnType<typeof vi.fn>;
  stream: FakeStream;
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
  restore: () => void;
}

/** Installs fake mediaDevices / MediaRecorder / URL.createObjectURL and a fetch spy (so tests can prove nothing is uploaded). */
export function installRecorderEnv(): RecorderEnv {
  FakeMediaRecorder.reset();
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => stream);
  let urlCounter = 0;
  const createObjectURL = vi.fn(() => `blob:fake-${++urlCounter}`);
  const revokeObjectURL = vi.fn();
  const fetchSpy = vi.fn(async () => new Response("{}"));
  const prev = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
    MediaRecorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
    fetch: globalThis.fetch,
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  return {
    getUserMedia,
    stream,
    createObjectURL,
    revokeObjectURL,
    fetchSpy,
    restore() {
      if (prev.mediaDevices) Object.defineProperty(navigator, "mediaDevices", prev.mediaDevices);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = prev.MediaRecorder;
      URL.createObjectURL = prev.createObjectURL;
      URL.revokeObjectURL = prev.revokeObjectURL;
      globalThis.fetch = prev.fetch;
    },
  };
}

export function domError(name: string) {
  const e = new Error(name);
  e.name = name;
  return e;
}
