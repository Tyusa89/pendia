// Joining a family with a family code: onboarding choices, the requester's waiting screen, and the organizer's code and request controls.
// The data layer is mocked; the database rules are covered by supabase/tests/family-join-code*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAM = "11111111-1111-4111-8111-111111111111";
const world = vi.hoisted(() => ({
  mine: [] as Array<{
    request_id: string;
    status: string;
    created_at: string;
    decided_at: string | null;
  }>,
  codeStatus: null as null | { enabled: boolean; rotated_at: string },
  requests: [] as Array<{
    request_id: string;
    requester_name: string;
    requester_email: string;
    created_at: string;
  }>,
  requestResult: "r1" as string | null,
  requestError: null as null | string,
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const request = vi.fn(async (_c: string, _n: string) => {
  if (world.requestError) throw new Error(world.requestError);
  return world.requestResult;
});
const cancel = vi.fn(async (_id: string) => undefined);
const rotateCode = vi.fn(async (_f: string) => "ABCD-2345-WXYZ");
const disableCode = vi.fn(async (_f: string) => undefined);
const decide = vi.fn(async (_id: string, _a: boolean, _flags?: unknown) => null as string | null);
const setActiveFamily = vi.fn(async (_f: string) => undefined);
const listMyFamilies = vi.fn(async () => [{ id: FAM, name: "The Secret Family Name" }]);
const joinDemo = vi.fn(async () => undefined);
const createFamily = vi.fn(async (_a: string, _b: string) => ({ id: FAM }));

vi.mock("sonner", () => ({ toast: toastSpy, Toaster: () => null }));
vi.mock("@/services", () => ({
  joinService: {
    request: (c: string, n: string) => request(c, n),
    myRequests: async () => world.mine,
    cancel: (id: string) => cancel(id),
    codeStatus: async () => world.codeStatus,
    rotateCode: (f: string) => rotateCode(f),
    disableCode: (f: string) => disableCode(f),
    requestsForFamily: async () => world.requests,
    decide: (id: string, a: boolean, flags?: unknown) => decide(id, a, flags),
  },
  familyService: {
    setActiveFamily: (f: string) => setActiveFamily(f),
    listMyFamilies: () => listMyFamilies(),
    joinDemo: () => joinDemo(),
    createFamily: (a: string, b: string) => createFamily(a, b),
    getMyFamily: async () => null,
  },
}));

import { JoinFamilyForm, JoinRequestStatus } from "@/components/JoinFamily";
import { ShareFamilyCode } from "@/components/FamilyJoinCode";
import { JoinRequests } from "@/components/JoinRequests";
import { Setup } from "@/routes/_authenticated/family";
import {
  CODE_DID_NOT_WORK,
  formatFamilyCode,
  isCompleteFamilyCode,
  joinErrorMessage,
  normalizeFamilyCode,
} from "@/lib/join-family";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  world.mine = [];
  world.codeStatus = null;
  world.requests = [];
  world.requestResult = "r1";
  world.requestError = null;
  [
    request,
    cancel,
    rotateCode,
    disableCode,
    decide,
    setActiveFamily,
    listMyFamilies,
    joinDemo,
    createFamily,
  ].forEach((m) => m.mockClear());
  toastSpy.success.mockClear();
  toastSpy.error.mockClear();
});
afterEach(cleanup);

describe("code helpers", () => {
  it("normalizes what people type", () => {
    expect(normalizeFamilyCode("ab12-cdoi l9")).toBe("AB12CD0119");
    expect(formatFamilyCode("abcd2345wxyz9999")).toBe("ABCD-2345-WXYZ");
    expect(isCompleteFamilyCode("abcd-2345-wxyz")).toBe(true);
    expect(isCompleteFamilyCode("abcd-2345")).toBe(false);
    expect(isCompleteFamilyCode("ABCD-2345-WXYU")).toBe(false); // U is not in the alphabet
  });
  it("turns database codes into plain language and never shows unknown text", () => {
    expect(joinErrorMessage("too_many_attempts")).toMatch(/Too many tries/);
    expect(joinErrorMessage("already_member")).toMatch(/already part/);
    expect(
      joinErrorMessage(
        "duplicate key value violates unique constraint family_join_request_one_pending",
      ),
    ).toBe("Something went wrong. Please try again.");
  });
});

describe("onboarding choices", () => {
  it("offers Create a Family and Join an Existing Family, create first", () => {
    wrap(<Setup />);
    const group = screen.getByRole("radiogroup");
    const create = within(group).getByRole("radio", { name: "Create a Family" });
    const join = within(group).getByRole("radio", { name: "Join an Existing Family" });
    expect(create.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("heading", { name: "Create your family" })).toBeTruthy();
    fireEvent.click(join);
    expect(join.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("heading", { name: "Join an existing family" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Explore the demo" })).toBeTruthy(); // demo entry is untouched
  });
  it("shows Pending approval instead of the choices while a request is open", async () => {
    world.mine = [
      { request_id: "r1", status: "pending", created_at: "2026-11-14T10:00:00Z", decided_at: null },
    ];
    wrap(<Setup />);
    expect(await screen.findByRole("heading", { name: "Pending approval" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("join form", () => {
  function fill(code: string, name: string) {
    fireEvent.change(screen.getByLabelText("Family code"), { target: { value: code } });
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: name } });
  }
  it("needs a complete code and a name, and formats the code as typed", () => {
    wrap(<JoinFamilyForm />);
    const send = screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement;
    fill("abcd23", "Rita");
    expect(send.disabled).toBe(true);
    fill("abcd2345wxyz", "Rita");
    expect((screen.getByLabelText("Family code") as HTMLInputElement).value).toBe("ABCD-2345-WXYZ");
    expect(send.disabled).toBe(false);
    fill("abcd2345wxyz", "   ");
    expect(send.disabled).toBe(true);
  });
  it("sends the request and refreshes the waiting state", async () => {
    wrap(<JoinFamilyForm />);
    fill("abcd2345wxyz", " Rita ");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("ABCD-2345-WXYZ", "Rita"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("gives ONE answer when the code did not work", async () => {
    world.requestResult = null;
    wrap(<JoinFamilyForm />);
    fill("abcd2345wxyz", "Rita");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect((await screen.findByRole("alert")).textContent).toBe(CODE_DID_NOT_WORK);
  });
  it("explains the guessing limit", async () => {
    world.requestError = "too_many_attempts";
    wrap(<JoinFamilyForm />);
    fill("abcd2345wxyz", "Rita");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Too many tries/);
  });
});

describe("requester waiting screen", () => {
  it("pending: says so, shows nothing about the family, can be canceled", async () => {
    world.mine = [
      { request_id: "r1", status: "pending", created_at: "2026-11-14T10:00:00Z", decided_at: null },
    ];
    const onStartOver = vi.fn();
    wrap(<JoinRequestStatus onStartOver={onStartOver} />);
    expect(await screen.findByRole("heading", { name: "Pending approval" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Secret Family Name/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(onStartOver).toHaveBeenCalled());
  });
  it("approved: makes the new family the active one", async () => {
    world.mine = [
      {
        request_id: "r1",
        status: "approved",
        created_at: "2026-11-14T10:00:00Z",
        decided_at: "2026-11-14T10:05:00Z",
      },
    ];
    wrap(<JoinRequestStatus onStartOver={() => undefined} />);
    await waitFor(() => expect(setActiveFamily).toHaveBeenCalledWith(FAM));
    expect(setActiveFamily).toHaveBeenCalledTimes(1);
  });
  it("declined: says it was not approved", async () => {
    world.mine = [
      {
        request_id: "r1",
        status: "declined",
        created_at: "2026-11-14T10:00:00Z",
        decided_at: "2026-11-14T10:05:00Z",
      },
    ];
    wrap(<JoinRequestStatus onStartOver={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Request not approved" })).toBeTruthy();
    expect(setActiveFamily).not.toHaveBeenCalled();
  });
});

describe("organizer: Share family code", () => {
  it("creates a code, shows it once, and never again after a reload", async () => {
    const first = wrap(<ShareFamilyCode familyId={FAM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a code" }));
    expect((await screen.findByTestId("family-code")).textContent).toBe("ABCD-2345-WXYZ");
    expect(rotateCode).toHaveBeenCalledWith(FAM);
    first.unmount();
    world.codeStatus = { enabled: true, rotated_at: "2026-11-14T10:00:00Z" };
    wrap(<ShareFamilyCode familyId={FAM} />);
    expect(await screen.findByText(/Joining with a code is on/)).toBeTruthy();
    expect(screen.queryByTestId("family-code")).toBeNull();
    expect(document.body.textContent).not.toMatch(/ABCD-2345/);
  });
  it("rotates and turns the code off", async () => {
    world.codeStatus = { enabled: true, rotated_at: "2026-11-14T10:00:00Z" };
    wrap(<ShareFamilyCode familyId={FAM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a new code" }));
    await waitFor(() => expect(rotateCode).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("switch", { name: /Joining with a family code is on/ }));
    await waitFor(() => expect(disableCode).toHaveBeenCalledWith(FAM));
  });
  it("offers to turn a disabled code back on with a NEW code", async () => {
    world.codeStatus = { enabled: false, rotated_at: "2026-11-14T10:00:00Z" };
    wrap(<ShareFamilyCode familyId={FAM} />);
    expect(await screen.findByText("Joining with a code is off.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on with a new code" })).toBeTruthy();
  });
});

describe("organizer: Join requests", () => {
  const row = {
    request_id: "q1",
    requester_name: "Rita Requester",
    requester_email: "rita@example.com",
    created_at: "2026-11-14T10:00:00Z",
  };
  it("says when no one is waiting", async () => {
    wrap(<JoinRequests familyId={FAM} />);
    expect(await screen.findByText(/No one is waiting/)).toBeTruthy();
  });
  it("starts with every viewing permission OFF and needs an explicit choice to approve", async () => {
    world.requests = [row];
    wrap(<JoinRequests familyId={FAM} />);
    expect(await screen.findByText("Rita Requester")).toBeTruthy();
    for (const label of ["Medications", "Schedule", "Visits"])
      expect(
        screen
          .getByRole("switch", { name: `Rita Requester can see ${label}` })
          .getAttribute("aria-checked"),
      ).toBe("false");
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(decide).not.toHaveBeenCalled();
  });
  it("approves with exactly the chosen permissions and states that upload stays off", async () => {
    world.requests = [row];
    wrap(<JoinRequests familyId={FAM} />);
    expect(await screen.findByText("Rita Requester")).toBeTruthy();
    expect(screen.getByText("rita@example.com")).toBeTruthy();
    expect(screen.getByText(/document upload stays off until you grant it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Rita Requester can see Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("q1", true, {
        meds: false,
        schedule: true,
        visits: false,
      }),
    );
    expect(toastSpy.success).toHaveBeenCalled();
  });
  it("declines", async () => {
    world.requests = [row];
    wrap(<JoinRequests familyId={FAM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("q1", false, undefined));
  });
  it("shows a plain message when the request was already answered", async () => {
    world.requests = [row];
    decide.mockRejectedValueOnce(new Error("request_not_pending"));
    wrap(<JoinRequests familyId={FAM} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Rita Requester can see Visits" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(toastSpy.error).toHaveBeenCalledWith("That request was already answered."),
    );
  });
});
