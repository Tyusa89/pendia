// One-time acknowledgement of the "recordings are stored privately" notice, remembered in this browser only.
const KEY = "pendia.recordingNotice.v1";

export function hasAcknowledgedRecordingNotice(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: simply ask again
  }
}

export function acknowledgeRecordingNotice(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}
