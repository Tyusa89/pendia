import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNarrow } from "@/hooks/use-narrow";
import { UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Empty, Panel } from "@/components/AppShell";
import { MemberInvite } from "@/components/MemberInvite";
import { SEND_MESSAGES, looksLikeEmail } from "@/lib/invitations";
import { familyService, inviteService, type Member } from "@/services";

export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");

export function Recipient({ familyId, editable }: { familyId: string; editable: boolean }) {
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
    <section aria-label="Care recipient" className="rounded-[var(--radius-card)] bg-[#1f2d4a] p-5 text-white shadow-card md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-[#f5efe6] font-display text-xl font-semibold text-[#1f2d4a] md:size-16 md:text-2xl">{initials(r.name)}</span>
          <div className="min-w-0">
            <p className="font-brand text-xs font-bold uppercase tracking-[0.08em] text-white/75">Caring for</p>
            <p className="break-words font-display text-[clamp(1.5rem,8vw,1.875rem)] font-semibold leading-tight md:text-4xl">{r.name}</p>
          </div>
        </div>
        {editable && (
          <Button variant="outline" size="sm" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={() => setEditing(true)}>
            Edit care profile
          </Button>
        )}
      </div>
      {r.notes && <p className="mt-3 max-w-3xl text-lg text-white/90">{r.notes}</p>}
    </section>
  );
}

export function MemberRow({ m, editable, defaultOpen = true }: { m: Member; editable: boolean; defaultOpen?: boolean }) {
  const qc = useQueryClient();
  const narrow = useNarrow();
  const [open, setOpen] = useState(defaultOpen);
  const showSwitches = !narrow || open;
  const upd = useMutation({
    mutationFn: (patch: Partial<Member>) => familyService.updateMember(m.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", m.family_id] }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Panel>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-full font-brand font-bold ${m.role === "organizer" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{initials(m.name)}</span>
          <div className="min-w-0">
            <p className="font-brand text-lg font-bold">{m.name}</p>
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
      {narrow && (
        <button type="button" aria-expanded={open} aria-controls={`access-${m.id}`} onClick={() => setOpen((v) => !v)} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl bg-accent px-3 font-brand text-sm font-semibold text-primary">
          Who can see what <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
      {showSwitches && (
        <div id={`access-${m.id}`} className="mt-3 divide-y divide-border border-t border-border">
          {(["can_see_meds", "can_see_schedule", "can_see_visits"] as const).map((k) => (
            <label key={k} className="flex min-h-[3.25rem] flex-row-reverse items-center justify-between gap-3 text-[0.9412rem] font-medium">
              <Switch
                checked={m[k]}
                disabled={!editable}
                onCheckedChange={(v) => upd.mutate({ [k]: v })}
              />
              {k === "can_see_meds" ? "Medications" : k === "can_see_schedule" ? "Coverage schedule" : "Doctor visits & recordings"}
            </label>
          ))}
          {m.role === "member" && (
            <label className="flex min-h-[3.25rem] flex-row-reverse items-center justify-between gap-3 text-[0.9412rem] font-medium">
              <Switch
                size="touch"
                checked={m.can_upload_documents}
                disabled={!editable || upd.isPending}
                onCheckedChange={(v) => upd.mutate({ can_upload_documents: v })}
                aria-describedby={`upload-hint-${m.id}`}
              />
              <span>
                Upload appointment documents
                <span id={`upload-hint-${m.id}`} className="block text-sm font-normal text-muted-foreground">
                  They upload; an organizer reviews and saves the appointment.
                </span>
              </span>
            </label>
          )}
        </div>
      )}
      {editable && m.role === "member" && !m.user_id && <MemberInvite m={m} />}
    </Panel>
  );
}

export function Invite({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const empty = {
    name: "",
    email: "",
    phone: "",
    language: "en",
    role: "member",
    can_see_meds: true,
    can_see_schedule: true,
    can_see_visits: true,
  };
  const [f, setF] = useState(empty);
  const add = useMutation({
    mutationFn: async () => {
      const { email, ...row } = f;
      const created = await familyService.addMember({ ...row, family_id: familyId });
      // with an email (Member role): also send the invitation. The member row exists either way.
      const invite = email.trim() && f.role === "member" ? await inviteService.send(created.id, email.trim()) : null;
      return { invite };
    },
    onSuccess: ({ invite }) => {
      setF(empty);
      qc.invalidateQueries({ queryKey: ["members", familyId] });
      qc.invalidateQueries({ queryKey: ["family-invites", familyId] });
      if (!invite) toast.success("Member added");
      else if (invite.code === "sent") toast.success("Member added and invitation sent");
      else toast.error(`Member added. ${SEND_MESSAGES[invite.code]}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const emailBad = f.email.trim() !== "" && !looksLikeEmail(f.email);
  return (
    <Panel className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl"><UserRoundPlus className="size-5 text-primary" /> Invite a member</h2>
      <Input
        placeholder="Name"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      <Input
        aria-label="Email for the invitation"
        placeholder="Email (optional) — we send a secure sign-in link"
        type="email"
        autoComplete="off"
        value={f.email}
        onChange={(e) => setF({ ...f, email: e.target.value })}
      />
      {f.email.trim() !== "" && f.role === "organizer" && (
        <p role="note" className="text-sm text-muted-foreground">Invitations are for the Member role. Add them as a Member, then change their role after they join.</p>
      )}
      {emailBad && <p role="alert" className="text-sm font-semibold text-destructive">Enter a valid email address.</p>}
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
      <Button className="w-full" disabled={!f.name || emailBad || add.isPending} onClick={() => add.mutate()}>
        {f.email.trim() && f.role === "member" ? "Add and send invitation" : "Add to family"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Without an email, they're only added to your team list. Text invitations come later.
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
      <div className="flex rounded-xl bg-accent p-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`min-h-11 flex-1 rounded-lg px-2 font-brand font-bold ${value === v ? "bg-card text-primary shadow-card" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
