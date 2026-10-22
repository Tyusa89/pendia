import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  Home,
  LogOut,
  Mail,
  MessageCircle,
  Pill,
  Stethoscope,
} from "lucide-react";
import { authService } from "@/services";
import { useFamily } from "@/hooks/use-family";
import { features } from "@/lib/features";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/family", label: "Family", icon: Home },
  { to: "/visits", label: "Visits", icon: Stethoscope },
  { to: "/meds", label: "Meds", icon: Pill },
  { to: "/coverage", label: "Coverage", icon: CalendarDays },
  { to: "/handoffs", label: "Handoffs", icon: ClipboardCheck },
  { to: "/digest", label: "Digest", icon: Mail },
] as const;

/**
 * The reserved place for the optional AI assistant. Renders nothing while `features.assistant` is off, so the app
 * looks and works the same without it. (No route exists for it yet.)
 */
function AssistantSlot({ variant }: { variant: "top" | "side" }) {
  if (!features.assistant) return null;
  return variant === "top" ? (
    <span
      data-testid="assistant-slot"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 font-semibold"
    >
      <MessageCircle className="size-[18px]" aria-hidden /> Ask
    </span>
  ) : (
    <span
      data-testid="assistant-slot"
      className="flex min-h-12 items-center gap-3 rounded-xl px-3.5 font-semibold text-muted-foreground"
    >
      <MessageCircle className="size-[22px]" aria-hidden /> Ask Pendia
    </span>
  );
}

/**
 * Shared top bar and six fixed bottom tabs at every width, with safe-area room for the phone home indicator.
 */
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

  const signOutButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={signOut}
      aria-label="Sign out"
      className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
    >
      <LogOut className="size-5" />
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-1 max-[17em]:max-md:grid-cols-3 md:px-[max(1rem,calc((100%-48rem)/2))]"
      >
        <Link
          to="/family"
          className="hidden"
        >
          Pendia
        </Link>
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[0.7059rem] font-semibold leading-tight text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:text-[0.8235rem] [@media(max-height:500px)_and_(orientation:landscape)]:min-h-11 [@media(max-height:500px)_and_(orientation:landscape)]:flex-row [@media(max-height:500px)_and_(orientation:landscape)]:gap-1.5"
            activeProps={{
              className: "text-primary font-bold",
              "aria-current": "page",
            }}
          >
            <span className="flex h-7 w-[min(3rem,100%)] items-center justify-center rounded-full group-aria-[current=page]:bg-primary/10 [@media(max-height:500px)_and_(orientation:landscape)]:w-auto">
              <Icon className="size-[22px]" aria-hidden />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </Link>
        ))}
        <div className="hidden">
          <AssistantSlot variant="side" />
          {data?.me && (
            <p className="truncate px-3.5 text-sm text-muted-foreground">
              {data.me.name} · {data.me.role === "organizer" ? "Organizer" : "Member"}
            </p>
          )}
          <div className="px-1.5">{signOutButton}</div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto grid min-h-16 w-full max-w-[48rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 md:px-7">
          <Link
            to="/family"
            className="inline-flex min-h-11 items-center font-display text-2xl font-semibold text-primary"
          >
            Pendia
          </Link>
          <div className="flex min-w-0 items-center gap-1">
            {data?.family && (
              <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground sm:inline">
                {data.family.name}
              </span>
            )}
            <AssistantSlot variant="top" />
            {signOutButton}
          </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[48rem] flex-1 px-4 pb-[calc(var(--nav-h)+2rem+env(safe-area-inset-bottom))] pt-5 md:px-7 md:pt-8">
          {children}
          <p className="mt-10 text-center text-[0.9412rem] text-muted-foreground">
            Not medical advice. Check with your doctor or pharmacist.
          </p>
        </main>
      </div>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  children,
  className = "",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={`rounded-[1.25rem] border border-transparent bg-card p-[1.125rem] shadow-card ${className}`}
    >
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-muted p-5 text-center text-muted-foreground">{children}</p>;
}

/** Renders children with family context, or a nudge to set up a family. */
export function WithFamily({
  children,
}: {
  children: (f: NonNullable<ReturnType<typeof useFamily>["data"]>) => ReactNode;
}) {
  const { data, isLoading } = useFamily();
  if (isLoading) return <LoadingCard />;
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

/** Grey shapes hold the layout while data loads (no spinner over content). */
export function LoadingCard() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="space-y-3 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card motion-safe:animate-pulse"
    >
      <div className="h-3.5 w-1/2 rounded-md bg-muted" />
      <div className="h-6 w-4/5 rounded-lg bg-muted" />
      <div className="h-20 rounded-2xl bg-muted" />
    </div>
  );
}
