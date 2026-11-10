import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { btn, Eyebrow, H2, PhotoSlot, focusRing } from "@/components/site/parts";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Pendia helps families stay connected, organized, and informed while they coordinate care for someone they love.";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Pendia" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "About Pendia" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
  component: About,
});

const WHY = [
  [
    "border-pd-dusty",
    "Care is shared",
    "Looking after someone is rarely one person's job. It is often spread across siblings, spouses, children, and friends.",
  ],
  [
    "border-pd-purple",
    "Details get scattered",
    "Appointment times, paperwork, and medication information end up in different phones, folders, and memories.",
  ],
  [
    "border-pd-sage",
    "Everyone needs the same picture",
    "When the people helping can all see what is planned and what has changed, there is less to chase down and repeat.",
  ],
] as const;
const HELPS = [
  [
    "Appointments and handoffs",
    "Keep upcoming visits and the notes passed from one caregiver to the next in one shared place.",
  ],
  [
    "Medication list and dose reporting",
    "Keep a shared medication list, and let the family see which doses have been reported as given.",
  ],
  [
    "Documents and care information",
    "Keep the paperwork a family keeps asking each other for where the family group can find it.",
  ],
  [
    "One group for the whole family",
    "Invite everyone who helps. Pricing is per family, never per member.",
  ],
] as const;

const sec = "px-5 py-[52px] md:px-12 md:py-[72px] lg:px-8 lg:py-[88px]";
const inner = "mx-auto max-w-[1000px]";

function About() {
  return (
    <SiteLayout>
      <section aria-labelledby="about-h1" className={cn("bg-pd-beige", sec)}>
        <div className={cn(inner, "flex flex-col gap-4")}>
          <Eyebrow>About Pendia</Eyebrow>
          <h1
            id="about-h1"
            className="max-w-[17em] font-brand text-[31px] font-extrabold leading-[1.12] tracking-[-0.02em] md:text-[40px] lg:text-[50px]"
          >
            Because Caring for Someone Shouldn't Mean Doing It Alone.
          </h1>
          <p className="max-w-[34em] text-[19px] text-pd-ink">
            Pendia helps families stay connected, organized, and informed while they coordinate care
            for someone they love.
          </p>
        </div>
      </section>

      <section aria-labelledby="story-h2" className={sec}>
        <div className={cn(inner, "flex flex-wrap items-center gap-x-14 gap-y-8")}>
          <div className="flex flex-[1.3_1_320px] flex-col gap-4">
            <H2 id="story-h2">Our Story</H2>
            <p className="text-pd-ink">
              Pendia began with a family. Several relatives were helping care for a loved one, and
              each of them held part of the picture: the appointments, the paperwork, the medication
              information, the updates after each visit.
            </p>
            <p className="text-pd-ink">
              Keeping everyone current took phone calls, text threads, and a lot of repeating.
              Pendia was created so that what a family needs to share has one place to live.
            </p>
          </div>
          <PhotoSlot variant="family" className="min-h-[240px] flex-[1_1_280px] rounded-[20px]" />
        </div>
      </section>

      <section aria-labelledby="mission-h2" className={cn("bg-pd-slate text-white", sec)}>
        <div className={cn(inner, "flex flex-col gap-4")}>
          <h2
            id="mission-h2"
            className="text-sm font-bold uppercase tracking-[0.08em] text-pd-lilac"
          >
            Our Mission
          </h2>
          <p className="max-w-[22em] font-brand text-[27px] font-bold leading-tight tracking-tight md:text-[32px] lg:text-4xl">
            To help families stay connected, organized, and informed while coordinating care.
          </p>
        </div>
      </section>

      <section aria-labelledby="why-h2" className={sec}>
        <div className={cn(inner, "flex flex-col gap-8")}>
          <H2 id="why-h2">Why Family Coordination Matters</H2>
          <div className="grid gap-7 md:grid-cols-3">
            {WHY.map(([bar, t, b]) => (
              <div key={t} className={cn("flex flex-col gap-2 border-t-[3px] pt-[18px]", bar)}>
                <h3 className="font-sans text-xl font-bold">{t}</h3>
                <p className="text-pd-muted">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="helps-h2" className={cn("bg-pd-sky", sec)}>
        <div className={cn(inner, "flex flex-col gap-8")}>
          <H2 id="helps-h2">How Pendia Helps</H2>
          <div className="grid gap-5 md:grid-cols-2">
            {HELPS.map(([t, b]) => (
              <div key={t} className="flex flex-col gap-2 rounded-2xl bg-white p-[26px]">
                <h3 className="font-sans text-xl font-bold">{t}</h3>
                <p className="text-pd-muted">{b}</p>
              </div>
            ))}
          </div>
          <p>
            <Link
              to="/pricing"
              className={cn(
                "inline-flex min-h-11 items-center font-bold text-pd-slate underline underline-offset-4",
                focusRing,
              )}
            >
              See pricing
            </Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="trust-h2" className={sec}>
        <div className={cn(inner, "flex flex-col gap-8")}>
          <H2 id="trust-h2">Our Commitment to Trust</H2>
          <div className="grid gap-7 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <h3 className="font-sans text-xl font-bold">Clear about what Pendia is</h3>
              <p className="text-pd-muted">
                Pendia is a coordination tool for families. It is not a healthcare provider and does
                not give medical advice.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-sans text-xl font-bold">Your family decides who is in</h3>
              <p className="text-pd-muted">
                A family organizer creates the family group and invites the people who should be
                part of it.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-sans text-xl font-bold">Plain about our policies</h3>
              <p className="text-pd-muted">
                Our{" "}
                <Link to="/terms" className="font-semibold underline underline-offset-4">
                  Terms &amp; Conditions
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="font-semibold underline underline-offset-4">
                  Privacy Policy
                </Link>{" "}
                are written to be read, and we will not claim more than we can stand behind.
              </p>
            </div>
          </div>
          <p className="border-t border-pd-line pt-6 text-pd-ink">
            Pendia is a product of EcoNest Systems LLC.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="about-cta"
        className="px-4 pb-[52px] md:px-8 md:pb-[72px] lg:pb-[88px]"
      >
        <div className="mx-auto flex max-w-[1136px] flex-wrap items-center gap-x-12 gap-y-5 rounded-3xl bg-pd-slate p-6 text-white md:p-10 lg:px-16 lg:py-14">
          <div className="flex flex-[1_1_280px] flex-col gap-2">
            <h2
              id="about-cta"
              className="font-brand text-[28px] font-bold leading-tight tracking-tight"
            >
              Bring your family together around care.
            </h2>
            <p className="text-pd-mist">Start coordinating care for free.</p>
          </div>
          <Link to="/auth" search={{ mode: "up" }} className={btn.onDark}>
            Get Started
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
