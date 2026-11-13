import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services";
import { TryPendiaDemo } from "@/components/TryPendiaDemo";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Pendia" },
      { name: "description", content: "Sign in to Pendia to coordinate care with your family." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Sign in — Pendia" },
      {
        property: "og:description",
        content: "Sign in to Pendia to coordinate care with your family.",
      },
    ],
  }),
  // ?mode=up opens the account-creation form (used by every "Get Started" button on the public site).
  // ?redirect=/invite lets the invitation page send an existing password user back after signing in (only that one path is allowed).
  validateSearch: (search: Record<string, unknown>): { mode?: "up"; redirect?: "/invite" } => ({
    ...(search["mode"] === "up" ? { mode: "up" as const } : {}),
    ...(search["redirect"] === "/invite" ? { redirect: "/invite" as const } : {}),
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const mode: "in" | "up" = search.mode === "up" ? "up" : "in";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const switchMode = () =>
    navigate({ to: "/auth", search: { ...(mode === "in" ? { mode: "up" as const } : {}), ...(search.redirect ? { redirect: search.redirect } : {}) }, replace: true });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await authService.signIn(email, password);
        if (error) throw error;
        navigate({ to: search.redirect ?? "/family" });
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

  const inputCls =
    "h-12 border-[1.5px] border-pd-dusty bg-white text-base text-pd-navy focus-visible:ring-pd-purple";
  return (
    <div className="flex min-h-screen flex-col bg-white text-pd-navy lg:flex-row">
      <aside className="flex flex-col justify-between gap-8 bg-pd-slate px-5 py-6 text-white md:px-12 lg:w-[44%] lg:max-w-[640px] lg:px-14 lg:py-12">
        <Link
          to="/"
          className="inline-flex min-h-11 w-fit items-center font-brand text-[22px] font-extrabold text-white no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pd-lilac"
        >
          Pendia
        </Link>
        <div className="hidden flex-col gap-4 lg:flex">
          {mode === "in" ? (
            <>
              <p className="font-brand text-3xl font-bold leading-tight">
                Your family is on the same page. Come see what is new.
              </p>
              <p className="text-lg text-pd-mist">
                Appointments, documents, and who is handling what, all in one place.
              </p>
            </>
          ) : (
            <>
              <p className="font-brand text-3xl font-bold leading-tight">
                Three steps to get your family organized.
              </p>
              <ol className="flex flex-col gap-4 text-lg">
                {[
                  ["Create Your Family", "Start a family group and invite the people who help."],
                  ["Organize Care", "Add appointments, follow-ups, and documents."],
                  ["Stay Connected", "Everyone sees the same picture."],
                ].map(([t, b], i) => (
                  <li key={t} className="flex gap-4">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pd-beige font-bold text-pd-navy"
                    >
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-bold">{t}</div>
                      <div className="text-pd-mist">{b}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </aside>
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-10 md:px-12">
        <div className="w-full max-w-md">
          <h1 className="font-brand text-4xl font-extrabold tracking-tight">
            {mode === "in" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-2 text-lg text-pd-muted">
            {mode === "in"
              ? "Welcome back to Pendia."
              : "You can set up your family group right after."}
          </p>
          <div className="mt-6">
            <TryPendiaDemo />
            <p className="mt-2 text-sm text-pd-muted">Fictional hackathon demo · Read-only</p>
          </div>
          {sent ? (
            <p role="status" className="mt-8 rounded-xl bg-pd-sky p-5 text-pd-navy">
              Check <strong>{email}</strong> for a link to confirm your account, then come back and
              sign in.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-base">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw" className="text-base">
                  Password
                </Label>
                <Input
                  id="pw"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  aria-describedby={mode === "up" ? "pw-hint" : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                />
                {mode === "up" && (
                  <p id="pw-hint" className="text-sm text-pd-muted">
                    At least 6 characters.
                  </p>
                )}
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full bg-pd-slate text-white hover:bg-pd-navy"
                disabled={busy}
              >
                {mode === "in" ? "Sign in" : "Create account"}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full text-center font-semibold text-pd-slate underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pd-purple"
                onClick={switchMode}
              >
                {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
