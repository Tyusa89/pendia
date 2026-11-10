import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FOOTER_GROUPS, GET_STARTED, PRIMARY_NAV, SIGN_IN, type SiteLink } from "@/lib/site";
import { cn } from "@/lib/utils";
import { btn, focusRing, SiteAnchor, Wordmark } from "./parts";

function isCurrent(link: SiteLink, pathname: string) {
  if (link.to === "/auth") return false;
  if ("hash" in link && link.hash) return false;
  return link.to === pathname;
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Close the drawer if the window grows into the desktop layout, where the drawer is not used.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <header className="border-b border-pd-line bg-white text-pd-navy">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-1.5 md:px-8 md:py-3 lg:gap-8">
        <Wordmark />
        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((link) => {
            const current = isCurrent(link, pathname);
            return (
              <SiteAnchor
                key={link.label}
                link={link}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-lg border-b-[3px] px-3.5 no-underline",
                  current
                    ? "border-pd-purple font-bold"
                    : "border-transparent font-medium hover:bg-pd-sky",
                  focusRing,
                )}
              />
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex lg:ml-0">
          <SiteAnchor link={SIGN_IN} className={btn.outline} />
          <SiteAnchor link={GET_STARTED} className={btn.primary} />
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className={cn(
              "ml-auto flex size-12 items-center justify-center rounded-[10px] text-pd-navy hover:bg-pd-sky md:ml-0 lg:hidden",
              focusRing,
            )}
          >
            <Menu aria-hidden className="size-[26px]" />
          </SheetTrigger>
          <SheetContent
            side="right"
            className="flex w-[min(20rem,88vw)] flex-col gap-0 bg-white p-0 text-pd-navy sm:max-w-sm"
          >
            <div className="border-b border-pd-line px-5 py-4">
              <SheetTitle className="font-brand text-xl font-extrabold text-pd-navy">
                Pendia
              </SheetTitle>
              <SheetDescription className="sr-only">Site navigation</SheetDescription>
            </div>
            <nav aria-label="Menu" className="flex flex-col gap-1 p-3">
              {PRIMARY_NAV.map((link) => {
                const current = isCurrent(link, pathname);
                return (
                  <SiteAnchor
                    key={link.label}
                    link={link}
                    onClick={close}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center rounded-[10px] px-3 text-lg no-underline hover:bg-pd-sky",
                      current ? "bg-pd-sky font-bold" : "font-medium",
                      focusRing,
                    )}
                  />
                );
              })}
            </nav>
            <div className="mt-auto flex flex-col gap-3 border-t border-pd-line p-5 md:hidden">
              <SiteAnchor link={SIGN_IN} onClick={close} className={cn(btn.outline, "w-full")} />
              <SiteAnchor
                link={GET_STARTED}
                onClick={close}
                className={cn(btn.primary, "w-full")}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-pd-navy text-[#d5dee8]">
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-16 gap-y-9 px-5 pb-8 pt-10 md:px-12 md:pt-12 lg:px-8 lg:pb-10 lg:pt-14">
        <div className="flex basis-[300px] flex-[2_1_300px] flex-col gap-3">
          <span className="font-brand text-[22px] font-extrabold text-white">Pendia</span>
          <p className="max-w-[30em] text-[15px]">
            A family caregiver coordination platform. Not a healthcare provider.
          </p>
          <p className="max-w-[36em] text-sm">
            Pendia is a family caregiving coordination tool. It does not provide medical advice,
            diagnosis, treatment, or emergency services. Always consult qualified healthcare
            professionals regarding medical decisions.
          </p>
          <p className="text-sm">
            © 2026 EcoNest Systems LLC. Pendia is a product of EcoNest Systems LLC.
          </p>
        </div>
        {FOOTER_GROUPS.map((group) => (
          <nav
            key={group.title}
            aria-label={group.title}
            className="flex basis-[140px] flex-[1_1_140px] flex-col"
          >
            <div className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-white">
              {group.title}
            </div>
            {group.links.map((link) => (
              <SiteAnchor
                key={link.label}
                link={link}
                className={cn(
                  "flex min-h-11 items-center text-base text-pd-mist hover:text-white hover:underline",
                  focusRing,
                )}
              />
            ))}
          </nav>
        ))}
      </div>
    </footer>
  );
}

/** Header + skip link + <main id="main"> + footer for every public marketing and legal page. */
export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-[17px] leading-[1.55] text-pd-navy">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-pd-navy px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
