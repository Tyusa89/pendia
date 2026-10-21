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

const thisMonday = () => {
  const x = new Date();
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
const at = (dayOffset: number, hour: number) => {
  const d = thisMonday();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const shift = (id: string, start: string, end: string, who: string | null) => ({
  id,
  family_id: "f1",
  start,
  end,
  assigned_member_id: who,
  status: who ? "claimed" : "open",
  created_at: "2026-10-01T00:00:00Z",
});
const localInput = (iso: string) => {
  // what the form shows for an instant: wall-clock in the family timezone
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}`;
};

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
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: string | RegExp, i = 0) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name })[i]!);
  });
};
const shiftsSection = () => screen.findByRole("region", { name: "Shifts this week" });

describe("who can edit", () => {
  it("an organizer sees Add shift and Edit buttons", async () => {
    world.shifts = [shift("s1", at(1, 14), at(1, 20), "m-ben")];
    mount();
    await shiftsSection();
    expect(screen.getByRole("button", { name: /Add shift/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Edit / }).length).toBe(1);
  });

  it("a family member sees the schedule but no Add, Edit, or tap-to-edit controls", async () => {
    world.role = "member";
    world.shifts = [
      shift("s1", at(1, 14), at(1, 20), "m-ben"),
      shift("s2", at(2, 14), at(2, 20), null),
    ];
    mount();
    await shiftsSection();
    expect(screen.queryByRole("button", { name: /Add shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tap to edit|Tap to add a shift/)).not.toBeInTheDocument();
    // the existing claim flow is still offered to members
    expect(screen.getByRole("button", { name: /^Cover / })).toBeInTheDocument();
  });
});

describe("create", () => {
  it("creates an OPEN shift from the form, with times typed in the family's timezone", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    const day = localInput(at(1, 12)).slice(0, 10);
    type("Starts", `${day}T08:00`);
    type("Ends", `${day}T14:00`);
    await press("Add shift");
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    const [fid, input] = svc.createShift.mock.calls[0]!;
    expect(fid).toBe("f1");
    expect(input.assigned_member_id).toBeNull();
    // 8:00 AM New York (EDT/EST) is 12:00Z or 13:00Z, never the device's clock
    expect(["12:00", "13:00"]).toContain(new Date(input.start).toISOString().slice(11, 16));
    expect(Date.parse(input.end) - Date.parse(input.start)).toBe(6 * 3600_000);
    expect(toastSpy.success).toHaveBeenCalledWith("Shift added");
  });

  it("creates an assigned overnight shift (end on the next day)", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    const d1 = localInput(at(1, 12)).slice(0, 10);
    const d2 = localInput(at(2, 12)).slice(0, 10);
    type("Starts", `${d1}T20:00`);
    type("Ends", `${d2}T08:00`);
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ben" } });
    await press("Add shift");
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    const input = svc.createShift.mock.calls[0]![1];
    expect(input.assigned_member_id).toBe("m-ben");
    expect(Date.parse(input.end) - Date.parse(input.start)).toBe(12 * 3600_000);
  });

  it("an invalid range shows a message and sends nothing", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    const day = localInput(at(1, 12)).slice(0, 10);
    type("Starts", `${day}T14:00`);
    type("Ends", `${day}T08:00`);
    await press("Add shift");
    expect(await screen.findByRole("alert")).toHaveTextContent("The end must be after the start.");
    expect(svc.createShift).not.toHaveBeenCalled();
  });

  it("an empty time shows a message and sends nothing", async () => {
    mount();
    await screen.findByRole("button", { name: /Add shift/ });
    await press(/Add shift/);
    type("Starts", "");
    await press("Add shift");
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid start/);
    expect(svc.createShift).not.toHaveBeenCalled();
  });
});

describe("needs completion: computed, shown, and clears", () => {
  it("an open shift is flagged in the list and on the grid, and the flag is gone for an assigned one", async () => {
    world.shifts = [
      shift("s1", at(1, 14), at(1, 20), null),
      shift("s2", at(2, 8), at(2, 14), "m-ben"),
    ];
    mount();
    const list = await shiftsSection();
    expect(within(list).getAllByTestId("needs-completion")).toHaveLength(1);
    expect(within(list).getByTestId("needs-completion")).toHaveTextContent(/no caregiver/);
    expect(screen.getAllByTestId("needs-completion-dot")).toHaveLength(1);
  });

  it("in the edit form the flag clears the moment a caregiver is chosen, and after saving the list shows none", async () => {
    world.shifts = [shift("s1", at(1, 14), at(1, 20), null)];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    const form = screen.getByRole("form", { name: "Edit shift" });
    expect(within(form).getByTestId("needs-completion")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Caregiver"), { target: { value: "m-ana" } });
    expect(within(form).queryByTestId("needs-completion")).not.toBeInTheDocument();
    await press("Save shift");
    await waitFor(() => expect(svc.updateShift).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("needs-completion")).not.toBeInTheDocument());
  });
});

describe("edit, reassign, cancel", () => {
  it("edits times and reassigns", async () => {
    world.shifts = [shift("s1", at(1, 14), at(1, 20), "m-ben")];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe(localInput(at(1, 14)));
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ana" } });
    const day = localInput(at(1, 14)).slice(0, 10);
    type("Ends", `${day}T23:00`);
    await press("Save shift");
    await waitFor(() =>
      expect(svc.updateShift).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ assigned_member_id: "m-ana" }),
      ),
    );
    expect(toastSpy.success).toHaveBeenCalledWith("Shift saved");
  });

  it("cancel asks first; 'Keep it' does nothing; confirming removes the shift", async () => {
    world.shifts = [
      shift("s1", at(1, 14), at(1, 20), "m-ben"),
      shift("s2", at(2, 14), at(2, 20), "m-ana"),
    ];
    mount();
    await shiftsSection();
    await press(/^Edit /, 0);
    await press(/Cancel this shift/);
    expect(await screen.findByText("Cancel this shift?")).toBeInTheDocument();
    await press("Keep it");
    expect(svc.cancelShift).not.toHaveBeenCalled();
    await press(/Cancel this shift/);
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
    const day = localInput(at(1, 12)).slice(0, 10);
    type("Starts", `${day}T09:00`);
    type("Ends", `${day}T16:00`);
    fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "m-ben" } });
    expect(await screen.findByTestId("shift-overlap")).toHaveTextContent(
      /Ben is already scheduled/,
    );
    await press("Add shift");
    await waitFor(() => expect(svc.createShift).toHaveBeenCalled());
    expect(toastSpy.warning).toHaveBeenCalledWith(expect.stringMatching(/Ben is also scheduled/));
  });

  it("an overnight shift shows as continuing into the next day", async () => {
    world.shifts = [shift("s1", at(1, 0), at(1, 12), "m-ben")];
    mount();
    expect(await screen.findByText(/\(next day\)/)).toBeInTheDocument();
  });
});

describe("errors from the service are shown, not swallowed", () => {
  it("shows a refused write inline and keeps the form open", async () => {
    world.shifts = [shift("s1", at(1, 14), at(1, 20), "m-ben")];
    mount();
    await shiftsSection();
    await press(/^Edit /);
    const mod = await import("@/services");
    vi.spyOn(mod.shiftService, "updateShift").mockRejectedValueOnce(
      new Error("You don't have permission to change this shift."),
    );
    await press("Save shift");
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/);
    expect(screen.getByRole("form", { name: "Edit shift" })).toBeInTheDocument();
  });
});

describe("existing behavior is preserved", () => {
  it("'Cover it' still claims the open block as the signed-in member", async () => {
    world.shifts = [shift("s1", at(2, 14), at(2, 20), null)];
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
    const first = Date.parse(world.fromCalls[0]!);
    const second = Date.parse(world.fromCalls.at(-1)!);
    expect(second - first).toBe(7 * 864e5);
    await press("Previous week");
    await waitFor(() => expect(Date.parse(world.fromCalls.at(-1)!)).toBe(first));
  });
});
