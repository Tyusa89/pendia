// What the Spark development page says when the server reports the tool as not enabled. Pure and client-safe.
// The server returns a `reason` ("off" | "no_key") only to users on SPARK_LIVE_USER_IDS; everyone else gets just
// { enabled: false }, and then this returns the generic line only, so the page reveals nothing about the allow-list or setup.
export const SPARK_NOT_ENABLED = "This tool is not enabled.";

export function sparkDisabledNotice(status: {
  enabled: boolean;
  reason?: string | null;
}): string | null {
  if (status.enabled) return null;
  if (status.reason === "off")
    return `${SPARK_NOT_ENABLED} The server's feature flag is not set to "true".`;
  if (status.reason === "no_key")
    return `${SPARK_NOT_ENABLED} The server has no Meta API key configured.`;
  return SPARK_NOT_ENABLED;
}
