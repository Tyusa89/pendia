import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, LoadingCard, PageTitle } from "@/components/AppShell";
import { FamilyTimeZone } from "@/components/FamilyTimeZone";
import { Invite, MemberRow, Recipient } from "@/components/FamilyMembers";
import { JoinRequests } from "@/components/JoinRequests";
import { ShareFamilyCode } from "@/components/FamilyJoinCode";
import { useFamily, useMembers } from "@/hooks/use-family";
import { useWebMCP } from "use-webmcp-tool";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";

export const Route = createFileRoute("/_authenticated/members")({
  head: () => ({
    meta: [
      { title: "Family Members — Pendia" },
      { name: "description", content: "Everyone on your family's care team, their roles and contact details." },
      { property: "og:title", content: "Family Members — Pendia" },
      { property: "og:description", content: "Everyone on your family's care team, their roles and contact details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MembersPage,
});

function MembersPage() {
  const { data, isLoading } = useFamily();
  const { data: members = [], isLoading: loadingMembers } = useMembers(data?.family.id);
  useWebMCP({
    name: "read_visible_care_team",
    description: "Read names and roles on the current family's care team screen, without contact details or permission changes.",
    enabled: !!data && !isLoading && !loadingMembers,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => runWebMCPTool("read_visible_care_team", () => {
      if (!data || isLoading || loadingMembers) throw new Error("Care team is not ready.");
      return members.length ? members.map(m => `${m.name}: ${m.role}`).join("\n") : "No care team members shown.";
    }),
  });
  if (isLoading) return <LoadingCard />;
  if (!data) return <Empty>Join or create a family first.</Empty>;
  const isOrganizer = data.me.role === "organizer";
  return (
    <>
      <Button asChild variant="ghost" className="mb-3 -ml-3 text-primary"><Link to="/family"><ArrowLeft /> Dashboard</Link></Button>
      <PageTitle title="Family Members" subtitle={`${data.family.name} · ${isOrganizer ? "You're the organizer" : "You're a member"}`} />
      <div className="space-y-5">
        <Recipient familyId={data.family.id} editable={isOrganizer} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-label="Care team" className="min-w-0">
            <h2 className="mb-3 text-xl">Care team · {members.length}</h2>
            {loadingMembers ? <LoadingCard /> : (
              <div className="flex flex-col gap-4">
                {members.map((m, i) => <MemberRow key={m.id} m={m} editable={isOrganizer} defaultOpen={i === 0} />)}
              </div>
            )}
          </section>
          <aside aria-label="Organizer tools" className="min-w-0 space-y-5">
            {isOrganizer && <Invite familyId={data.family.id} />}
            {isOrganizer && <ShareFamilyCode familyId={data.family.id} />}
            {isOrganizer && <JoinRequests familyId={data.family.id} />}
            <FamilyTimeZone familyId={data.family.id} timeZone={data.family.timezone} editable={isOrganizer} />
          </aside>
        </div>
      </div>
    </>
  );
}
