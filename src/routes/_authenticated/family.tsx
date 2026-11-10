import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingCard, PageTitle, Panel } from "@/components/AppShell";
import { FamilyOverview, greeting } from "@/components/FamilyOverview";
import { familyKey, useFamily } from "@/hooks/use-family";
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
  timeZone,
  me,
}: {
  familyId: string;
  familyName: string;
  timeZone: string;
  me: Member;
}) {
  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight md:text-4xl">{greeting(new Date())}, {me.name.split(" ")[0]}</h1>
        <p className="mt-1 text-muted-foreground">{formatFamilyDate(timeZone)}</p>
      </div>
      <FamilyOverview me={me} timeZone={timeZone} />
    </>
  );
}

function formatFamilyDate(timeZone: string) {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone });
}

