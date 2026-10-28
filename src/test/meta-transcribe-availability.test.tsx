// The Handoffs page's transcription AVAILABILITY states, through the real route with only the server-function edge faked:
// loading, available, disabled, not-organizer and temporary error; bounded retries; recovery when a recording stops; and a
// confirmed "available" is never replaced by a failed check. No Meta request can happen here, and no check ever carries audio.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTranscribeResponse } from "@/lib/meta-transcribe/response";
import { installRecorderEnv, type RecorderEnv } from "./recorder-fakes";
import { liveFixture } from "./meta-transcribe-helpers";

const fns = vi.hoisted(() => ({ getTranscriptionStatus: vi.fn(), transcribeRecording: vi.fn() }));
vi.mock("@/lib/meta-transcribe/transcribe.functions", () => fns);
vi.mock("@/services", () => ({
  handoffService: {
    list: async () => [],
    activeWatchItems: async () => [],
    create: async (h: unknown) => h,
  },
  recordingService: { saveHandoffWithRecording: async (h: unknown) => h },
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

const YES = { available: true };
const DISABLED = { available: false, reason: "disabled" };
const NOT_ORG = { available: false, reason: "not_organizer" };
const CHECK_FAILED = { available: false, reason: "check_failed" };
const TEXT = {
  loading: /Checking whether transcription is available/i,
  disabled: /Transcription isn't connected yet/i,
  notOrganizer: /Only the family organizer can transcribe a recording/i,
  error: /Couldn't check whether transcription is available/i,
};
const SLOW = { timeout: 6000 };

let env: RecorderEnv;
let qc: QueryClient;
beforeEach(() => {
  env = installRecorderEnv();
  fns.getTranscriptionStatus.mockReset();
  fns.transcribeRecording.mockReset();
});
afterEach(() => {
  // No availability check ever carries audio or a family other than the page's own.
  for (const call of fns.getTranscriptionStatus.mock.calls)
    expect(call).toEqual([{ data: { familyId: "fam-1" } }]);
  cleanup();
  env.restore();
});

function mount() {
  const Page = Route.options.component as ComponentType;
  qc = new QueryClient(); // the app's own defaults (src/router.tsx)
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name })[0]!);
  });
};
const recordAndStop = async () => {
  await click("Record");
  await click("Stop");
};
const transcribeButton = () => screen.queryByRole("button", { name: /^Transcribe$/ });
const calls = () => fns.getTranscriptionStatus.mock.calls.length;

describe("each state is shown for what it is", () => {
  it("loading: while the first check is still running, says so and does not claim 'not connected'", async () => {
    fns.getTranscriptionStatus.mockReturnValue(new Promise(() => {}));
    mount();
    await recordAndStop();
    expect(await screen.findByText(TEXT.loading)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.disabled)).not.toBeInTheDocument();
    expect(transcribeButton()).not.toBeInTheDocument();
  });
  it("available: offers Transcribe", async () => {
    fns.getTranscriptionStatus.mockResolvedValue(YES);
    mount();
    await recordAndStop();
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
  });
  it.each([
    ["disabled", DISABLED],
    ["disabled (older answer shape, no reason)", { available: false }],
  ])("%s: the existing 'not connected yet' text, no button", async (_n, reply) => {
    fns.getTranscriptionStatus.mockResolvedValue(reply);
    mount();
    await recordAndStop();
    expect(await screen.findByText(TEXT.disabled)).toBeInTheDocument();
    expect(transcribeButton()).not.toBeInTheDocument();
    expect(calls()).toBe(1); // a definite answer is not retried
  });
  it("not an organizer: the explicit message, no button, not retried", async () => {
    fns.getTranscriptionStatus.mockResolvedValue(NOT_ORG);
    mount();
    await recordAndStop();
    expect(await screen.findByText(TEXT.notOrganizer)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.disabled)).not.toBeInTheDocument();
    expect(transcribeButton()).not.toBeInTheDocument();
    expect(calls()).toBe(1);
  });
});

describe("temporary failures are errors, not 'not connected'", () => {
  it.each([
    [
      "a rejected request",
      () => fns.getTranscriptionStatus.mockRejectedValue(new Error("HTTP 500")),
    ],
    [
      "a check_failed answer (the server could not look the user up)",
      () => fns.getTranscriptionStatus.mockResolvedValue(CHECK_FAILED),
    ],
  ])(
    "%s: bounded retries (1 try + 2 retries), then an explicit error with Try again",
    async (_n, arrange) => {
      arrange();
      mount();
      await recordAndStop();
      expect(await screen.findByText(TEXT.error, undefined, SLOW)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByText(TEXT.disabled)).not.toBeInTheDocument();
      expect(screen.queryByText(TEXT.notOrganizer)).not.toBeInTheDocument();
      expect(transcribeButton()).not.toBeInTheDocument();
      expect(calls()).toBe(3);
      await new Promise((r) => setTimeout(r, 1800)); // and it stays bounded: no further automatic attempts
      expect(calls()).toBe(3);
    },
  );
  it("a temporary failure that clears during the retries never shows an error", async () => {
    fns.getTranscriptionStatus.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(YES);
    mount();
    await recordAndStop();
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument(), SLOW);
    expect(screen.queryByText(TEXT.error)).not.toBeInTheDocument();
    expect(calls()).toBe(2);
  });
  it("Try again re-checks and recovers", async () => {
    fns.getTranscriptionStatus.mockRejectedValue(new Error("down"));
    mount();
    await recordAndStop();
    await screen.findByText(TEXT.error, undefined, SLOW);
    expect(calls()).toBe(3);
    fns.getTranscriptionStatus.mockReset().mockResolvedValue(YES);
    await click("Try again");
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    expect(screen.queryByText(TEXT.error)).not.toBeInTheDocument();
    expect(calls()).toBe(1);
  });
});

describe("re-check when a recording stops (only if not already available)", () => {
  it("disabled at load, available by the time the recording stops: the button appears without a reload", async () => {
    fns.getTranscriptionStatus.mockResolvedValueOnce(DISABLED).mockResolvedValue(YES);
    mount();
    await click("Record");
    await waitFor(() => expect(calls()).toBe(1));
    await click("Stop");
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    expect(calls()).toBe(2);
  });
  it("after a temporary error at load, stopping a recording re-checks and recovers", async () => {
    fns.getTranscriptionStatus.mockRejectedValue(new Error("down"));
    mount();
    await click("Record");
    await waitFor(() => expect(calls()).toBe(3), SLOW); // retries finish while recording
    fns.getTranscriptionStatus.mockReset().mockResolvedValue(YES);
    await click("Stop");
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    expect(calls()).toBe(1);
  });
  it("not-organizer is re-checked on stop too, and stays not-organizer if the server still says so", async () => {
    fns.getTranscriptionStatus.mockResolvedValue(NOT_ORG);
    mount();
    await click("Record");
    await waitFor(() => expect(calls()).toBe(1));
    await click("Stop");
    await waitFor(() => expect(calls()).toBe(2));
    expect(await screen.findByText(TEXT.notOrganizer)).toBeInTheDocument();
  });
  it("when transcription is already available, stopping a recording makes NO extra check", async () => {
    fns.getTranscriptionStatus.mockResolvedValue(YES);
    mount();
    await click("Record");
    await waitFor(() => expect(calls()).toBe(1));
    await click("Stop");
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 200));
    expect(calls()).toBe(1);
  });
  it("while a check is already running, stopping does not start a second one", async () => {
    fns.getTranscriptionStatus.mockReturnValue(new Promise(() => {}));
    mount();
    await recordAndStop();
    await screen.findByText(TEXT.loading);
    expect(calls()).toBe(1);
  });
});

describe("a confirmed 'available' is not replaced without a clear reason", () => {
  const refetch = async () => {
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["transcription-status", "fam-1"] });
    });
  };
  it.each([
    ["a rejected re-check", () => fns.getTranscriptionStatus.mockRejectedValue(new Error("net"))],
    ["a check_failed re-check", () => fns.getTranscriptionStatus.mockResolvedValue(CHECK_FAILED)],
  ])("%s keeps Transcribe available", async (_n, arrange) => {
    fns.getTranscriptionStatus.mockResolvedValueOnce(YES);
    mount();
    await recordAndStop();
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    arrange();
    await refetch();
    await waitFor(() => expect(calls()).toBe(4), SLOW); // 1 ok + 1 try + 2 bounded retries
    expect(transcribeButton()).toBeInTheDocument();
    expect(screen.queryByText(TEXT.error)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.disabled)).not.toBeInTheDocument();
  });
  it("a definite answer (not an organizer any more) DOES replace it, with that reason shown", async () => {
    fns.getTranscriptionStatus.mockResolvedValueOnce(YES).mockResolvedValue(NOT_ORG);
    mount();
    await recordAndStop();
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    await refetch();
    expect(await screen.findByText(TEXT.notOrganizer)).toBeInTheDocument();
    expect(transcribeButton()).not.toBeInTheDocument();
  });
});

describe("recorded audio and editable drafts survive every availability change", () => {
  const turns = parseTranscribeResponse(liveFixture).turns;
  it("through errors, retries and recovery: same recording, same edited draft, audio never re-sent", async () => {
    fns.getTranscriptionStatus.mockResolvedValue(YES);
    fns.transcribeRecording.mockResolvedValue({
      ok: true,
      turns,
      speakerCount: 2,
      audioSeconds: 58.24,
      elapsedMs: 1,
    });
    mount();
    await recordAndStop();
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument());
    await click("Transcribe");
    const draft = (await screen.findByLabelText(/Draft from dictation/i)) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "Speaker A (0:00): My own edit." } });
    const player = screen.getByLabelText("Playback of your recording");

    // availability now fails, retries, is shown as an error, then recovers
    fns.getTranscriptionStatus.mockReset().mockRejectedValue(new Error("down"));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["transcription-status", "fam-1"] });
    });
    await waitFor(() => expect(calls()).toBe(3), SLOW);
    // and a definite 'disabled' arrives, which is the harshest case for the panel
    fns.getTranscriptionStatus.mockReset().mockResolvedValue(DISABLED);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["transcription-status", "fam-1"] });
    });
    expect(await screen.findByText(TEXT.disabled)).toBeInTheDocument();

    expect((screen.getByLabelText(/Draft from dictation/i) as HTMLTextAreaElement).value).toBe(
      "Speaker A (0:00): My own edit.",
    );
    expect(screen.getByLabelText("Playback of your recording")).toBe(player);
    expect(fns.transcribeRecording).toHaveBeenCalledTimes(1); // only the caregiver's own Transcribe press ever sent audio
  });
  it("a Try again press does not discard the recording", async () => {
    fns.getTranscriptionStatus.mockRejectedValue(new Error("down"));
    mount();
    await recordAndStop();
    await screen.findByText(TEXT.error, undefined, SLOW);
    const player = screen.getByLabelText("Playback of your recording");
    await click("Try again");
    await screen.findByText(TEXT.error, undefined, SLOW);
    expect(screen.getByLabelText("Playback of your recording")).toBe(player);
    expect(fns.transcribeRecording).not.toHaveBeenCalled();
  });
});

describe("availability checks never send audio", () => {
  it("across loading, errors, retries and recovery, transcribeRecording is never called", async () => {
    fns.getTranscriptionStatus
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce(DISABLED)
      .mockResolvedValue(YES);
    mount();
    await click("Record");
    await waitFor(() => expect(calls()).toBe(2), SLOW); // blip, one retry, definite 'disabled'
    await click("Stop"); // stopping re-checks, and the answer is now yes
    await waitFor(() => expect(transcribeButton()).toBeInTheDocument(), SLOW);
    expect(calls()).toBe(3);
    expect(fns.transcribeRecording).not.toHaveBeenCalled();
    for (const call of fns.getTranscriptionStatus.mock.calls)
      expect(Object.keys((call[0] as { data: object }).data)).toEqual(["familyId"]);
  });
});
