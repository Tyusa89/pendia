// Small presentational pieces for Demo Mode. Deliberately self-contained: nothing here imports the app shell, the data
// layer or any hook that reads family data, so the public /demo page cannot reach a database or a service.
import { useEffect, useRef, type ReactNode } from "react";
import { DEMO_BANNER } from "@/lib/visit-pipeline/labels";
import { STEPS, type Step } from "@/lib/visit-demo/state";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "rounded-[1.25rem] border border-transparent bg-card p-[1.125rem] shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Always visible at the top of every step. */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo mode notice"
      className="rounded-xl border border-dashed border-warning-foreground/50 bg-warning px-4 py-3 text-warning-foreground"
    >
      <p className="text-sm font-bold uppercase tracking-wide">{DEMO_BANNER.title}</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.9412rem] font-semibold">
        {DEMO_BANNER.lines.map((l) => (
          <li
            key={l}
            className="flex items-center gap-3 after:text-warning-foreground/60 after:content-['·'] last:after:content-none"
          >
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StepIndicator({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Demo progress">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-[0.8235rem] font-bold",
              i === at
                ? "bg-primary text-primary-foreground"
                : i < at
                  ? "bg-success text-success-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Moves keyboard/screen-reader focus to the new step's heading when the step changes. */
export function StepHeading({ children, id }: { children: ReactNode; id: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, [id]);
  return (
    <h2 ref={ref} tabIndex={-1} className="text-2xl font-semibold outline-none md:text-3xl">
      {children}
    </h2>
  );
}

export const ProposedBadge = () => (
  <span className="shrink-0 rounded-full bg-warning px-3 py-1 text-[0.8235rem] font-bold text-warning-foreground">
    Proposed · not confirmed
  </span>
);
