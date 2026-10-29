import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Users } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingCard, PageTitle, Panel } from "@/components/AppShell";
import { FamilyOverview, greeting } from "@/components/FamilyOverview";
import { Recipient, initials } from "@/components/FamilyMembers";
import { familyKey, useFamily, useMembers } from "@/hooks/use-family";
import { familyService, type Member } from "@/services";

export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "My Family — Pendia" },
      { name: "description", content: "Your care team and care recipient." }, { property: "og:title", content: "My Family — Pendia" }, { property: "og:description", content: "Your care team and care recipient." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FamilyPage,
});

function FamilyPage() {
  const { data, isLoading } = useFamily();
  if (isLoading) return <LoadingCard />;
  if (!data) return <Setup />;
  return (
    <FamilyView
      familyId={data.family.id}
      familyName={data.family.name}
      timeZone={data.family.timezone}
      me={data.me}
    />
  );
}

function Setup() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const create = useMutation({
    mutationFn: () => familyService.createFamily(name, myName),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKey }),
    onError: (e) => toast.error((e as Error).message),
  });
  const demo = useMutation({
    mutationFn: () => familyService.joinDemo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKey }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageTitle title="Welcome" subtitle="Start a family, or look around the demo first." />
      <Panel className="space-y-4">
        <h2 className="text-xl font-semibold">Create your family</h2>
        <div className="space-y-2">
          <Label>Family name</Label>
          <Input
            placeholder="The Morales Family"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Your name</Label>
          <Input placeholder="Elena" value={myName} onChange={(e) => setMyName(e.target.value)} />
        </div>
        <Button
          className="w-full"
          disabled={!name || !myName || create.isPending}
          onClick={() => create.mutate()}
        >
          Create family
        </Button>
      </Panel>
      <Panel className="mt-5 bg-secondary">
        <h2 className="text-xl font-semibold">Explore the demo</h2>
        <p className="mt-1 text-secondary-foreground">
          Open a private demo of a family caring for Grandma Rosa, with sample meds and a coverage
          schedule. Nothing here is real patient data.
        </p>
        <Button
          variant="outline"
          className="mt-4 w-full"
          disabled={demo.isPending}
          onClick={() => demo.mutate()}
        >
          Open demo family
        </Button>
      </Panel>
    </>
  );
}

function FamilyView({
  familyId,
  familyName,
  timeZone,
  me,
}: {
  familyId: string;
  familyName: string;
  timeZone: string;
  me: Member;
}) {
  const { data: members = [] } = useMembers(familyId);
  return (
    <>
      <PageTitle title={`${greeting(new Date())}, ${me.name.split(" ")[0]}`} subtitle={formatFamilyDate(timeZone)} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)]">
        <div className="min-w-0 space-y-5">
          <Recipient familyId={familyId} editable={false} />
          <MembersSummary members={members} familyName={familyName} />
        </div>
        <div className="min-w-0 space-y-5">
          <FamilyOverview me={me} timeZone={timeZone} />
        </div>
      </div>
    </>
  );
}

function MembersSummary({ members, familyName }: { members: Member[]; familyName: string }) {
  const shown = members.slice(0, 3);
  return (
    <Panel aria-label="Family members summary">
      <h2 className="flex items-center gap-2 text-xl font-semibold"><Users className="size-5 text-primary" aria-hidden /> Family members</h2>
      <p className="mt-1 text-muted-foreground">{members.length} {members.length === 1 ? "member" : "members"} in {familyName}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex -space-x-2" aria-hidden>
          {shown.map((m) => <span key={m.id} title={m.name} className={`grid size-11 place-items-center rounded-full border-2 border-card font-bold ${m.role === "organizer" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{initials(m.name)}</span>)}
          {members.length > 3 && <span className="grid size-11 place-items-center rounded-full border-2 border-card bg-muted text-sm font-bold text-muted-foreground">+{members.length - 3}</span>}
        </div>
        <Link to="/members" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View All Members <ChevronRight className="size-4" aria-hidden /></Link>
      </div>
    </Panel>
  );
}

function formatFamilyDate(timeZone: string) {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone });
}

