// Time zones an organizer can pick for the family. The family's zone (not the viewing device's) decides which calendar
// day and clock time a shift or appointment is on. The list is a convenience; validation accepts any real IANA zone.
import { isValidTimeZone } from "@/lib/zoned-time";

export const COMMON_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern Time (New York)" },
  { id: "America/Chicago", label: "Central Time (Chicago)" },
  { id: "America/Denver", label: "Mountain Time (Denver)" },
  { id: "America/Phoenix", label: "Mountain Time, no daylight saving (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
  { id: "America/Puerto_Rico", label: "Atlantic Time (Puerto Rico)" },
  { id: "America/Mexico_City", label: "Central Time (Mexico City)" },
  { id: "America/Bogota", label: "Colombia (Bogotá)" },
  { id: "America/Sao_Paulo", label: "Brasília Time (São Paulo)" },
  { id: "Europe/London", label: "United Kingdom (London)" },
  { id: "Europe/Madrid", label: "Central European Time (Madrid)" },
  { id: "Europe/Paris", label: "Central European Time (Paris)" },
  { id: "Asia/Manila", label: "Philippines (Manila)" },
  { id: "Asia/Kolkata", label: "India (Kolkata)" },
  { id: "Australia/Sydney", label: "Eastern Australia (Sydney)" },
];

export function timeZoneLabel(id: string): string {
  return COMMON_TIME_ZONES.find((z) => z.id === id)?.label ?? id.replace(/_/g, " ");
}

/** A region/city IANA name such as "America/Chicago" that the runtime recognizes. Abbreviations like "CST" are refused. */
export function validateFamilyTimeZone(
  value: unknown,
): { ok: true; timeZone: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim())
    return { ok: false, error: "Choose a time zone." };
  const tz = value.trim();
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz) || !isValidTimeZone(tz))
    return { ok: false, error: "That isn't a time zone Pendia recognizes." };
  return { ok: true, timeZone: tz };
}
