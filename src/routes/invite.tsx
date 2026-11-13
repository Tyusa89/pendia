import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptErrorMessage, looksLikeEmail } from "@/lib/invitations";
import { isJudgeDemo } from "@/lib/judge-demo";
import { authService, familyService, inviteService } from "@/services";

export const Route = createFileRoute("/invite")({
  head: () => ({
    meta: [
      { title: "Join your family — Pendia" },
      { name: "description", content: "Sign in with your email to accept a family invitation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

/** What Supabase Auth puts in the URL fragment when a magic link failed. Read once, then removed from the address bar. Never logged. */
export function readLinkProblem(): "expired" | "other" | null {
  if (typeof window === "undefined") return null;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!h.get("error") && !h.get("error_code")) return null;
  const expired =
    h.get("error_code") === "otp_expired" || /expired/i.test(h.get("error_description") ?? "");
  window.history.replaceState(null, "", window.location.pathname);
  return expired ? "expired" : "other";
}

// Read at module load, before the Supabase client (which also watches the URL fragment) can consume it.
export const linkProblem: { value: "expired" | "other" | null } = { value: readLinkProblem() };

function InvitePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [problem] = useState(linkProblem.value);
  useEffect(() => authService.onSignedInChange(setSignedIn), []);
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-background px-5 py-10"
    >
      <div className="w-full max-w-md space-y-6">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-brand text-2xl font-extrabold text-foreground"
        >
          Pendia
        </Link>
        <h1 className="text-3xl">Join your family</h1>
        {isJudgeDemo() ? (
          <p role="note" className="rounded-2xl bg-secondary p-4 text-secondary-foreground">
            The fictional demo can't accept invitations. Sign out of the demo to use a real account.
          </p>
        ) : signedIn === null ? (
          <p role="status" className="text-muted-foreground">
            Checking your sign-in…
          </p>
        ) : signedIn ? (
          <Pending />
        ) : (
          <SignIn problem={problem} />
        )}
      </div>
    </main>
  );
}

function SignIn({ problem }: { problem: "expired" | "other" | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) return;
    setBusy(true);
    try {
      const { error } = await authService.sendMagicLink(email.trim().toLowerCase());
      if (error) throw error;
      setSent(true);
    } catch {
      // the provider's message can contain the address, so it is never shown or logged
      toast.error("We couldn't send the email. Wait a minute and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <p role="status" className="rounded-2xl bg-secondary p-5 text-secondary-foreground">
        Check your inbox for a sign-in link. Open it on this device, then come back here to accept
        the invitation. It expires soon, so use it right away.
      </p>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      {problem && (
        <p
          role="alert"
          className="rounded-2xl bg-warning p-4 font-semibold text-warning-foreground"
        >
          {problem === "expired"
            ? "That sign-in link has expired or was already used. Enter your email to get a new one."
            : "That sign-in link didn't work. Enter your email to get a new one."}
        </p>
      )}
      <p className="text-muted-foreground">
        Enter the email address your invitation was sent to. We'll email you a secure sign-in link;
        no password needed.
      </p>
      <div className="space-y-2">
        <Label htmlFor="invite-email" className="text-base">
          Email
        </Label>
        <Input
          id="invite-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy || !looksLikeEmail(email)}>
        <Mail aria-hidden /> {busy ? "Sending…" : "Email me a sign-in link"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have a password?{" "}
        <Link
          to="/auth"
          search={{ redirect: "/invite" }}
          className="font-semibold text-primary underline"
        >
          Sign in with it
        </Link>
      </p>
    </form>
  );
}

function Pending() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-pending-invites"],
    queryFn: () => inviteService.myPending(),
    staleTime: 0,
    gcTime: 0,
  });
  const { data: email } = useQuery({
    queryKey: ["current-email"],
    queryFn: () => authService.currentEmail(),
  });

  async function accept(id: string) {
    setAccepting(id);
    try {
      const familyId = await inviteService.accept(id);
      await familyService.setActiveFamily(familyId);
      await qc.cancelQueries();
      await qc.resetQueries();
      toast.success("You've joined the family.");
      void navigate({ to: "/family", replace: true });
    } catch (e) {
      toast.error(acceptErrorMessage(e));
      await qc.invalidateQueries({ queryKey: ["my-pending-invites"] });
    } finally {
      setAccepting(null);
    }
  }

  if (isLoading)
    return (
      <p role="status" className="text-muted-foreground">
        Looking for your invitations…
      </p>
    );
  if (isError)
    return (
      <p role="alert" className="font-semibold text-destructive">
        We couldn't load your invitations. Please reload the page.
      </p>
    );
  if (!data || data.length === 0)
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-2xl bg-muted p-5">
          There's no pending invitation for{" "}
          {email ? <strong className="break-all">{email}</strong> : "this account"}. It may have
          expired, been withdrawn, or already been used, or it was sent to a different email
          address. Ask the organizer to send a new one.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/family">Go to my family</Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => void authService.signOut()}>
            Use a different email
          </Button>
        </div>
      </div>
    );
  return (
    <ul className="space-y-4" aria-label="Your invitations">
      {data.map((i) => (
        <li
          key={i.invite_id}
          className="space-y-3 rounded-[var(--radius-card)] border border-border-warm bg-card p-5 shadow-card"
        >
          <p className="text-lg">
            {i.invited_by_name ? <strong>{i.invited_by_name}</strong> : "An organizer"} invited you
            to join <strong>{i.family_name}</strong> as <strong>{i.member_name}</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Signed in as {email ?? "your account"} · expires{" "}
            {new Date(i.expires_at).toLocaleDateString()}
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={accepting !== null}
            onClick={() => void accept(i.invite_id)}
          >
            {accepting === i.invite_id ? "Joining…" : "Accept invitation"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
