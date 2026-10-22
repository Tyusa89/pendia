import { createFileRoute, Link } from "@tanstack/react-router";
import { Stethoscope } from "lucide-react";
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
          <Link to="/visits/demo" className="mt-6 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline">
            <Stethoscope className="size-5" /> Try the doctor-visit demo (synthetic data)
          </Link>
        </>
      )}
    </WithFamily>
  ),
});
