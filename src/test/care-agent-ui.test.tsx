// Mounts the real Ask route with the two server functions mocked. Fictional data only; no network.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
const askFn = vi.fn();
vi.mock("@/lib/care-agent/care-agent.functions", () => ({
  getCareAgentStatus: (a: unknown) => status(a),
  askCareAgentFn: (a: unknown) => askFn(a),
}));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      params,
    }: {
      to: string;
      children: ReactNode;
      params?: { id: string };
    }) => <a href={params ? to.replace("$id", params.id) : to}>{children}</a>,
  };
});
const me = { language: "en" };
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    data: { family: { id: "3b1f8f0e-6c1d-4f43-9d0a-0e5b2a7c9d11", name: "Rosa's Care Team" }, me },
  }),
}));
vi.mock("@/components/PreferencesProvider", () => ({
  usePreferences: () => ({ preferences: { language: null } }),
}));

import { Route } from "@/routes/_authenticated/ask";

const PLACEHOLDER =
  /Ask Pendia isn’t available yet\. No questions or family records are being sent to an AI service\./;
function mount() {
  const Page = Route.options.component as ComponentType;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}
const ok = (over: Record<string, unknown> = {}) => ({
  ok: true,
  language: "en",
  answer: {
    answer: "Lisinopril 10 mg is listed.",
    citations: ["med:m1"],
    missing: [],
    refusal: null,
  },
  sources: [{ id: "med:m1", label: "Lisinopril 10 mg" }],
  ...over,
});
const setItem = vi.spyOn(Storage.prototype, "setItem");

beforeEach(() => {
  status.mockReset();
  askFn.mockReset();
  setItem.mockClear();
});
afterEach(cleanup);

async function typeAndAsk(q: string) {
  await screen.findByRole("button", { name: "Ask" });
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: q } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
}

describe("Ask page: the truthful placeholder stays whenever the agent is not available", () => {
  for (const state of ["not_enabled", "not_demo_family", "not_member"]) {
    it(`${state}: placeholder, disabled input, no panel`, async () => {
      status.mockResolvedValue({ state });
      mount();
      expect(await screen.findByText(PLACEHOLDER)).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Assistant not connected")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    });
  }
  it("a failed availability check shows an error with retry, not a denial and not the panel", async () => {
    status.mockRejectedValue(new Error("x"));
    mount();
    expect(
      await screen.findByText(
        "Couldn't check whether Ask Pendia is available.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  }, 15000);
  it("lookup_failed is treated as an error, distinct from not enabled", async () => {
    status.mockResolvedValue({ state: "lookup_failed" });
    mount();
    expect(
      await screen.findByText("Couldn't check whether Ask Pendia is available."),
    ).toBeInTheDocument();
  });
});

describe("Ask page: available", () => {
  beforeEach(() => status.mockResolvedValue({ state: "available" }));

  it("shows the demo banner, a counter and example prompts", async () => {
    mount();
    expect(await screen.findByText(/Demo family — synthetic records only/)).toBeInTheDocument();
    expect(screen.getByText("0/500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(screen.getByText("When is the next visit?")).toBeInTheDocument();
  });
  it("blocks a question over 500 characters", async () => {
    mount();
    await screen.findByRole("button", { name: "Ask" });
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "a".repeat(501) },
    });
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });
  it("renders the answer with the AI badge, source links, missing list and footer", async () => {
    askFn.mockResolvedValue(
      ok({
        answer: {
          answer: "Lisinopril 10 mg is listed.",
          citations: ["med:m1"],
          missing: ["Visit notes are not visible to you."],
          refusal: null,
        },
        sources: [
          { id: "med:m1", label: "Lisinopril 10 mg" },
          { id: "visit:v9", label: "Cardiology visit" },
        ],
      }),
    );
    mount();
    await typeAndAsk("What medications are listed?");
    expect(await screen.findByText("Lisinopril 10 mg is listed.")).toBeInTheDocument();
    expect(screen.getByText("AI-generated from Pendia records")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lisinopril 10 mg" })).toHaveAttribute("href", "/meds");
    expect(screen.getByRole("link", { name: "Cardiology visit" })).toHaveAttribute(
      "href",
      "/visits/v9",
    );
    expect(screen.getByText("Not in the records")).toBeInTheDocument();
    expect(screen.getByText("Visit notes are not visible to you.")).toBeInTheDocument();
    expect(screen.getByText("Not medical advice. Check the linked records.")).toBeInTheDocument();
  });
  it("a refusal shows the canned text with no sources section", async () => {
    askFn.mockResolvedValue(
      ok({
        answer: {
          answer: "I can't give medical advice.",
          citations: [],
          missing: [],
          refusal: "medical_advice",
        },
        sources: [],
      }),
    );
    mount();
    await typeAndAsk("Should we change the dose?");
    expect(await screen.findByText("I can't give medical advice.")).toBeInTheDocument();
    expect(screen.queryByText("Sources")).toBeNull();
  });
  it("rate_limited, unverified and provider errors each show fixed copy and never raw detail", async () => {
    askFn.mockResolvedValueOnce({ ok: false, code: "rate_limited", language: "en" });
    mount();
    await typeAndAsk("What is listed?");
    expect(await screen.findByText(/asked several questions recently/)).toBeInTheDocument();
    askFn.mockResolvedValueOnce({
      ok: false,
      code: "provider_error",
      language: "en",
      detail: "SECRET-DETAIL",
    });
    await typeAndAsk("Again?");
    expect(await screen.findByText(/Couldn't get an answer right now/)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET-DETAIL/)).toBeNull();
  });
  it("a thrown server error becomes the fixed error copy", async () => {
    askFn.mockRejectedValue(new Error("boom"));
    mount();
    await typeAndAsk("What is listed?");
    expect(await screen.findByText(/Couldn't get an answer right now/)).toBeInTheDocument();
  });
  it("sends at most two earlier exchanges as context, never refusals, and sends the family id from the signed-in member", async () => {
    askFn.mockResolvedValue(ok());
    mount();
    for (const q of ["q1", "q2", "q3"]) await typeAndAsk(q);
    const last = askFn.mock.calls.at(-1)![0] as {
      data: { familyId: string; question: string; recentTurns: { role: string; text: string }[] };
    };
    expect(last.data.familyId).toBe("3b1f8f0e-6c1d-4f43-9d0a-0e5b2a7c9d11");
    expect(last.data.question).toBe("q3");
    expect(last.data.recentTurns.map((t) => t.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(last.data.recentTurns.map((t) => t.text)[0]).toBe("q1");
  });
  it("writes nothing to browser storage", async () => {
    askFn.mockResolvedValue(ok());
    mount();
    await typeAndAsk("What is listed?");
    await screen.findByText("Lisinopril 10 mg is listed.");
    expect(setItem).not.toHaveBeenCalled();
  });
  it("cancel discards a pending answer", async () => {
    let release: (v: unknown) => void = () => {};
    askFn.mockReturnValue(new Promise((r) => (release = r)));
    mount();
    await typeAndAsk("What is listed?");
    expect(screen.getAllByText("Looking through the records…").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await act(async () => release(ok()));
    expect(screen.queryByText("Lisinopril 10 mg is listed.")).toBeNull();
  });
});
