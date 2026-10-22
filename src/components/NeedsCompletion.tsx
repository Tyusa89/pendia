import { AlertTriangle } from "lucide-react";
import { missingFromShift, type ShiftRow } from "@/lib/shifts";
import { formatInZone } from "@/lib/zoned-time";

export const shiftRange = (s: Pick<ShiftRow, "start" | "end">, tz: string) => {
  const day = (iso: string) =>
    formatInZone(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = (iso: string) => formatInZone(iso, tz, { hour: "numeric", minute: "2-digit" });
  const nextDay = day(s.start) !== day(s.end);
  return `${formatInZone(s.start, tz, { weekday: "short", month: "short", day: "numeric" })} · ${time(s.start)} – ${time(s.end)}${nextDay ? " (next day)" : ""}`;
};

export function NeedsCompletion({
  shift,
}: {
  shift: { end?: string | null; assigned_member_id?: string | null };
}) {
  const missing = missingFromShift(shift);
  if (!missing.length) return null;
  return (
    <span
      data-testid="needs-completion"
      className="inline-flex items-center gap-1.5 rounded-full bg-warning px-3 py-1 text-[0.8235rem] font-bold text-warning-foreground"
    >
      <AlertTriangle className="size-3.5" aria-hidden />
      Needs completion: no {missing.join(" or ")}
    </span>
  );
}
