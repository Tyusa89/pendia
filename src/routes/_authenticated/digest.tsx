import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, PageTitle, Panel, WithFamily } from "@/components/AppShell";
import { digestService, type Member } from "@/services";

export const Route = createFileRoute("/_authenticated/digest")({
  head: () => ({
    meta: [
      { title: "Weekly digest — Pendia" },
      { name: "description", content: "The Sunday summary for your family." },
    ],
  }),
  component: () => <WithFamily>{({ me }) => <DigestView me={me} />}</WithFamily>,
});

function DigestView({ me }: { me: Member }) {
  const [lang, setLang] = useState<"en" | "es">((me.language as "en" | "es") ?? "en");
  const { data = [] } = useQuery({
    queryKey: ["digest", me.family_id],
    queryFn: () => digestService.latest(me.family_id),
  });
  const latestWeek = data[0]?.week;
  const d =
    data.find((x) => x.week === latestWeek && x.language === lang) ??
    data.find((x) => x.week === latestWeek);
  return (
    <>
      <PageTitle
        title={lang === "es" ? "Resumen semanal" : "Weekly digest"}
        subtitle={lang === "es" ? "Cada domingo" : "Every Sunday"}
      />
      <div role="group" aria-label="Language" className="mb-5 flex rounded-xl bg-muted p-1">
        {(["en", "es"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`min-h-12 flex-1 cursor-pointer rounded-lg font-bold ${lang === l ? "bg-card shadow-card" : "text-muted-foreground"}`}
          >
            {l === "en" ? "English" : "Español"}
          </button>
        ))}
      </div>
      {!d ? (
        <Empty>No digest yet.</Empty>
      ) : (
        <Panel className="bg-hero">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {new Date(d.week + "T12:00").toLocaleDateString(lang === "es" ? "es" : "en", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <ol className="mt-4 space-y-4">
            {d.text
              .split("\n")
              .slice(0, 5)
              .map((line, i) => (
                <li key={i} className="flex gap-4 text-xl leading-snug break-words">
                  <span className="font-display text-2xl font-semibold text-primary">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
          </ol>
        </Panel>
      )}
    </>
  );
}
