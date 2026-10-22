// Coverage C1 (UI): organizer adds, edits, reassigns and cancels shifts; "needs completion" is computed and clears;
// overlaps are flagged but never block; members get no editing controls; the existing claim flow and week navigation
// are unchanged. The service layer and database rules have their own suites. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestShift = {
  id: string;
  family_id: string;
  start: string;
  end: string;
  assigned_member_id: string | null;
  status: string;
  created_at: string;
};
const TZ = "America/New_York";
const world = vi.hoisted(() => ({
  role: "organizer" as "organizer" | "member",
  shifts: [] as TestShift[],
  fromCalls: [] as string[],
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const svc = vi.hoisted(() => ({
  createShift: vi.fn(),
  updateShift: vi.fn(),
  cancelShift: vi.fn(),
  claim: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastSpy }));
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
      family: { id: "f1", name: "Test Family", timezone: "America/New_York" },
      me: { id: "m-ana", family_id: "f1", name: "Ana", role: world.role },
    },
  }),
  useMembers: () => ({
    data: [
      { id: "m-ana", name: "Ana" },
      { id: "m-ben", name: "Ben" },
    ],
  }),
}));
vi.mock("@/services", async () => {
  const lib = await import("@/lib/shifts");
  return {
    shiftService: {
      listRange: async (_f: string, from: string, to: string) => {
        world.fromCalls.push(from);
        return world.shifts.filter((s) => s.start >= from && s.start < to);
      },
      claim: (id: string, member: string) => svc.claim(id, member),
      // behaves like the real service: validates first, flags overlaps, never blocks them
      createShift: async (
        fid: string,
        input: { start: string; end: string; assigned_member_id: string | null },
      ) => {
        const t = lib.validateShiftTimes(input.start, input.end);
        svc.createShift(fid, input);
        const shift = {
          id: `n${world.shifts.length + 1}`,
          family_id: fid,
          created_at: "2026-10-21T00:00:00Z",
          status: input.assigned_member_id ? "claimed" : "open",
          ...input,
          ...t,
        };
        const overlaps = lib.overlapsForMember(
          world.shifts,
          input.assigned_member_id,
          t.start,
          t.end,
        );
        world.shifts.push(shift);
        return { shift, overlaps };
      },
      updateShift: async (
        id: string,
        input: { start: string; end: string; assigned_member_id: string | null },
      ) => {
        const t = lib.validateShiftTimes(input.start, input.end);
        svc.updateShift(id, input);
        const s = world.shifts.find((x) => x.id === id)!;
        Object.assign(s, input, t, { status: input.assigned_member_id ? "claimed" : "open" });
        return {
          shift: s,
          overlaps: lib.overlapsForMember(
            world.shifts,
            input.assigned_member_id,
            t.start,
            t.end,
            id,
          ),
        };
      },
      cancelShift: async (id: string) => {
        svc.cancelShift(id);
        world.shifts = world.shifts.filter((x) => x.id !== id);
        return {};
      },
    },
  };
});

import { Route } from "@/routes/_authenticated/coverage";

import { mondayInZone, weekDays } from "@/lib/shifts";

/** An instant on the visible week: day offset from the family-timezone Monday, hour in UTC (14-20Z is daytime in New York). */
const at = (dayOffset: number, hour: number) =>
  `${weekDays(mondayInZone(new Date(), TZ))[dayOffset]}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const shift = (id: string, start: string, end: string, who: string | null) => ({
  id,
  family_id: "f1",
  start,
  end,
  assigned_member_id: who,
  status: who ? "claimed" : "open",
  created_at: "2026-10-01T00:00:00Z",
});
beforeEach(() => {
  world.role = "organizer";
  world.shifts = [];
  world.fromCalls = [];
  Object.values(svc).forEach((f) => f.mockReset());
  Object.values(toastSpy).forEach((f) => f.mockReset());
  svc.claim.mockResolvedValue({});
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
const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: string | RegExp, within_?: HTMLElement) => {
  const scope = within_ ? within(within_) : screen;
  await act(async () => {
    fireEvent.click(scope.getAllByRole("button", { name })[0]!);
  });
};
const dialog = () => screen.findByRole("dialog");
const shiftsSection = () => screen.findByRole("region", { name: "Shifts this week" });
const DAY = "2026-10-27"; // a Tuesday; 8:00 AM New York is 12:00Z (EDT)

describe("who can edit", () => {
  it("an organizer sees Add shift and Edit buttons", async () => {
    world.shifts = [shift("s1", at(1, 18), at(1, 22), "m-ben")];
    mount();
    await shiftsSection();
    expect(screen.getByRole("button", { name: /Add shift/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Edit / })).toHaveLength(1);
  });

  it("a family member sees the schedule but no Add, Edit or tap-to-edit controls, and can still claim", async () => {
    world.role = "member";
    world.shifts = [
      shift("s1", at(1, 18), at(1, 22), "m-ben"),
      shift("s2", at(2, 18), at(2, 22), null),
    ];
    mount();
    await shiftsSection();
    expect(screen.queryByRole("button", { name: /Add shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tap to edit|Tap to add one/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Cover / }).length).toBeGreaterThan(0);
  });
});

describe("create", () => {
  it("creates an OPEN shift, with times typed in the family's timezone", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    await dialog();
    set("Date", DAY);
    set("Start", "08:00");
    set("End", "14:00");
    await press("Save", await dialog());
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    const [fid, input] = svc.createShift.mock.calls[0]!;
    expect(fid).toBe("f1");
    expect(input).toEqual({
      start: "2026-10-27T12:00:00.000Z",
      end: "2026-10-27T18:00:00.000Z",
      assigned_member_id: null,
    });
    expect(toastSpy.success).toHaveBeenCalledWith("Shift saved");
  });

  it("creates an assigned overnight shift (an earlier end time means the next day)", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    await dialog();
    set("Date", DAY);
    set("Start", "20:00");
    set("End", "08:00");
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ben" } });
    await press("Save", await dialog());
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    expect(svc.createShift.mock.calls[0]![1]).toEqual({
      start: "2026-10-28T00:00:00.000Z",
      end: "2026-10-28T12:00:00.000Z",
      assigned_member_id: "m-ben",
    });
  });

  it("equal start and end is refused with a message and sends nothing", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    await dialog();
    set("Date", DAY);
    set("Start", "09:00");
    set("End", "09:00");
    await press("Save", await dialog());
    expect(await screen.findByRole("alert")).toHaveTextContent("The end must be after the start.");
    expect(svc.createShift).not.toHaveBeenCalled();
  });

  it("a missing date or time sends nothing", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    await dialog();
    set("Date", "");
    await press("Save", await dialog());
    expect(svc.createShift).not.toHaveBeenCalled();
  });
});

describe("needs completion: computed, shown, and clears", () => {
  it("an open shift is flagged in the list and on the grid; an assigned one is not", async () => {
    world.shifts = [
      shift("s1", at(1, 18), at(1, 22), null),
      shift("s2", at(2, 12), at(2, 18), "m-ben"),
    ];
    mount();
    const list = await shiftsSection();
    expect(within(list).getAllByTestId("needs-completion")).toHaveLength(1);
    expect(within(list).getByTestId("needs-completion")).toHaveTextContent(/no caregiver/);
    expect(screen.getAllByTestId("needs-completion-dot")).toHaveLength(1);
  });

  it("in the edit dialog the flag clears the moment a caregiver is chosen, and after saving the list shows none", async () => {
    world.shifts = [shift("s1", at(1, 18), at(1, 22), null)];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    const d = await dialog();
    expect(within(d).getByTestId("needs-completion")).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText("Caregiver"), { target: { value: "m-ana" } });
    expect(within(d).queryByTestId("needs-completion")).not.toBeInTheDocument();
    await press("Save", d);
    await waitFor(() => expect(svc.updateShift).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("needs-completion")).not.toBeInTheDocument());
  });
});

describe("edit, reassign, cancel", () => {
  it("edits times and reassigns", async () => {
    world.shifts = [shift("s1", at(1, 18), at(1, 22), "m-ben")];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    const d = await dialog();
    expect((within(d).getByLabelText("Start") as HTMLInputElement).value).toBe("14:00"); // 18:00Z = 2 PM New York
    fireEvent.change(within(d).getByLabelText("Caregiver"), { target: { value: "m-ana" } });
    fireEvent.change(within(d).getByLabelText("End"), { target: { value: "23:00" } });
    await press("Save", d);
    await waitFor(() =>
      expect(svc.updateShift).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ assigned_member_id: "m-ana" }),
      ),
    );
    expect(toastSpy.success).toHaveBeenCalledWith("Shift saved");
  });

  it("cancel asks first; 'Keep it' does nothing; confirming removes the shift (delete, no schema change)", async () => {
    world.shifts = [
      shift("s1", at(1, 18), at(1, 22), "m-ben"),
      shift("s2", at(2, 18), at(2, 22), "m-ana"),
    ];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    await press("Cancel shift", await dialog());
    expect(await screen.findByText("Cancel this shift?")).toBeInTheDocument();
    await press("Keep it", screen.getByRole("alertdialog"));
    expect(svc.cancelShift).not.toHaveBeenCalled();
    await press("Cancel shift", await dialog());
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel shift" }),
      );
    });
    await waitFor(() => expect(svc.cancelShift).toHaveBeenCalledWith("s1"));
    expect(toastSpy.success).toHaveBeenCalledWith("Shift canceled");
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Shifts this week" })).getAllByRole("listitem"),
      ).toHaveLength(1),
    );
  });
});

describe("overlap is flagged, never blocked", () => {
  it("warns live, saves anyway, and tells the organizer afterwards", async () => {
    world.shifts = [shift("s1", at(1, 12), at(1, 18), "m-ben")];
    mount();
    await shiftsSection();
    await press(/Add shift/);
    await dialog();
    const day = at(1, 12).slice(0, 10);
    set("Date", day);
    set("Start", "09:00"); // 13:00Z
    set("End", "13:00"); // 17:00Z, overlaps Ben's 12:00Z-18:00Z shift
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ben" } });
    expect(await screen.findByTestId("shift-overlap")).toHaveTextContent(
      /Ben is already scheduled/,
    );
    await press("Save", await dialog());
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    expect(toastSpy.warning).toHaveBeenCalledWith(expect.stringMatching(/Ben is also scheduled/));
  });

  it("two different people at the same time is not an overlap", async () => {
    world.shifts = [shift("s1", at(1, 12), at(1, 18), "m-ben")];
    mount();
    await shiftsSection();
    await press(/Add shift/);
    await dialog();
    set("Date", at(1, 12).slice(0, 10));
    set("Start", "09:00");
    set("End", "13:00");
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ana" } });
    expect(screen.queryByTestId("shift-overlap")).not.toBeInTheDocument();
  });

  it("an overnight shift shows as continuing into the next day", async () => {
    world.shifts = [shift("s1", at(1, 0), at(1, 12), "m-ben")]; // 8 PM-8 AM New York
    mount();
    expect(await screen.findByText(/\(next day\)/)).toBeInTheDocument();
  });
});

describe("errors from the service are shown, not swallowed", () => {
  it("shows a refused write inside the dialog and keeps it open", async () => {
    world.shifts = [shift("s1", at(1, 18), at(1, 22), "m-ben")];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    const mod = await import("@/services");
    vi.spyOn(mod.shiftService, "updateShift").mockRejectedValueOnce(
      new Error("You don't have permission to change this shift."),
    );
    await press("Save", await dialog());
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("existing behavior is preserved", () => {
  it("'Cover it' still claims the open block as the signed-in member", async () => {
    world.shifts = [shift("s1", at(2, 18), at(2, 22), null)];
    mount();
    const open = await screen.findByRole("region", { name: "Still open this week" });
    await act(async () => {
      fireEvent.click(within(open).getByRole("button", { name: /^Cover / }));
    });
    await waitFor(() => expect(svc.claim).toHaveBeenCalledWith("s1", "m-ana"));
  });

  it("week navigation still moves a week at a time", async () => {
    mount();
    await screen.findByRole("button", { name: "Next week" });
    await press("Next week");
    await waitFor(() => expect(world.fromCalls.length).toBeGreaterThan(1));
    const days = (Date.parse(world.fromCalls.at(-1)!) - Date.parse(world.fromCalls[0]!)) / 864e5;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    await press("Previous week");
    await waitFor(() =>
      expect(Date.parse(world.fromCalls.at(-1)!)).toBe(Date.parse(world.fromCalls[0]!)),
    );
  });
});
