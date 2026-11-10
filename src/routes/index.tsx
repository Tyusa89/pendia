import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, FileText, Users } from "lucide-react";
import { TryPendiaDemo } from "@/components/TryPendiaDemo";
import { SiteLayout } from "@/components/site/SiteLayout";
import { btn, Eyebrow, H2, PhotoSlot, focusRing } from "@/components/site/parts";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Keep your family connected around appointments, important updates, documents, and everyday caregiving responsibilities, all in one place.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pendia — Family caregiving, coordinated" },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Pendia — Family caregiving, coordinated" },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: Landing,
});

const QUICK = [
  {
    icon: CalendarDays,
    tint: "bg-[#e4ecf2] text-pd-slate",
    title: "Appointments & Follow-Ups",
    body: "Upcoming visits and what needs to happen after each one.",
  },
  {
    icon: FileText,
    tint: "bg-[#ece8f3] text-pd-purple-deep",
    title: "Documents & Care Information",
    body: "Visit summaries and care details, kept where your family can find them.",
  },
  {
    icon: Users,
    tint: "bg-[#e3ece5] text-pd-sage-deep",
    title: "Family Coordination",
    body: "Who is in your family group and who is handling what this week.",
  },
] as const;

const FEATURES = [
  {
    bar: "border-pd-dusty",
    title: "Keep Appointments Organized",
    body: "See upcoming visits and follow-ups in one shared view, so nobody has to ask who is driving on Thursday.",
  },
  {
    bar: "border-pd-purple",
    title: "Share Important Documents",
    body: "Keep visit summaries and care information in one place for the family members you choose.",
  },
  {
    bar: "border-pd-sage",
    title: "Coordinate as a Family",
    body: "Split up responsibilities and see at a glance what is covered and what still needs someone.",
  },
  {
    bar: "border-pd-navy",
    title: "Stay Informed",
    body: "Open Pendia to see what changed since you last looked, whether you live down the street or across the country.",
  },
] as const;

const STEPS = [
  {
    title: "Create Your Family",
    body: "Set up a family group and invite the people who share in the caregiving.",
  },
  {
    title: "Organize Care",
    body: "Add appointments, follow-ups, and the documents everyone keeps asking for.",
  },
  {
    title: "Stay Connected",
    body: "Everyone sees the same picture, so plans hold together between phone calls.",
  },
] as const;

const wrap = "mx-auto max-w-[1200px] px-5 md:px-12 lg:px-8";

function Landing() {
  return (
    <SiteLayout>
      <section aria-labelledby="hero-title" className="flex flex-col lg:flex-row">
        <PhotoSlot className="min-h-[240px] md:min-h-[320px] lg:min-h-[420px] lg:flex-1" />
        <div className="flex flex-col justify-center gap-6 bg-pd-slate px-5 py-12 text-white md:px-12 md:py-16 lg:flex-1 lg:px-[72px] lg:py-[88px]">
          <div className="text-sm font-semibold uppercase tracking-[0.08em] text-pd-lilac">
            Family caregiver coordination
          </div>
          <h1
            id="hero-title"
            className="max-w-[13em] font-brand text-[34px] font-extrabold leading-[1.08] tracking-[-0.02em] md:text-[44px] lg:text-[54px]"
          >
            Coordinate Care for the People You Love.
          </h1>
          <p className="max-w-[30em] text-lg text-pd-mist md:text-[19px]">
            Keep your family connected around appointments, important updates, documents, and
            everyday caregiving responsibilities—all in one place.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link to="/auth" search={{ mode: "up" }} className={btn.onDark}>
              Get Started
            </Link>
            <Link to="/demo" className={btn.onDarkOutline}>
              Explore Demo
            </Link>
          </div>
          <p className="text-sm text-[#d5dee8]">The demo uses sample data only.</p>
        </div>
      </section>

      <section aria-labelledby="quick-title" className="bg-pd-beige py-14 md:py-[72px]">
        <div className={cn(wrap, "flex flex-col gap-8")}>
          <h2
            id="quick-title"
            className="font-brand text-2xl font-bold tracking-tight text-pd-navy md:text-[30px]"
          >
            Pick up where your family left off
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {QUICK.map(({ icon: Icon, tint, title, body }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-[#e7dfd2] bg-white p-7 shadow-[0_1px_2px_rgba(31,45,74,0.06)]"
              >
                <span className={cn("flex size-12 items-center justify-center rounded-xl", tint)}>
                  <Icon aria-hidden className="size-6" strokeWidth={1.8} />
                </span>
                <h3 className="mt-1 font-sans text-xl font-bold">{title}</h3>
                <p className="text-pd-muted">{body}</p>
                <Link
                  to="/auth"
                  className={cn(
                    "mt-auto flex min-h-11 items-end pt-3 font-semibold text-pd-sage-deep underline-offset-4 hover:underline",
                    focusRing,
                  )}
                >
                  Sign in to view
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="features"
        aria-labelledby="features-title"
        className="scroll-mt-4 py-16 md:py-[88px]"
      >
        <div className={cn(wrap, "flex flex-col gap-10")}>
          <div className="flex max-w-[640px] flex-col gap-3">
            <Eyebrow>Features</Eyebrow>
            <H2 id="features-title">Less back-and-forth. More time with them.</H2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className={cn("flex flex-col gap-2.5 border-t-[3px] pt-5", f.bar)}>
                <h3 className="font-sans text-xl font-bold">{f.title}</h3>
                <p className="text-pd-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-title"
        className="scroll-mt-4 bg-pd-sky py-16 md:py-[88px]"
      >
        <div className={cn(wrap, "flex flex-col gap-10")}>
          <div className="flex max-w-[640px] flex-col gap-3">
            <Eyebrow>For families</Eyebrow>
            <H2 id="how-title">How Pendia Works</H2>
          </div>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-3 rounded-2xl bg-white p-8">
                <span
                  aria-hidden="true"
                  className="font-brand text-[40px] font-extrabold leading-none text-pd-sage"
                >
                  {i + 1}
                </span>
                <h3 className="font-sans text-[22px] font-bold">{s.title}</h3>
                <p className="text-pd-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="about" aria-labelledby="about-title" className="py-16 md:py-[88px]">
        <div className={cn(wrap, "flex flex-wrap items-start gap-x-16 gap-y-6")}>
          <div className="flex flex-[1_1_320px] flex-col gap-3">
            <Eyebrow>About</Eyebrow>
            <H2 id="about-title">Built for families, not for hospitals.</H2>
          </div>
          <div className="flex flex-[1.4_1_380px] flex-col gap-4 text-lg text-pd-ink">
            <p>
              Pendia is a coordination tool for the relatives and friends who look after someone
              together. It keeps the practical side of caregiving in one shared place.
            </p>
            <p>
              Pendia is not a healthcare provider and does not give medical advice. Your care team
              stays your care team; Pendia helps your family stay on the same page.
            </p>
            <p>
              <Link
                to="/about"
                className={cn(
                  "inline-flex min-h-11 items-center font-bold text-pd-slate underline underline-offset-4",
                  focusRing,
                )}
              >
                More about Pendia
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="px-4 pb-16 md:px-8 md:pb-[88px]">
        <div className="mx-auto flex max-w-[1136px] flex-wrap items-center gap-x-12 gap-y-6 rounded-3xl bg-pd-slate p-7 text-white md:p-12 lg:p-16">
          <div className="flex flex-[1_1_320px] flex-col gap-2">
            <h2
              id="cta-title"
              className="font-brand text-[26px] font-bold leading-tight tracking-tight md:text-[32px]"
            >
              Bring your family together around care.
            </h2>
            <p className="text-lg text-pd-mist">
              Create your family group and invite the first person.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3">
            <Link to="/auth" search={{ mode: "up" }} className={btn.onDark}>
              Get Started
            </Link>
            <TryPendiaDemo
              variant="link"
              className="h-auto min-h-11 px-0 text-white underline underline-offset-4 hover:bg-transparent hover:text-white"
            />
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
