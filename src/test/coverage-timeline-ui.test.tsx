// Coverage time-grid (UI): one continuous event per shift, exact hours and names, unscheduled time shown plainly, every
// record still editable, list and calendar agree, phone day view, permissions and claiming preserved. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  role: "organizer" as "organizer" | "member",
  shifts: [] as Array<Record<string, unknown>>,
}));
const claim = vi.hoisted(() => vi.fn());
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
      me: { id: "m-elise", family_id: "f1", name: "Elise Morales", role: world.role },
    },
  }),
  useMembers: () => ({
    data: [
      { id: "m-elise", name: "Elise Morales" },
      { id: "m-ben", name: "Ben Okafor" },
    ],
  }),
}));
vi.mock("@/services", () => ({
  shiftService: {
    listRange: async (_f: string, from: string, to: string) =>
      world.shifts.filter((s) => (s["start"] as string) < to && (s["end"] as string) > from),
    claim: (id: string, member: string) => claim(id, member),
    createShift: vi.fn(),
    updateShift: vi.fn(),
    cancelShift: vi.fn(),
  },
}));

import { Route } from "@/routes/_authenticated/coverage";
import { fromZonedInputValue } from "@/lib/zoned-time";

const TZ = "America/Chicago";
const row = (id: string, from: string, to: string, who: string | null) => ({
  id,
  family_id: "f1",
  start: fromZonedInputValue(from, TZ)!,
  end: fromZonedInputValue(to, TZ)!,
  assigned_member_id: who,
  status: who ? "claimed" : "open",
  created_at: "2026-10-01T00:00:00Z",
});
const oct22 = () => [
  row("a", "2026-10-22T10:00", "2026-10-22T12:00", "m-elise"),
  row("b", "2026-10-22T12:00", "2026-10-22T15:00", "m-elise"),
  row("c", "2026-10-22T16:00", "2026-10-23T00:00", "m-elise"),
];

const setNow = (iso = "2026-10-21T20:00:00Z") =>
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
const phone = (isPhone: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: isPhone && q.includes("max-width"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
beforeEach(() => {
  world.role = "organizer";
  world.shifts = [];
  claim.mockReset();
  claim.mockResolvedValue({});
  setNow();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  const Page = Route.options.component as ComponentType;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
  await screen.findByRole("group", { name: "Coverage timeline" });
  // The week's shifts arrive asynchronously; the list appears once they have.
  if (world.shifts.length) await screen.findByRole("region", { name: "Shifts this week" });
}
const events = () => screen.queryAllByTestId("timeline-event");
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const column = (day: string) => document.querySelector(`[data-day="${day}"]`) as HTMLElement;

describe("October 22 example (America/Chicago)", () => {
  beforeEach(() => {
    world.shifts = oct22();
  });

  it("shows exactly three events for three shifts, matching the list", async () => {
    await mount();
    expect(events()).toHaveLength(3);
    expect(new Set(events().map((e) => e.getAttribute("data-shift-id")))).toEqual(
      new Set(["a", "b", "c"]),
    );
    const list = await screen.findByRole("region", { name: "Shifts this week" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("3 shifts scheduled · none open")).toBeInTheDocument();
  });

  it("each event shows its own exact hours once, all on Oct 22", async () => {
    await mount();
    const day = within(column("2026-10-22"));
    const hours = day.getAllByTestId("shift-hours").map((e) => e.textContent);
    expect(hours).toEqual(["10a–12p", "12–3p", "4p–12a"]);
    expect(day.getAllByTestId("timeline-event")).toHaveLength(3);
    expect(within(column("2026-10-23")).queryAllByTestId("timeline-event")).toHaveLength(0);
  });

  it("12–3 PM spans three hours and starts where 10–12 ends (placement is by real time)", async () => {
    await mount();
    const [a, b, c] = events().map((e) => e.style);
    expect([a!.top, a!.height]).toEqual(["30rem", "6rem"]);
    expect([b!.top, b!.height]).toEqual(["36rem", "9rem"]);
    expect([c!.top, c!.height]).toEqual(["48rem", "24rem"]);
  });

  it("3–4 PM is shaded as nothing scheduled, and nothing says gap or uncovered", async () => {
    await mount();
    const bands = [...column("2026-10-22").querySelectorAll("[data-unscheduled]")].map((b) =>
      b.getAttribute("data-unscheduled"),
    );
    expect(bands).toEqual(["00:00-10:00", "15:00-16:00"]);
    expect(screen.queryByText(/uncovered|missing/i)).toBeNull();
    // The only mention of gaps is the plain note that required hours aren't set, so none can be reported.
    expect(screen.queryAllByText(/\bgaps?\b/i).map((e) => e.textContent)).toEqual([
      expect.stringMatching(/Required hours aren't set/),
    ]);
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
  });

  it("names the caregiver and exact times in each event's accessible name", async () => {
    await mount();
    expect(screen.getByLabelText(/Thursday, October 22 4:00 PM–12:00 AM: you/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Thursday, October 22 12:00 PM–3:00 PM: you/)).toBeInTheDocument();
  });

  it("all three remain editable, each opening its own record", async () => {
    await mount();
    for (const [id, start, end] of [
      ["a", "10:00", "12:00"],
      ["b", "12:00", "15:00"],
      ["c", "16:00", "00:00"],
    ] as const) {
      await click(document.querySelector(`[data-shift-id="${id}"]`) as HTMLElement);
      expect(((await screen.findByLabelText("Date")) as HTMLInputElement).value).toBe("2026-10-22");
      expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(start);
      expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe(end);
      await click(screen.getByRole("button", { name: /Cancel$|Close/ }));
    }
  });
});

describe("overlap, overnight and the week edge", () => {
  it("overlapping shifts sit side by side and both stay clickable", async () => {
    world.shifts = [
      row("x", "2026-10-22T09:00", "2026-10-22T13:00", "m-ben"),
      row("y", "2026-10-22T11:00", "2026-10-22T15:00", "m-elise"),
    ];
    await mount();
    const evs = within(column("2026-10-22")).getAllByTestId("timeline-event");
    expect(evs.map((e) => e.getAttribute("data-lane"))).toEqual(["0", "1"]);
    expect(evs[0]!.style.width).toBe("calc(50% - 2px)");
    expect(evs[1]!.style.left).toBe("calc(50% + 1px)");
  });

  it("an overnight shift is one event per day it touches, each saying it continues; the list shows one shift", async () => {
    world.shifts = [row("n", "2026-10-22T22:00", "2026-10-23T06:00", "m-ben")];
    await mount();
    expect(within(column("2026-10-22")).getByTestId("shift-hours")).toHaveTextContent("10p–6a ▸");
    expect(within(column("2026-10-23")).getByTestId("shift-hours")).toHaveTextContent("◂ 10p–6a");
    expect(
      screen.getByLabelText(/Thursday, October 22 .*continues the next day/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Friday, October 23 .*started the day before/),
    ).toBeInTheDocument();
    const list = await screen.findByRole("region", { name: "Shifts this week" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("a Sunday-night shift shows its tail on the next week's Monday", async () => {
    world.shifts = [row("w", "2026-10-25T22:00", "2026-10-26T06:00", "m-ben")];
    await mount();
    expect(within(column("2026-10-25")).getAllByTestId("timeline-event")).toHaveLength(1);
    await click(screen.getByRole("button", { name: "Next week" }));
    expect(
      await screen.findByLabelText(/Monday, October 26 .*started the day before/),
    ).toBeInTheDocument();
  });

  it("clock-change days say how long they are", async () => {
    setNow("2026-10-30T20:00:00Z");
    await mount();
    expect(screen.getByText("25h day")).toBeInTheDocument(); // Sunday Nov 1 is in this week
  });
});

describe("permissions and claiming are unchanged", () => {
  it("a member sees no add or edit controls, and cannot click someone else's event", async () => {
    world.role = "member";
    world.shifts = oct22();
    await mount();
    expect(screen.queryByRole("button", { name: /Add shift|Add a shift on/ })).toBeNull();
    expect(events().every((e) => e.tagName !== "BUTTON")).toBe(true);
    expect(document.querySelector("[data-slot]")).toBeNull();
  });

  it("a member can cover an open shift from the calendar", async () => {
    world.role = "member";
    world.shifts = [row("o", "2026-10-22T18:00", "2026-10-22T22:00", null)];
    await mount();
    await click(
      screen.getByLabelText(/Thursday, October 22 6:00 PM–10:00 PM: open.*Tap to cover it/),
    );
    expect(claim).toHaveBeenCalledWith("o", "m-elise");
    expect(screen.getByTestId("needs-completion-dot")).toBeInTheDocument();
  });

  it("an organizer can add from a time slot", async () => {
    await mount();
    await click(document.querySelector('[data-slot="2026-10-22T15:00"]') as HTMLElement);
    expect(((await screen.findByLabelText("Start")) as HTMLInputElement).value).toBe("15:00");
  });
});

describe("responsive layouts", () => {
  it("phones open on one day with a date strip and previous/next day", async () => {
    phone(true);
    world.shifts = oct22();
    await mount();
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll("[data-day]")).toHaveLength(1);
    expect(document.querySelector("[data-day]")?.getAttribute("data-day")).toBe("2026-10-21");
    await click(screen.getByRole("button", { name: "Next day" }));
    expect(document.querySelector("[data-day]")?.getAttribute("data-day")).toBe("2026-10-22");
    expect(events()).toHaveLength(3);
    await click(screen.getByRole("button", { name: /^Friday 23/ }));
    expect(document.querySelector("[data-day]")?.getAttribute("data-day")).toBe("2026-10-23");
  });

  it("next day from Sunday moves to Monday of the next week", async () => {
    phone(true);
    setNow("2026-10-25T20:00:00Z");
    await mount();
    await click(screen.getByRole("button", { name: "Next day" }));
    expect(document.querySelector("[data-day]")?.getAttribute("data-day")).toBe("2026-10-26");
    expect(screen.getByText(/Week of October 26/)).toBeInTheDocument();
  });

  it("larger screens open on the week, and the Day/Week buttons switch", async () => {
    phone(false);
    await mount();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(7);
    await click(screen.getByRole("button", { name: "Day" }));
    expect(document.querySelectorAll("[data-day]")).toHaveLength(1);
    await click(screen.getByRole("button", { name: "Week" }));
    expect(document.querySelectorAll("[data-day]")).toHaveLength(7);
  });

  it("states the family's zone so nobody has to guess", async () => {
    await mount();
    expect(screen.getByText(/Times are in Central Time/)).toBeInTheDocument();
  });
});

describe("clock-change days label their own hours", () => {
  it("the 25-hour day carries its own hour labels in week view, so a wall time is never read off the shared gutter", async () => {
    setNow("2026-10-30T20:00:00Z");
    world.shifts = [row("h", "2026-10-31T22:00", "2026-11-01T06:00", "m-ben")];
    await mount();
    expect(column("2026-11-01").querySelector("[data-own-hours]")).not.toBeNull();
    expect(column("2026-10-30").querySelector("[data-own-hours]")).toBeNull();
    const labels = [...column("2026-11-01").querySelectorAll("[data-own-hours] span")].map((n) =>
      n.textContent!.replace(/\u202f/g, " "),
    );
    expect(labels.filter((l) => l.startsWith("1 AM"))).toEqual(["1 AM CDT", "1 AM CST"]);
    // 10 PM–6 AM across the change is nine real hours: seven on Nov 1 (midnight to 6 AM CST) and two on Oct 31.
    expect(within(column("2026-11-01")).getByTestId("timeline-event").style.height).toBe("21rem");
    expect(within(column("2026-10-31")).getByTestId("timeline-event").style.height).toBe("6rem");
  });
});
