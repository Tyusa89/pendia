// Mechanical brake: the spike code can only talk to a loopback address (the local simulator) unless the operator
// explicitly sets SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL AND the host is exactly api.meta.ai. No Meta call is ever made by
// default, by tests, or by CI.
import { ALLOWED_LIVE_HOST } from "./protocol.ts";

export const APPROVAL_TOKEN = "I_HAVE_APPROVAL";

export const isLoopback = (host: string) =>
  host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";

export function assertConnectAllowed(
  url: string,
  opts: { liveApproval?: string | undefined; paceMultiplier?: number | undefined },
) {
  const u = new URL(url);
  if (u.protocol !== "ws:" && u.protocol !== "wss:")
    throw new Error("Only ws:// or wss:// URLs are allowed.");
  if (isLoopback(u.hostname)) return { live: false as const };
  if (u.hostname !== ALLOWED_LIVE_HOST)
    throw new Error(
      `Refusing to connect to ${u.hostname}: only loopback or ${ALLOWED_LIVE_HOST} are allowed.`,
    );
  if (opts.liveApproval !== APPROVAL_TOKEN)
    throw new Error(
      "Live Meta connection refused: set SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL only after the owner approves the run.",
    );
  if ((opts.paceMultiplier ?? 1) !== 1)
    throw new Error("Live runs must stream at real-time speed (pace multiplier 1).");
  return { live: true as const };
}
