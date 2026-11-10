import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { btn, Eyebrow, H2, focusRing } from "@/components/site/parts";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Pendia is free for the whole family. Plus adds AI-assisted help with documents and visit planning, and is not available yet.";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Pendia" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Pricing — Pendia" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Pricing,
});

const FREE = [
  "One care team",
  "Appointments and handoffs",
  "Medication list and dose reporting",
  "Unlimited family members",
];
const PLUS = [
  "Everything in Free",
  "AI document extraction",
  "Ask Pendia",
  "Visit preparation",
  "Weekly digest",
  "Expanded document storage",
];
const ROWS: [string, boolean][] = [
  ["One care team", true],
  ["Appointments and handoffs", true],
  ["Medication list and dose reporting", true],
  ["Unlimited family members", true],
  ["AI document extraction", false],
  ["Ask Pendia", false],
  ["Visit preparation", false],
  ["Weekly digest", false],
  ["Expanded document storage", false],
];
const TRIAL = [
  ["30 days of Plus", "Your whole family gets every Plus feature for the length of the trial."],
  ["No card to start", "You will not be asked for a credit card to begin the trial."],
  [
    "Nothing automatic",
    "When the trial ends, your family keeps the Free coordination tier. Plus continues only if you choose to subscribe.",
  ],
] as const;
const FAQ = [
  [
    "Do we pay for each family member?",
    "No. Pricing is per family, never per member. Unlimited invited family members are included.",
  ],
  [
    "What stays free?",
    "One care team, appointments and handoffs, the medication list and dose reporting, and unlimited family members.",
  ],
  [
    "What does Plus cost?",
    "$15/month per family, or $149/year. Both plans include one care team and unlimited invited family members.",
  ],
  [
    "How does the Plus trial work?",
    "The trial lasts 30 days and does not require a credit card. When it ends, your family keeps the Free tier unless you choose to subscribe.",
  ],
  [
    "Who can get Founding Family pricing?",
    "Waitlist participants and Family Care Binder buyers get the full Plus plan for $10/month for life. Binder buyers also receive three months of Plus free.",
  ],
  [
    "Can we buy Plus today?",
    "Not yet. Plus and its trial are not open. You can start with Pendia Free now.",
  ],
] as const;

const wrap = "mx-auto max-w-[1200px] px-5 md:px-12 lg:px-8";

function Tick({ className }: { className?: string }) {
  return (
    <Check
      aria-hidden
      className={cn("mt-0.5 size-[22px] shrink-0 text-pd-sage-deep", className)}
      strokeWidth={2.4}
    />
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const toggle = (on: boolean) =>
    cn(
      "min-h-11 rounded-lg px-5 font-semibold",
      on ? "bg-pd-slate text-white" : "text-pd-navy hover:bg-pd-sky",
      focusRing,
    );
  return (
    <SiteLayout>
      <section aria-labelledby="pricing-title" className="bg-pd-beige py-14 md:py-[72px]">
        <div className={cn(wrap, "flex flex-col gap-10")}>
          <div className="flex max-w-[44rem] flex-col gap-4">
            <h1
              id="pricing-title"
              className="font-brand text-[31px] font-extrabold leading-[1.12] tracking-[-0.02em] md:text-[40px] lg:text-[50px]"
            >
              Care Together. One Price for the Whole Family.
            </h1>
            <p className="text-[19px] text-pd-ink">
              Start coordinating care for free. Upgrade when your family needs more.
            </p>
            <div
              role="group"
              aria-label="Billing period for Plus"
              className="mt-2 inline-flex w-fit gap-1 rounded-xl border border-pd-line bg-white p-1"
            >
              <button
                type="button"
                aria-pressed={!annual}
                onClick={() => setAnnual(false)}
                className={toggle(!annual)}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={annual}
                onClick={() => setAnnual(true)}
                className={toggle(annual)}
              >
                Annual
              </button>
            </div>
          </div>

          <div className="grid items-stretch gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-3xl border border-[#e7dfd2] bg-white p-7 shadow-[0_1px_2px_rgba(31,45,74,0.06)] md:p-9">
              <div className="flex flex-col gap-1">
                <h2 className="font-brand text-2xl font-bold">Pendia Free</h2>
                <p className="text-pd-muted">
                  The everyday coordination tools, free for your whole family.
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-brand text-5xl font-extrabold">$0</span>
                <span className="text-pd-muted">per family</span>
              </div>
              <ul className="flex flex-col gap-3">
                {FREE.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Tick />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                search={{ mode: "up" }}
                className={cn(btn.primary, "mt-auto w-full text-center")}
              >
                Get Started Free
              </Link>
            </div>

            <div className="flex flex-col gap-6 rounded-3xl border-2 border-pd-purple bg-white p-7 shadow-[0_1px_2px_rgba(31,45,74,0.06)] md:p-9">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-brand text-2xl font-bold">Pendia Plus</h2>
                  <span className="rounded-full bg-[#ece8f3] px-3 py-1 text-sm font-bold text-pd-purple-deep">
                    30-day trial
                  </span>
                </div>
                <p className="text-pd-muted">
                  Adds AI-assisted help with documents and visit planning, plus more storage.
                </p>
              </div>
              <div aria-live="polite" className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-brand text-5xl font-extrabold">
                    {annual ? "$149" : "$15"}
                  </span>
                  <span className="text-pd-muted">
                    {annual ? "/year per family" : "/month per family"}
                  </span>
                </div>
                <p className="text-sm text-pd-muted">
                  {annual
                    ? "About two months free compared with paying monthly."
                    : "Or $149/year when billed annually."}
                </p>
              </div>
              <ul className="flex flex-col gap-3">
                {PLUS.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Tick />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2">
                <button
                  type="button"
                  disabled
                  aria-describedby="plus-note"
                  className="min-h-12 w-full cursor-not-allowed rounded-[10px] bg-[#e3e1ea] px-5 font-bold text-pd-ink"
                >
                  Coming Soon
                </button>
                <p id="plus-note" className="text-sm text-pd-muted">
                  Plus is not available yet. There is nothing to sign up for or pay for today.
                </p>
              </div>
            </div>
          </div>
          <p className="text-pd-ink">
            Pricing is per family, never per member. Unlimited invited family members are included.
          </p>
        </div>
      </section>

      <section
        id="founding"
        aria-labelledby="founding-title"
        className="scroll-mt-4 py-14 md:py-[88px]"
      >
        <div className={wrap}>
          <div className="flex flex-col gap-8 rounded-3xl bg-[#ece8f3] p-7 md:flex-row md:p-12">
            <div className="flex flex-1 flex-col gap-3">
              <Eyebrow>Founding Family</Eyebrow>
              <H2 id="founding-title">$10/month for life</H2>
              <p className="text-lg text-pd-ink">
                The full Pendia Plus plan at a founding price, as a thank-you to the families who
                were here first.
              </p>
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              <li className="flex gap-3">
                <Tick className="text-[#4e4070]" />
                For the eligible founding cohort: waitlist participants and Family Care Binder
                buyers.
              </li>
              <li className="flex gap-3">
                <Tick className="text-[#4e4070]" />
                Family Care Binder buyers also receive three months of Plus free.
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="size-[22px] shrink-0" />
                Enrollment is not open yet. This offer will be made available to eligible families
                when enrollment opens.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="compare-title" className="bg-pd-sky py-14 md:py-[88px]">
        <div className={cn(wrap, "flex flex-col gap-8")}>
          <div className="flex flex-col gap-3">
            <Eyebrow>Compare plans</Eyebrow>
            <H2 id="compare-title">What is included</H2>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[20rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-pd-line">
                  <th scope="col" className="p-4 font-bold">
                    Feature
                  </th>
                  <th scope="col" className="w-24 p-4 text-center font-bold">
                    Free
                  </th>
                  <th scope="col" className="w-24 p-4 text-center font-bold">
                    Plus
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, free]) => (
                  <tr key={label} className="border-b border-pd-line last:border-0">
                    <th scope="row" className="p-4 font-medium">
                      {label}
                    </th>
                    <td className="p-4 text-center">
                      {free ? (
                        <Check
                          role="img"
                          aria-label="Included"
                          className="mx-auto size-[22px] text-pd-sage-deep"
                          strokeWidth={2.4}
                        />
                      ) : (
                        <span role="img" aria-label="Not included" className="text-pd-muted">
                          —
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <Check
                        role="img"
                        aria-label="Included"
                        className="mx-auto size-[22px] text-pd-sage-deep"
                        strokeWidth={2.4}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-pd-muted">Plus features are not available yet.</p>
        </div>
      </section>

      <section aria-labelledby="trial-title" className="py-14 md:py-[88px]">
        <div className={cn(wrap, "flex flex-col gap-8")}>
          <div className="flex flex-col gap-3">
            <Eyebrow>Plus trial</Eyebrow>
            <H2 id="trial-title">Try Plus for 30 days. No credit card required.</H2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {TRIAL.map(([t, b], i) => (
              <div
                key={t}
                className={cn(
                  "flex flex-col gap-2 border-t-[3px] pt-5",
                  ["border-pd-dusty", "border-pd-purple", "border-pd-sage"][i],
                )}
              >
                <h3 className="font-sans text-xl font-bold">{t}</h3>
                <p className="text-pd-muted">{b}</p>
              </div>
            ))}
          </div>
          <p className="font-semibold text-pd-ink">
            The trial is not open yet. It will be available when Plus is.
          </p>
        </div>
      </section>

      <section
        id="faq"
        aria-labelledby="faq-title"
        className="scroll-mt-4 bg-pd-beige py-14 md:py-[88px]"
      >
        <div className={cn(wrap, "flex flex-col gap-8")}>
          <H2 id="faq-title">Questions families ask</H2>
          <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <div key={q} className="flex flex-col gap-2">
                <h3 className="font-sans text-xl font-bold">{q}</h3>
                <p className="text-pd-ink">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="px-4 py-14 md:px-8 md:py-[88px]">
        <div className="mx-auto flex max-w-[1136px] flex-wrap items-center gap-x-12 gap-y-6 rounded-3xl bg-pd-slate p-7 text-white md:p-12 lg:p-16">
          <div className="flex flex-[1_1_320px] flex-col gap-2">
            <h2
              id="cta-title"
              className="font-brand text-[26px] font-bold leading-tight tracking-tight md:text-[32px]"
            >
              Start coordinating care for free.
            </h2>
            <p className="text-lg text-pd-mist">One price for the whole family, starting at $0.</p>
          </div>
          <Link to="/auth" search={{ mode: "up" }} className={btn.onDark}>
            Get Started Free
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
