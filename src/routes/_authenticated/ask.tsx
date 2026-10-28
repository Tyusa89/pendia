import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, MessageCircle, CalendarDays, ClipboardCheck, Stethoscope } from "lucide-react";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CareAgentPanel } from "@/components/CareAgentPanel";
import { useFamily } from "@/hooks/use-family";
import { usePreferences } from "@/components/PreferencesProvider";
import { UI_COPY } from "@/lib/care-agent/copy";
import { useCareAgentStatus } from "@/lib/care-agent/useCareAgent";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({
    meta: [
      { title: "Ask Pendia — Family care assistant" },
      {
        name: "description",
        content: "Ask Pendia assistant availability and your family's care records.",
      },
      { property: "og:title", content: "Ask Pendia — Family care assistant" },
      {
        property: "og:description",
        content: "Ask Pendia assistant availability and your family's care records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AskPage,
});

function AskPage() {
  const { data } = useFamily();
  const { preferences: p } = usePreferences();
  const language = p.language ?? (data?.me.language === "es" ? "es" : "en");
  const c = UI_COPY[language];
  const { loading, status, failed, retry } = useCareAgentStatus(data?.family.id);
  const available = !failed && status?.state === "available" && !!data;
  return (
    <div className="reading-view">
      <Button asChild variant="link" className="mb-3 px-0">
        <Link to="/family">
          <ArrowLeft /> Family
        </Link>
      </Button>
      <PageTitle title="Ask Pendia" />
      {available && data ? (
        <CareAgentPanel familyId={data.family.id} language={language} />
      ) : (
        <>
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-accent-foreground">
            <span className="rounded-full bg-muted px-3 py-1">Optional</span>
            <span className="rounded-full border border-dashed border-input px-3 py-1">
              Not connected
            </span>
          </div>
          <div className="rounded-2xl bg-muted p-5 leading-relaxed">
            <MessageCircle className="mb-3 size-7 text-primary" aria-hidden />
            <p>
              Ask Pendia isn’t available yet. No questions or family records are being sent to an AI
              service.
            </p>
            <p className="mt-3 text-muted-foreground">
              For medical questions, contact your care team. For an emergency, call your local
              emergency number.
            </p>
          </div>
          {data && loading && (
            <p className="mb-5 text-sm text-muted-foreground" role="status">
              {c.checking}
            </p>
          )}
          {data && failed && !loading && (
            <div className="mb-5" role="alert">
              <p>{c.statusError}</p>
              <Button variant="outline" className="mt-2" onClick={retry}>
                {c.tryAgain}
              </Button>
            </div>
          )}
          <div className="my-6 grid gap-3 sm:grid-cols-3">
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-14 whitespace-normal px-3 py-3"
            >
              <Link to="/handoffs">
                <ClipboardCheck /> Handoffs
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-14 whitespace-normal px-3 py-3"
            >
              <Link to="/visits">
                <Stethoscope /> Visits
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-14 whitespace-normal px-3 py-3"
            >
              <Link to="/coverage">
                <CalendarDays /> Coverage
              </Link>
            </Button>
          </div>
          <label htmlFor="ask-question" className="mb-2 block font-semibold">
            Your question
          </label>
          <Input id="ask-question" disabled placeholder="Assistant not connected" />
        </>
      )}
    </div>
  );
}
