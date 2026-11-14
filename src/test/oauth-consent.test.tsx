import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";

const state = vi.hoisted(() => ({
  details: { client: { name: "Test assistant" }, redirect_uri: "https://assistant.invalid/callback", scope: "openid email profile" },
  approve: vi.fn(), deny: vi.fn(), lookup: vi.fn(), session: vi.fn(),
}));
vi.mock("@/services", () => ({ authService: {
  session: state.session, authorizationDetails: state.lookup,
  currentEmail: async () => "caregiver@example.invalid",
  approveAuthorization: state.approve, denyAuthorization: state.deny, signOut: vi.fn(),
} }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options, useLoaderData: () => ({ details: state.details, email: "caregiver@example.invalid" }), useSearch: () => ({ authorization_id: "test-auth" }) }),
  redirect: (options: object) => ({ redirect: options }),
}));
import { Route } from "@/routes/[.]lovable.oauth.consent";
const route = Route as unknown as { options: {
  component: ComponentType;
  beforeLoad: (ctx: unknown) => Promise<unknown>;
  loader: (ctx: unknown) => Promise<unknown>;
} };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
describe("OAuth consent", () => {
  it("preserves authorization through sign-in", async () => {
    state.session.mockResolvedValue({ data: { session: null }, error: null });
    await expect(route.options.beforeLoad({ search: { authorization_id: "test-auth" }, location: { pathname: "/.lovable/oauth/consent", searchStr: "?authorization_id=test-auth" } })).rejects.toEqual({ redirect: { to: "/auth", search: { next: "/.lovable/oauth/consent?authorization_id=test-auth" } } });
  });
  it("handles already authorized provider redirects", async () => {
    state.lookup.mockResolvedValue({ data: { redirect_url: "https://assistant.invalid/callback" }, error: null });
    await expect(route.options.loader({ location: { search: "?authorization_id=test-auth" } })).rejects.toEqual({ redirect: { href: "https://assistant.invalid/callback" } });
  });
  it("rejects missing authorization", async () => {
    await expect(route.options.beforeLoad({ search: { authorization_id: "" } })).rejects.toThrow("missing");
  });
  it("handles expired authorization and provider failure", async () => {
    state.lookup.mockResolvedValue({ data: null, error: { message: "expired" } });
    await expect(route.options.loader({ location: { search: "?authorization_id=test-auth" } })).rejects.toThrow("invalid or expired");
  });
  it.each([true, false])("surfaces failed decision and enables retry: approve=%s", async approve => {
    (approve ? state.approve : state.deny).mockResolvedValue({ error: { message: "failure" }, data: null });
    render(<route.options.component />);
    fireEvent.click(screen.getByRole("button", { name: approve ? "Approve connection" : "Cancel connection" }));
    await waitFor(() => expect(approve ? state.approve : state.deny).toHaveBeenCalledWith("test-auth"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve connection" })).not.toBeDisabled();
  });
});