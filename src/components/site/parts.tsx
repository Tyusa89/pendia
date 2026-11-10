import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SiteLink } from "@/lib/site";

export const focusRing =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pd-purple";

/** Shared button looks for the public site. All are >= 44px tall (touch friendly) and never wrap their label. */
export const btn = {
  primary: cn(
    "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-[10px] bg-pd-slate px-5 py-2.5 font-semibold text-white no-underline hover:bg-pd-navy",
    focusRing,
  ),
  outline: cn(
    "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-[10px] border-[1.5px] border-pd-dusty px-[18px] py-2 font-semibold text-pd-slate no-underline hover:bg-pd-sky",
    focusRing,
  ),
  onDark: cn(
    "inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl bg-pd-beige px-7 py-3 text-[17px] font-bold text-pd-navy no-underline hover:bg-white",
    focusRing,
  ),
  onDarkOutline: cn(
    "inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border-[1.5px] border-white px-7 py-3 text-[17px] font-bold text-white no-underline hover:bg-white/10",
    focusRing,
  ),
};

export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <Link
      to="/"
      className={cn(
        "inline-flex min-h-11 items-center font-brand text-[22px] font-extrabold tracking-tight no-underline",
        light ? "text-white" : "text-pd-navy",
        focusRing,
        className,
      )}
    >
      Pendia
    </Link>
  );
}

/** Renders any SiteLink with the router, so every destination is type-checked against the real route tree. */
export function SiteAnchor({
  link,
  className,
  children,
  ...rest
}: {
  link: SiteLink;
  className?: string;
  children?: ReactNode;
} & { [extra: string]: unknown }) {
  // Extra props (aria-current, and onClick/ref from Radix Slot when wrapped in SheetClose) pass straight through to the <a>.
  const passthrough = rest as object;
  const content = children ?? link.label;
  if (link.to === "/auth") {
    return (
      <Link
        to="/auth"
        {...(link.search ? { search: link.search } : {})}
        className={className}
        {...passthrough}
      >
        {content}
      </Link>
    );
  }
  return (
    <Link
      to={link.to}
      {...("hash" in link && link.hash ? { hash: link.hash } : {})}
      className={className}
      {...passthrough}
    >
      {content}
    </Link>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("text-sm font-bold uppercase tracking-[0.08em] text-pd-purple-deep", className)}
    >
      {children}
    </div>
  );
}

export function H2({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "font-brand text-[27px] font-bold leading-[1.15] tracking-[-0.015em] text-pd-navy md:text-[32px] lg:text-4xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** Decorative stand-in for photography (no photo assets exist yet). Purely decorative, hidden from assistive tech. */
export function PhotoSlot({
  className,
  variant = "home",
}: {
  className?: string;
  variant?: "home" | "family";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-pd-sand",
        className,
      )}
    >
      <svg
        viewBox="0 0 400 300"
        className="h-full max-h-[360px] w-full max-w-[520px] p-6"
        fill="none"
      >
        <rect x="40" y="206" width="320" height="14" rx="7" fill="#c9b99f" />
        <rect x="70" y="220" width="12" height="60" rx="4" fill="#b8a688" />
        <rect x="318" y="220" width="12" height="60" rx="4" fill="#b8a688" />
        <circle cx="150" cy="106" r="30" fill="#7a6a9e" />
        <path d="M100 206c0-34 22-58 50-58s50 24 50 58z" fill="#4a6b88" />
        <circle cx="262" cy="122" r="26" fill="#4f7260" />
        <path d="M222 206c0-30 18-50 40-50s40 20 40 50z" fill="#2c4560" />
        {variant === "family" && (
          <>
            <circle cx="206" cy="150" r="18" fill="#d9d1ea" />
            <path d="M180 206c0-20 12-34 26-34s26 14 26 34z" fill="#7a6a9e" />
          </>
        )}
        <rect x="170" y="190" width="60" height="16" rx="3" fill="#f5efe6" />
      </svg>
    </div>
  );
}
