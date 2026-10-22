import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/AppShell";
import { familyKey } from "@/hooks/use-family";
import { COMMON_TIME_ZONES, timeZoneLabel, validateFamilyTimeZone } from "@/lib/timezones";
import { familyService } from "@/services";

/** The family's time zone. Everyone sees it; only organizers can change it (the database enforces that too). */
export function FamilyTimeZone({
  familyId,
  timeZone,
  editable,
}: {
  familyId: string;
  timeZone: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(timeZone);
  useEffect(() => setValue(timeZone), [timeZone]);
  const save = useMutation({
    mutationFn: () => familyService.setTimezone(familyId, value),
    onSuccess: () => {
      toast.success("Time zone saved");
      // Every calendar day and clock time is derived from it, so refresh anything that shows one.
      qc.invalidateQueries();
      qc.invalidateQueries({ queryKey: familyKey });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const known = COMMON_TIME_ZONES.some((z) => z.id === timeZone);
  const check = validateFamilyTimeZone(value);
  return (
    <Panel className="mt-5 space-y-2" aria-label="Family time zone">
      <h2 className="text-xl font-semibold">Time zone</h2>
      {editable ? (
        <>
          <Label htmlFor="family-tz">Care team time zone</Label>
          <select
            id="family-tz"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-12 w-full rounded-md border border-input bg-background px-3"
          >
            {!known && <option value={timeZone}>{timeZoneLabel(timeZone)}</option>}
            {COMMON_TIME_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground">
            Shifts and appointments are shown in this zone for everyone, wherever they are. Changing
            it does not move anything already scheduled; those times will show on the new zone's
            clock.
          </p>
          <Button
            disabled={value === timeZone || !check.ok || save.isPending}
            onClick={() => save.mutate()}
          >
            Save time zone
          </Button>
        </>
      ) : (
        <p>
          Times are shown in <strong>{timeZoneLabel(timeZone)}</strong>. An organizer can change
          this.
        </p>
      )}
    </Panel>
  );
}
