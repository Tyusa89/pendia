import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { NOT_MEDICAL_ADVICE } from "@/lib/visit-pipeline/labels";
import type { MedVerification } from "@/lib/visit-pipeline/med-verifier";
import { verificationLabel } from "@/lib/visit-pipeline/verification-labels";
import { SPARK_FIXTURE_ID } from "@/lib/spark/spark-live-input";
import { sparkDisabledNotice } from "@/lib/spark/spark-status-notice";
import { getSparkLiveStatus, runSparkSyntheticExtraction } from "@/lib/spark/spark-live.functions";

// DEVELOPMENT TOOL. Not linked from any navigation. Protected twice: this route sits under the signed-in layout, and BOTH
// server functions require a signed-in user and the server's own feature flag + allow-list, so knowing the URL grants nothing.
// It can only run the built-in fictional visit. Nothing it shows is saved.
export const Route = createFileRoute("/_authenticated/dev-spark")({
  head: () => ({
    meta: [
      { title: "Spark check (dev) — Pendia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DevSpark,
});

const Mark = ({ ok }: { ok: boolean }) => (
  <span className={ok ? "font-semibold text-success" : "font-semibold text-destructive"}>
    {ok ? "Yes" : "No"}
  </span>
);

function DevSpark() {
  const status = useQuery({
    queryKey: ["dev-spark-status"],
    queryFn: () => getSparkLiveStatus(),
    retry: false,
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: () => runSparkSyntheticExtraction({ data: { fixtureId: SPARK_FIXTURE_ID } }),
  });
  const result = run.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p
        role="note"
        className="rounded-xl border-2 border-dashed p-3 text-base font-semibold"
        aria-label="Development tool notice"
      >
        DEV TOOL · Fictional data only · Live Meta AI (Standard tier) when enabled · Nothing is
        saved
      </p>
      <h1 className="font-display text-3xl font-semibold">Spark extraction check</h1>

      {status.isLoading && <p>Checking…</p>}
      {status.isError && <p>This tool is not available.</p>}
      {status.data && !status.data.enabled && <p>{sparkDisabledNotice(status.data)}</p>}

      {status.data?.enabled && (
        <section className="space-y-3 rounded-xl bg-card p-4 shadow-card" aria-label="Run">
          <p>
            Sends only the <strong>doctor&apos;s turns</strong> of the built-in fictional visit to
            Meta Muse Spark 1.3 (Standard tier). The answer is checked against the transcript before
            anything is shown. It is a draft; nobody has confirmed it.
          </p>
          <Button size="lg" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "Run synthetic extraction"}
          </Button>
          {run.isError && <p role="alert">The request could not be completed.</p>}
        </section>
      )}

      {result && !result.ok && (
        <section
          className="space-y-2 rounded-xl bg-card p-4 shadow-card"
          aria-label="Result"
          role="alert"
        >
          <h2 className="text-xl font-semibold">Not completed</h2>
          <p>
            <code>{result.code}</code>: {result.message}
          </p>
          {result.diagnostics && (
            <p className="text-muted-foreground">
              The answer had {result.diagnostics.answerChars ?? "no"} characters. Top-level keys:{" "}
              {result.diagnostics.answerKeys.join(", ") || "none"}.
            </p>
          )}
        </section>
      )}

      {result?.ok && (
        <section className="space-y-4 rounded-xl bg-card p-4 shadow-card" aria-label="Result">
          <p className="font-semibold">{result.label}</p>
          <div>
            <h2 className="text-xl font-semibold">Checks against the known answer</h2>
            <ul className="mt-1 space-y-1">
              <li>
                Lisinopril to 20 mg found: <Mark ok={result.check.medChange} />
              </li>
              <li>
                Blood-test follow-up found: <Mark ok={result.check.task} />
              </li>
              <li>
                Ankle-swelling watch item found: <Mark ok={result.check.watch} />
              </li>
              <li>
                Items from a non-doctor turn: <strong>{result.check.nonDoctorItems}</strong> (must
                be 0)
              </li>
              <li>
                Items kept: {result.check.itemCount}; dropped for missing evidence:{" "}
                {result.check.rejectedCount}
              </li>
              <li>
                Medication values verified: <strong>{result.check.medVerified}</strong>; unverified
                (kept for review): <strong>{result.check.medUnverified}</strong>
              </li>
            </ul>
          </div>

          {[
            [
              "Medication changes",
              result.extraction.med_changes.map((m) => ({
                id: m.id,
                head: `${m.medication}: ${m.before} → ${m.after}${m.timing ? ` (${m.timing})` : ""}`,
                s: m.source,
                unclear: m.unclear,
                v: m.verification,
              })),
            ],
            [
              "Follow-up tasks",
              result.extraction.tasks.map((t) => ({
                id: t.id,
                head: `${t.title}${t.due_hint ? ` (${t.due_hint})` : ""}`,
                s: t.source,
                unclear: t.unclear,
              })),
            ],
            [
              "Watch items",
              result.extraction.watch_items.map((w) => ({
                id: w.id,
                head: w.text,
                s: w.source,
                unclear: false,
              })),
            ],
          ].map(([title, items]) => (
            <div key={title as string}>
              <h2 className="text-xl font-semibold">{title as string}</h2>
              {(
                items as Array<{
                  id: string;
                  head: string;
                  s: { speaker: string; start_s: number; quote: string };
                  unclear: boolean;
                  v?: MedVerification | undefined;
                }>
              ).length === 0 ? (
                <p className="text-muted-foreground">None.</p>
              ) : (
                <ul className="mt-1 space-y-3">
                  {(
                    items as Array<{
                      id: string;
                      head: string;
                      s: { speaker: string; start_s: number; quote: string };
                      unclear: boolean;
                      v?: MedVerification | undefined;
                    }>
                  ).map((i) => (
                    <li key={i.id} className="rounded-lg bg-muted p-3">
                      <p className="font-semibold">
                        {i.head}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          · Draft, not confirmed
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Heard at {i.s.start_s.toFixed(1)} s · speaker {i.s.speaker}: “{i.s.quote}”
                        {i.unclear
                          ? ` · Unclear: ${result.uncertainty[i.id] ?? "no reason given"}`
                          : ""}
                      </p>
                      <p className="text-sm">
                        <strong>{verificationLabel(i.v).short}.</strong>{" "}
                        <span className="text-muted-foreground">
                          {verificationLabel(i.v).detail}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {result.rejected.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold">Dropped for missing evidence</h2>
              <ul className="mt-1 list-disc pl-6">
                {result.rejected.map((r, n) => (
                  <li key={n}>
                    {r.kind.replace("_", " ")} #{r.index + 1}: {r.reason.replaceAll("_", " ")} (
                    {r.turnId})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            HTTP {result.meta.status ?? "?"} · {result.meta.elapsedMs ?? "?"} ms · tokens
            in/out/reasoning: {result.meta.usage?.promptTokens ?? "?"}/
            {result.meta.usage?.completionTokens ?? "?"}/{result.meta.usage?.reasoningTokens ?? "?"}
          </p>
        </section>
      )}

      <p className="text-sm font-semibold text-muted-foreground">{NOT_MEDICAL_ADVICE}</p>
    </div>
  );
}
