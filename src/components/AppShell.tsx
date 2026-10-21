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
 * Phone first. Under 1024px: top bar + a fixed bottom tab bar (six tabs at every width, 56px+ targets, honors the
 * iPhone home-indicator inset). From 1024px: the same six as a left sidebar and the top bar is dropped.
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
    <button
      type="button"
      onClick={signOut}
      aria-label="Sign out"
      className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
    >
      <LogOut className="size-5" />
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-card pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-1 max-[17em]:max-md:grid-cols-3 md:px-[max(1rem,calc((100%-44rem)/2))] lg:sticky lg:top-0 lg:bottom-auto lg:flex lg:h-screen lg:w-[var(--side-w)] lg:flex-none lg:flex-col lg:gap-1 lg:self-start lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-3 lg:py-6"
      >
        <Link
          to="/family"
          className="hidden px-3.5 pb-5 pt-1 font-display text-[1.625rem] font-semibold text-primary lg:block"
        >
          Pendia
        </Link>
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[clamp(0.6rem,3.4vw,0.8235rem)] font-semibold leading-tight tracking-tight text-muted-foreground hover:bg-muted lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:px-3.5 lg:text-base [@media(max-height:500px)_and_(orientation:landscape)]:min-h-11 [@media(max-height:500px)_and_(orientation:landscape)]:flex-row [@media(max-height:500px)_and_(orientation:landscape)]:gap-1.5"
            activeProps={{
              className: "text-primary font-bold lg:bg-primary/10",
              "aria-current": "page",
            }}
          >
            <span className="flex h-7 w-[min(3rem,100%)] items-center justify-center rounded-full group-aria-[current=page]:bg-primary/10 lg:h-auto lg:w-auto lg:group-aria-[current=page]:bg-transparent [@media(max-height:500px)_and_(orientation:landscape)]:w-auto [@media(max-height:500px)_and_(orientation:landscape)]:group-aria-[current=page]:bg-transparent">
              <Icon className="size-[22px]" aria-hidden />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </Link>
        ))}
        <div className="mt-auto hidden flex-col gap-1 border-t pt-4 lg:flex">
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
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-2 border-b bg-background/90 py-2 pl-5 pr-3 backdrop-blur lg:hidden">
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
        </header>
        <main className="mx-auto w-full max-w-[66rem] flex-1 px-4 pb-[calc(var(--nav-h)+2rem+env(safe-area-inset-bottom))] pt-5 md:px-8 md:pt-8 lg:px-12 lg:pb-16 lg:pt-10">
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
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
