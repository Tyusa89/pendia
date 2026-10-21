import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CalendarDays, ClipboardCheck, Home, LogOut, Mail, Pill, Stethoscope } from "lucide-react";
import { authService } from "@/services";
import { useFamily } from "@/hooks/use-family";

const nav = [
  { to: "/family", label: "Family", icon: Home },
  { to: "/visits", label: "Visits", icon: Stethoscope },
  { to: "/meds", label: "Meds", icon: Pill },
  { to: "/coverage", label: "Coverage", icon: CalendarDays },
  { to: "/handoffs", label: "Handoffs", icon: ClipboardCheck },
  { to: "/digest", label: "Digest", icon: Mail },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useFamily();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await authService.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-5 py-3 backdrop-blur">
        <Link to="/family" className="font-display text-2xl font-semibold text-primary">
          Pendia
        </Link>
        <div className="flex items-center gap-3">
          {data?.family && <span className="hidden text-sm text-muted-foreground sm:inline">{data.family.name}</span>}
          <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>
      <main className="flex-1 px-5 pb-32 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <ul className="mx-auto grid max-w-2xl grid-cols-6">
          {nav.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex flex-col items-center gap-1 py-3 text-xs font-medium text-muted-foreground"
                activeProps={{ className: "text-primary" }}
              >
                <Icon className="size-6" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border bg-card p-5 shadow-card ${className}`}>{children}</section>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-muted p-5 text-center text-muted-foreground">{children}</p>;
}

/** Renders children with family context, or a nudge to set up a family. */
export function WithFamily({ children }: { children: (f: NonNullable<ReturnType<typeof useFamily>["data"]>) => ReactNode }) {
  const { data, isLoading } = useFamily();
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data)
    return (
      <Empty>
        You're not part of a family yet.{" "}
        <Link to="/family" className="font-semibold text-primary underline">
          Set one up
        </Link>
      </Empty>
    );
  return <>{children(data)}</>;
}
