// The Add shift dialog's date comes from the family's zone (today), the clicked calendar cell, or the shift being edited,
// never from whichever week is on screen. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ tz: "America/Chicago", shifts: [] as unknown[] }));
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
      family: { id: "f1", name: "Test Family", timezone: world.tz },
      me: { id: "m-ana", family_id: "f1", name: "Ana Rivera", role: "organizer" },
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
  shiftService: {
    listRange: async () => world.shifts,
    claim: vi.fn(),
    createShift: vi.fn(),
    updateShift: vi.fn(),
  },
}));

import { Route } from "@/routes/_authenticated/coverage";
import { fromZonedInputValue } from "@/lib/zoned-time";

const setNow = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
beforeEach(() => {
  world.tz = "America/Chicago";
  world.shifts = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
  await screen.findByRole("region", { name: "This week" });
}
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const dialogDate = async () => ((await screen.findByLabelText("Date")) as HTMLInputElement).value;
const addShift = () => click(screen.getByRole("button", { name: /Add shift/ }));
const closeDialog = () => click(screen.getByRole("button", { name: /Close/ }));

describe("general Add shift button defaults to today in the family's zone", () => {
  it("Oct 21 in Chicago (Monday of that week is Oct 19) defaults to Oct 21, not Oct 19", async () => {
    setNow("2026-10-21T20:00:00Z"); // 3 PM CDT
    await mount();
    await addShift();
    expect(await dialogDate()).toBe("2026-10-21");
  });

  it("navigating to another week does not change it", async () => {
    setNow("2026-10-21T20:00:00Z");
    await mount();
    await click(screen.getByRole("button", { name: "Next week" }));
    await click(screen.getByRole("button", { name: "Next week" }));
    await addShift();
    expect(await dialogDate()).toBe("2026-10-21");
  });

  it("around midnight, Chicago and New York give their own dates", async () => {
    setNow("2026-10-22T04:30:00Z"); // 11:30 PM Oct 21 in Chicago, 12:30 AM Oct 22 in New York
    await mount();
    await addShift();
    expect(await dialogDate()).toBe("2026-10-21");
    cleanup();
    world.tz = "America/New_York";
    await mount();
    await addShift();
    expect(await dialogDate()).toBe("2026-10-22");
  });

  it("uses the family's zone even when it is a different day in UTC", async () => {
    setNow("2026-10-22T03:30:00Z"); // already Oct 22 in UTC, still Oct 21 in Chicago
    await mount();
    await addShift();
    expect(await dialogDate()).toBe("2026-10-21");
  });

  it("daylight saving: just before and after the Nov 1 2026 fall-back, and across midnight into Nov 2", async () => {
    for (const [now, expected] of [
      ["2026-11-01T06:59:00Z", "2026-11-01"], // 1:59 AM CDT
      ["2026-11-01T07:00:00Z", "2026-11-01"], // 1:00 AM CST (repeated hour)
      ["2026-11-02T05:59:00Z", "2026-11-01"], // 11:59 PM CST
      ["2026-11-02T06:00:00Z", "2026-11-02"], // midnight CST
    ] as const) {
      setNow(now);
      await mount();
      await addShift();
      expect(await dialogDate(), now).toBe(expected);
      cleanup();
      vi.useRealTimers();
    }
  });

  it("spring forward (Mar 8 2026): 2:30 AM CST doesn't exist; the date is still right on both sides", async () => {
    for (const [now, expected] of [
      ["2026-03-08T07:59:00Z", "2026-03-08"], // 1:59 AM CST
      ["2026-03-08T08:00:00Z", "2026-03-08"], // 3:00 AM CDT
    ] as const) {
      setNow(now);
      await mount();
      await addShift();
      expect(await dialogDate(), now).toBe(expected);
      cleanup();
      vi.useRealTimers();
    }
  });
});

describe("other ways in keep their own date", () => {
  it("a calendar cell for Oct 22 defaults to Oct 22", async () => {
    setNow("2026-10-21T20:00:00Z");
    await mount();
    await click(screen.getByLabelText(/Thursday Morning: no shift/));
    expect(await dialogDate()).toBe("2026-10-22");
    await closeDialog();
    await click(screen.getByLabelText(/Thursday Evening: no shift/));
    expect(await dialogDate()).toBe("2026-10-22");
  });

  it("a cell in a week you navigated to defaults to that cell's date", async () => {
    setNow("2026-10-21T20:00:00Z");
    await mount();
    await click(screen.getByRole("button", { name: "Next week" }));
    await click(screen.getByLabelText(/Tuesday Morning: no shift/));
    expect(await dialogDate()).toBe("2026-10-27");
  });

  it("editing an existing shift keeps its actual date and times, including an overnight one", async () => {
    setNow("2026-10-21T20:00:00Z");
    world.shifts = [
      {
        id: "s1",
        family_id: "f1",
        start: fromZonedInputValue("2026-10-22T16:00", "America/Chicago")!,
        end: fromZonedInputValue("2026-10-23T00:00", "America/Chicago")!,
        assigned_member_id: "m-ben",
        status: "claimed",
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    await mount();
    const list = await screen.findByRole("region", { name: "Shifts this week" });
    await click(within(list).getByRole("button", { name: /^Edit / }));
    expect(await dialogDate()).toBe("2026-10-22");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("16:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("00:00");
  });
});
