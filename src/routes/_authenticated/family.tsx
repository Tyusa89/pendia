import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Users, UserRoundPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Empty, LoadingCard, PageTitle, Panel } from "@/components/AppShell";
import { FamilyOverview, greeting } from "@/components/FamilyOverview";
import { FamilyTimeZone } from "@/components/FamilyTimeZone";
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
  const isOrganizer = me.role === "organizer";
  const [teamOpen, setTeamOpen] = useState(false);
  const { data: members = [] } = useMembers(familyId);
  return (
    <>
      {teamOpen && <Button variant="ghost" className="mb-3 -ml-3 text-primary" onClick={() => setTeamOpen(false)}><ArrowLeft /> Family</Button>}
      <PageTitle title={teamOpen ? familyName : `${greeting(new Date())}, ${me.name.split(" ")[0]}`} subtitle={teamOpen ? (isOrganizer ? "You're the organizer" : "You're a member") : formatFamilyDate(timeZone)} />
      <div className={teamOpen ? "space-y-5" : "grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)]"}>
        <Recipient familyId={familyId} editable={isOrganizer && teamOpen} />
        {!teamOpen && <div className="min-w-0 space-y-5">
          <FamilyOverview me={me} timeZone={timeZone} />
          <Button variant="outline" className="w-full" onClick={() => setTeamOpen(true)}><Users /> Care team · {members.length}</Button>
        </div>}
        {teamOpen && <section aria-label="Care team" className="min-w-0">
          <h2 className="mb-3 text-xl font-semibold">Care team · {members.length}</h2>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {members.map((m) => (
              <MemberRow key={m.id} m={m} editable={isOrganizer} />
            ))}
          </div>
          {isOrganizer && <Invite familyId={familyId} />}
          <FamilyTimeZone familyId={familyId} timeZone={timeZone} editable={isOrganizer} />
        </section>}
      </div>
    </>
  );
}

function formatFamilyDate(timeZone: string) {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone });
}

