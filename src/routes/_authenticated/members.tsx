import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, LoadingCard, PageTitle } from "@/components/AppShell";
import { FamilyTimeZone } from "@/components/FamilyTimeZone";
import { Invite, MemberRow, Recipient } from "@/components/FamilyMembers";
import { useFamily, useMembers } from "@/hooks/use-family";

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
  const { data: members = [], isLoading: loadingMembers } = useMembers(data?.family.id ?? "");
  if (isLoading) return <LoadingCard />;
  if (!data) return <Empty>Join or create a family first.</Empty>;
  const isOrganizer = data.me.role === "organizer";
  return (
    <>
      <Button asChild variant="ghost" className="mb-3 -ml-3 text-primary"><Link to="/family"><ArrowLeft /> Dashboard</Link></Button>
      <PageTitle title="Family Members" subtitle={`${data.family.name} · ${isOrganizer ? "You're the organizer" : "You're a member"}`} />
      <div className="space-y-5">
        <Recipient familyId={data.family.id} editable={isOrganizer} />
        <section aria-label="Care team" className="min-w-0">
          <h2 className="mb-3 text-xl font-semibold">Care team · {members.length}</h2>
          {loadingMembers ? <LoadingCard /> : (
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {members.map((m) => <MemberRow key={m.id} m={m} editable={isOrganizer} />)}
            </div>
          )}
          {isOrganizer && <Invite familyId={data.family.id} />}
          <FamilyTimeZone familyId={data.family.id} timeZone={data.family.timezone} editable={isOrganizer} />
        </section>
      </div>
    </>
  );
}
