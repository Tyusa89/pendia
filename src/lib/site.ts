/** Public-website navigation: one source for the header, the mobile/tablet drawer and the footer. */
export type SiteLink =
  | {
      label: string;
      to: "/" | "/about" | "/pricing" | "/contact" | "/terms" | "/privacy";
      hash?: string;
    }
  | { label: string; to: "/auth"; search?: { mode: "up" } };

export const PRIMARY_NAV: readonly SiteLink[] = [
  { label: "Home", to: "/" },
  { label: "About", to: "/about" },
  { label: "Features", to: "/", hash: "features" },
  { label: "Pricing", to: "/pricing" },
  { label: "Contact", to: "/contact" },
];

export const SIGN_IN: SiteLink = { label: "Sign In", to: "/auth" };
export const GET_STARTED: SiteLink = { label: "Get Started", to: "/auth", search: { mode: "up" } };

export const FOOTER_GROUPS: readonly { title: string; links: readonly SiteLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/", hash: "features" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Pendia", to: "/about" },
      { label: "Contact Us", to: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms & Conditions", to: "/terms" },
      { label: "Privacy Policy", to: "/privacy" },
    ],
  },
];

export const MEDICAL_DISCLAIMER =
  "Pendia is a family caregiving coordination tool. It does not provide medical advice, diagnosis, treatment, or emergency services. Always consult qualified healthcare professionals regarding medical decisions.";
