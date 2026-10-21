import { useCallback, useEffect, useRef, useState } from "react";

/** Hard stop so a forgotten recording can't grow without bound in memory. */
export const MAX_RECORDING_SECONDS = 600;

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopped" | "error";
export type RecorderErrorCode = "unsupported" | "denied" | "no-device" | "in-use" | "failed";
export type RecorderNotice = "interrupted" | "limit";

export interface RecordedAudio {
  blob: Blob;
  /** Object URL for playback only; revoked on discard/unmount. Audio never leaves the device from here. */
  url: string;
  mimeType: string;
  durationSec: number;
}

export const RECORDER_ERROR_MESSAGES: Record<RecorderErrorCode, string> = {
  unsupported:
    "This browser can't record audio here. Recording needs a secure (https) connection and a recent browser. You can still type your note.",
  denied:
    "Microphone access is blocked. Allow the microphone for this site in your browser or phone settings, then tap Try again. You can still type your note.",
  "no-device":
    "No microphone was found. Check that one is connected and enabled, then tap Try again. You can still type your note.",
  "in-use":
    "The microphone is busy or couldn't start. Close other apps or tabs that may be using it, then tap Try again. You can still type your note.",
  failed:
    "Something went wrong and no audio was captured. Tap Try again, or type your note instead.",
};

export const RECORDER_NOTICE_MESSAGES: Record<RecorderNotice, string> = {
  interrupted:
    "Recording stopped because the microphone was interrupted. What was captured so far is below.",
  limit: "Recording stopped at the 10-minute limit. What was captured is below.",
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function")
    return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

function classify(err: unknown): RecorderErrorCode {
  switch ((err as { name?: string } | null)?.name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-device";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in-use";
    default:
      return "failed";
  }
}

/**
 * Records microphone audio into memory. Nothing is saved or uploaded: the result is a Blob + a local
 * object URL for playback. The microphone is released as soon as recording stops, is discarded, or the
 * component unmounts.
 */
export function useAudioRecorder() {
  const [status, setStatusState] = useState<RecorderStatus>("idle");
  const [errorCode, setErrorCode] = useState<RecorderErrorCode | null>(null);
  const [notice, setNotice] = useState<RecorderNotice | null>(null);
  const [audio, setAudio] = useState<RecordedAudio | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const statusRef = useRef<RecorderStatus>("idle");
  const mounted = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const discardRef = useRef(false);
  const noticeRef = useRef<RecorderNotice | null>(null);

  const currentStatus = (): RecorderStatus => statusRef.current;

  const setStatus = useCallback((s: RecorderStatus) => {
    statusRef.current = s;
    if (mounted.current) setStatusState(s);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const fail = useCallback(
    (code: RecorderErrorCode) => {
      clearTimer();
      releaseStream();
      recorderRef.current = null;
      if (!mounted.current) return;
      setErrorCode(code);
      setStatus("error");
    },
    [clearTimer, releaseStream, setStatus],
  );

  const start = useCallback(async () => {
    if (statusRef.current === "requesting" || statusRef.current === "recording") return;
    revokeUrl();
    discardRef.current = false;
    noticeRef.current = null;
    setAudio(null);
    setErrorCode(null);
    setNotice(null);
    setElapsedSec(0);

    if (!isRecordingSupported()) return fail("unsupported");

    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (currentStatus() === "requesting") fail(classify(e));
      return;
    }
    // Discarded or unmounted while the permission prompt was open: don't keep the mic.
    if (!mounted.current || currentStatus() !== "requesting") {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let recorder: MediaRecorder;
    const mime = pickMimeType();
    try {
      streamRef.current = stream;
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      return fail("failed");
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => fail("failed");
    recorder.onstop = () => {
      clearTimer();
      const durationSec = Math.max(0, (Date.now() - startedAtRef.current) / 1000);
      const type = recorder.mimeType || mime || "audio/webm";
      const chunks = chunksRef.current;
      chunksRef.current = [];
      releaseStream();
      recorderRef.current = null;
      if (discardRef.current || !mounted.current) {
        if (mounted.current) setStatus("idle");
        return;
      }
      if (!chunks.some((c) => c.size > 0)) return fail("failed");
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setAudio({ blob, url, mimeType: type, durationSec });
      setElapsedSec(Math.floor(durationSec));
      setNotice(noticeRef.current);
      setStatus("stopped");
    };

    // The OS or another app can take the microphone away mid-recording.
    stream.getAudioTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (statusRef.current === "recording" && recorderRef.current?.state === "recording") {
          noticeRef.current = "interrupted";
          recorderRef.current.stop();
        }
      }),
    );

    startedAtRef.current = Date.now();
    try {
      recorder.start(1000); // timeslice: partial audio survives an interruption
    } catch {
      return fail("failed");
    }
    setStatus("recording");
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startedAtRef.current) / 1000;
      if (mounted.current) setElapsedSec(Math.floor(secs));
      if (secs >= MAX_RECORDING_SECONDS && recorderRef.current?.state === "recording") {
        noticeRef.current = "limit";
        recorderRef.current.stop();
      }
    }, 250);
  }, [clearTimer, fail, releaseStream, revokeUrl, setStatus]);

  const stop = useCallback(() => {
    if (statusRef.current === "recording" && recorderRef.current?.state === "recording")
      recorderRef.current.stop();
  }, []);

  /** Throws away the recording (and cancels a pending permission request). Safe to call in any state. */
  const discard = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    clearTimer();
    releaseStream();
    revokeUrl();
    noticeRef.current = null;
    setAudio(null);
    setErrorCode(null);
    setNotice(null);
    setElapsedSec(0);
    setStatus("idle");
  }, [clearTimer, releaseStream, revokeUrl, setStatus]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      clearTimer();
      releaseStream();
      revokeUrl();
    };
  }, [clearTimer, releaseStream, revokeUrl]);

  return {
    status,
    errorCode,
    notice,
    audio,
    elapsedSec,
    start,
    stop,
    discard,
    supported: isRecordingSupported(),
  };
}
