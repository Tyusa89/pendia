// Same look as the shell's Panel, kept here so Demo Mode can share these pieces without importing the authenticated shell.
import type { ReactNode } from "react";

export function Card({
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
