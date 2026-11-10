import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  rootRouteId,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The full route tree imports every page (and so every service), so give the Supabase client just enough shape to
// be imported. None of the public pages under test talk to it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  },
}));

import { routeTree } from "@/routeTree.gen";
import { FOOTER_GROUPS, GET_STARTED, PRIMARY_NAV, SIGN_IN } from "@/lib/site";

afterEach(cleanup);

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

const PUBLIC = ["/", "/about", "/pricing", "/contact", "/terms", "/privacy", "/auth", "/demo"];

describe("public website routes and navigation", () => {
  it("every public route is a real page, not not-found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const p of PUBLIC) expect(router.matchRoutes(p).at(-1)?.routeId, p).not.toBe(rootRouteId);
  });

  it("header and footer links all point at real routes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const links = [...PRIMARY_NAV, SIGN_IN, GET_STARTED, ...FOOTER_GROUPS.flatMap((g) => g.links)];
    for (const l of links)
      expect(router.matchRoutes(l.to).at(-1)?.routeId, l.label).not.toBe(rootRouteId);
  });

  it("renders one header and one footer per page, with the approved navigation", async () => {
    for (const p of ["/", "/about", "/pricing", "/contact", "/terms", "/privacy"]) {
      await renderAt(p);
      expect(screen.getAllByRole("banner"), p).toHaveLength(1);
      expect(screen.getAllByRole("contentinfo"), p).toHaveLength(1);
      expect(screen.getAllByRole("main"), p).toHaveLength(1);
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(nav)
          .getAllByRole("link")
          .map((a) => a.textContent),
      ).toEqual(["Home", "About", "Features", "Pricing", "Contact"]);
      const footer = screen.getByRole("contentinfo");
      for (const t of [
        "About Pendia",
        "Features",
        "Pricing",
        "Contact Us",
        "Terms & Conditions",
        "Privacy Policy",
      ]) {
        expect(within(footer).getByRole("link", { name: t }), `${p} ${t}`).toBeInTheDocument();
      }
      expect(footer).toHaveTextContent("EcoNest Systems LLC");
      cleanup();
    }
  });

  it("marks the current page in the primary navigation", async () => {
    await renderAt("/pricing");
    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
        name: "Pricing",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  // The drawer itself (open, focus trap, Escape, focus return, link navigation) is covered by the browser checks in the
  // PR description; closing a Radix dialog inside this full router hangs jsdom, so it is not unit-tested here.
  it("renders a menu button for tablet and mobile widths", async () => {
    await renderAt("/");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });
});

describe("landing page", () => {
  it("offers Get Started and Explore Demo with real destinations", async () => {
    await renderAt("/");
    expect(screen.getByRole("link", { name: "Explore Demo" })).toHaveAttribute("href", "/demo");
    const gs = screen.getAllByRole("link", { name: "Get Started" });
    for (const a of gs) expect(a).toHaveAttribute("href", "/auth?mode=up");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Coordinate Care for the People You Love.",
    );
    expect(document.querySelector("#features")).not.toBeNull();
  });
});

describe("pricing page", () => {
  it("shows the approved plans, a working billing toggle, and no internal fallback price", async () => {
    await renderAt("/pricing");
    expect(document.body.textContent).not.toMatch(/\$12\b/);
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("$15")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    expect(screen.getByText("$149")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annual" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("$10/month for life")).toBeInTheDocument();
  });

  it("does not offer purchase or sign-up for unfinished Plus", async () => {
    await renderAt("/pricing");
    expect(screen.getByRole("button", { name: "Coming Soon" })).toBeDisabled();
    expect(screen.getByText(/Plus is not available yet/)).toBeInTheDocument();
    expect(screen.getByText(/Enrollment is not open yet/)).toBeInTheDocument();
  });
});

describe("contact page", () => {
  it("validates, never sends, and never claims success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await renderAt("/contact");
    expect(screen.getByText(/not connected yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "pat@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Inquiry category"), { target: { value: "general" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
    expect(screen.getByRole("status")).toHaveTextContent(/was not sent/i);
    expect(screen.getByRole("status").textContent).not.toMatch(/thank|success|received/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/do not include medical records/i)).toBeInTheDocument();
  });
});

describe("legal drafts", () => {
  it.each([
    ["/terms", /DRAFT — Pending Legal Review/],
    ["/privacy", /DRAFT — Pending Privacy and Legal Review/],
  ])(
    "%s is clearly a draft with unresolved items and no compliance claims",
    async (path, banner) => {
      await renderAt(path);
      expect(screen.getByRole("note")).toHaveTextContent(banner);
      expect(document.querySelectorAll("mark").length).toBeGreaterThan(5);
      expect(document.body.textContent).not.toMatch(
        /HIPAA[- ]compliant|SOC ?2|ISO 27001|encrypted at rest|we are compliant/i,
      );
    },
  );
});

describe("auth page", () => {
  it("opens sign in by default and account creation for ?mode=up", async () => {
    await renderAt("/auth");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
    cleanup();
    await renderAt("/auth?mode=up");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });
});
