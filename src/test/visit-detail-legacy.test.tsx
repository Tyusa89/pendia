// The real, existing visit page must keep rendering a legacy recorded visit exactly as before (summary, medication
// change before -> after with source time + speaker, tasks, watch items, transcript), now with the appointment panel.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAMILY, makeRow } from "./fake-visits";

const legacy = makeRow({
  id: "legacy-1",
  provider_name: "Dr. Legacy",
  doctor: "Dr. Legacy",
  status: "completed",
  scheduled_start: null,
  scheduled_end: null,
  date: "2026-09-01",
  office_address: null,
  office_phone: null,
  summary: "Blood pressure was a little high.",
  transcript: [
    {
      speaker: "A",
      start_s: 65,
      end_s: 70,
      text: "Let's increase the Lisinopril from 10 to 20 milligrams.",
    },
    { speaker: "B", start_s: 71, end_s: 74, text: "Okay, I will take it every morning." },
  ],
});

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/services", () => ({
  visitService: {
    list: async () => [legacy],
    get: async () => ({
      visit: legacy,
      changes: [
        {
          id: "mc1",
          family_id: FAMILY,
          visit_id: "legacy-1",
          medication: "Lisinopril",
          before: "10 mg",
          after: "20 mg",
          source_seconds: 65,
          speaker_label: "Speaker A",
          status: "pending",
          confirmed_by: null,
          unclear: false,
        },
      ],
      tasks: [
        { id: "t1", title: "Book blood test", owner_member_id: null, due_date: "2026-09-15" },
      ],
      watch: [{ id: "w1", text: "Dizziness when standing", ends_on: null }],
    }),
    confirmChange: vi.fn(),
  },
}));
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "aaaaaaaa-0000-4000-8000-00000000000a", timezone: "America/New_York" },
      me: {
        id: "m1",
        family_id: "aaaaaaaa-0000-4000-8000-00000000000a",
        name: "Maria",
        role: "organizer",
      },
    },
  }),
  useMembers: () => ({ data: [{ id: "m1", name: "Maria" }] }),
}));

import { Route } from "@/routes/_authenticated/visits.$id";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("existing visit page with a legacy recorded visit", () => {
  it("still shows the recording panel, summary, medication change, tasks, watch items and transcript, plus the appointment panel", async () => {
    vi.spyOn(Route, "useParams").mockReturnValue({ id: "legacy-1" } as never);
    const Page = Route.options.component as ComponentType;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Page />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Dr. Legacy" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText("Blood pressure was a little high.")).toBeInTheDocument();
    expect(screen.getByText("Lisinopril")).toBeInTheDocument();
    expect(screen.getByText("10 mg")).toBeInTheDocument();
    expect(screen.getByText("20 mg")).toBeInTheDocument();
    expect(screen.getByText(/Heard at 1:05 · Speaker A/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm this change/ })).toBeInTheDocument();
    expect(screen.getByText("Book blood test")).toBeInTheDocument();
    expect(screen.getByText("Dizziness when standing")).toBeInTheDocument();
    const transcript = screen.getByRole("heading", { name: "Transcript" }).closest("section")!;
    expect(within(transcript).getByText(/Lisinopril from 10 to 20/)).toBeInTheDocument();
    expect(within(transcript).getAllByText(/^Speaker [AB]$/)).toHaveLength(2);
    // the new appointment panel is there, and a completed legacy visit is not nagged as incomplete
    expect(screen.getByLabelText("Appointment details")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByTestId("incomplete-flag")).not.toBeInTheDocument();
  });
});
