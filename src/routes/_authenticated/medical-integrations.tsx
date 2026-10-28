import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, CalendarPlus, Pill, ShieldCheck } from "lucide-react";
import { PageTitle, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

// STATIC INFORMATION PAGE. It makes no network request, reads no family data and stores nothing. There is no provider
// connection yet: the Connect button stays disabled until a real patient-authorized sign-in and data exchange exists.
export const Route = createFileRoute("/_authenticated/medical-integrations")({
  head: () => ({
    meta: [
      { title: "Medical Integrations — Pendia" },
      {
        name: "description",
        content:
          "Provider connections for Pendia are not available yet. Add appointments and medications yourself.",
      },
      { property: "og:title", content: "Medical Integrations — Pendia" },
      {
        property: "og:description",
        content:
          "Provider connections for Pendia are not available yet. Add appointments and medications yourself.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MedicalIntegrationsPage,
});

function MedicalIntegrationsPage() {
  return (
    <div className="reading-view">
      <Button asChild variant="link" className="mb-3 px-0">
        <Link to="/preferences">
          <ArrowLeft /> Preferences & Accessibility
        </Link>
      </Button>
      <PageTitle
        title="Medical Integrations"
        subtitle="Provider connections are not available yet"
      />

      <div
        role="note"
        className="mb-5 flex gap-3 rounded-xl bg-secondary p-4 text-secondary-foreground"
      >
        <Check className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>Nothing is connected, and no medical records are being imported into Pendia.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel aria-label="MyChart and Epic">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-xl">MyChart / Epic</h2>
            <span className="rounded-full border border-dashed border-input px-3 py-1 text-sm font-semibold text-accent-foreground">
              Coming soon — Not connected
            </span>
          </div>
          <p className="mt-3">
            Connect to a patient's MyChart account at a participating provider, for example Duly
            Health and Care.
          </p>
          <p className="mt-4 font-semibold">In the future, imports may include:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Appointments</li>
            <li>Visit summaries</li>
            <li>Medication lists</li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            What can be imported depends on what each provider supports and on the patient's
            authorization. Nothing here is available today.
          </p>
          <Button
            type="button"
            disabled
            aria-describedby="connect-unavailable"
            className="mt-4 w-full sm:w-auto"
          >
            Connect MyChart
          </Button>
          <p id="connect-unavailable" className="mt-2 text-sm text-muted-foreground">
            Not available yet. This button is turned on only when a real, patient-authorized
            connection exists.
          </p>
        </Panel>

        <Panel aria-label="Enter records yourself">
          <h2 className="text-xl">Enter records yourself</h2>
          <p className="mt-3 text-muted-foreground">
            Manual entry works today. It stays available however a future connection works.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-14 whitespace-normal px-3 py-3"
            >
              <Link to="/visits/new">
                <CalendarPlus /> Add an appointment
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-14 whitespace-normal px-3 py-3"
            >
              <Link to="/meds">
                <Pill /> Add or review medications
              </Link>
            </Button>
          </div>
        </Panel>

        <Panel aria-label="Privacy" className="lg:col-span-2">
          <h2 className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-6 text-primary" aria-hidden /> Privacy
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>No medical records are imported today.</li>
            <li>
              This page does not contact MyChart, Epic or any provider, and it sends nothing
              anywhere.
            </li>
            <li>
              A future connection would need the patient, or their legal proxy, to sign in to their
              own provider account and approve access first. Nothing would be imported without that
              approval.
            </li>
            <li>What you enter yourself stays under your family's existing access settings.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
