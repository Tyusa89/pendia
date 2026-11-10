// Design integration: the responsive shell (six tabs, sign out, reserved AI slot), the Family overview tiles, and the
// phone-first coverage grid. The data layer is mocked; fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const flags = vi.hoisted(() => ({ assistant: false }));
const signOut = vi.fn(async () => {});
const claim = vi.fn(async (id: string, member: string) => ({ id, member }));
const world = vi.hoisted(() => ({
  me: {
    id: "m1",
    family_id: "f1",
    name: "Elena Morales",
    role: "organizer",
    can_see_meds: true,
    can_see_schedule: true,
    can_see_visits: true,
  } as Record<string, unknown>,
}));

vi.mock("@/lib/features", () => ({ features: flags }));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
      <a href={to} {...(rest as object)}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "f1", name: "The Morales Family", timezone: "America/New_York" },
      me: world.me,
    },
  }),
  useMembers: () => ({
    data: [
      { id: "m1", name: "Elena Morales" },
      { id: "m2", name: "Marco Morales" },
    ],
  }),
}));

const mondayThisWeek = () => {
  const x = new Date();
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
const shiftAt = (id: string, day: number, hour: number, who: string | null) => {
  const s = mondayThisWeek();
  s.setUTCDate(s.getUTCDate() + day);
  s.setUTCHours(hour);
  return {
    id,
    family_id: "f1",
    start: s.toISOString(),
    end: s.toISOString(),
    assigned_member_id: who,
  };
};
const upcoming = new Date(Date.now() + 2 * 864e5).toISOString();
const visit = (over: object) => ({
  id: "v1",
  family_id: "f1",
  date: upcoming.slice(0, 10),
  scheduled_start: upcoming,
  scheduled_end: null,
  status: "scheduled",
  archived_at: null,
  provider_name: "Dr. Example",
  ...over,
});

vi.mock("@/services", () => ({
  authService: { signOut: () => signOut() },
  visitService: { list: async () => [visit({})] },
  shiftService: {
    listRange: async () => [
      shiftAt("s1", 0, 8, "m2"),
      shiftAt("s2", 2, 14, null),
      shiftAt("s3", 5, 14, null),
    ],
    claim: (id: string, member: string) => claim(id, member),
  },
  handoffService: { list: async () => [{ id: "h1", created_at: new Date().toISOString() }] },
}));

import { AppShell } from "@/components/AppShell";
import { FamilyOverview, greeting } from "@/components/FamilyOverview";
import { Route as CoverageRoute } from "@/routes/_authenticated/coverage";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

beforeEach(() => {
  flags.assistant = false;
  world.me = { ...world.me, role: "organizer", can_see_visits: true, can_see_schedule: true };
  navigate.mockClear();
  signOut.mockClear();
  claim.mockClear();
});
afterEach(cleanup);

describe("app shell", () => {
  it("keeps all seven destinations, in the same order, in the main navigation (header pills on tablet and desktop)", () => {
    render(wrap(<AppShell>page</AppShell>));
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Dashboard", "/family"],
      ["Family Members", "/members"],
      ["Visits", "/visits"],
      ["Meds", "/meds"],
      ["Coverage", "/coverage"],
      ["Handoffs", "/handoffs"],
      ["Digest", "/digest"],
    ]);
  });

  it("phone bottom bar: Home, Visits, a centred Handoff action, Meds, Coverage", () => {
    render(wrap(<AppShell>page</AppShell>));
    const bar = screen.getByRole("navigation", { name: "Bottom" });
    expect(within(bar).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Home", "/family"],
      ["Visits", "/visits"],
      ["Handoff", "/handoffs"],
      ["Meds", "/meds"],
      ["Coverage", "/coverage"],
    ]);
  });

  it("phone menu sheet holds the other destinations, Ask Pendia (not available), preferences and sign out", async () => {
    render(wrap(<AppShell>page</AppShell>));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const more = await screen.findByRole("navigation", { name: "More" });
    expect(within(more).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/members", "/handoffs", "/digest", "/ask", "/preferences",
    ]);
    expect(within(more).getByText("Not available yet")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(more).getByRole("button", { name: "Sign out" }));
    });
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("keeps Ask Pendia as a link to the availability page (it does not enable AI) and a Skip link", () => {
    render(wrap(<AppShell>page</AppShell>));
    expect(screen.getByTestId("assistant-slot")).toHaveAttribute("href", "/ask");
    expect(screen.getByRole("link", { name: "Skip to care content" })).toHaveAttribute("href", "#care-content");
  });

  it("always shows the medical-advice footer", () => {
    render(wrap(<AppShell>page</AppShell>));
    expect(
      screen.getByText(/Not medical advice\. Check with your doctor or pharmacist\./),
    ).toBeInTheDocument();
  });

  it("signs out and goes to the sign-in page", async () => {
    render(wrap(<AppShell>page</AppShell>));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);
    });
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });

});

describe("family overview", () => {
  it("greets by time of day", () => {
    expect(greeting(new Date(2026, 9, 21, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 9, 21, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 9, 21, 20))).toBe("Good evening");
  });

  it("organizer: next visit, open blocks, latest handoff, and the Add appointment shortcut", async () => {
    render(wrap(<FamilyOverview me={world.me as never} timeZone="America/New_York" />));
    expect(await screen.findByText("2 blocks")).toBeInTheDocument();
    expect(screen.getByText("Next visit")).toBeInTheDocument();
    expect(screen.queryByText("None yet")).not.toBeInTheDocument();
    expect(screen.getByText("Latest handoff")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add appointment/ })).toHaveAttribute(
      "href",
      "/visits/new",
    );
  });

  it("Quick handoff only navigates to the Handoffs page, and today's coverage is labelled as scheduled, not presence", async () => {
    render(wrap(<FamilyOverview me={world.me as never} timeZone="America/New_York" />));
    await screen.findByText("2 blocks");
    const start = screen.getByRole("link", { name: /Start a handoff/ });
    expect(start).toHaveAttribute("href", "/handoffs");
    expect(screen.getByRole("link", { name: /Voice note/ })).toHaveAttribute("href", "/handoffs");
    expect(screen.getByText("Scheduled coverage today")).toBeInTheDocument();
    expect(screen.getByText("Today · scheduled coverage")).toBeInTheDocument();
  });

  it("a member without visit or schedule access sees none of those tiles, and no Add appointment", async () => {
    world.me = { ...world.me, role: "member", can_see_visits: false, can_see_schedule: false };
    render(wrap(<FamilyOverview me={world.me as never} timeZone="America/New_York" />));
    await screen.findByRole("link", { name: /Start a handoff/ });
    expect(screen.queryByText("Next visit")).not.toBeInTheDocument();
    expect(screen.queryByText("Open this week")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest handoff")).not.toBeInTheDocument();
    expect(screen.queryByText("Scheduled coverage today")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add appointment/ })).not.toBeInTheDocument();
  });
});

describe("coverage on a phone", () => {
  const Page = CoverageRoute.options.component as ComponentType;

  it("lists open blocks with a large Cover it button, and claiming one uses the signed-in member", async () => {
    render(wrap(<Page />));
    const list = await screen.findByRole("region", { name: "Still open this week" });
    const buttons = within(list).getAllByRole("button", { name: /Cover/ });
    expect(buttons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(buttons[0]!);
    });
    await waitFor(() => expect(claim).toHaveBeenCalledWith("s2", "m1"));
  });

  it("gives every event an accessible name with its day, hours and person", async () => {
    render(wrap(<Page />));
    await screen.findByRole("region", { name: "This week" });
    expect(await screen.findByLabelText(/Monday, .*: Marco Morales/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Wednesday, .*: open/)).toBeInTheDocument();
  });
});
