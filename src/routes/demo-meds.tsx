import { createFileRoute } from "@tanstack/react-router";
import { MedDayDemo } from "@/components/med-demo/MedDayDemo";

// Public on purpose, like /demo: synthetic data only, no data-layer import anywhere in this file's tree.
export const Route = createFileRoute("/demo-meds")({
  head: () => ({
    meta: [
      { title: "Pendia — Medication day demo (synthetic data)" },
      {
        name: "description",
        content:
          "A synthetic walkthrough of how family members report medication doses in Pendia. No real people, no live AI, nothing saved.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <div className="min-h-screen bg-hero px-4 py-6 md:px-8">
      <header className="mx-auto mb-5 flex w-full max-w-5xl items-center justify-between">
        <a href="/" className="font-display text-2xl font-semibold text-primary">
          Pendia
        </a>
        <span className="text-sm font-semibold text-muted-foreground">Medication day demo</span>
      </header>
      <main id="main">
        <MedDayDemo />
      </main>
    </div>
  ),
});
