import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authService } from "@/services";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Connect an assistant — Pendia" },
    { name: "description", content: "Review and approve an assistant's access to your Pendia account." },
    { property: "og:title", content: "Connect an assistant — Pendia" },
    { property: "og:description", content: "Review and approve an assistant's access to your Pendia account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  validateSearch: (s: Record<string, unknown>) => ({ authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "" }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection request is missing its authorization. Start the connection again from your assistant.");
    const { data, error } = await authService.session();
    if (error) throw new Error("Your account could not be checked. Please try again.");
    if (!data.session) throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id");
    if (!id) throw new Error("Missing connection request.");
    const { data, error } = await authService.authorizationDetails(id);
    if (error || !data) throw new Error("This connection request is invalid or expired. Start a new connection from your assistant.");
    if ("redirect_url" in data) throw redirect({ href: data.redirect_url });
    const email = await authService.currentEmail();
    return { details: data, email };
  },
  pendingComponent: () => <main className="p-8 text-foreground" role="status">Checking connection request…</main>,
  errorComponent: ({ error }) => <main className="mx-auto max-w-lg space-y-4 px-5 py-16"><h1 className="text-2xl">Connection unavailable</h1><p role="alert">{error instanceof Error ? error.message : "This connection request could not be loaded."}</p><Button asChild variant="outline"><a href="/">Back to Pendia</a></Button></main>,
  component: Consent,
});

function Consent() {
  const { details, email } = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(approve: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = approve ? await authService.approveAuthorization(authorization_id) : await authService.denyAuthorization(authorization_id);
      if (result.error) throw new Error(approve ? "Approval failed. Please try again." : "Cancellation failed. Please try again.");
      if (!result.data?.redirect_url) throw new Error("The connection could not return to your assistant. Please try again.");
      window.location.assign(result.data.redirect_url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The connection failed. Please try again."); setBusy(false);
    }
  }
  const client = details.client.name || "your assistant";
  const scopes = details.scope.split(" ").filter(Boolean);
  return <main className="mx-auto max-w-lg space-y-6 px-5 py-16 text-foreground">
    <h1 className="text-3xl">Connect {client} to Pendia</h1>
    <p className="text-muted-foreground">Signed in as {email ?? "your Pendia account"}</p>
    <p>This lets {client} use Pendia as you.</p>
    <p className="break-all text-sm text-muted-foreground">Return address: {details.redirect_uri}</p>
    <ul className="list-disc space-y-2 pl-5">
      {scopes.map(scope => <li key={scope}>{scope === "email" ? "Share your email address" : scope === "profile" ? "Share your basic profile" : scope === "openid" ? "Confirm your identity" : `Additional permission requested: ${scope}`}</li>)}
      <li>Read the names and roles of your own family memberships.</li>
    </ul>
    <p>Family permissions still decide what is accessible. This connection cannot change records, open documents or call Ask Pendia.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void decide(true)}>Approve connection</Button><Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Cancel connection</Button></div>
    <Button variant="ghost" disabled={busy} onClick={async () => { await authService.signOut(); window.location.reload(); }}>Use a different account</Button>
  </main>;
}