import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { VisitDemo } from "@/components/visit-demo/VisitDemo";

// The same Demo Mode component as the public /demo page, shown inside the signed-in shell.
export const Route = createFileRoute("/_authenticated/visits/demo")({
  head: () => ({
    meta: [
      { title: "Doctor-visit demo — Pendia" },
      {
        name: "description",
        content:
          "A prerecorded, synthetic walkthrough of a doctor visit. No live AI, no real messages.",
      },
      { property: "og:title", content: "Doctor-visit demo — Pendia" },
      {
        property: "og:description",
        content: "Prerecorded synthetic data. No live AI, no real messages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div>
      <Link
        to="/visits"
        className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-2 font-semibold text-primary"
      >
        <ArrowLeft className="size-5" /> All visits
      </Link>
      <VisitDemo />
    </div>
  ),
});
