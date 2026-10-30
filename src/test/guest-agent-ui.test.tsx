// The Ask page for judges: the separate guest path, with the server functions mocked. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
const askFn = vi.fn();
const memberStatus = vi.fn();
vi.mock("@/lib/care-agent/guest.functions", () => ({
  getGuestAgentStatus: () => status(),
  askGuestAgentFn: (a: unknown) => askFn(a),
}));
vi.mock("@/lib/care-agent/care-agent.functions", () => ({
  getCareAgentStatus: (a: unknown) => memberStatus(a),
  askCareAgentFn: vi.fn(),
}));
vi.mock("@/lib/judge-demo", async (orig) => ({
  ...(await orig<object>()),
  isJudgeDemo: () => true,
}));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});
vi.mock("@/hooks/use-family", () => ({ useFamily: () => ({ data: undefined }) }));
vi.mock("@/components/PreferencesProvider", () => ({
  usePreferences: () => ({ preferences: { language: null } }),
}));
import { Route } from "@/routes/_authenticated/ask";

const mount = () => {
  const Page = Route.options.component as ComponentType;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
};
beforeEach(() => {
  status.mockReset();
  askFn.mockReset();
  memberStatus.mockReset();
});
afterEach(cleanup);

describe("judge Ask page", () => {
  it("not enabled: the truthful placeholder, no input, and the member path is never called", async () => {
    status.mockResolvedValue({ state: "not_enabled" });
    mount();
    expect(await screen.findByText(/Ask Pendia isn’t available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(memberStatus).not.toHaveBeenCalled();
  });
  it("available: asks through the guest function, sending no family id", async () => {
    status.mockResolvedValue({ state: "available" });
    askFn.mockResolvedValue({
      ok: true,
      language: "en",
      answer: {
        answer: "Lisinopril 10 mg is listed.",
        citations: ["med:m1"],
        missing: [],
        refusal: null,
      },
      sources: [{ id: "med:m1", label: "Medication — Lisinopril" }],
    });
    mount();
    await screen.findByRole("button", { name: "Ask" });
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "What medication is listed?" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    });
    expect(await screen.findByText("Lisinopril 10 mg is listed.")).toBeInTheDocument();
    expect(screen.getByText("AI-generated from Pendia records")).toBeInTheDocument();
    const sent = askFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(sent.data).sort()).toEqual(["question", "recentTurns"]);
    expect(memberStatus).not.toHaveBeenCalled();
  });
  it("a cap or flag denial shows the fixed unavailable text with no detail", async () => {
    status.mockResolvedValue({ state: "available" });
    askFn.mockResolvedValue({ ok: false, code: "not_enabled", language: "en" });
    mount();
    await screen.findByRole("button", { name: "Ask" });
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "What is listed?" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    });
    expect(await screen.findByText(/Couldn't get an answer right now/)).toBeInTheDocument();
  });
});
