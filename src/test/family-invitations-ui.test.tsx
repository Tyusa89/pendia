// Family invitations in the app: the organizer's controls, the invite form, and the public /invite page. The data layer is mocked.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAM = "11111111-1111-4111-8111-111111111111";
const world = vi.hoisted(() => ({
  invites: [] as Array<Record<string, unknown>>,
  pending: [] as Array<{
    invite_id: string;
    family_name: string;
    member_name: string;
    invited_by_name: string | null;
    expires_at: string;
  }>,
  signedIn: false,
  judge: false,
  email: "invitee@example.com",
}));
const navigate = vi.fn();
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const send = vi.fn(async (_m: string, _e: string) => ({ code: "sent" as const, inviteId: "i1" }));
const revoke = vi.fn(async (_id: string) => undefined);
const accept = vi.fn(async (_id: string) => FAM);
const addMember = vi.fn(async (_m: Record<string, unknown>) => ({ id: "new-member" }));
const setActiveFamily = vi.fn(async (_f: string) => undefined);
const sendMagicLink = vi.fn(async (_e: string) => ({ error: null as null | { message: string } }));
const signOut = vi.fn(async () => undefined);

vi.mock("sonner", () => ({ toast: toastSpy, Toaster: () => null }));
vi.mock("@/lib/judge-demo", () => ({
  isJudgeDemo: () => world.judge,
  assertDemoWritable: () => undefined,
  JUDGE_DEMO_READ_ONLY_MESSAGE: "demo",
}));
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
vi.mock("@/services", () => ({
  inviteService: {
    listForFamily: async () => world.invites,
    myPending: async () => world.pending,
    send: (m: string, e: string) => send(m, e),
    revoke: (id: string) => revoke(id),
    accept: (id: string) => accept(id),
  },
  familyService: {
    addMember: (m: Record<string, unknown>) => addMember(m),
    updateMember: vi.fn(),
    setActiveFamily: (f: string) => setActiveFamily(f),
  },
  authService: {
    sendMagicLink: (e: string) => sendMagicLink(e),
    currentEmail: async () => world.email,
    signOut: () => signOut(),
    onSignedInChange: (cb: (s: boolean) => void) => {
      cb(world.signedIn);
      return () => undefined;
    },
  },
}));

import { Invite, MemberRow } from "@/components/FamilyMembers";
import { Route as InviteRoute, linkProblem, readLinkProblem } from "@/routes/invite";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);
const member = (over: object = {}) => ({
  id: "mem-a",
  family_id: FAM,
  name: "Member A",
  role: "member",
  phone: null,
  language: "en",
  user_id: null,
  can_see_meds: true,
  can_see_schedule: true,
  can_see_visits: true,
  can_upload_documents: false,
  created_at: "",
  ...over,
});
const inv = (over: object = {}) => ({
  id: "i1",
  family_id: FAM,
  member_id: "mem-a",
  invited_email: "p@example.com",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 5 * 864e5).toISOString(),
  accepted_at: null,
  revoked_at: null,
  delivery_status: "sent",
  last_sent_at: null,
  ...over,
});

beforeEach(() => {
  world.invites = [];
  world.pending = [];
  world.signedIn = false;
  world.judge = false;
  for (const f of [
    navigate,
    send,
    revoke,
    accept,
    addMember,
    setActiveFamily,
    sendMagicLink,
    signOut,
    toastSpy.success,
    toastSpy.error,
  ])
    f.mockClear();
  window.history.replaceState(null, "", "/invite");
});
afterEach(cleanup);

describe("organizer invitation controls on a member card", () => {
  it("an unlinked member with no invitation: type an email, send it", async () => {
    render(wrap(<MemberRow m={member() as never} editable />));
    const button = await screen.findByRole("button", { name: "Send invitation" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email for the invitation"), {
      target: { value: "p@example.com" },
    });
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(send).toHaveBeenCalledWith("mem-a", "p@example.com");
  });
  it("a pending invitation shows its status, address and expiry, with Resend and Withdraw", async () => {
    world.invites = [inv()];
    render(wrap(<MemberRow m={member() as never} editable />));
    expect(await screen.findByText("Invitation sent")).toBeInTheDocument();
    expect(screen.getByText("p@example.com")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));
    });
    expect(send).toHaveBeenCalledWith("mem-a", "p@example.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Withdraw/ }));
    });
    expect(revoke).toHaveBeenCalledWith("i1");
  });
  it("an email that could not be sent is called out and can be resent", async () => {
    world.invites = [inv({ delivery_status: "failed" })];
    render(wrap(<MemberRow m={member() as never} editable />));
    expect(await screen.findByText("Email not sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend invitation" })).toBeEnabled();
  });
  it("an expired invitation says so and can be resent; a withdrawn one offers a fresh send", async () => {
    world.invites = [inv({ expires_at: new Date(Date.now() - 864e5).toISOString() })];
    const { unmount } = render(wrap(<MemberRow m={member() as never} editable />));
    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend invitation" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
    unmount();
    world.invites = [inv({ revoked_at: new Date().toISOString() })];
    render(wrap(<MemberRow m={member() as never} editable />));
    expect(await screen.findByText("Invitation withdrawn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeInTheDocument();
  });
  it("a refused or failed send is reported with a fixed message and no raw text", async () => {
    send.mockResolvedValueOnce({ code: "email_failed" } as never);
    render(wrap(<MemberRow m={member() as never} editable />));
    fireEvent.change(await screen.findByLabelText("Email for the invitation"), {
      target: { value: "p@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    });
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/could not be sent/));
  });
  it("is not drawn for non-organizers, for a linked member, or for an organizer-role row", () => {
    const a = render(wrap(<MemberRow m={member() as never} editable={false} />));
    expect(screen.queryByRole("group", { name: /Invitation for/ })).not.toBeInTheDocument();
    a.unmount();
    const b = render(wrap(<MemberRow m={member({ user_id: "u1" }) as never} editable />));
    expect(screen.queryByRole("group", { name: /Invitation for/ })).not.toBeInTheDocument();
    b.unmount();
    render(wrap(<MemberRow m={member({ role: "organizer" }) as never} editable />));
    expect(screen.queryByRole("group", { name: /Invitation for/ })).not.toBeInTheDocument();
  });
  it("sending an invitation never changes the member's permission switches or their upload permission", async () => {
    render(wrap(<MemberRow m={member({ can_upload_documents: true }) as never} editable />));
    fireEvent.change(await screen.findByLabelText("Email for the invitation"), {
      target: { value: "p@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: /Upload appointment documents/ })).toBeChecked();
  });
});

describe("invite form", () => {
  it("name + email (Member): adds the member row, then sends the invitation", async () => {
    render(wrap(<Invite familyId={FAM} />));
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Email for the invitation"), {
      target: { value: "pat@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add and send invitation" }));
    });
    await waitFor(() => expect(send).toHaveBeenCalledWith("new-member", "pat@example.com"));
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(addMember.mock.calls[0]![0]).not.toHaveProperty("email");
    expect(addMember.mock.calls[0]![0]).not.toHaveProperty("user_id");
  });
  it("without an email it only adds the member, as before", async () => {
    render(wrap(<Invite familyId={FAM} />));
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Pat" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to family" }));
    });
    await waitFor(() => expect(addMember).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalled();
  });
  it("a malformed email blocks the button", () => {
    render(wrap(<Invite familyId={FAM} />));
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Email for the invitation"), {
      target: { value: "nope" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(screen.getByRole("button", { name: /Add/ })).toBeDisabled();
  });
});

describe("the public /invite page", () => {
  const Page = InviteRoute.options.component as ComponentType;
  it("signed out: asks for the email and sends a magic link (lower-cased); accepts nothing", async () => {
    render(wrap(<Page />));
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "Invitee@Example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Email me a sign-in link/ }));
    });
    expect(sendMagicLink).toHaveBeenCalledWith("invitee@example.com");
    expect(await screen.findByText(/Check your inbox/)).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
  });
  it("signed out: existing password users get a link to the password sign-in", async () => {
    render(wrap(<Page />));
    expect(await screen.findByRole("link", { name: /Sign in with it/ })).toBeInTheDocument();
  });
  it("a failed magic-link email shows a fixed message without the provider's text", async () => {
    sendMagicLink.mockResolvedValueOnce({
      error: { message: "rate limit for invitee@example.com" },
    });
    render(wrap(<Page />));
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "invitee@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Email me a sign-in link/ }));
    });
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't send the email/));
    expect(JSON.stringify(toastSpy.error.mock.calls)).not.toContain("invitee@example.com");
  });
  it("the failed-link fragment is read once and removed from the address bar", () => {
    window.history.replaceState(
      null,
      "",
      "/invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(readLinkProblem()).toBe("expired");
    expect(window.location.hash).toBe("");
    window.history.replaceState(null, "", "/invite#error=server_error");
    expect(readLinkProblem()).toBe("other");
    expect(readLinkProblem()).toBeNull();
  });
  it("an expired or used magic link is explained and a new link can be requested", async () => {
    linkProblem.value = "expired";
    render(wrap(<Page />));
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired or was already used/);
    expect(screen.getByRole("button", { name: /Email me a sign-in link/ })).toBeInTheDocument();
    linkProblem.value = null;
  });
  it("signed in with a pending invitation: shows who invited you to which family, and accepts ONLY when you press the button", async () => {
    world.signedIn = true;
    world.pending = [
      {
        invite_id: "i1",
        family_name: "The Morales Family",
        member_name: "Marco",
        invited_by_name: "Elena",
        expires_at: new Date(Date.now() + 5 * 864e5).toISOString(),
      },
    ];
    render(wrap(<Page />));
    expect(await screen.findByText(/invited you to join/)).toHaveTextContent(
      "Elena invited you to join The Morales Family as Marco.",
    );
    expect(accept).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    });
    await waitFor(() => expect(accept).toHaveBeenCalledWith("i1"));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(setActiveFamily).toHaveBeenCalledWith(FAM);
    expect(navigate).toHaveBeenCalledWith({ to: "/family", replace: true });
  });
  it("signed in with no invitation for this email: says so, shows the email, offers a different account", async () => {
    world.signedIn = true;
    render(wrap(<Page />));
    expect(await screen.findByText(/no pending invitation for/)).toBeInTheDocument();
    expect(screen.getByText("invitee@example.com")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    });
    expect(signOut).toHaveBeenCalled();
  });
  it("an invitation that became invalid before accepting is explained plainly and the list refreshes", async () => {
    world.signedIn = true;
    world.pending = [
      {
        invite_id: "i1",
        family_name: "F",
        member_name: "M",
        invited_by_name: null,
        expires_at: new Date(Date.now() + 864e5).toISOString(),
      },
    ];
    accept.mockRejectedValueOnce(new Error("invite_invalid"));
    render(wrap(<Page />));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    });
    await waitFor(() =>
      expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/no longer valid/)),
    );
    expect(setActiveFamily).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it("the fictional demo cannot accept invitations", () => {
    world.judge = true;
    world.signedIn = true;
    render(wrap(<Page />));
    expect(screen.getByRole("note")).toHaveTextContent(/can't accept invitations/);
    expect(
      within(document.body).queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
  });
});
