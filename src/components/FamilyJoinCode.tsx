import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/AppShell";
import { joinErrorMessage } from "@/lib/join-family";
import { joinService } from "@/services";

/** Organizer: share, replace or switch off the family code. The code is shown once; only its hash is stored. */
export function ShareFamilyCode({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const [shown, setShown] = useState<string | null>(null);
  const { data: status } = useQuery({
    queryKey: ["join-code", familyId],
    queryFn: () => joinService.codeStatus(familyId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["join-code", familyId] });
  const rotate = useMutation({
    mutationFn: () => joinService.rotateCode(familyId),
    onSuccess: (code) => {
      setShown(code);
      void refresh();
    },
    onError: (e) => toast.error(joinErrorMessage((e as Error).message)),
  });
  const disable = useMutation({
    mutationFn: () => joinService.disableCode(familyId),
    onSuccess: () => {
      setShown(null);
      void refresh();
      toast.success("Joining with a code is off");
    },
    onError: (e) => toast.error(joinErrorMessage((e as Error).message)),
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(shown ?? "");
      toast.success("Code copied");
    } catch {
      toast.error("Could not copy. Select the code and copy it.");
    }
  }
  const on = !!status?.enabled;
  return (
    <Panel className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl">
        <KeyRound className="size-5 text-primary" /> Share family code
      </h2>
      <p className="text-sm text-muted-foreground">
        People who download Pendia can ask to join with this code. It does not let anyone in by
        itself: you approve each request below.
      </p>
      {shown && (
        <div role="status" className="rounded-xl bg-secondary p-4">
          <p className="text-sm text-secondary-foreground">
            Your new family code. For security it is shown only now. Share it privately.
          </p>
          <p
            data-testid="family-code"
            className="mt-1 select-all font-mono text-2xl font-bold tracking-wider"
          >
            {shown}
          </p>
          <Button variant="outline" className="mt-3" onClick={() => void copy()}>
            Copy code
          </Button>
        </div>
      )}
      {!shown && on && (
        <p className="text-sm font-semibold">
          Joining with a code is on. The code was shown when you made it; make a new one to share it
          again.
        </p>
      )}
      {!shown && status && !on && (
        <p className="text-sm font-semibold">Joining with a code is off.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={rotate.isPending} onClick={() => rotate.mutate()}>
          {status ? (on ? "Make a new code" : "Turn on with a new code") : "Create a code"}
        </Button>
        {on && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <Switch
              size="touch"
              checked={on}
              disabled={disable.isPending}
              onCheckedChange={(v) => {
                if (!v) disable.mutate();
              }}
              aria-label="Joining with a family code is on"
            />
            Allow joining with a code
          </label>
        )}
      </div>
      {on && (
        <p className="text-xs text-muted-foreground">
          A new code replaces the old one immediately. Requests already made stay waiting for you.
        </p>
      )}
    </Panel>
  );
}
