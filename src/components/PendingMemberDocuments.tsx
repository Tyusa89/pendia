import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";
import { Panel } from "@/components/AppShell";
import { visitService } from "@/services";

/** Organizer only: documents a family member uploaded that no appointment references yet. The organizer reads each and saves the appointment. */
export function PendingMemberDocuments({ familyId, timeZone }: { familyId: string; timeZone: string }) {
  const { data = [] } = useQuery({
    queryKey: ["pending-member-docs", familyId],
    queryFn: () => visitService.pendingMemberDocuments(familyId),
  });
  if (data.length === 0) return null;
  return (
    <Panel aria-label="Waiting for you" className="mb-5 space-y-3">
      <h2 className="text-xl">Waiting for you · {data.length}</h2>
      <p className="text-muted-foreground">Family members sent these. Open one, then add the appointment. A document is only kept for 30 days unless an appointment is saved.</p>
      <ul className="divide-y divide-border">
        {data.map((d) => (
          <li key={d.path} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <p className="font-brand font-bold">{d.uploader_name}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(d.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone })}
            </p>
            <AppointmentDocumentLink path={d.path} />
            <Link
              to="/visits/new"
              search={{ doc: d.path }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-input bg-card px-4 font-brand font-semibold text-primary hover:bg-accent"
            >
              <Plus className="size-4" aria-hidden /> Add appointment from this document
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
