import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { btn, Eyebrow } from "@/components/site/parts";
import { cn } from "@/lib/utils";

const DESCRIPTION = "Questions about Pendia? Choose a topic and send us a note.";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — Pendia" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Contact Us — Pendia" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Contact,
});

const CATEGORIES = [
  ["general", "General inquiries", "Questions about Pendia and how it works."],
  ["support", "Technical support", "Help with signing in or using Pendia."],
  ["billing", "Billing questions", "Questions about plans and pricing."],
  [
    "privacy",
    "Privacy-related inquiries",
    "Questions about your information, and privacy requests.",
  ],
  [
    "business",
    "Partnership or business inquiries",
    "For organizations interested in working with Pendia.",
  ],
] as const;

type Errors = { name?: string; email?: string; category?: string; message?: string };

const field =
  "min-h-12 w-full rounded-[10px] border-[1.5px] border-pd-dusty bg-white px-3.5 text-base text-pd-navy focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-pd-purple aria-[invalid=true]:border-[#a8321f]";
const err = "text-sm font-semibold text-[#a8321f]";

function Contact() {
  const [v, setV] = useState({ name: "", email: "", category: "", message: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [checked, setChecked] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!v.name.trim()) next.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
      next.email = "Enter an email address in the format name@example.com.";
    if (!v.category) next.category = "Choose a category.";
    if (!v.message.trim()) next.message = "Enter a message.";
    setErrors(next);
    setChecked(Object.keys(next).length === 0);
    // Deliberately no network call: there is no approved contact endpoint yet, so nothing is sent or stored.
  }

  const set =
    (k: keyof typeof v) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setV((s) => ({ ...s, [k]: e.target.value }));
      setChecked(false);
    };
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <SiteLayout>
      <section
        aria-labelledby="contact-h1"
        className="bg-pd-beige px-5 py-12 md:px-12 md:py-[72px] lg:px-8"
      >
        <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
          <Eyebrow>Contact Us</Eyebrow>
          <h1
            id="contact-h1"
            className="max-w-[17em] font-brand text-[31px] font-extrabold leading-[1.12] tracking-[-0.02em] md:text-[40px] lg:text-5xl"
          >
            We're Here to Help You Stay Connected.
          </h1>
          <p className="max-w-[34em] text-[19px] text-pd-ink">
            Have a question about Pendia? Choose a topic and send us a note.
          </p>
        </div>
      </section>

      <section aria-label="Contact form" className="px-5 py-10 md:px-12 md:py-14 lg:px-8">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-8">
          <div role="note" className="rounded-xl border-2 border-[#d9b84a] bg-[#fff8dc] p-4">
            <strong>Contact form not connected yet.</strong> Messages sent from this page are not
            delivered or stored. Please check back soon.
          </div>
          <div className="flex flex-col gap-10 lg:flex-row">
            <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
              <h2 className="font-brand text-2xl font-bold">What can we help with?</h2>
              <ul className="flex flex-col gap-4">
                {CATEGORIES.map(([id, label, desc]) => (
                  <li key={id} className="flex flex-col">
                    <span className="font-bold">{label}</span>
                    <span className="text-pd-muted">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <form
              onSubmit={submit}
              noValidate
              aria-labelledby="form-title"
              className="flex min-w-0 flex-1 flex-col gap-5 rounded-2xl border border-[#e7dfd2] bg-white p-6 shadow-[0_1px_2px_rgba(31,45,74,0.06)] md:p-8"
            >
              <div>
                <h2 id="form-title" className="font-brand text-2xl font-bold">
                  Send us a message
                </h2>
                <p className="text-pd-muted">All fields are required.</p>
              </div>
              {hasErrors && (
                <div
                  role="alert"
                  className="rounded-lg bg-[#fbeae6] p-3 font-semibold text-[#7a2314]"
                >
                  Please fix the fields marked below, then send again.
                </div>
              )}
              {checked && (
                <div
                  role="status"
                  className="rounded-lg bg-[#e3ece5] p-3 font-semibold text-pd-sage-deep"
                >
                  Your details look complete, but this form is not connected yet, so your message
                  was not sent.
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="c-name" className="font-semibold">
                  Name
                </label>
                <input
                  id="c-name"
                  type="text"
                  autoComplete="name"
                  required
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "c-name-err" : undefined}
                  value={v.name}
                  onChange={set("name")}
                  className={field}
                />
                {errors.name && (
                  <p id="c-name-err" className={err}>
                    Error: {errors.name}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="c-email" className="font-semibold">
                  Email address
                </label>
                <input
                  id="c-email"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "c-email-err" : undefined}
                  value={v.email}
                  onChange={set("email")}
                  className={field}
                />
                {errors.email && (
                  <p id="c-email-err" className={err}>
                    Error: {errors.email}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="c-category" className="font-semibold">
                  Inquiry category
                </label>
                <select
                  id="c-category"
                  required
                  aria-invalid={!!errors.category}
                  aria-describedby={errors.category ? "c-category-err" : undefined}
                  value={v.category}
                  onChange={set("category")}
                  className={field}
                >
                  <option value="">Choose a category</option>
                  {CATEGORIES.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                {errors.category && (
                  <p id="c-category-err" className={err}>
                    Error: {errors.category}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="c-message" className="font-semibold">
                  Message
                </label>
                <p id="c-message-hint" className="text-sm text-pd-muted">
                  Please do not include medical records, medication details, or other sensitive
                  health information.
                </p>
                <textarea
                  id="c-message"
                  rows={5}
                  required
                  aria-invalid={!!errors.message}
                  aria-describedby={
                    errors.message ? "c-message-hint c-message-err" : "c-message-hint"
                  }
                  value={v.message}
                  onChange={set("message")}
                  className={cn(field, "py-3")}
                />
                {errors.message && (
                  <p id="c-message-err" className={err}>
                    Error: {errors.message}
                  </p>
                )}
              </div>
              <button
                type="submit"
                className={cn(btn.primary, "w-full min-h-12 text-base sm:w-fit")}
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
