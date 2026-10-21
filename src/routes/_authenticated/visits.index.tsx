import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Empty, PageTitle, WithFamily } from "@/components/AppShell";
import { visitService } from "@/services";

export const Route = createFileRoute("/_authenticated/visits/")({
  head: () => ({ meta: [{ title: "Visits — Pendia" }, { name: "description", content: "Doctor visits for your loved one." }] }),
  component: () => <WithFamily>{({ family }) => <Visits familyId={family.id} />}</WithFamily>,
});

function Visits({ familyId }: { familyId: string }) {
  const { data = [] } = useQuery({ queryKey: ["visits", familyId], queryFn: () => visitService.list(familyId) });
  return (
    <>
      <PageTitle title="Visits" subtitle="Doctor appointments and what was said." />
      {data.length === 0 ? <Empty>No visits yet.</Empty> : (
        <ul className="space-y-3">
          {data.map((v) => (
            <li key={v.id}>
              <Link to="/visits/$id" params={{ id: v.id }} className="flex items-center justify-between rounded-2xl border bg-card p-5 shadow-card">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                    {new Date(v.date + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" })}
                  </p>
                  <p className="mt-1 text-xl font-semibold">{v.doctor}</p>
                  {v.summary && <p className="mt-1 line-clamp-2 text-muted-foreground">{v.summary}</p>}
                </div>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
