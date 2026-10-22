// Phase 3 (UI): the Coverage summary states scheduled/open counts and never claims coverage. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const TZ = "America/Chicago";
const world = vi.hoisted(() => ({ shifts: [] as unknown[] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "f1", name: "Test Family", timezone: "America/Chicago" },
      me: { id: "m-ana", family_id: "f1", name: "Ana Rivera", role: "member" },
    },
  }),
  useMembers: () => ({
    data: [
      { id: "m-ana", name: "Ana Rivera" },
      { id: "m-ben", name: "Ben Okafor" },
    ],
  }),
}));
vi.mock("@/services", () => ({
  shiftService: { listRange: async () => world.shifts, claim: vi.fn() },
}));

import { Route } from "@/routes/_authenticated/coverage";
import { mondayInZone, weekDays } from "@/lib/shifts";
import { fromZonedInputValue } from "@/lib/zoned-time";

const week = weekDays(mondayInZone(new Date(), TZ));
const row = (
  id: string,
  dayIdx: number,
  from: string,
  toDayIdx: number,
  to: string,
  who: string | null,
) => ({
  id,
  family_id: "f1",
  start: fromZonedInputValue(`${week[dayIdx]}T${from}`, TZ)!,
  end: fromZonedInputValue(`${week[toDayIdx]}T${to}`, TZ)!,
  assigned_member_id: who,
  status: who ? "claimed" : "open",
  created_at: "2026-10-01T00:00:00Z",
});
afterEach(cleanup);

function mount() {
  const Page = Route.options.component as ComponentType;
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
}

describe("Phase 3: the summary never claims coverage it can't know", () => {
  it("counts scheduled and open shifts and says required hours aren't set", async () => {
    world.shifts = [
      row("a", 0, "08:00", 0, "14:00", "m-ben"),
      row("b", 1, "08:00", 1, "14:00", null),
    ];
    mount();
    expect(await screen.findByText("2 shifts scheduled · 1 open")).toBeInTheDocument();
    expect(screen.getByText(/Required hours aren't set yet/)).toBeInTheDocument();
    expect(screen.queryByText(/covered/i)).toBeNull();
  });
  it("a fully assigned schedule still does not say 'covered'", async () => {
    world.shifts = [row("a", 0, "08:00", 0, "12:00", "m-ben")];
    mount();
    expect(await screen.findByText("1 shift scheduled · none open")).toBeInTheDocument();
    expect(screen.queryByText(/every shift|all covered|fully/i)).toBeNull();
  });
  it("an empty week says so", async () => {
    world.shifts = [];
    mount();
    expect(await screen.findByText("No shifts scheduled this week")).toBeInTheDocument();
  });
});
