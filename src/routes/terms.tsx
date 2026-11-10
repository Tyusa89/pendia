import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalDoc, Open, type LegalSection } from "@/components/site/LegalDoc";
import { SiteLayout } from "@/components/site/SiteLayout";
import { MEDICAL_DISCLAIMER } from "@/lib/site";

const DESCRIPTION = "Draft Terms & Conditions for Pendia. Pending legal review; not in effect.";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions (draft) — Pendia" },
      { name: "description", content: DESCRIPTION },
      // A draft is not an approved policy: keep it out of search indexes until legal review is complete.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Terms,
});

const SECTIONS: LegalSection[] = [
  {
    id: "t1",
    nav: "1. Acceptance of terms",
    title: "1. Acceptance of Terms",
    body: (
      <>
        <p>
          These Terms &amp; Conditions govern your use of Pendia, a family caregiving coordination
          service provided by EcoNest Systems LLC ("EcoNest," "we," or "us"). By creating an account
          or using Pendia, you agree to these Terms. If you do not agree, please do not use Pendia.
        </p>
      </>
    ),
  },
  {
    id: "t2",
    nav: "2. Eligibility and accounts",
    title: "2. Eligibility and Account Responsibilities",
    body: (
      <>
        <p>
          You must be <Open>[MINIMUM AGE — TO BE DETERMINED]</Open> or older to create an account.
          You are responsible for the accuracy of the information you provide, for keeping your
          sign-in details private, and for activity that happens under your account.
        </p>
      </>
    ),
  },
  {
    id: "t3",
    nav: "3. Family roles",
    title: "3. Family Organizer and Invited-Member Roles",
    body: (
      <>
        <p>
          Each family group has a family organizer, who creates the group and invites members.
          Invited members can view and add information within the family group. The organizer is
          responsible for inviting only people who should have access to the family"s information.
        </p>
        <p>
          <Open>[WHAT EACH ROLE CAN SEE AND CHANGE — TO BE CONFIRMED AGAINST THE PRODUCT]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t4",
    nav: "4. Permitted and prohibited use",
    title: "4. Permitted and Prohibited Use",
    body: (
      <>
        <p>
          Pendia is for personal, non-commercial use by families coordinating care. You agree not
          to:
        </p>
        <ul>
          <li>use Pendia for anything unlawful;</li>
          <li>access a family group you have not been invited to;</li>
          <li>add information you do not have the right to share;</li>
          <li>interfere with Pendia or try to get around its security or access controls;</li>
          <li>copy, resell, or collect data from Pendia by automated means.</li>
        </ul>
      </>
    ),
  },
  {
    id: "t5",
    nav: "5. User-provided content",
    title: "5. User-Provided Content",
    body: (
      <>
        <p>
          You keep ownership of the content you add to Pendia. You give EcoNest permission to store,
          process, and display that content as needed to run Pendia for you and your family group.
          You are responsible for having the right to share what you add, including information
          about the person receiving care.
        </p>
        <p>
          <Open>[SCOPE OF THIS PERMISSION — PENDING LEGAL REVIEW]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t6",
    nav: "6. Pricing and billing",
    title: "6. Subscription Pricing and Billing",
    body: (
      <>
        <p>
          <strong>Pendia Free</strong> costs $0 and includes one care team, appointments and
          handoffs, the medication list and dose reporting, and unlimited invited family members.
        </p>
        <p>
          <strong>Pendia Plus</strong> costs $15 per month per family, or $149 per year. Pricing is
          per family, never per member.
        </p>
        <p>
          Billing is not active.{" "}
          <Open>
            [BILLING, RENEWAL, TAX, AND PAYMENT TERMS — TO BE ADDED BEFORE BILLING LAUNCHES]
          </Open>{" "}
          <Open>[REFUND POLICY — TO BE DECIDED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t7",
    nav: "7. Free trials and cancellation",
    title: "7. Free Trials and Cancellation",
    body: (
      <>
        <p>
          Pendia Plus includes a 30-day trial that does not require a credit card. When the trial
          ends, your family keeps the Free tier unless you choose to subscribe. You are not billed
          automatically at the end of a trial.
        </p>
        <p>
          <Open>[HOW TO CANCEL AND WHAT HAPPENS AFTERWARD — TO BE DECIDED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t8",
    nav: "8. Founding Family terms",
    title: "8. Founding Family Promotional Terms",
    body: (
      <>
        <p>
          Eligible founding families, meaning waitlist participants and Family Care Binder buyers,
          may subscribe to the full Pendia Plus plan for $10 per month for life. Family Care Binder
          buyers also receive three months of Plus free. The offer will be made available to
          eligible families when enrollment opens.
        </p>
        <p>
          <Open>
            [MEANING OF "FOR LIFE," TRANSFERABILITY, AND EFFECT OF CANCELLATION — TO BE DECIDED]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "t9",
    nav: "9. Intellectual property",
    title: "9. Intellectual Property",
    body: (
      <>
        <p>
          Pendia, including its software, design, and name, belongs to EcoNest Systems LLC. These
          Terms give you a limited, personal right to use Pendia. They do not transfer ownership of
          any part of it.
        </p>
      </>
    ),
  },
  {
    id: "t10",
    nav: "10. Service availability",
    title: "10. Service Availability",
    body: (
      <>
        <p>
          We work to keep Pendia available, but we do not promise that it will be uninterrupted or
          free of errors. Pendia may be unavailable during maintenance or for reasons outside our
          control.
        </p>
        <p>
          <Open>[NO SERVICE-LEVEL COMMITMENT HAS BEEN DEFINED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t11",
    nav: "11. Medical disclaimer",
    title: "11. Medical Information Disclaimer",
    body: (
      <>
        <p>{MEDICAL_DISCLAIMER}</p>
        <p>
          <Open>[SUGGESTED WORDING — NOT YET LEGALLY APPROVED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t12",
    nav: "12. Limitation of liability",
    title: "12. Limitation of Liability",
    body: (
      <>
        <p>
          <Open>
            [TO BE DRAFTED BY LEGAL COUNSEL. No liability limits, warranty disclaimers, governing
            law, or dispute-resolution terms have been written.]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "t13",
    nav: "13. Changes to the service",
    title: "13. Changes to the Service",
    body: (
      <>
        <p>
          We may add, change, or remove features, and we may update these Terms from time to time.
        </p>
        <p>
          <Open>[HOW AND WHEN YOU WILL BE TOLD ABOUT CHANGES — TO BE DECIDED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "t14",
    nav: "14. Contact information",
    title: "14. Contact Information",
    body: (
      <>
        <p>
          Questions about these Terms can be sent through the{" "}
          <Link to="/contact">Contact page</Link>. Pendia is a product of EcoNest Systems LLC.
        </p>
        <p>
          <Open>[ADDRESS FOR LEGAL NOTICES — TO BE PROVIDED]</Open>
        </p>
      </>
    ),
  },
];

function Terms() {
  return (
    <SiteLayout>
      <LegalDoc
        titleId="terms-h1"
        title="Terms &amp; Conditions"
        label="Terms and Conditions"
        status="DRAFT — Pending Legal Review."
        statusNote="This document has not been approved and is not in effect. Highlighted items in brackets are unresolved."
        sections={SECTIONS}
      />
    </SiteLayout>
  );
}
