// The complete application flow with a MOCKED Meta: Handoffs page -> record -> Transcribe -> reviewable draft with speaker labels
// and timestamps -> "Add to note" -> Save handoff. Part 1 runs the real client adapter and the real server module against a fake
// fetch (WAV validation, gates, parsing). Part 2 mounts the real Handoffs route with the server functions faked at their edge.
// No test here can reach Meta.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandoffDictation } from "@/components/HandoffDictation";
import { createMetaTranscriber } from "@/lib/meta-transcribe/client";
import { parseTranscribeResponse } from "@/lib/meta-transcribe/response";
import type { PcmProvider } from "@/lib/pcm-capture";
import {
  resetTranscribeLimits,
  transcribeRecording as serverTranscribe,
} from "@/server/meta-transcribe.server";
import { installRecorderEnv, type RecorderEnv } from "./recorder-fakes";
import { ENV_ON, FAMILY, jsonResponse, liveFixture, wavBytes } from "./meta-transcribe-helpers";

const fns = vi.hoisted(() => ({
  getTranscriptionStatus: vi.fn(),
  transcribeRecording: vi.fn(),
}));
const who = vi.hoisted(() => ({ role: "organizer" }));
vi.mock("@/lib/meta-transcribe/transcribe.functions", () => fns);

const create = vi.fn(async (h: unknown) => h);
const saveWithRecording = vi.fn(async (h: unknown) => h);
vi.mock("@/services", () => ({
  handoffService: {
    list: async () => [],
    activeWatchItems: async () => [],
    create: (h: unknown) => create(h),
  },
  recordingService: { saveHandoffWithRecording: (h: unknown) => saveWithRecording(h) },
}));
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: {
      family: { id: "fam-1", name: "Test Family" },
      me: { id: "mem-1", family_id: "fam-1", name: "Maria", role: who.role },
    },
  }),
  useMembers: () => ({ data: [{ id: "mem-1", name: "Maria" }] }),
}));

import { Route } from "@/routes/_authenticated/handoffs";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
  create.mockClear();
  who.role = "organizer";
  saveWithRecording.mockClear();
  fns.getTranscriptionStatus.mockReset();
  fns.transcribeRecording.mockReset();
  resetTranscribeLimits();
});
afterEach(() => {
  cleanup();
  env.restore();
});

const click = async (name: string | RegExp, i = 0) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name })[i]!);
  });
};
const recordAndStop = async () => {
  await click("Record");
  await click("Stop");
};

/** A recorder whose WAV copy is a real, valid 16 kHz mono WAV, so the server module's validation is exercised. */
function wavPcm(seconds = 2): PcmProvider {
  return {
    prepare: () => ({ ctx: {} as AudioContext, moduleReady: Promise.resolve() }),
    attach: async () => ({
      stop: async () => ({
        wav: new Blob([wavBytes({ seconds })], { type: "audio/wav" }),
        sampleCount: seconds * 16000,
        durationSec: seconds,
      }),
      abort: () => {},
    }),
    release: () => {},
  };
}

describe("part 1: client adapter + real server module + fake Meta fetch", () => {
  const isOrganizer = async () => true;
  function connected(
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
    env2 = ENV_ON,
    org = isOrganizer,
  ) {
    return createMetaTranscriber(FAMILY, true, {
      transcribe: (async ({ data }: { data: { familyId: string; audioBase64: string } }) =>
        serverTranscribe({
          env: env2,
          userId: "u1",
          familyId: data.familyId,
          audioBase64: data.audioBase64,
          isOrganizer: org,
          fetchImpl,
        })) as never,
    });
  }

  it("shows a reviewable draft with anonymous speaker labels and timestamps; nothing is added until confirmed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(liveFixture));
    const onAccept = vi.fn();
    render(
      <HandoffDictation onAccept={onAccept} transcriber={connected(fetchImpl)} pcm={wavPcm()} />,
    );
    await recordAndStop();
    expect(screen.getByText(/sends this recording to Meta's speech service/i)).toBeInTheDocument();
    const disclosure =
      screen.getByText(/sends this recording to Meta's speech service/i).textContent ?? "";
    expect(disclosure).toMatch(/only sent when you press the button/i);
    expect(disclosure).toMatch(/Meta's own terms/i);
    // No unverified promise about what Meta does with the audio.
    expect(disclosure).not.toMatch(
      /not saved there|deleted|no retention|not retained|not stored by Meta|private|secure/i,
    );
    await click("Transcribe");
    const draft = (await screen.findByLabelText(/Draft from dictation/i)) as HTMLTextAreaElement;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const lines = draft.value.split("\n");
    expect(lines).toHaveLength(11); // 12 turns returned, 1 empty non-speech turn ignored
    expect(lines[0]).toMatch(/^Speaker A \(0:00\): Good morning, Rosa\./);
    expect(lines[1]).toMatch(/^Speaker B \(0:05\): Pretty good\./);
    expect(draft.value).toMatch(/lisinopril from 10 milligrams to milligrams to 20 milligrams/); // as heard; caregiver must fix
    expect(screen.getByRole("note")).toHaveTextContent(/labels from the transcription, not names/i);
    expect(screen.getByRole("note")).toHaveTextContent(/doses, medicines or instructions/i);
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.change(draft, { target: { value: "Speaker A (0:00): Edited by the caregiver." } });
    await click("Add to note");
    expect(onAccept).toHaveBeenCalledExactlyOnceWith("Speaker A (0:00): Edited by the caregiver.");
  });

  it("sends the WAV copy (not the original recording) to the service", async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const text = new TextDecoder("latin1").decode(init.body as Uint8Array);
      expect(text).toContain('name="audio"');
      expect(text).toContain("RIFF");
      return jsonResponse(liveFixture);
    });
    render(
      <HandoffDictation onAccept={() => {}} transcriber={connected(fetchImpl)} pcm={wavPcm()} />,
    );
    await recordAndStop();
    await click("Transcribe");
    await screen.findByLabelText(/Draft from dictation/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("without a WAV copy the service is never called and the caregiver is told to type the note", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(liveFixture));
    render(<HandoffDictation onAccept={() => {}} transcriber={connected(fetchImpl)} />); // no pcm: original only
    await recordAndStop();
    await click("Transcribe");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /transcription-ready copy.*type the note/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument();
  });

  it.each([
    [
      "a timeout",
      () => Promise.reject(Object.assign(new Error("x"), { name: "TimeoutError" })),
      /took too long/i,
    ],
    [
      "a network error",
      () => Promise.reject(new TypeError("fetch failed")),
      /Couldn't reach the transcription service/i,
    ],
    [
      "HTTP 401",
      () => Promise.resolve(jsonResponse({ error: "bad key" }, 401)),
      /isn't available right now/i,
    ],
    ["HTTP 429", () => Promise.resolve(jsonResponse({}, 429)), /busy/i],
    [
      "HTTP 500",
      () => Promise.resolve(jsonResponse("oops", 500)),
      /Couldn't turn this recording into text/i,
    ],
    [
      "a malformed reply",
      () => Promise.resolve(jsonResponse({ nope: 1 })),
      /Couldn't turn this recording into text/i,
    ],
    [
      "a reply with no speech",
      () =>
        Promise.resolve(
          jsonResponse({
            ...liveFixture,
            turns: [{ turnId: 0, startMs: 0, endMs: 9, transcript: "" }],
          }),
        ),
      /No speech was found/i,
    ],
  ])("%s: friendly message, recording kept, no draft, no retry", async (_n, impl, msg) => {
    const fetchImpl = vi.fn(impl as never);
    const onAccept = vi.fn();
    render(
      <HandoffDictation onAccept={onAccept} transcriber={connected(fetchImpl)} pcm={wavPcm()} />,
    );
    await recordAndStop();
    await click("Transcribe");
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Draft from dictation/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transcribe" })).toBeEnabled(); // the caregiver chooses whether to try again
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("transcription switched off or not permitted on the server: safe message, no request", async () => {
    for (const [env2, org, msg] of [
      [{}, isOrganizer, /isn't available right now/i],
      [ENV_ON, async () => false, /Only the family organizer/i],
    ] as const) {
      const fetchImpl = vi.fn(async () => jsonResponse(liveFixture));
      const { unmount } = render(
        <HandoffDictation
          onAccept={() => {}}
          transcriber={connected(fetchImpl, env2 as never, org)}
          pcm={wavPcm()}
        />,
      );
      await recordAndStop();
      await click("Transcribe");
      expect(await screen.findByRole("alert")).toHaveTextContent(msg);
      expect(fetchImpl).not.toHaveBeenCalled();
      unmount();
      cleanup();
    }
  });

  it("an unavailable transcriber shows the existing 'not connected' text and no Transcribe button", async () => {
    render(
      <HandoffDictation onAccept={() => {}} transcriber={createMetaTranscriber(FAMILY, false)} />,
    );
    await recordAndStop();
    expect(screen.getByText(/Transcription isn't connected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Transcribe/ })).not.toBeInTheDocument();
  });

  it("cancel while transcribing discards the late result", async () => {
    let release!: (r: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => (release = r)));
    render(
      <HandoffDictation onAccept={() => {}} transcriber={connected(fetchImpl)} pcm={wavPcm()} />,
    );
    await recordAndStop();
    await click("Transcribe");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await click(/Transcribing… tap to cancel/);
    await act(async () => release(jsonResponse(liveFixture)));
    expect(screen.queryByLabelText(/Draft from dictation/i)).not.toBeInTheDocument();
  });
});

describe("part 2: the real Handoffs route; only the server-function edge is faked", () => {
  const turns = parseTranscribeResponse(liveFixture).turns;
  const okReply = { ok: true, turns, speakerCount: 2, audioSeconds: 58.24, elapsedMs: 1 };

  function mount() {
    const Page = Route.options.component as ComponentType;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  }
  const answerRequired = async () => {
    await click("Yes", 0); // ate
    await click("Yes", 1); // meds
  };

  it("asks the server about THIS family, then offers Transcribe to an organizer", async () => {
    fns.getTranscriptionStatus.mockResolvedValue({ available: true });
    mount();
    await click("Record");
    await click("Stop");
    expect(await screen.findByRole("button", { name: "Transcribe" })).toBeInTheDocument();
    expect(fns.getTranscriptionStatus).toHaveBeenCalledWith({ data: { familyId: "fam-1" } });
  });

  it("transcript -> review -> note -> save: only the reviewed text is persisted, through the existing handoff save", async () => {
    fns.getTranscriptionStatus.mockResolvedValue({ available: true });
    fns.transcribeRecording.mockResolvedValue(okReply);
    mount();
    await answerRequired();
    await click("Record");
    await click("Stop");
    await click("Transcribe");
    const draft = (await screen.findByLabelText(/Draft from dictation/i)) as HTMLTextAreaElement;
    expect(fns.transcribeRecording).toHaveBeenCalledTimes(1);
    const arg = fns.transcribeRecording.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(arg.data).sort()).toEqual(["audioBase64", "familyId"]);
    expect(arg.data["familyId"]).toBe("fam-1");

    // The draft alone changes nothing: the note field is empty, and saving now persists no transcript.
    const note = screen.getByPlaceholderText(/^Optional/) as HTMLTextAreaElement;
    expect(note.value).toBe("");
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      family_id: "fam-1",
      unusual: null,
      ate: true,
      meds_taken: true,
    });
    create.mockClear();

    // Review: the caregiver corrects the heard-as-garbled dose, then adds it.
    fireEvent.change(draft, {
      target: {
        value: draft.value.replace(
          "from 10 milligrams to milligrams to 20 milligrams",
          "from 10 milligrams to 20 milligrams",
        ),
      },
    });
    await click("Add to note");
    expect(note.value).toMatch(/^Speaker A \(0:00\): Good morning, Rosa\./);
    expect(note.value).toContain("from 10 milligrams to 20 milligrams");
    expect(note.value).not.toContain("milligrams to milligrams");
    expect(create).not.toHaveBeenCalled(); // adding to the note is not saving

    await answerRequired();
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const saved = create.mock.calls[0]![0] as { unusual: string };
    expect(saved).toMatchObject({ family_id: "fam-1", author_member_id: "mem-1" });
    expect(saved.unusual.split("\n")).toHaveLength(11);
    expect(saved.unusual).toContain("Speaker B (0:05): Pretty good.");
    expect(saveWithRecording).not.toHaveBeenCalled(); // the audio itself is not stored unless "Keep" is ticked
    expect(JSON.stringify(saved)).not.toMatch(/audio_|sessionId|sanitized-session-id/);
  });

  it("a failed or empty transcription leaves typing and saving exactly as before", async () => {
    fns.getTranscriptionStatus.mockResolvedValue({ available: true });
    fns.transcribeRecording.mockResolvedValue({ ok: false, code: "timeout" });
    mount();
    await answerRequired();
    await click("Record");
    await click("Stop");
    await click("Transcribe");
    expect(await screen.findByRole("alert")).toHaveTextContent(/took too long/i);
    fireEvent.change(screen.getByPlaceholderText(/^Optional/), {
      target: { value: "Typed instead" },
    });
    await click("Save handoff");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ unusual: "Typed instead" });
    expect(fns.transcribeRecording).toHaveBeenCalledTimes(1);
  });

  it("when the server says transcription is unavailable, the page shows the 'not connected' text and no button", async () => {
    fns.getTranscriptionStatus.mockResolvedValue({ available: false });
    mount();
    await click("Record");
    await click("Stop");
    expect(screen.getByText(/Transcription isn't connected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Transcribe/ })).not.toBeInTheDocument();
  });

  it("when the status call itself fails (offline, signed out), the page degrades to the same text", async () => {
    fns.getTranscriptionStatus.mockRejectedValue(new Error("Unauthorized"));
    mount();
    await click("Record");
    await click("Stop");
    expect(screen.getByText(/Transcription isn't connected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Transcribe/ })).not.toBeInTheDocument();
  });

  it("a non-organizer still cannot save a handoff, whatever the transcription status", async () => {
    who.role = "member";
    fns.getTranscriptionStatus.mockResolvedValue({ available: false });
    mount();
    expect(await screen.findByText(/Only the organizer can save a handoff/i)).toBeInTheDocument();
    await answerRequired();
    expect(screen.getByRole("button", { name: "Save handoff" })).toBeDisabled();
    expect(
      within(document.body).queryByRole("button", { name: /^Transcribe/ }),
    ).not.toBeInTheDocument();
  });
});
