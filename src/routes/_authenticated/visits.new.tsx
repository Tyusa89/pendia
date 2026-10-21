import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { AppointmentEditor } from "@/components/AppointmentEditor";

export const Route = createFileRoute("/_authenticated/visits/new")({
  head: () => ({ meta: [{ title: "New appointment — Pendia" }, { name: "description", content: "Add a doctor appointment." }] }),
  component: NewAppointment,
});

function NewAppointment() {
  const navigate = useNavigate();
  return (
    <WithFamily>
      {({ family, me }) => (
        <>
          <PageTitle title="New appointment" subtitle="Add what you know. You can fill in the rest later." />
          <AppointmentEditor
            familyId={family.id}
            timeZone={family.timezone}
            canWrite={me.role === "organizer"}
            onDone={(id) => navigate({ to: "/visits/$id", params: { id } })}
            onCancel={() => navigate({ to: "/visits" })}
          />
        </>
      )}
    </WithFamily>
  );
}
