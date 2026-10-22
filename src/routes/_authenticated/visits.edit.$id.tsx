import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { AppointmentEditor } from "@/components/AppointmentEditor";

export const Route = createFileRoute("/_authenticated/visits/edit/$id")({
  head: () => ({
    meta: [
      { title: "Edit appointment — Pendia" },
      { name: "description", content: "Change a doctor appointment." }, { property: "og:title", content: "Edit appointment — Pendia" }, { property: "og:description", content: "Change a doctor appointment." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditAppointment,
});

function EditAppointment() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return (
    <WithFamily>
      {({ family, me }) => (
        <>
          <PageTitle title="Edit appointment" />
          <AppointmentEditor
            familyId={family.id}
            timeZone={family.timezone}
            canWrite={me.role === "organizer"}
            appointmentId={id}
            onDone={(visitId) => navigate({ to: "/visits/$id", params: { id: visitId } })}
            onCancel={() => navigate({ to: "/visits/$id", params: { id } })}
          />
        </>
      )}
    </WithFamily>
  );
}
