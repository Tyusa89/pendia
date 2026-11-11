import { FamilySwitcher } from "@/components/FamilySwitcher";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { Lock, LogOut, Menu, Plus, SlidersHorizontal } from "lucide-react";
import { authService } from "@/services";
import { useFamily } from "@/hooks/use-family";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { phoneBarLeft, phoneBarRight, phoneMenu, pillDestinations } from "@/lib/app-nav";
import { isJudgeDemo } from "@/lib/judge-demo";

// Under large text the labels step down a size so every one stays whole ("Coverage" must not be cut to "Cover…").
const barLabel = "max-w-full text-center [html[data-text-size=large]_&]:text-[min(0.5625rem,3.2vw)] [html[data-text-size=large]_&]:tracking-tight";
const bar =
  "group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 text-[0.7059rem] font-semibold leading-tight text-muted-foreground focus-visible:outline-2";

/**
 * Link to the assistant's availability page; does not enable AI. Drawn as a dashed, locked control because Ask Pendia
 * is not available yet.
 */
function AssistantSlot({ iconOnly }: { iconOnly?: boolean }) {
  return (
    <Link
      to="/ask"
      data-testid="assistant-slot"
      aria-label="Ask Pendia (not available yet)"
      className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-dashed border-input px-3.5 font-brand text-sm font-semibold text-muted-foreground hover:bg-accent"
    >
      <Lock className="size-4" aria-hidden />
      <span className={iconOnly ? "hidden xl:inline" : ""}>Ask Pendia</span>
    </Link>
  );
}

/**
 * Shared care workspace. Phones (under 768px): top bar, floating bottom bar with a centred Handoff action, and a menu
 * sheet. Tablet (768px up): header plus a sticky row of pills. Desktop (1024px up): the pills sit in the header.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useFamily();
  const [menuOpen, setMenuOpen] = useState(false);

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
      className="size-11 rounded-full text-muted-foreground"
    >
      <LogOut className="size-5" />
    </Button>
  );

  return (
    <div className="pendia-workspace flex min-h-screen flex-col">
      <a href="#care-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3 focus:text-primary focus:ring-2 focus:ring-ring">Skip to care content</a>
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-7 lg:px-8 lg:py-3">
          <Link to="/family" className="inline-flex min-h-11 items-center font-brand text-2xl font-extrabold text-foreground">
            Pendia
          </Link>
          <nav
            aria-label="Main"
            className="order-last hidden w-full min-w-0 md:block lg:order-none lg:w-auto lg:flex-1"
          >
            <ul className="flex flex-wrap items-center gap-1 lg:inline-flex lg:rounded-[1.75rem] lg:border lg:border-border lg:bg-card lg:p-1">
              {pillDestinations.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="inline-flex min-h-11 items-center rounded-full px-4 font-brand text-[0.9412rem] font-semibold text-foreground hover:bg-accent"
                    activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary", "aria-current": "page" }}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {data?.family && <FamilySwitcher activeId={data.family.id} activeName={data.family.name} />}
            <div className="hidden items-center gap-1.5 md:flex">
              <AssistantSlot iconOnly />
              <Button asChild variant="ghost" size="icon" className="size-11 rounded-full text-muted-foreground">
                <Link to="/preferences" aria-label="Preferences & Accessibility" title="Preferences & Accessibility"><SlidersHorizontal className="size-5" /></Link>
              </Button>
              {signOutButton}
            </div>
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Menu" className="size-11 rounded-full md:hidden">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[1.625rem] bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                <SheetTitle className="font-brand text-lg font-bold">Menu</SheetTitle>
                <SheetDescription className="sr-only">Other places in Pendia, preferences and sign out.</SheetDescription>
                <nav aria-label="More" className="mt-3 divide-y divide-border">
                  {phoneMenu.map(({ to, label, hint, icon: Icon }) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-14 items-center gap-3 py-2"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Icon className="size-5" aria-hidden /></span>
                      <span className="min-w-0">
                        <span className="block font-brand font-bold">{label}</span>
                        <span className="block text-sm text-muted-foreground">{hint}</span>
                      </span>
                    </Link>
                  ))}
                  <button type="button" onClick={signOut} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><LogOut className="size-5" aria-hidden /></span>
                    <span className="font-brand font-bold">Sign out</span>
                  </button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="care-content" tabIndex={-1} className="care-content mx-auto w-full max-w-[1440px] flex-1 px-4 pb-[calc(var(--nav-h)+2rem+env(safe-area-inset-bottom))] pt-5 md:px-7 md:pb-12 md:pt-8 lg:px-8">
        {isJudgeDemo() && <p role="note" className="mb-5 block w-fit rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground">Fictional hackathon demo · Read-only · No real patient information</p>}
        <Fragment key={data?.family.id ?? "none"}>{children}</Fragment>
        <p className="mt-10 text-center text-[0.9412rem] text-muted-foreground">
          Ask Pendia isn't available yet. No questions or family records are being sent to an AI service.
        </p>
        <p className="mt-2 text-center text-[0.9412rem] text-muted-foreground">
          Not medical advice. Check with your doctor or pharmacist.
        </p>
      </main>

      <nav
        aria-label="Bottom"
        className="fixed inset-x-3 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-30 flex items-end gap-0.5 rounded-[1.75rem] border border-border-warm bg-card px-2 pb-1.5 pt-1.5 shadow-card md:hidden"
      >
        {phoneBarLeft.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className={bar} activeProps={{ className: "bg-accent font-bold text-primary", "aria-current": "page" }}>
            <Icon className="size-[22px]" aria-hidden />
            <span className={barLabel}>{label}</span>
          </Link>
        ))}
        <Link
          to="/handoffs"
          className="-mt-6 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 self-end text-[0.7059rem] font-bold leading-tight text-primary"
          activeProps={{ "aria-current": "page" }}
        >
          <span className="grid size-14 place-items-center rounded-full border-4 border-card bg-primary text-primary-foreground shadow-warm"><Plus className="size-6" aria-hidden /></span>
          <span className={barLabel}>Handoff</span>
        </Link>
        {phoneBarRight.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className={bar} activeProps={{ className: "bg-accent font-bold text-primary", "aria-current": "page" }}>
            <Icon className="size-[22px]" aria-hidden />
            <span className={barLabel}>{label}</span>
          </Link>
        ))}
      </nav>
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
      className={`rounded-[var(--radius-card)] border border-border-warm bg-card p-5 shadow-card ${className}`}
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
      className="space-y-3 rounded-[var(--radius-card)] bg-card p-5 shadow-card motion-safe:animate-pulse"
    >
      <div className="h-3.5 w-1/2 rounded-md bg-muted" />
      <div className="h-6 w-4/5 rounded-lg bg-muted" />
      <div className="h-20 rounded-2xl bg-muted" />
    </div>
  );
}
