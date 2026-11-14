import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingCard, PageTitle, Panel } from "@/components/AppShell";
import { FamilyOverview, greeting } from "@/components/FamilyOverview";
import { JoinFamilyForm, JoinRequestStatus, MY_JOIN_REQUESTS_KEY } from "@/components/JoinFamily";
import { familyKey, useFamily } from "@/hooks/use-family";
import { familyService, joinService, type Member } from "@/services";
import { useQuery } from "@tanstack/react-query";

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

export function Setup() {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<"create" | "join">("create");
  const [startedOver, setStartedOver] = useState(false);
  const { data: requests = [], isSuccess } = useQuery({ queryKey: MY_JOIN_REQUESTS_KEY, queryFn: () => joinService.myRequests() });
  const waiting = isSuccess && !startedOver && requests.length > 0 && requests[0]!.status !== "canceled";
  const demo = useMutation({
    mutationFn: () => familyService.joinDemo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKey }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageTitle title="Welcome" subtitle="Start a family, join one you were invited to, or look around the demo first." />
      {waiting ? (
        <JoinRequestStatus onStartOver={() => setStartedOver(true)} />
      ) : (
        <>
          <div role="radiogroup" aria-label="How do you want to start?" className="mb-5 grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
            {([["create", "Create a Family"], ["join", "Join an Existing Family"]] as const).map(([k, label]) => (
              <Button key={k} role="radio" aria-checked={choice === k} variant={choice === k ? "default" : "outline"} className="min-h-12 whitespace-normal" onClick={() => setChoice(k)}>{label}</Button>
            ))}
          </div>
          {choice === "create" ? <CreateFamilyForm /> : <JoinFamilyForm />}
        </>
      )}
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

function CreateFamilyForm() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const create = useMutation({
    mutationFn: () => familyService.createFamily(name, myName),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKey }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Panel className="space-y-4">
      <h2 className="text-xl font-semibold">Create your family</h2>
      <div className="space-y-2">
        <Label>Family name</Label>
        <Input placeholder="The Morales Family" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Your name</Label>
        <Input placeholder="Elena" value={myName} onChange={(e) => setMyName(e.target.value)} />
      </div>
      <Button className="w-full" disabled={!name || !myName || create.isPending} onClick={() => create.mutate()}>
        Create family
      </Button>
    </Panel>
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

