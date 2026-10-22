// The Handoffs screen as designed: Temporary / Saved voice-note states, the docked Stop control, past-handoff cards,
// and who may save. Recording behavior itself is proven by the existing handoff/recording suites. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmProvider } from "@/lib/pcm-capture";
import { installRecorderEnv, type RecorderEnv } from "./recorder-fakes";

const who = vi.hoisted(() => ({ role: "organizer" as "organizer" | "member" }));
const rows = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/services", () => ({
  handoffService: {
    list: async () => rows.list,
    activeWatchItems: async () => [{ id: "w1", text: "Dizzy when standing" }],
    create: async (h: unknown) => h,
  },
  recordingService: {},
}));
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "fam-1", name: "Test Family" },
      me: { id: "mem-1", family_id: "fam-1", name: "Maria", role: who.role },
    },
  }),
  useMembers: () => ({
    data: [
      { id: "mem-1", name: "Maria" },
      { id: "mem-2", name: "Carlos" },
    ],
  }),
}));

// jsdom has no AudioWorklet; inject a provider that yields a small WAV so "Keep" can be switched on.
vi.mock("@/lib/pcm-capture", () => {
  const provider: PcmProvider = {
    prepare: () => ({ ctx: {} as AudioContext, moduleReady: Promise.resolve() }),
    attach: async () => ({
      stop: async () => ({
        wav: new Blob(["RIFF....WAVEfmt "], { type: "audio/wav" }),
        sampleCount: 16000,
        durationSec: 1,
      }),
      abort: () => {},
    }),
    release: () => {},
  };
  return { browserPcm: provider };
});

import { Route } from "@/routes/_authenticated/handoffs";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
  who.role = "organizer";
  rows.list = [];
});
afterEach(() => {
  cleanup();
  env.restore();
});

function mount() {
  const Page = Route.options.component as ComponentType;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}
const click = async (name: string | RegExp, i = 0) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name })[i]!);
  });
};
const toggleKeep = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("switch", { name: /Keep the recording with this handoff/i }));
  });
};
const row = (over: Record<string, unknown>) => ({
  id: "h1",
  family_id: "fam-1",
  author_member_id: "mem-2",
  created_at: "2026-10-20T14:04:00Z",
  ate: true,
  meds_taken: false,
  unusual: "Dizzy getting up from the couch.",
  note: null,
  watch_answers: { "Dizzy when standing": "Yes" },
  audio_path: null,
  audio_wav_path: null,
  duration_seconds: null,
  ...over,
});

describe("Handoffs, as designed", () => {
  it("has a check-in card and a separate voice-note card, in that order", async () => {
    mount();
    const checkin = await screen.findByRole("region", { name: "Check-in" });
    const voice = screen.getByRole("region", { name: "Voice note" });
    expect(within(checkin).getByText("Did she eat?")).toBeInTheDocument();
    expect(within(voice).getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(checkin.compareDocumentPosition(voice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the Temporary state until a recording is kept, then the Saved state", async () => {
    mount();
    await screen.findByText("Did she eat?");
    expect(screen.getByTestId("storage-state")).toHaveTextContent(
      /Temporary · stays on this device, not saved/,
    );
    await click("Record");
    await click("Stop");
    expect(screen.getByTestId("storage-state")).toHaveTextContent(/Temporary/);
    await toggleKeep();
    expect(screen.getByTestId("storage-state")).toHaveTextContent(
      /Will be saved privately with this handoff/,
    );
    await toggleKeep();
    expect(screen.getByTestId("storage-state")).toHaveTextContent(/Temporary/);
  });

  it("docks a Stop control above the tab bar while recording, and it really stops", async () => {
    mount();
    await screen.findByText("Did she eat?");
    expect(screen.queryByRole("region", { name: "Recording in progress" })).not.toBeInTheDocument();
    await click("Record");
    const dock = screen.getByRole("region", { name: "Recording in progress" });
    expect(dock.className).toContain("fixed");
    expect(dock.className).toContain("var(--nav-h)"); // sits above the tab bar
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Stop recording" }));
    });
    expect(screen.queryByRole("region", { name: "Recording in progress" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument();
  });

  it("an organizer can save; a member is told why they can't (the database only lets organizers write handoffs today)", async () => {
    mount();
    await screen.findByText("Did she eat?");
    await click("Yes", 0);
    await click("Yes", 1);
    expect(screen.getByRole("button", { name: "Save handoff" })).toBeEnabled();
    cleanup();
    who.role = "member";
    mount();
    await screen.findByText("Did she eat?");
    await click("Yes", 0);
    await click("Yes", 1);
    expect(screen.getByRole("button", { name: "Save handoff" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/Only the organizer can save a handoff/);
  });

  it("past handoffs show who, plain-language pills, the note, and 'No recording kept'", async () => {
    rows.list = [row({})];
    mount();
    const past = await screen.findByRole("complementary", { name: "Past handoffs" });
    await within(past).findByText("Carlos");
    expect(within(past).getByText("Ate")).toBeInTheDocument();
    expect(within(past).getByText("Meds not taken")).toBeInTheDocument();
    expect(within(past).getByText("Dizzy when standing: Yes")).toBeInTheDocument();
    expect(within(past).getByText("Dizzy getting up from the couch.")).toBeInTheDocument();
    expect(within(past).getByText("No recording kept")).toBeInTheDocument();
  });

  it("a saved recording shows the Saved badge; only organizers see Delete (storage rules unchanged)", async () => {
    rows.list = [
      row({
        audio_path: "f/handoff/h/o.webm",
        audio_wav_path: "f/handoff/h/o.wav",
        duration_seconds: 42,
      }),
    ];
    mount();
    const saved = await screen.findByLabelText("Saved recording");
    expect(within(saved).getByText(/Saved privately for your family/)).toBeInTheDocument();
    expect(within(saved).getByRole("button", { name: "Play recording" })).toBeInTheDocument();
    expect(within(saved).getByRole("button", { name: "Delete recording" })).toBeInTheDocument();
    cleanup();
    who.role = "member";
    mount();
    const savedMember = await screen.findByLabelText("Saved recording");
    expect(within(savedMember).getByRole("button", { name: "Play recording" })).toBeInTheDocument();
    expect(
      within(savedMember).queryByRole("button", { name: "Delete recording" }),
    ).not.toBeInTheDocument();
  });
});
