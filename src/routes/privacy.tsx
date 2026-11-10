import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalDoc, Open, type LegalSection } from "@/components/site/LegalDoc";
import { SiteLayout } from "@/components/site/SiteLayout";
import { MEDICAL_DISCLAIMER } from "@/lib/site";

const DESCRIPTION =
  "Draft Privacy Policy for Pendia. Pending privacy and legal review; not in effect.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy (draft) — Pendia" },
      { name: "description", content: DESCRIPTION },
      // A draft is not an approved policy: keep it out of search indexes until legal review is complete.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Privacy,
});

const SECTIONS: LegalSection[] = [
  {
    id: "p1",
    nav: "1. Information we may collect",
    title: "1. Information Pendia May Collect",
    body: (
      <>
        <ul>
          <li>
            <strong>Account information:</strong> your name, email address, and sign-in details.
          </li>
          <li>
            <strong>Family group information:</strong> the family group you create or join, and the
            members invited to it.
          </li>
          <li>
            <strong>Care coordination information you add:</strong> appointments and visits, handoff
            notes, medication lists, and dose reports.
          </li>
          <li>
            <strong>Documents and recordings you choose to upload.</strong>
          </li>
        </ul>
        <p>
          <Open>[DEVICE, LOG, AND USAGE DATA — TO BE VERIFIED AGAINST THE IMPLEMENTATION]</Open>
        </p>
      </>
    ),
  },
  {
    id: "p2",
    nav: "2. How information may be used",
    title: "2. How Information May Be Used",
    body: (
      <>
        <ul>
          <li>to provide Pendia to you and your family group;</li>
          <li>to show shared information to the members of your family group;</li>
          <li>to run AI-assisted features when you use them;</li>
          <li>to respond to your questions and requests;</li>
          <li>to maintain and protect the service.</li>
        </ul>
        <p>
          <Open>[POSITION ON ADVERTISING AND SALE OF INFORMATION — TO BE CONFIRMED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "p3",
    nav: "3. Family sharing and permissions",
    title: "3. Family Sharing and Permissions",
    body: (
      <>
        <p>
          Information added to a family group is shared with the members of that group. The family
          organizer creates the group and decides who is invited.
        </p>
        <p>
          <Open>
            [WHAT EACH ROLE CAN SEE AND CHANGE — TO BE VERIFIED AGAINST THE IMPLEMENTATION]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "p4",
    nav: "4. Document uploads and storage",
    title: "4. Document Uploads and Storage",
    body: (
      <>
        <p>Documents you upload are stored so that your family group can use them in Pendia.</p>
        <p>
          <Open>
            [WHERE FILES ARE STORED, WHO CAN OPEN THEM, AND STORAGE LIMITS — TO BE VERIFIED]
          </Open>{" "}
          This draft makes no statement about encryption.
        </p>
      </>
    ),
  },
  {
    id: "p5",
    nav: "5. AI-assisted processing",
    title: "5. AI-Assisted Processing",
    body: (
      <>
        <p>
          Some Pendia features use AI models to work with information you provide, such as document
          extraction, Ask Pendia, visit preparation, and the weekly digest. When you use these
          features, the relevant content is sent to an AI service provider to be processed.
        </p>
        <p>
          AI-generated results can be incomplete or wrong. Check them against the original document
          or with your care team.
        </p>
        <p>
          <Open>
            [WHAT IS SENT, WHETHER THE PROVIDER KEEPS IT OR USES IT FOR TRAINING, AND HOW TO TURN AI
            FEATURES OFF — TO BE VERIFIED]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "p6",
    nav: "6. Service providers",
    title: "6. Third-Party Service Providers",
    body: (
      <>
        <p>
          Pendia relies on other companies to operate. The following appear in the current code and
          still need to be confirmed:
        </p>
        <ul>
          <li>
            <strong>Supabase:</strong> sign-in, database, and file storage.
          </li>
          <li>
            <strong>Meta:</strong> AI models used by the AI-assisted features.
          </li>
          <li>
            <strong>Google Fonts:</strong> typefaces loaded by the website.
          </li>
        </ul>
        <p>
          <Open>[HOSTING PROVIDER AND ANY OTHERS — TO BE CONFIRMED]</Open>{" "}
          <Open>[PAYMENT PROCESSOR — NONE CONNECTED; TO BE ADDED IF BILLING LAUNCHES]</Open>
        </p>
      </>
    ),
  },
  {
    id: "p7",
    nav: "7. Retention and deletion",
    title: "7. Data Retention and Deletion",
    body: (
      <>
        <p>
          <Open>[RETENTION PERIODS — NOT YET DEFINED]</Open>{" "}
          <Open>
            [HOW TO DELETE AN ACCOUNT, A FAMILY GROUP, OR UPLOADED CONTENT — TO BE VERIFIED]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "p8",
    nav: "8. Account security",
    title: "8. Account Security",
    body: (
      <>
        <p>
          You sign in to Pendia with your own account. Keep your password private, and tell us if
          you believe someone has used your account without permission.
        </p>
        <p>
          <Open>[SECURITY MEASURES — TO BE DESCRIBED ONLY AFTER VERIFICATION]</Open> This draft
          makes no claims about encryption, certifications, or regulatory compliance.
        </p>
      </>
    ),
  },
  {
    id: "p9",
    nav: "9. Privacy rights and requests",
    title: "9. Privacy Rights and Requests",
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to see, correct, or delete your
          information. You can send a privacy request through the{" "}
          <Link to="/contact">Contact page</Link>.
        </p>
        <p>
          <Open>
            [WHICH LAWS APPLY, HOW REQUESTS ARE HANDLED, AND RESPONSE TIMES — PENDING LEGAL REVIEW]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "p10",
    nav: "10. Children's information",
    title: "10. Children's Information",
    body: (
      <>
        <p>Pendia accounts are intended for adults who are coordinating care.</p>
        <p>
          <Open>
            [MINIMUM AGE, AND HOW INFORMATION ABOUT A CHILD RECEIVING CARE IS HANDLED — PENDING
            LEGAL REVIEW]
          </Open>
        </p>
      </>
    ),
  },
  {
    id: "p11",
    nav: "11. Policy changes",
    title: "11. Policy Changes",
    body: (
      <>
        <p>We may update this policy as Pendia changes.</p>
        <p>
          <Open>[HOW AND WHEN YOU WILL BE TOLD ABOUT CHANGES — TO BE DECIDED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "p12",
    nav: "12. Contact information",
    title: "12. Contact Information",
    body: (
      <>
        <p>
          Privacy questions and requests can be sent through the{" "}
          <Link to="/contact">Contact page</Link>, under "Privacy-related inquiries." Pendia is a
          product of EcoNest Systems LLC.
        </p>
        <p>
          <Open>[PRIVACY CONTACT — TO BE PROVIDED]</Open>
        </p>
      </>
    ),
  },
  {
    id: "p13",
    nav: "Medical disclaimer",
    title: "Medical Disclaimer",
    body: (
      <>
        <p>{MEDICAL_DISCLAIMER}</p>
        <p>
          <Open>[SUGGESTED WORDING — NOT YET LEGALLY APPROVED]</Open>
        </p>
      </>
    ),
  },
];

function Privacy() {
  return (
    <SiteLayout>
      <LegalDoc
        titleId="privacy-h1"
        title="Privacy Policy"
        label="Privacy Policy"
        status="DRAFT — Pending Privacy and Legal Review."
        statusNote="This document has not been approved and is not in effect. Highlighted items in brackets are unresolved or still need to be checked against how Pendia actually works."
        intro={
          <p>
            Current status: Pendia is limited to sample data. No real patient information is
            collected.
          </p>
        }
        sections={SECTIONS}
      />
    </SiteLayout>
  );
}
