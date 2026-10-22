import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { AppointmentList } from "@/components/AppointmentList";

export const Route = createFileRoute("/_authenticated/visits/")({
  head: () => ({
    meta: [
      { title: "Visits — Pendia" },
      { name: "description", content: "Doctor appointments and visits for your loved one." }, { property: "og:title", content: "Visits — Pendia" }, { property: "og:description", content: "Doctor appointments and visits for your loved one." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WithFamily>
      {({ family, me }) => (
        <>
          <PageTitle
            title="Visits"
            subtitle="Upcoming appointments, and what was said at past visits."
          />
          <AppointmentList
            familyId={family.id}
            timeZone={family.timezone}
            canWrite={me.role === "organizer"}
          />
        </>
      )}
    </WithFamily>
  ),
});
