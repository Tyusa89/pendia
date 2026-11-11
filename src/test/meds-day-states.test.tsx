// The Medications page's left card says "No doses scheduled on this day." only after the dose service answered
// successfully with nothing. Loading, error and "not switched on" show their own message and no empty-state claim.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DoseError } from "@/lib/dose-administration";

const world = vi.hoisted(() => ({
  occurrences: (() => Promise.resolve([])) as () => Promise<unknown[]>,
}));

vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "f1", name: "Test Family", timezone: "America/Chicago" },
      me: {
        id: "m1",
        family_id: "f1",
        name: "Elena",
        role: "organizer",
        can_see_meds: true,
        can_see_schedule: true,
        can_see_visits: true,
      },
    },
  }),
}));
vi.mock("@/services", () => ({
  medicationService: {
    list: async () => [
      {
        id: "med1",
        family_id: "f1",
        name: "Lisinopril",
        dose: "10 mg",
        status: "active",
        schedule: null,
      },
    ],
    add: vi.fn(),
    remove: vi.fn(),
  },
  doseService: {
    occurrences: () => world.occurrences(),
    listSchedules: async () => [],
    history: async () => [],
  },
}));

import { Route } from "@/routes/_authenticated/meds";

const NO_DOSES = /No doses scheduled on this day/;
const renderPage = () => {
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
  world.occurrences = () => Promise.resolve([]);
});
afterEach(cleanup);

describe("Medications day card states", () => {
  it("loading: shows only the loading message", async () => {
    world.occurrences = () => new Promise(() => {});
    renderPage();
    expect(await screen.findByText("Loading dose times…")).toBeInTheDocument();
    expect(screen.queryByText(NO_DOSES)).not.toBeInTheDocument();
    expect(screen.queryByText(/No medications listed/)).not.toBeInTheDocument();
  });

  it("error: shows the error and no empty-state claim", async () => {
    world.occurrences = () => Promise.reject(new Error("The dose times could not be loaded."));
    renderPage();
    expect(await screen.findByText("The dose times could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(NO_DOSES)).not.toBeInTheDocument();
  });

  it("not switched on: shows the existing unavailable message and no empty-state claim", async () => {
    world.occurrences = () => Promise.reject(new DoseError("dose_unavailable", "off"));
    renderPage();
    expect(
      await screen.findByText("Dose reporting is not switched on for this family yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_DOSES)).not.toBeInTheDocument();
  });

  it("success with no doses: now says nothing is scheduled", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(NO_DOSES)).toBeInTheDocument());
    expect(screen.queryByText("Loading dose times…")).not.toBeInTheDocument();
  });

  it("success with a dose: lists it and makes no empty-state claim", async () => {
    world.occurrences = () =>
      Promise.resolve([
        {
          schedule_id: "s1",
          medication_id: "med1",
          medication_name: "Lisinopril",
          dose_text: "10 mg",
          local_date: new Date().toISOString().slice(0, 10),
          local_time: "08:00:00",
          tz: "America/Chicago",
          scheduled_at: new Date().toISOString(),
          time_state: "normal",
          status: "unconfirmed",
          head_id: null,
          reported_by: null,
          reported_by_name: null,
          reported_at: null,
          not_given_reason: null,
          change_reason: null,
          outside_window: false,
          reports_differ: false,
          open_disagreements: 0,
          history_count: 0,
        },
      ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Lisinopril/).length).toBeGreaterThan(0));
    expect(screen.queryByText(NO_DOSES)).not.toBeInTheDocument();
  });
});
