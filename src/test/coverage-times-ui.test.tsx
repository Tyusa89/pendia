// Phase 2 (UI): the weekly calendar shows exact shift hours and caregiver names in the family's zone, shifts crossing
// blocks show in each, and the week list gives the same facts in text. Fictional data only.
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
const weekRegion = () => screen.findByRole("region", { name: "This week" });

describe("exact hours in the calendar", () => {
  it("a 12–2 PM shift shows its hours and who, not just 'You' or initials", async () => {
    world.shifts = [row("a", 3, "12:00", 3, "14:00", "m-ben")];
    mount();
    const grid = await weekRegion();
    const cell = await within(grid).findByLabelText(
      /Thursday Morning .*12:00 PM.*2:00 PM.*: Ben Okafor/,
    );
    expect(within(cell).getByTestId("shift-hours")).toHaveTextContent("12–2p");
    expect(cell).toHaveTextContent("Ben");
    expect(within(grid).queryByLabelText(/Thursday Afternoon .*12:00 PM/)).toBeNull(); // 2 PM end does not leak into Afternoon
  });

  it("shows my own shift as You, with hours", async () => {
    world.shifts = [row("a", 1, "08:00", 1, "14:00", "m-ana")];
    mount();
    const cell = await within(await weekRegion()).findByLabelText(/Tuesday Morning .*: you/);
    expect(cell).toHaveTextContent("8a–2p");
    expect(cell).toHaveTextContent("You");
  });

  it("an open shift says Open with its hours", async () => {
    world.shifts = [row("a", 2, "18:00", 2, "22:00", null)];
    mount();
    const cell = await within(await weekRegion()).findByLabelText(/Wednesday Evening .*: open/);
    expect(cell).toHaveTextContent("6–10p");
    expect(cell).toHaveTextContent("Open");
  });

  it("a shift crossing blocks appears in each, with the full hours and the same person", async () => {
    world.shifts = [row("a", 4, "13:00", 4, "16:00", "m-ben")];
    mount();
    const grid = await weekRegion();
    expect(
      await within(grid).findByLabelText(/Friday Morning .*1:00 PM.*4:00 PM.*: Ben Okafor/),
    ).toBeInTheDocument();
    expect(
      within(grid).getByLabelText(/Friday Afternoon .*1:00 PM.*4:00 PM.*: Ben Okafor/),
    ).toBeInTheDocument();
  });

  it("an overnight shift appears on both days and says it continues", async () => {
    world.shifts = [row("a", 1, "22:00", 2, "06:00", "m-ben")];
    mount();
    const grid = await weekRegion();
    const eve = await within(grid).findByLabelText(/Tuesday Evening .*continues the next day/);
    expect(eve).toHaveTextContent("10p–6a▸");
    const morn = within(grid).getByLabelText(/Wednesday Morning .*started the day before/);
    expect(morn).toHaveTextContent("◂10p–6a");
  });

  it("two overlapping shifts in one block both show, each with its own hours and person", async () => {
    world.shifts = [
      row("a", 0, "09:00", 0, "12:00", "m-ben"),
      row("b", 0, "11:00", 0, "14:00", "m-ana"),
    ];
    mount();
    const grid = await weekRegion();
    expect(
      await within(grid).findByLabelText(/Monday Morning .*9:00 AM.*12:00 PM.*: Ben Okafor/),
    ).toBeInTheDocument();
    expect(
      within(grid).getByLabelText(/Monday Morning .*11:00 AM.*2:00 PM.*: you/),
    ).toBeInTheDocument();
  });

  it("the list under the calendar states the same hours and names in text (phone-friendly)", async () => {
    world.shifts = [row("a", 3, "12:00", 3, "14:00", "m-ben")];
    mount();
    const list = await screen.findByRole("region", { name: "Shifts this week" });
    expect(list).toHaveTextContent("12:00 PM – 2:00 PM");
    expect(list).toHaveTextContent("Ben Okafor");
  });
});
