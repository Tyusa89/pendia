import { createFileRoute } from "@tanstack/react-router";
import { VisitDemo } from "@/components/visit-demo/VisitDemo";

// Public on purpose: a judge or reviewer opens this link cold. It is safe by construction: Demo Mode reads no family
// data, writes nothing and calls no service, and this file (like everything it imports) has no data-layer import.
export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Pendia — Doctor-visit demo (synthetic data)" },
      {
        name: "description",
        content:
          "A prerecorded, synthetic walkthrough of how Pendia turns a doctor visit into a reviewed summary. No live AI, no real messages.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Pendia — Doctor-visit demo" },
      {
        property: "og:description",
        content: "Prerecorded synthetic data. No live AI, no real messages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicDemo,
});

function PublicDemo() {
  return (
    <div className="min-h-screen bg-hero px-4 py-6 md:px-8">
      <header className="mx-auto mb-5 flex w-full max-w-5xl items-center justify-between">
        <a href="/" className="font-display text-2xl font-semibold text-primary">
          Pendia
        </a>
        <span className="text-sm font-semibold text-muted-foreground">Doctor-visit demo</span>
      </header>
      <main id="main">
        <VisitDemo />
      </main>
    </div>
  );
}
