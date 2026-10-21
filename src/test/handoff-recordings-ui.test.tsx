// Page-level tests: the real Handoffs route + the real recording service, against a persistent fake backend.
// Fictional data only. Real family isolation is proven in supabase/tests/storage.test.sql (database layer).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmProvider } from "@/lib/pcm-capture";
import { FAM, toastSpy, world } from "./fake-world";
import { installRecorderEnv, type RecorderEnv } from "./recorder-fakes";

const create = vi.fn(async (h: unknown) => h);

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSpy.success(...a),
    error: (...a: unknown[]) => toastSpy.error(...a),
  },
}));
vi.mock("@/services", async () => {
  const { createRecordingService } = await import("@/services/recordings");
  const { world: w } = await import("./fake-world");
  return {
    handoffService: {
      list: async () => w.listRows(),
      activeWatchItems: async () => [],
      create: (h: unknown) => create(h),
    },
    recordingService: createRecordingService({
      storage: w.storage,
      db: w.db as never,
      sleep: async () => {},
      newId: () => "11111111-1111-4111-8111-111111111111",
    }),
  };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: FAM, name: "Test Family" },
      me: { id: "mem-1", family_id: FAM, name: "Maria", role: "organizer" },
    },
  }),
  useMembers: () => ({ data: [{ id: "mem-1", name: "Maria" }] }),
}));
// The jsdom environment has no AudioWorklet; inject a provider that yields a small WAV so "Keep" can be exercised.
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
  world.reset();
  create.mockClear();
  toastSpy.success.mockClear();
  toastSpy.error.mockClear();
  localStorage.clear();
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
const savedPanel = () => screen.findByLabelText("Saved recording");
async function answerRequired() {
  await screen.findByText("Did she eat?");
  await click("Yes", 0);
  await click("Yes", 1);
}
async function recordAClip() {
  await click("Record");
  await click("Stop");
}
const keepBox = () =>
  screen.getByRole("checkbox", { name: /Keep the recording with this handoff/i });

describe("keeping a recording is opt-in", () => {
  it("offers 'Keep' only after a recording exists, unchecked by default, with a plain-language explanation", async () => {
    mount();
    await screen.findByText("Did she eat?");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await recordAClip();
    expect(keepBox()).not.toBeChecked();
    expect(screen.getByText(/Off by default/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /stays on this device\. It isn't saved or uploaded unless you choose to keep it/i,
      ),
    ).toBeInTheDocument();
  });

  it("saving WITHOUT ticking Keep behaves exactly as before: same payload, nothing uploaded", async () => {
    mount();
    await answerRequired();
    fireEvent.change(screen.getByPlaceholderText("Optional"), {
      target: { value: "Quiet afternoon" },
    });
    await recordAClip();
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      family_id: FAM,
      author_member_id: "mem-1",
      ate: true,
      meds_taken: true,
      unusual: "Quiet afternoon",
      watch_answers: {},
    });
    expect(world.objects.size).toBe(0);
    expect(world.log).toEqual([]);
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });
});

describe("saving a kept recording", () => {
  it("shows the storage notice before the FIRST kept save and uploads nothing until it is confirmed", async () => {
    mount();
    await answerRequired();
    await recordAClip();
    fireEvent.click(keepBox());
    await click("Save handoff");
    expect(await screen.findByText("Store this recording?")).toBeInTheDocument();
    expect(world.objects.size).toBe(0); // nothing uploaded yet
    expect(world.log).toEqual([]);

    await click("Store the recording");
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Handoff saved"));
    expect(world.log).toEqual(["upload:original.webm", "upload:pcm.wav", "insert"]);
    expect(world.objects.size).toBe(2);
    expect(world.rows).toHaveLength(1);
    expect(create).not.toHaveBeenCalled(); // the kept path goes through the recording service, in one DB write
    expect(world.rows[0]).toMatchObject({
      family_id: FAM,
      audio_wav_mime: "audio/wav",
      audio_mime: expect.stringMatching(/^audio\/webm/),
    });
  });

  it("does not ask again once acknowledged (this browser)", async () => {
    localStorage.setItem("pendia.recordingNotice.v1", "1");
    mount();
    await answerRequired();
    await recordAClip();
    fireEvent.click(keepBox());
    await click("Save handoff");
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    expect(screen.queryByText("Store this recording?")).not.toBeInTheDocument();
    expect(world.objects.size).toBe(2);
  });

  it("'Not now' on the notice saves nothing and uploads nothing", async () => {
    mount();
    await answerRequired();
    await recordAClip();
    fireEvent.click(keepBox());
    await click("Save handoff");
    await click("Not now");
    expect(world.log).toEqual([]);
    expect(world.objects.size).toBe(0);
    expect(world.rows).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("a failed save never reports success, leaves no orphan object, and keeps the caregiver's work", async () => {
    localStorage.setItem("pendia.recordingNotice.v1", "1");
    world.failInsert = true;
    mount();
    await answerRequired();
    fireEvent.change(screen.getByPlaceholderText("Optional"), {
      target: { value: "Typed note that must survive" },
    });
    await recordAClip();
    fireEvent.click(keepBox());
    await click("Save handoff");
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    expect(toastSpy.error.mock.calls[0]![0]).toMatch(/Nothing was saved/);
    expect(toastSpy.success).not.toHaveBeenCalled();
    expect(world.objects.size).toBe(0); // compensation removed both uploads
    expect(world.rows).toHaveLength(0);
    expect(world.log.at(-1)).toMatch(/^remove:/);
    expect((screen.getByPlaceholderText("Optional") as HTMLTextAreaElement).value).toBe(
      "Typed note that must survive",
    );
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument(); // the recording is still there to retry
  });

  it("after a successful kept save the form and recording reset for the next handoff", async () => {
    localStorage.setItem("pendia.recordingNotice.v1", "1");
    mount();
    await answerRequired();
    await recordAClip();
    fireEvent.click(keepBox());
    await click("Save handoff");
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByLabelText("Playback of your recording")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("saved recordings in Past handoffs", () => {
  it("shows the duration from the database and the note it was saved with", async () => {
    world.seedSaved("h1", { duration: 8.25 });
    mount();
    expect(await screen.findByText(/· 0:08/)).toBeInTheDocument();
    expect(screen.getByText("Napped after lunch")).toBeInTheDocument();
  });

  it("plays through a short-lived signed URL requested on demand (5 minutes), not stored anywhere", async () => {
    const { audio } = world.seedSaved("h1");
    mount();
    await savedPanel();
    await click("Play recording");
    const player = (await screen.findByLabelText(
      "Playback of the saved recording",
    )) as HTMLAudioElement;
    expect(player.src).toContain(audio);
    expect(world.signedRequests).toEqual([{ path: audio, ttl: 300, download: undefined }]);
    expect(JSON.stringify(world.rows)).not.toContain("signed.example");
  });

  it("still plays after a page refresh (remount): the database reference is all it needs", async () => {
    const { audio } = world.seedSaved("h1");
    const first = mount();
    await savedPanel();
    await click("Play recording");
    await screen.findByLabelText("Playback of the saved recording");
    first.unmount(); // refresh
    mount();
    await savedPanel();
    await click("Play recording");
    const player = (await screen.findByLabelText(
      "Playback of the saved recording",
    )) as HTMLAudioElement;
    expect(player.src).toContain(audio);
    expect(world.signedRequests).toHaveLength(2); // a fresh link each time, no cached URL
  });

  it("still plays after sign-out and sign-in (new session: fresh query cache, nothing carried over in memory)", async () => {
    const { audio } = world.seedSaved("h1");
    const session1 = mount();
    await screen.findByText(/· 0:08/);
    session1.unmount();
    localStorage.clear();
    sessionStorage.clear(); // sign-out wipes browser state
    mount(); // sign-in: brand-new QueryClient and component tree
    expect(await screen.findByText(/· 0:08/)).toBeInTheDocument();
    await savedPanel();
    await click("Play recording");
    expect(
      ((await screen.findByLabelText("Playback of the saved recording")) as HTMLAudioElement).src,
    ).toContain(audio);
  });

  it("if the original won't play it retries with a fresh link, then falls back to the WAV copy", async () => {
    const { audio, wav } = world.seedSaved("h1");
    mount();
    await savedPanel();
    await click("Play recording");
    let player = await screen.findByLabelText("Playback of the saved recording");
    await act(async () => void fireEvent.error(player)); // original fails (maybe expired link)
    await waitFor(() => expect(world.signedRequests).toHaveLength(2));
    expect(world.signedRequests[1]!.path).toBe(audio); // same file, fresh link
    player = await screen.findByLabelText("Playback of the saved recording");
    await act(async () => void fireEvent.error(player)); // still fails
    await waitFor(() => expect(world.signedRequests).toHaveLength(3));
    expect(world.signedRequests[2]!.path).toBe(wav); // compatible copy
    expect(await screen.findByText(/Playing the compatible copy/i)).toBeInTheDocument();
  });

  it("if even the WAV fails it says so plainly and offers Download", async () => {
    world.seedSaved("h1");
    mount();
    await savedPanel();
    await click("Play recording");
    for (let i = 0; i < 3; i++) {
      const player = await screen.findByLabelText("Playback of the saved recording");
      await act(async () => void fireEvent.error(player));
      await waitFor(() =>
        expect(world.signedRequests.length).toBeGreaterThanOrEqual(Math.min(i + 2, 3)),
      );
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't play the recording/i);
    expect(screen.getByRole("button", { name: "Download recording" })).toBeInTheDocument();
  });

  it("a recording that has been removed from storage shows a friendly error, never a crash", async () => {
    const { audio, wav } = world.seedSaved("h1");
    world.objects.delete(audio);
    world.objects.delete(wav);
    mount();
    await savedPanel();
    await click("Play recording");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't open the recording/i);
    expect(screen.queryByLabelText("Playback of the saved recording")).not.toBeInTheDocument();
  });
});

describe("deleting a saved recording", () => {
  it("asks for confirmation first; nothing happens if the caregiver keeps it", async () => {
    world.seedSaved("h1");
    mount();
    await savedPanel();
    await click("Delete recording");
    expect(await screen.findByText("Delete this recording?")).toBeInTheDocument();
    expect(world.log).toEqual([]);
    await click("Keep it");
    expect(world.log).toEqual([]);
    expect(world.objects.size).toBe(2);
  });

  it("clears the DB reference first, then removes both objects; the handoff and its note remain", async () => {
    world.seedSaved("h1");
    mount();
    await savedPanel();
    await click("Delete recording");
    await screen.findByText("Delete this recording?");
    const dialog = screen.getByRole("alertdialog");
    await act(
      async () =>
        void fireEvent.click(within(dialog).getByRole("button", { name: "Delete recording" })),
    );
    await waitFor(() => expect(world.objects.size).toBe(0));
    expect(world.log).toEqual(["clear", "remove:2"]);
    expect(world.rows[0]).toMatchObject({
      id: "h1",
      unusual: "Napped after lunch",
      audio_path: null,
      audio_wav_path: null,
      duration_seconds: null,
    });
    await waitFor(() => expect(screen.queryByLabelText("Saved recording")).not.toBeInTheDocument());
    expect(screen.getByText("Napped after lunch")).toBeInTheDocument();
  });
});

describe("downloads and cross-family protection in the UI layer", () => {
  it("downloads use the same signed-URL call (same authorization, 5 minutes) with a file name", async () => {
    const { audio, wav } = world.seedSaved("h1");
    const saved: string[] = [];
    const { SavedRecording } = await import("@/components/SavedRecording");
    const { recordingService } = await import("@/services");
    render(
      <SavedRecording
        handoff={{
          id: "h1",
          family_id: FAM,
          audio_path: audio,
          audio_wav_path: wav,
          duration_seconds: 8,
        }}
        service={recordingService}
        saveFile={(u) => saved.push(u)}
        onDeleted={() => {}}
      />,
    );
    await click("Download recording");
    await click("Download WAV copy");
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(world.signedRequests).toEqual([
      { path: audio, ttl: 300, download: "original.webm" },
      { path: wav, ttl: 300, download: "pcm.wav" },
    ]);
  });

  it("never requests a path from another family, even if one is somehow in the data", async () => {
    const foreign =
      "bbbbbbbb-0000-4000-8000-00000000000b/handoff/22222222-2222-4222-8222-222222222222/original.webm";
    world.objects.set(foreign, { size: 1, type: "audio/webm" });
    const { SavedRecording } = await import("@/components/SavedRecording");
    const { recordingService } = await import("@/services");
    render(
      <SavedRecording
        handoff={{
          id: "h9",
          family_id: FAM,
          audio_path: foreign,
          audio_wav_path: null,
          duration_seconds: 3,
        }}
        service={recordingService}
        onDeleted={() => {}}
      />,
    );
    await click("Play recording");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't open the recording/i);
    expect(world.signedRequests).toEqual([]); // blocked before asking storage at all
  });
});
