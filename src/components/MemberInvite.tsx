import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEND_MESSAGES, inviteStatus, latestInviteByMember, looksLikeEmail, type FamilyInvite } from "@/lib/invitations";
import { inviteService, type Member } from "@/services";

export const invitesKey = (familyId: string) => ["family-invites", familyId] as const;

/** Organizer's invitation controls on one member card: send, status, resend, revoke. Shown only for a Member row with no linked account. */
export function MemberInvite({ m }: { m: Member }) {
  const qc = useQueryClient();
  const { data: invites = [] } = useQuery({ queryKey: invitesKey(m.family_id), queryFn: () => inviteService.listForFamily(m.family_id) });
  const latest: FamilyInvite | undefined = latestInviteByMember(invites).get(m.id);
  const status = latest ? inviteStatus(latest) : null;
  const [email, setEmail] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: invitesKey(m.family_id) });

  const send = useMutation({
    mutationFn: (to: string) => inviteService.send(m.id, to),
    onSuccess: async (r) => {
      await refresh();
      if (r.code === "sent") {
        toast.success(SEND_MESSAGES.sent);
        setEmail("");
      } else toast.error(SEND_MESSAGES[r.code]);
    },
    onError: () => toast.error(SEND_MESSAGES.failed),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => inviteService.revoke(id),
    onSuccess: async () => {
      await refresh();
      toast.success("Invitation withdrawn.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const target = latest?.invited_email ?? email.trim();
  const valid = looksLikeEmail(target);
  const open = status === "pending";
  const failed = latest?.delivery_status === "failed";

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3" aria-label={`Invitation for ${m.name}`} role="group">
      <p className="font-semibold">Invite {m.name} to connect their account</p>
      {latest && status !== "accepted" && (
        <p className="flex flex-wrap items-center gap-2 text-[0.9412rem]">
          <span
            className={`rounded-full px-3 py-1 text-[0.8235rem] font-bold ${open && !failed ? "bg-secondary text-secondary-foreground" : status === "pending" ? "bg-warning text-warning-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {open ? (failed ? "Email not sent" : "Invitation sent") : status === "expired" ? "Invitation expired" : "Invitation withdrawn"}
          </span>
          <span className="break-all text-muted-foreground">{latest.invited_email}</span>
          {open && <span className="text-muted-foreground">· expires {new Date(latest.expires_at).toLocaleDateString()}</span>}
        </p>
      )}
      {(!latest || status === "revoked") && (
        <div className="space-y-2">
          <label htmlFor={`invite-email-${m.id}`} className="block font-semibold">Email for the invitation</label>
          <Input id={`invite-email-${m.id}`} type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={latest && status !== "revoked" ? "outline" : "default"} disabled={!valid || send.isPending} onClick={() => send.mutate(target)}>
          {latest && status !== "revoked" ? <RotateCw aria-hidden /> : <Mail aria-hidden />}
          {send.isPending ? "Sending…" : latest && status !== "revoked" ? "Resend invitation" : "Send invitation"}
        </Button>
        {open && latest && (
          <Button type="button" variant="ghost" className="text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(latest.id)}>
            <X aria-hidden /> Withdraw
          </Button>
        )}
      </div>
      {!latest && <p className="text-sm text-muted-foreground">You send this from your own organizer account. We email them a secure sign-in link, and they confirm after signing in.</p>}
    </div>
  );
}
