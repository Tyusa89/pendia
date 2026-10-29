import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TryPendiaDemo } from "@/components/TryPendiaDemo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pendia — Family caregiving, coordinated" },
      { name: "description", content: "Share visits, medications, coverage and handoffs with everyone who helps care for your parent." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Pendia — Family caregiving, coordinated" },
      { property: "og:description", content: "Share visits, medications, coverage and handoffs with everyone who helps care for your parent." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen flex-col bg-hero px-6 py-10">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
        <p className="font-display text-2xl font-semibold text-primary">Pendia</p>
        <h1 className="mt-6 text-5xl font-semibold leading-tight">Everyone caring for Mom, on the same page.</h1>
        <p className="mt-5 text-xl text-muted-foreground">
          Doctor visits, medication changes, who's with her tonight, and how the day went — in one calm place, in English or Spanish.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <TryPendiaDemo />
          <Button asChild size="lg" variant="outline"><Link to="/auth">Get started</Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/family">I already have an account</Link></Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Fictional hackathon demo · Read-only</p>
      </div>
    </div>
  );
}
