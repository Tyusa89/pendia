// Mounts the real Handoffs route component with the data layer mocked, to prove the existing check-in flow
// is unchanged and that dictation never changes what gets saved. Fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRecorderEnv, type RecorderEnv } from "./recorder-fakes";

// The availability check is a server function; this page test has no server, so say plainly that transcription is switched off.
vi.mock("@/lib/meta-transcribe/transcribe.functions", () => ({
  getTranscriptionStatus: async () => ({ available: false, reason: "disabled" }),
  transcribeRecording: async () => ({ ok: false, code: "not_available" }),
}));

const create = vi.fn(async (h: unknown) => h);
vi.mock("@/services", () => ({
  handoffService: {
    list: async () => [],
    activeWatchItems: async () => [{ id: "w1", text: "Ankle swelling" }],
    create: (h: unknown) => create(h),
  },
}));
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "fam-1", name: "Test Family" },
      me: { id: "mem-1", family_id: "fam-1", name: "Maria", role: "organizer" },
    },
  }),
  useMembers: () => ({ data: [{ id: "mem-1", name: "Maria" }] }),
}));

import { Route } from "@/routes/_authenticated/handoffs";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
  create.mockClear();
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

async function fillRequired() {
  await screen.findByText(/Watching: Ankle swelling\?/);
  await click("Yes", 0); // ate
  await click("Yes", 1); // meds
  await click("No", 2); // ankle swelling answer
}

describe("Handoffs page", () => {
  it("still renders the existing check-in questions plus the new dictation panel", async () => {
    mount();
    expect(await screen.findByText("Did she eat?")).toBeInTheDocument();
    expect(screen.getByText("Did she take her medication?")).toBeInTheDocument();
    expect(screen.getByText("Anything unusual?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save handoff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
  });

  it("saves exactly the same payload as before for a typed note", async () => {
    mount();
    await fillRequired();
    fireEvent.change(screen.getByPlaceholderText(/^Optional/), {
      target: { value: "Felt a bit tired after lunch" },
    });
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      family_id: "fam-1",
      author_member_id: "mem-1",
      ate: true,
      meds_taken: true,
      unusual: "Felt a bit tired after lunch",
      watch_answers: { "Ankle swelling": "No" },
    });
  });

  it("recording and playing audio does not save anything or add audio to the saved handoff", async () => {
    mount();
    await fillRequired();
    await click("Record");
    await click("Stop");
    expect(create).not.toHaveBeenCalled();
    expect(env.fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/^Optional/), { target: { value: "Typed note" } });
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const saved = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual([
      "ate",
      "author_member_id",
      "family_id",
      "meds_taken",
      "unusual",
      "watch_answers",
    ]);
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });

  it("the page works fully when the microphone is blocked (typing and saving unaffected)", async () => {
    env.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    );
    mount();
    await fillRequired();
    await click("Record");
    expect(screen.getByRole("alert")).toHaveTextContent(/Microphone access is blocked/i);
    fireEvent.change(screen.getByPlaceholderText(/^Optional/), {
      target: { value: "Typed anyway" },
    });
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("the page tells caregivers transcription isn't connected rather than offering a dead button", async () => {
    mount();
    await click("Record");
    await click("Stop");
    expect(await screen.findByText(/Transcription isn't connected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Transcribe/ })).not.toBeInTheDocument();
  });
});
