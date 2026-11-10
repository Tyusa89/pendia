import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./parts";

/** An unresolved item inside a draft legal document. Always highlighted so it cannot be mistaken for final text. */
export function Open({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-[#fdf0b8] px-1 font-semibold text-pd-navy">{children}</mark>;
}

export type LegalSection = { id: string; nav: string; title: string; body: ReactNode };

export function LegalDoc({
  titleId,
  title,
  status,
  statusNote,
  intro,
  sections,
  label,
}: {
  titleId: string;
  title: string;
  status: string;
  statusNote: string;
  intro?: ReactNode;
  sections: LegalSection[];
  label: string;
}) {
  return (
    <>
      <section
        aria-labelledby={titleId}
        className="bg-pd-beige px-5 py-12 md:px-12 md:py-[72px] lg:px-8"
      >
        <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
          <div className="text-sm font-bold uppercase tracking-[0.08em] text-pd-purple-deep">
            Legal
          </div>
          <h1
            id={titleId}
            className="font-brand text-[31px] font-extrabold leading-[1.12] tracking-[-0.02em] md:text-[40px] lg:text-5xl"
          >
            {title}
          </h1>
          <div
            role="note"
            className="rounded-xl border-2 border-[#d9b84a] bg-[#fff8dc] p-4 text-pd-navy"
          >
            <strong>{status}</strong> {statusNote}
          </div>
          {intro}
          <p>
            Effective date: <Open>[TO BE SET ON APPROVAL]</Open>
          </p>
        </div>
      </section>
      <section aria-label={label} className="px-5 py-10 md:px-12 md:py-14 lg:px-8">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-10 lg:flex-row lg:items-start">
          <nav
            aria-label="Sections of this document"
            className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0"
          >
            <div className="mb-2 text-sm font-bold uppercase tracking-[0.08em] text-pd-purple-deep">
              On this page
            </div>
            <div className="flex flex-col">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={cn(
                    "flex min-h-11 items-center py-1 text-pd-slate hover:underline",
                    focusRing,
                  )}
                >
                  {s.nav}
                </a>
              ))}
            </div>
          </nav>
          <article className="flex min-w-0 max-w-[44rem] flex-1 flex-col gap-9 text-[17px] leading-[1.7] text-pd-ink [&_a]:font-semibold [&_a]:text-pd-slate [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="flex scroll-mt-6 flex-col gap-3">
                <h2 className="font-brand text-2xl font-bold leading-snug text-pd-navy">
                  {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </section>
    </>
  );
}
