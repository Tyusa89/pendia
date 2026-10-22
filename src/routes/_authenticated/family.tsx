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
        </section>}
      </div>
    </>
  );
}

function formatFamilyDate(timeZone: string) {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone });
}

function Recipient({ familyId, editable }: { familyId: string; editable: boolean }) {
  const qc = useQueryClient();
  const { data: r } = useQuery({
    queryKey: ["recipient", familyId],
    queryFn: () => familyService.getRecipient(familyId),
  });
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setName(r?.name ?? "");
    setNotes(r?.notes ?? "");
  }, [r]);
  const save = useMutation({
    mutationFn: () => familyService.saveRecipient(familyId, name, notes, r?.id),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["recipient", familyId] });
      toast.success("Saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (editing || (!r && editable))
    return (
      <Panel className="space-y-3">
        <h2 className="text-xl font-semibold">Who you're caring for</h2>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          placeholder="Notes (health, preferences…)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button disabled={!name} onClick={() => save.mutate()}>
          Save
        </Button>
      </Panel>
    );
  if (!r) return <Empty>No care recipient yet.</Empty>;
  return (
    <Panel className="bg-hero">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Caring for
      </p>
      <div className="mt-1 flex items-center gap-3">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-card font-display text-xl font-semibold">{r.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
        <p className="min-w-0 font-display text-3xl font-semibold">{r.name}</p>
      </div>
      {r.notes && <p className="mt-2 text-lg">{r.notes}</p>}
      {editable && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          Edit care profile
        </Button>
      )}
    </Panel>
  );
}

function MemberRow({ m, editable }: { m: Member; editable: boolean }) {
  const qc = useQueryClient();
  const upd = useMutation({
    mutationFn: (patch: Partial<Member>) => familyService.updateMember(m.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", m.family_id] }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Panel>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full font-bold ${m.role === "organizer" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{m.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
          <div className="min-w-0">
          <p className="text-lg font-semibold">{m.name}</p>
          <p className="break-words text-muted-foreground">
            {m.phone || "No phone"} · {m.language === "es" ? "Español" : "English"}
          </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[0.8235rem] font-bold ${m.role === "organizer" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {m.role === "organizer" ? "Organizer" : "Member"}
        </span>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        {(["can_see_meds", "can_see_schedule", "can_see_visits"] as const).map((k) => (
          <label key={k} className="flex min-h-12 flex-row-reverse items-center justify-between gap-3 text-[0.9412rem] font-medium">
            <Switch
              checked={m[k]}
              disabled={!editable}
              onCheckedChange={(v) => upd.mutate({ [k]: v })}
            />
            {k === "can_see_meds" ? "Medications" : k === "can_see_schedule" ? "Coverage schedule" : "Doctor visits & recordings"}
          </label>
        ))}
      </div>
    </Panel>
  );
}

function Invite({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const empty = {
    name: "",
    phone: "",
    language: "en",
    role: "member",
    can_see_meds: true,
    can_see_schedule: true,
    can_see_visits: true,
  };
  const [f, setF] = useState(empty);
  const add = useMutation({
    mutationFn: () => familyService.addMember({ ...f, family_id: familyId }),
    onSuccess: () => {
      setF(empty);
      qc.invalidateQueries({ queryKey: ["members", familyId] });
      toast.success("Member added");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Panel className="mt-6 space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold"><UserRoundPlus className="size-5 text-primary" /> Invite a member</h2>
      <Input
        placeholder="Name"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      <Input
        placeholder="Phone, e.g. (212) 555-0102"
        type="tel"
        value={f.phone}
        onChange={(e) => setF({ ...f, phone: e.target.value })}
      />
      <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
        <Seg
          label="Language"
          value={f.language}
          options={[
            ["en", "English"],
            ["es", "Español"],
          ]}
          onChange={(v) => setF({ ...f, language: v })}
        />
        <Seg
          label="Role"
          value={f.role}
          options={[
            ["member", "Member"],
            ["organizer", "Organizer"],
          ]}
          onChange={(v) => setF({ ...f, role: v })}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-0.5">
        {(["can_see_meds", "can_see_schedule", "can_see_visits"] as const).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3 font-medium">
            <Switch checked={f[k]} onCheckedChange={(v) => setF({ ...f, [k]: v })} />
            {k === "can_see_meds" ? "Meds" : k === "can_see_schedule" ? "Schedule" : "Visits"}
          </label>
        ))}
      </div>
      <Button className="w-full" disabled={!f.name || add.isPending} onClick={() => add.mutate()}>
        Add to family
      </Button>
      <p className="text-sm text-muted-foreground">
        Text invites come later — for now they're added to your team list.
      </p>
    </Panel>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 font-semibold">{label}</p>
      <div className="flex rounded-xl bg-muted p-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`min-h-11 flex-1 rounded-lg px-2 font-bold ${value === v ? "bg-card shadow-card" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
