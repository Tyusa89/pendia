// UI tests for V1 appointments: list views, create/edit forms, cancel/archive, and the computed flags.
// Fictional data only. The database rules are proven in supabase/tests/appointments.test.sql.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calls,
  FAMILY,
  fakeVisitService,
  makeRow,
  NOW_ISO,
  resetStore,
  store,
  TZ,
} from "./fake-visits";

const navigate = vi.fn();
const toastSpy = { success: vi.fn(), error: vi.fn() };
const ctx = { role: "organizer" as "organizer" | "member" };

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSpy.success(...a),
    error: (...a: unknown[]) => toastSpy.error(...a),
  },
}));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children: ReactNode;
    }) => (
      <a href={to.replace("$id", params?.["id"] ?? "")} {...rest}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/services", async () => {
  const { fakeVisitService: svc } = await import("./fake-visits");
  return { visitService: svc, memberService: {} };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: {
        id: "aaaaaaaa-0000-4000-8000-00000000000a",
        name: "Test Family",
        timezone: "America/New_York",
      },
      me: {
        id: "mem-1",
        family_id: "aaaaaaaa-0000-4000-8000-00000000000a",
        name: "Maria",
        role: ctx.role,
      },
    },
  }),
  useMembers: () => ({ data: [{ id: "mem-1", name: "Maria" }] }),
}));

import { AppointmentEditor } from "@/components/AppointmentEditor";
import { AppointmentList } from "@/components/AppointmentList";
import { AppointmentSummary } from "@/components/AppointmentSummary";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW_ISO), toFake: ["Date"] }); // freeze "now" so upcoming/past is deterministic
  ctx.role = "organizer";
  navigate.mockClear();
  toastSpy.success.mockClear();
  toastSpy.error.mockClear();
  resetStore();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const list = (canWrite = true) => (
  <AppointmentList familyId={FAMILY} timeZone={TZ} canWrite={canWrite} />
);
const editor = (appointmentId?: string, canWrite = true) => (
  <AppointmentEditor
    familyId={FAMILY}
    timeZone={TZ}
    canWrite={canWrite}
    {...(appointmentId ? { appointmentId } : {})}
    onDone={(id) => navigate({ done: id })}
    onCancel={() => navigate({ cancelled: true })}
  />
);
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
const openTab = async (name: RegExp) => {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
  });
};
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("list: upcoming / past / archived", () => {
  beforeEach(() => {
    resetStore([
      makeRow({ id: "up1", provider_name: "Dr. Soon", scheduled_start: "2026-11-12T15:00:00Z" }),
      makeRow({ id: "up2", provider_name: "Dr. Later", scheduled_start: "2026-12-05T15:00:00Z" }),
      makeRow({
        id: "past-missed",
        provider_name: "Dr. Missed",
        scheduled_start: "2026-10-01T15:00:00Z",
      }),
      makeRow({
        id: "done",
        provider_name: "Dr. Done",
        status: "completed",
        scheduled_start: null,
        date: "2026-09-01",
        office_address: null,
        office_phone: null,
      }),
      makeRow({
        id: "cx",
        provider_name: "Dr. Canceled",
        status: "canceled",
        scheduled_start: "2026-11-15T15:00:00Z",
      }),
      makeRow({
        id: "arch",
        provider_name: "Dr. Archived",
        status: "completed",
        archived_at: "2026-11-01T00:00:00Z",
      }),
    ]);
  });

  it("puts each appointment in the right view, soonest first, with counts", async () => {
    renderWithClient(list());
    expect(await screen.findByRole("tab", { name: "Upcoming (2)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Past (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Archived (1)" })).toBeInTheDocument();
    const up = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(up[0]).toContain("Dr. Soon");
    expect(up[1]).toContain("Dr. Later");
    await openTab(/Past/);
    expect(await screen.findByText("Dr. Done")).toBeInTheDocument();
    expect(screen.getByText("Dr. Canceled")).toBeInTheDocument();
    expect(screen.getByText("Dr. Missed")).toBeInTheDocument();
    expect(screen.getByText("Canceled")).toBeInTheDocument();
    await openTab(/Archived/);
    expect(await screen.findByText("Dr. Archived")).toBeInTheDocument();
  });

  it("legacy recorded visits (no scheduled time) show under Past and are NOT flagged incomplete", async () => {
    renderWithClient(list());
    await screen.findByRole("tab", { name: /Past/ });
    await openTab(/Past/);
    const card = (await screen.findByText("Dr. Done")).closest("a")!;
    expect(within(card).queryByTestId("incomplete-flag")).not.toBeInTheDocument();
  });

  it("only organizers get the New appointment button", async () => {
    const { unmount } = renderWithClient(list(true));
    expect(await screen.findByRole("link", { name: /New appointment/ })).toHaveAttribute(
      "href",
      "/visits/new",
    );
    unmount();
    renderWithClient(list(false));
    await screen.findByRole("tab", { name: /Upcoming/ });
    expect(screen.queryByRole("link", { name: /New appointment/ })).not.toBeInTheDocument();
  });

  it("shows friendly empty states", async () => {
    resetStore([]);
    renderWithClient(list());
    expect(await screen.findByText(/No upcoming appointments/)).toBeInTheDocument();
  });
});

describe("incomplete indicator (computed)", () => {
  it("flags an upcoming appointment that is missing provider, address or phone, naming exactly what is missing", async () => {
    resetStore([
      makeRow({ id: "a", provider_name: "Dr. Whole", scheduled_start: "2026-11-12T15:00:00Z" }),
      makeRow({
        id: "b",
        provider_name: "Dr. NoPhone",
        office_phone: null,
        scheduled_start: "2026-11-13T15:00:00Z",
      }),
      makeRow({
        id: "c",
        provider_name: null,
        office_address: "  ",
        office_phone: null,
        scheduled_start: "2026-11-14T15:00:00Z",
      }),
    ]);
    renderWithClient(list());
    const flags = await screen.findAllByTestId("incomplete-flag");
    expect(flags.map((f) => f.textContent?.trim())).toEqual([
      "Incomplete: missing phone number",
      "Incomplete: missing provider, address, phone number",
    ]);
    expect(screen.getByText("Provider not set")).toBeInTheDocument(); // a label, not a stored or invented value
  });

  it("does not flag canceled appointments", async () => {
    resetStore([
      makeRow({
        id: "x",
        status: "canceled",
        provider_name: null,
        office_phone: null,
        scheduled_start: "2026-11-12T15:00:00Z",
      }),
    ]);
    renderWithClient(list());
    await screen.findByRole("tab", { name: /Past/ });
    await openTab(/Past/);
    await screen.findByText("Canceled");
    expect(screen.queryByTestId("incomplete-flag")).not.toBeInTheDocument();
  });

  it("the flag CLEARS when the missing field is filled in on edit, and the list updates", async () => {
    resetStore([
      makeRow({
        id: "e1",
        provider_name: "Dr. Edit",
        office_phone: null,
        scheduled_start: "2026-11-12T15:00:00Z",
      }),
    ]);
    renderWithClient(
      <>
        {editor("e1")}
        {list()}
      </>,
    );
    expect(await screen.findByTestId("incomplete-flag")).toHaveTextContent("missing phone number");
    expect(
      screen.getByText(/Not set\. This appointment will show as incomplete/),
    ).toBeInTheDocument(); // live hint under the phone field
    type("Office phone", "555-0199");
    expect(
      screen.queryByText(/Not set\. This appointment will show as incomplete/),
    ).not.toBeInTheDocument(); // hint clears as you type
    await click("Save changes");
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("incomplete-flag")).not.toBeInTheDocument());
    expect(store.rows[0]!.office_phone).toBe("555-0199");
    expect(store.rows[0]!.provider_name).toBe("Dr. Edit"); // nothing else was touched
  });

  it("the flag comes back if the field is cleared again", async () => {
    resetStore([makeRow({ id: "e2", scheduled_start: "2026-11-12T15:00:00Z" })]);
    renderWithClient(
      <>
        {editor("e2")}
        {list()}
      </>,
    );
    await screen.findByLabelText("Office phone");
    expect(screen.queryByTestId("incomplete-flag")).not.toBeInTheDocument();
    type("Office phone", "   ");
    await click("Save changes");
    expect(await screen.findByTestId("incomplete-flag")).toHaveTextContent("missing phone number");
    expect(store.rows[0]!.office_phone).toBeNull(); // blank is stored as absent, not as spaces or a placeholder
  });
});

describe("overlap indicator (flags, never blocks)", () => {
  it("flags both appointments and still lets a caregiver save the overlapping one", async () => {
    resetStore([
      makeRow({
        id: "o1",
        provider_name: "Dr. One",
        scheduled_start: "2026-12-01T15:00:00Z",
        scheduled_end: "2026-12-01T16:00:00Z",
      }),
    ]);
    renderWithClient(
      <>
        {editor()}
        {list()}
      </>,
    );
    await screen.findByLabelText("Starts");
    type("Starts", "2026-12-01T10:30"); // 15:30Z, inside Dr. One's slot
    type("Ends (optional)", "2026-12-01T11:30");
    type("Doctor or provider", "Dr. Two");
    expect(await screen.findByTestId("form-overlap-warning")).toHaveTextContent(
      "overlaps with Dr. One",
    );
    expect(screen.getByTestId("form-overlap-warning")).toHaveTextContent("You can still save it");
    await click("Add appointment");
    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1)); // not blocked
    const flags = await screen.findAllByTestId("overlap-flag");
    expect(flags).toHaveLength(2);
    expect(flags[0]).toHaveTextContent("Overlaps with another appointment");
  });

  it("back-to-back appointments are not flagged", async () => {
    resetStore([
      makeRow({
        id: "b1",
        scheduled_start: "2026-12-01T15:00:00Z",
        scheduled_end: "2026-12-01T16:00:00Z",
      }),
      makeRow({
        id: "b2",
        scheduled_start: "2026-12-01T16:00:00Z",
        scheduled_end: "2026-12-01T17:00:00Z",
      }),
    ]);
    renderWithClient(list());
    await screen.findByRole("tab", { name: "Upcoming (2)" });
    expect(screen.queryByTestId("overlap-flag")).not.toBeInTheDocument();
  });
});

describe("create form", () => {
  it("requires only a date and time: an empty submit explains and saves nothing", async () => {
    renderWithClient(editor());
    await screen.findByLabelText("Starts");
    await click("Add appointment");
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose a date and time/);
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("saves an appointment with only a time, leaving everything else null (it will be flagged, never filled in)", async () => {
    renderWithClient(
      <>
        {editor()}
        {list()}
      </>,
    );
    await screen.findByLabelText("Starts");
    type("Starts", "2026-12-01T10:00");
    await click("Add appointment");
    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create).toHaveBeenCalledWith(FAMILY, {
      provider_name: null,
      office_name: null,
      office_address: null,
      office_phone: null,
      scheduled_start: "2026-12-01T15:00:00.000Z",
      scheduled_end: null,
      reason: null,
      notes: null,
      confirmation_status: "unconfirmed",
    });
    expect(navigate).toHaveBeenCalledWith({ done: expect.any(String) });
    expect(await screen.findByTestId("incomplete-flag")).toHaveTextContent(
      "missing provider, address, phone number",
    );
  });

  it("converts the typed time using the FAMILY's timezone and trims text", async () => {
    renderWithClient(editor());
    await screen.findByLabelText("Starts");
    type("Starts", "2026-07-01T10:00"); // EDT: UTC-4
    type("Ends (optional)", "2026-07-01T10:45");
    type("Doctor or provider", "  Dr. Patel  ");
    type("Office or clinic name", "Patel Family Medicine");
    type("Office address", "12 Example Rd\nSpringfield");
    type("Office phone", "(212) 555-0100");
    type("Reason for the visit", "Blood test");
    type("Notes", "Bring the medication list");
    fireEvent.click(screen.getByLabelText(/Confirmed with the office/));
    await click("Add appointment");
    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create).toHaveBeenCalledWith(FAMILY, {
      provider_name: "Dr. Patel",
      office_name: "Patel Family Medicine",
      office_address: "12 Example Rd\nSpringfield",
      office_phone: "(212) 555-0100",
      scheduled_start: "2026-07-01T14:00:00.000Z",
      scheduled_end: "2026-07-01T14:45:00.000Z",
      reason: "Blood test",
      notes: "Bring the medication list",
      confirmation_status: "confirmed",
    });
  });

  it("does not reformat the office phone number (no invented values)", async () => {
    renderWithClient(editor());
    await screen.findByLabelText("Starts");
    type("Starts", "2026-12-01T10:00");
    type("Office phone", "555-0100 ext. 4");
    await click("Add appointment");
    await waitFor(() => expect(calls.create).toHaveBeenCalled());
    expect(calls.create.mock.calls[0]![1].office_phone).toBe("555-0100 ext. 4");
  });

  it("rejects an end before the start, and a time that does not exist when clocks change", async () => {
    renderWithClient(editor());
    await screen.findByLabelText("Starts");
    type("Starts", "2026-12-01T10:00");
    type("Ends (optional)", "2026-12-01T09:00");
    await click("Add appointment");
    expect(screen.getByRole("alert")).toHaveTextContent(/end time can't be before/);
    type("Ends (optional)", "");
    type("Starts", "2026-03-08T02:30"); // skipped hour
    await click("Add appointment");
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn't exist/);
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("surfaces a save failure without losing the form", async () => {
    vi.spyOn(fakeVisitService, "createAppointment").mockRejectedValueOnce(
      new Error("Network down"),
    );
    renderWithClient(editor());
    await screen.findByLabelText("Starts");
    type("Starts", "2026-12-01T10:00");
    type("Doctor or provider", "Dr. Keep");
    await click("Add appointment");
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    expect((screen.getByLabelText("Doctor or provider") as HTMLInputElement).value).toBe(
      "Dr. Keep",
    );
    expect(navigate).not.toHaveBeenCalledWith({ done: expect.anything() });
  });

  it("members cannot add or change appointments (the database enforces the same rule)", async () => {
    renderWithClient(editor(undefined, false));
    expect(
      await screen.findByText(/Only the organizer can add or change appointments/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
  });
});

describe("edit form", () => {
  it("is prefilled in the family's timezone and saves through update (not create)", async () => {
    resetStore([
      makeRow({
        id: "ed",
        provider_name: "Dr. Prefill",
        office_name: "Clinic",
        reason: "Checkup",
        scheduled_start: "2026-12-01T15:00:00Z",
        scheduled_end: "2026-12-01T15:30:00Z",
        confirmation_status: "confirmed",
      }),
    ]);
    renderWithClient(editor("ed"));
    expect(((await screen.findByLabelText("Starts")) as HTMLInputElement).value).toBe(
      "2026-12-01T10:00",
    );
    expect((screen.getByLabelText("Ends (optional)") as HTMLInputElement).value).toBe(
      "2026-12-01T10:30",
    );
    expect((screen.getByLabelText("Doctor or provider") as HTMLInputElement).value).toBe(
      "Dr. Prefill",
    );
    expect((screen.getByLabelText(/Confirmed with the office/) as HTMLInputElement).checked).toBe(
      true,
    );
    type("Reason for the visit", "Follow-up");
    await click("Save changes");
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.update.mock.calls[0]![0]).toBe("ed");
    expect(calls.update.mock.calls[0]![1]).toMatchObject({
      reason: "Follow-up",
      provider_name: "Dr. Prefill",
      scheduled_start: "2026-12-01T15:00:00.000Z",
    });
  });

  it("says so if the appointment does not exist", async () => {
    renderWithClient(editor("nope"));
    expect(await screen.findByText(/couldn't be found/)).toBeInTheDocument();
  });
});

describe("appointment details: cancel and archive", () => {
  const summary = (v: ReturnType<typeof makeRow>, canWrite = true) => (
    <AppointmentSummary visit={v} timeZone={TZ} canWrite={canWrite} overlapCount={0} />
  );

  it("shows what is set, and 'Not set' (never a made-up value) for what is not", async () => {
    renderWithClient(
      summary(
        makeRow({ provider_name: null, office_phone: null, office_address: "12 Example Rd" }),
      ),
    );
    expect(screen.getAllByText("Not set")).toHaveLength(2); // provider + phone
    expect(screen.getByText("12 Example Rd")).toBeInTheDocument();
    expect(screen.getByTestId("incomplete-flag")).toHaveTextContent(
      "missing provider, phone number",
    );
  });

  it("links the office phone so it can be tapped to call", async () => {
    renderWithClient(summary(makeRow({ office_phone: "(212) 555-0100" })));
    expect(screen.getByRole("link", { name: /\(212\) 555-0100/ })).toHaveAttribute(
      "href",
      "tel:2125550100",
    );
  });

  it("cancel asks first; 'Keep it' does nothing; confirming marks it canceled and moves it to Past", async () => {
    resetStore([
      makeRow({ id: "c1", provider_name: "Dr. Cancel", scheduled_start: "2026-11-12T15:00:00Z" }),
    ]);
    renderWithClient(
      <>
        {summary(store.rows[0]!)}
        {list()}
      </>,
    );
    await screen.findByRole("tab", { name: "Upcoming (1)" });
    await click("Cancel appointment");
    expect(await screen.findByText("Cancel this appointment?")).toBeInTheDocument();
    expect(screen.getByText(/does not contact the office/)).toBeInTheDocument();
    await click("Keep it");
    expect(calls.cancel).not.toHaveBeenCalled();
    await click("Cancel appointment");
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel appointment" }),
      );
    });
    await waitFor(() => expect(calls.cancel).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Upcoming (0)" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Past (1)" })).toBeInTheDocument();
    expect(store.rows[0]!.status).toBe("canceled"); // kept, not deleted
    expect(toastSpy.success).toHaveBeenCalledWith("Appointment canceled");
  });

  it("an upcoming appointment can't be archived directly (cancel it first); a canceled one can, and can be restored", async () => {
    resetStore([
      makeRow({ id: "ar", provider_name: "Dr. Archive", scheduled_start: "2026-11-12T15:00:00Z" }),
    ]);
    const { rerender } = renderWithClient(
      <>
        {summary(store.rows[0]!)}
        {list()}
      </>,
    );
    await screen.findByRole("tab", { name: "Upcoming (1)" });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();

    store.rows[0]!.status = "canceled";
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        {summary(store.rows[0]!)}
        {list()}
      </QueryClientProvider>,
    );
    await click("Archive");
    expect(await screen.findByText("Archive this appointment?")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is deleted/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
      );
    });
    await waitFor(() => expect(calls.archive).toHaveBeenCalledWith("ar"));
    expect(store.rows[0]!.archived_at).not.toBeNull();
    expect(store.rows).toHaveLength(1); // archived, never deleted

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        {summary(store.rows[0]!)}
      </QueryClientProvider>,
    );
    await click("Restore from archive");
    await waitFor(() => expect(calls.unarchive).toHaveBeenCalledWith("ar"));
    expect(store.rows[0]!.archived_at).toBeNull();
  });

  it("mark completed asks first; 'Keep it' does nothing; confirming completes it, keeps every detail, and moves it to Past", async () => {
    resetStore([
      makeRow({
        id: "m1",
        provider_name: "Dr. Done",
        office_address: "1 Example Rd",
        notes: "Bring list",
        transcript: [{ speaker: "A", text: "synthetic" }],
        scheduled_start: "2026-11-12T15:00:00Z",
      }),
    ]);
    const before = JSON.stringify(store.rows[0]);
    renderWithClient(
      <>
        {summary(store.rows[0]!)}
        {list()}
      </>,
    );
    await screen.findByRole("tab", { name: "Upcoming (1)" });
    await click("Mark visit completed");
    expect(await screen.findByText("Mark this visit as completed?")).toBeInTheDocument();
    expect(screen.getByText(/nothing is recorded or summarized automatically/)).toBeInTheDocument();
    await click("Keep it");
    expect(calls.complete).not.toHaveBeenCalled();
    await click("Mark visit completed");
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark completed" }),
      );
    });
    await waitFor(() => expect(calls.complete).toHaveBeenCalledWith("m1"));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Upcoming (0)" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Past (1)" })).toBeInTheDocument();
    expect(JSON.parse(JSON.stringify({ ...store.rows[0], status: "scheduled" }))).toEqual(
      JSON.parse(before),
    ); // status is the ONLY thing that changed
    expect(store.rows[0]!.status).toBe("completed");
    expect(toastSpy.success).toHaveBeenCalledWith("Marked as completed");
  });

  it("a failed completion shows the error and leaves the appointment scheduled", async () => {
    resetStore([makeRow({ id: "m2", scheduled_start: "2026-11-12T15:00:00Z" })]);
    calls.complete.mockImplementationOnce(() => {
      throw new Error("Could not save. Try again.");
    });
    renderWithClient(summary(store.rows[0]!));
    await click("Mark visit completed");
    await act(async () => {
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Mark completed",
        }),
      );
    });
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith("Could not save. Try again."));
    expect(store.rows[0]!.status).toBe("scheduled");
  });

  it("no completion control for canceled, completed or archived appointments", async () => {
    for (const over of [
      { status: "canceled" },
      { status: "completed" },
      { archived_at: "2026-11-01T00:00:00Z" },
    ]) {
      const { unmount } = renderWithClient(summary(makeRow(over)));
      expect(
        screen.queryByRole("button", { name: /Mark visit completed/ }),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("members get no completion control", async () => {
    renderWithClient(summary(makeRow({}), false));
    expect(screen.queryByRole("button", { name: /Mark visit completed/ })).not.toBeInTheDocument();
  });

  it("members see the details but none of the edit, cancel or archive controls", async () => {
    renderWithClient(summary(makeRow({ provider_name: "Dr. ReadOnly" }), false));
    expect(screen.queryByRole("link", { name: /Edit appointment/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cancel appointment|Archive|Restore/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dr. ReadOnly")).toBeInTheDocument();
  });

  it("organizers get an Edit link to the edit page", async () => {
    renderWithClient(summary(makeRow({ id: "lnk" })));
    expect(screen.getByRole("link", { name: /Edit appointment/ })).toHaveAttribute(
      "href",
      "/visits/edit/lnk",
    );
  });
});
