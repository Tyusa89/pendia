import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, PageTitle, Panel, WithFamily } from "@/components/AppShell";
import { MedicationDay } from "@/components/medication-day/MedicationDay";
import { medicationService } from "@/services";

export const Route = createFileRoute("/_authenticated/meds")({
  head: () => ({
    meta: [
      { title: "Medications — Pendia" },
      { name: "description", content: "The shared current medication list." },
      { property: "og:title", content: "Medications — Pendia" },
      { property: "og:description", content: "The shared current medication list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WithFamily>
      {({ family, me }) => <Meds familyId={family.id} timeZone={family.timezone} me={me} />}
    </WithFamily>
  ),
});

const statusStyle: Record<string, string> = {
  active: "bg-success text-success-foreground",
  paused: "bg-warning text-warning-foreground",
  stopped: "bg-muted text-muted-foreground",
};

function Meds({
  familyId,
  timeZone,
  me,
}: {
  familyId: string;
  timeZone: string;
  me: { id: string; role: string; can_see_meds: boolean };
}) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["meds", familyId],
    queryFn: () => medicationService.list(familyId),
  });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", dose: "", schedule: "" });
  const add = useMutation({
    mutationFn: () => medicationService.add({ ...f, family_id: familyId }),
    onSuccess: () => {
      setF({ name: "", dose: "", schedule: "" });
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["meds", familyId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageTitle
        title="Medications"
        subtitle="What she's taking right now."
        action={
          <Button variant="outline" onClick={() => setAdding(!adding)}>
            {adding ? "Cancel" : "Add medication"}
          </Button>
        }
      />
      {adding && (
        <Panel className="mb-5 max-w-4xl space-y-3">
          <Input
            placeholder="Name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
            <Input
              placeholder="Dose"
              value={f.dose}
              onChange={(e) => setF({ ...f, dose: e.target.value })}
            />
            <Input
              placeholder="When"
              value={f.schedule}
              onChange={(e) => setF({ ...f, schedule: e.target.value })}
            />
          </div>
          <Button className="w-full" disabled={!f.name} onClick={() => add.mutate()}>
            Save medication
          </Button>
        </Panel>
      )}
      <MedicationDay
        familyId={familyId}
        timeZone={timeZone}
        me={me}
        medications={data
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.id, name: m.name }))}
      />
      {data.length === 0 ? (
        <Empty>No medications listed.</Empty>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 min-[1800px]:grid-cols-3">
          {data.map((m) => (
            <Panel key={m.id} className="space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="break-words text-xl font-semibold">
                    {m.name} <span className="font-normal text-muted-foreground">{m.dose}</span>
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[0.8235rem] font-bold capitalize ${statusStyle[m.status]}`}
                >
                  {m.status}
                </span>
              </div>
              <div className="border-t border-border pt-3">
                <p className="font-semibold">When to take it</p>
                <p className="mt-1 text-muted-foreground">{m.schedule || "Schedule not set"}</p>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
