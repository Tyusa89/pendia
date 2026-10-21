import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, PageTitle, Panel, WithFamily } from "@/components/AppShell";
import { medicationService } from "@/services";

export const Route = createFileRoute("/_authenticated/meds")({
  head: () => ({ meta: [{ title: "Medications — Pendia" }, { name: "description", content: "The shared current medication list." }] }),
  component: () => <WithFamily>{({ family }) => <Meds familyId={family.id} />}</WithFamily>,
});

const statusStyle: Record<string, string> = {
  active: "bg-success text-success-foreground",
  paused: "bg-warning text-warning-foreground",
  stopped: "bg-muted text-muted-foreground",
};

function Meds({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["meds", familyId], queryFn: () => medicationService.list(familyId) });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", dose: "", schedule: "" });
  const add = useMutation({
    mutationFn: () => medicationService.add({ ...f, family_id: familyId }),
    onSuccess: () => { setF({ name: "", dose: "", schedule: "" }); setAdding(false); qc.invalidateQueries({ queryKey: ["meds", familyId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageTitle title="Medications" subtitle="What she's taking right now." action={<Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add"}</Button>} />
      {adding && (
        <Panel className="mb-5 space-y-3">
          <Input className="h-12 text-base" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input className="h-12 text-base" placeholder="Dose" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} />
            <Input className="h-12 text-base" placeholder="When" value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} />
          </div>
          <Button className="w-full" disabled={!f.name} onClick={() => add.mutate()}>Save medication</Button>
        </Panel>
      )}
      {data.length === 0 ? <Empty>No medications listed.</Empty> : (
        <div className="space-y-3">
          {data.map((m) => (
            <Panel key={m.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xl font-semibold">{m.name} <span className="font-normal text-muted-foreground">{m.dose}</span></p>
                <p className="text-muted-foreground">{m.schedule}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${statusStyle[m.status]}`}>{m.status}</span>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
