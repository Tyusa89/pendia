// The Medical Integrations page: static, no provider connection, no network, and reachable from settings without a seventh tab.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import { routeTree } from "@/routeTree.gen";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
      <a href={to} {...(rest as object)}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({ data: { family: { id: "f" }, me: { language: "en", role: "organizer" } } }),
}));

import { Route as IntegrationsRoute } from "@/routes/_authenticated/medical-integrations";
import { Route as PreferencesRoute } from "@/routes/_authenticated/preferences";

afterEach(cleanup);
const root = join(__dirname, "../..");
const source = (p: string) => readFileSync(join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const Page = IntegrationsRoute.options.component as () => ReactNode;

describe("Medical Integrations page", () => {
  it("has the page title as the main heading", () => {
    render(<Page />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Medical Integrations" }),
    ).toBeInTheDocument();
  });

  it("labels the MyChart / Epic card 'Coming soon — Not connected' and names Duly Health and Care only as an example", () => {
    render(<Page />);
    const card = screen.getByRole("region", { name: "MyChart and Epic" });
    expect(
      within(card).getByRole("heading", { level: 2, name: "MyChart / Epic" }),
    ).toBeInTheDocument();
    expect(within(card).getAllByText("Coming soon — Not connected")).toHaveLength(1);
    expect(card).toHaveTextContent(/participating provider, for example Duly Health and Care/i);
  });

  it("explains that future imports may include appointments, visit summaries and medication lists, subject to provider support and patient authorization", () => {
    render(<Page />);
    const card = screen.getByRole("region", { name: "MyChart and Epic" });
    expect(card).toHaveTextContent(/In the future, imports may include/i);
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Appointments", "Visit summaries", "Medication lists"]);
    expect(card).toHaveTextContent(
      /depends on what each provider supports and on the patient's authorization/i,
    );
    expect(card).toHaveTextContent(/Nothing here is available today/i);
  });

  it("the Connect button is disabled and explained, and nothing on the page can start a connection", () => {
    render(<Page />);
    const connect = screen.getByRole("button", { name: "Connect MyChart" });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription(/Not available yet/i);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    // every link is an internal app route: no provider, OAuth or external URL
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.sort()).toEqual(["/meds", "/preferences", "/visits/new"]);
    expect(
      screen.queryByRole("link", { name: /connect|sign in|authorize|mychart/i }),
    ).not.toBeInTheDocument();
  });

  it("links to the established manual entry pages", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: /Add an appointment/i })).toHaveAttribute(
      "href",
      "/visits/new",
    );
    expect(screen.getByRole("link", { name: /Add or review medications/i })).toHaveAttribute(
      "href",
      "/meds",
    );
    expect(screen.getByRole("link", { name: /Preferences & Accessibility/i })).toHaveAttribute(
      "href",
      "/preferences",
    );
  });

  it("states plainly that no records are imported, and explains privacy", () => {
    render(<Page />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Nothing is connected, and no medical records are being imported into Pendia.",
    );
    const privacy = screen.getByRole("region", { name: "Privacy" });
    expect(privacy).toHaveTextContent(/No medical records are imported today/i);
    expect(privacy).toHaveTextContent(/does not contact MyChart, Epic or any provider/i);
    expect(privacy).toHaveTextContent(/patient, or their legal proxy/i);
  });

  it("makes no claim that anything is connected or imported", () => {
    const { container } = render(<Page />);
    expect(container.textContent).not.toMatch(
      /\b(connected successfully|synced|imported from|linked to your|we import)\b/i,
    );
  });
});

describe("how the page is reached", () => {
  it("is linked from the Preferences (settings) page", () => {
    const PreferencesPage = PreferencesRoute.options.component as () => ReactNode;
    render(
      <PreferencesProvider>
        <PreferencesPage />
      </PreferencesProvider>,
    );
    const panel = screen.getByRole("region", { name: "Medical integrations" });
    expect(panel).toHaveTextContent(/coming soon and are not connected/i);
    expect(panel).toHaveTextContent(/No medical records are being imported/i);
    expect(within(panel).getByRole("link", { name: "Medical Integrations" })).toHaveAttribute(
      "href",
      "/medical-integrations",
    );
  });

  it("does not add a seventh tab: the shell is untouched and still six tabs", () => {
    const shell = strip(source("src/components/AppShell.tsx"));
    expect(shell).not.toMatch(/medical-integrations|Medical Integrations/);
    expect(shell.match(/\{ to: "\/[a-z]+", label: "[A-Za-z]+", icon: \w+ \}/g)).toHaveLength(6);
    expect(shell).toMatch(/grid-cols-6/);
  });

  it("is a real route inside the signed-in layout", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const ids = router.matchRoutes("/medical-integrations").map((m) => m.routeId);
    expect(ids).toContain("/_authenticated");
    expect(ids.at(-1)).toBe("/_authenticated/medical-integrations");
  });
});

describe("the page cannot reach a provider, the network or any credential", () => {
  const code = strip(source("src/routes/_authenticated/medical-integrations.tsx"));
  it("has no network, storage, data-layer or environment access", () => {
    expect(code).not.toMatch(
      /\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|@\/services|@\/integrations|supabase|createServerFn|import\.meta\.env|process\.env|useQuery|useMutation/,
    );
  });
  it("has no OAuth or FHIR plumbing and no provider endpoints", () => {
    expect(code).not.toMatch(
      /client_id|client_secret|redirect_uri|oauth|\/authorize|authorizeUrl|authorization_endpoint|response_type|\/fhir|https?:\/\/|epic\.com|mychart\.com|duly\.com/i,
    );
  });
  it("the only real button (not a link) is the disabled Connect button", () => {
    const tags = code.match(/<Button\b[^>]*>/g) ?? [];
    const realButtons = tags.filter((t) => !/\basChild\b/.test(t));
    expect(realButtons).toHaveLength(1);
    expect(realButtons[0]).toMatch(/\bdisabled\b/);
  });
});
