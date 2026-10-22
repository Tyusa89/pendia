import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Pendia" },
      { name: "description", content: "Sign in to Pendia to coordinate care with your family." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Sign in — Pendia" },
      { property: "og:description", content: "Sign in to Pendia to coordinate care with your family." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await authService.signIn(email, password);
        if (error) throw error;
        navigate({ to: "/family" });
      } else {
        const { data, error } = await authService.signUp(email, password);
        if (error) throw error;
        if (data.session) navigate({ to: "/family" });
        else setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-hero px-5">
      <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-card">
        <h1 className="font-display text-4xl font-semibold text-primary">Pendia</h1>
        <p className="mt-2 text-lg text-muted-foreground">Caring for someone, together.</p>
        {sent ? (
          <p className="mt-8 rounded-xl bg-secondary p-5 text-secondary-foreground">
            Check <strong>{email}</strong> for a link to confirm your account, then come back and sign in.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-base">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw" className="text-base">Password</Label>
              <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {mode === "in" ? "Sign in" : "Create account"}
            </Button>
            <button type="button" className="w-full text-center font-medium text-primary" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
