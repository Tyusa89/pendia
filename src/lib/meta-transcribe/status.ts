// What the Handoffs page may learn about transcription, and the page states derived from it. Pure and isomorphic: no environment,
// secret name, network or storage access.
//
// `check_failed` means the server could NOT find out (for example the membership lookup errored). It is deliberately not "no": the
// client treats it as a temporary error, retries a bounded number of times, and never lets it replace an earlier confirmed answer.
export type TranscriptionStatusReason = "disabled" | "not_organizer" | "check_failed";

export type TranscriptionStatus =
  { available: true } | { available: false; reason?: TranscriptionStatusReason };

/** What the page shows. `error` = the check itself keeps failing (temporary); `disabled` and `not_organizer` are definite answers. */
export type TranscriberState = "loading" | "available" | "disabled" | "not_organizer" | "error";

export interface StatusSnapshot {
  /** The last CONFIRMED answer from the server, if any (kept across failed refetches). */
  data: TranscriptionStatus | undefined;
  isFetching: boolean;
  isError: boolean;
}

export function deriveTranscriberState(s: StatusSnapshot): TranscriberState {
  if (s.data?.available === true) return "available"; // a confirmed yes survives background re-checks and temporary errors
  if (s.isFetching) return "loading";
  if (s.data) return s.data.reason === "not_organizer" ? "not_organizer" : "disabled";
  return s.isError ? "error" : "loading";
}

/** Bounded retries with short backoff for a temporary status failure: 1 try + 2 retries, about 1.4 s in all. */
export const STATUS_RETRY_DELAYS_MS = [400, 1000] as const;
export const STATUS_CONFIRMED_STALE_MS = 5 * 60_000;
