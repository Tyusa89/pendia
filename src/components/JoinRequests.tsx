import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/AppShell";
import { joinErrorMessage, type FamilyJoinRequest } from "@/lib/join-family";
import { joinService } from "@/services";

/** Organizer: people who asked to join with the family code. Approving creates a Member; Document Upload stays off. */
export function JoinRequests({ familyId }: { familyId: string }) {
  const { data: requests = [] } = useQuery({
    queryKey: ["join-requests", familyId],
    queryFn: () => joinService.requestsForFamily(familyId),
    refetchInterval: 20_000,
  });
  return (
    <Panel className="space-y-3">
      <h2 className="text-xl">Join requests{requests.length > 0 ? ` · ${requests.length}` : ""}</h2>
      {requests.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No one is waiting. Requests made with your family code appear here.
        </p>
      )}
      {requests.map((r) => (
        <RequestRow key={r.request_id} familyId={familyId} r={r} />
      ))}
    </Panel>
  );
}

function RequestRow({ familyId, r }: { familyId: string; r: FamilyJoinRequest }) {
  const qc = useQueryClient();
  const [flags, setFlags] = useState({ meds: false, schedule: false, visits: false });
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ["join-requests", familyId] });
    void qc.invalidateQueries({ queryKey: ["members", familyId] });
  };
  const approve = useMutation({
    mutationFn: () => joinService.decide(r.request_id, true, flags),
    onSuccess: () => done(`${r.requester_name} joined as a member`),
    onError: (e) => toast.error(joinErrorMessage((e as Error).message)),
  });
  const decline = useMutation({
    mutationFn: () => joinService.decide(r.request_id, false),
    onSuccess: () => done("Request declined"),
    onError: (e) => toast.error(joinErrorMessage((e as Error).message)),
  });
  const chosen = flags.meds || flags.schedule || flags.visits;
  const busy = approve.isPending || decline.isPending;
  const opts: [keyof typeof flags, string][] = [
    ["meds", "Medications"],
    ["schedule", "Schedule"],
    ["visits", "Visits"],
  ];
  return (
    <div className="space-y-3 rounded-xl border border-border p-4" data-testid="join-request">
      <div>
        <p className="font-semibold">{r.requester_name}</p>
        <p className="break-all text-sm text-muted-foreground">{r.requester_email}</p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold">Choose what they can see</legend>
        {opts.map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center justify-between gap-3 text-sm">
            {label}
            <Switch
              size="touch"
              checked={flags[k]}
              onCheckedChange={(v) => setFlags({ ...flags, [k]: v })}
              aria-label={`${r.requester_name} can see ${label}`}
            />
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Nothing is shared until you select it; choose at least one to approve. Joins as a Member;
          document upload stays off until you grant it on their card.
        </p>
      </fieldset>
      <div className="flex gap-3">
        <Button disabled={busy || !chosen} onClick={() => approve.mutate()}>
          Approve
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decline.mutate()}>
          Decline
        </Button>
      </div>
    </div>
  );
}
