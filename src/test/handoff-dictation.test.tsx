import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandoffDictation } from "@/components/HandoffDictation";
import {
  dictationTranscriber,
  TranscriptionNotConfiguredError,
  type DictationTranscriber,
} from "@/services/dictation";
import {
  domError,
  FakeMediaRecorder,
  installRecorderEnv,
  type RecorderEnv,
} from "./recorder-fakes";

let env: RecorderEnv;
beforeEach(() => {
  env = installRecorderEnv();
});
afterEach(() => {
  cleanup();
  env.restore();
});

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
const recordAndStop = async () => {
  await click("Record");
  await click("Stop");
};

function fakeTranscriber(impl: DictationTranscriber["transcribe"]): DictationTranscriber {
  return { available: true, transcribe: vi.fn(impl) };
}

describe("HandoffDictation: recording UI", () => {
  it("shows a Record button and the privacy promise, and no player yet", () => {
    render(<HandoffDictation onAccept={() => {}} />);
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(
      screen.getByText(/stays on this device\. It isn't saved or uploaded/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Playback of your recording")).not.toBeInTheDocument();
  });

  it("Record -> shows a live timer and Stop; Stop -> shows playback", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Recording 0:0\d/);
    await click("Stop");
    const player = screen.getByLabelText("Playback of your recording") as HTMLAudioElement;
    expect(player.tagName).toBe("AUDIO");
    expect(player).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(screen.getByText(/^Recorded 0:0\d$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("Discard recording removes playback and revokes the local URL", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await recordAndStop();
    await click("Discard recording");
    expect(screen.queryByLabelText("Playback of your recording")).not.toBeInTheDocument();
    expect(env.revokeObjectURL).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
  });

  it("Record again replaces the previous take", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await recordAndStop();
    await click("Record again");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(2);
  });

  it("uploads and saves nothing: no network calls through record, stop, playback and discard", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await recordAndStop();
    await click("Discard recording");
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });

  it("permission denied: clear, actionable alert, offers Try again, typing still possible", async () => {
    env.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Microphone access is blocked/i);
    expect(alert).toHaveTextContent(/You can still type your note/i);
    await click("Try again");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(); // second attempt succeeds
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no microphone: specific message", async () => {
    env.getUserMedia.mockRejectedValueOnce(domError("NotFoundError"));
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    expect(screen.getByRole("alert")).toHaveTextContent(/No microphone was found/i);
  });

  it("unsupported browser: explains why, doesn't throw, and doesn't offer a pointless retry", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    expect(screen.getByRole("alert")).toHaveTextContent(/secure \(https\) connection/i);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows a notice (and keeps the audio) when the mic is interrupted mid-recording", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    act(() => env.stream.track.fire("ended"));
    expect(screen.getByText(/microphone was interrupted/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument();
  });

  it("releases the microphone when the component unmounts", async () => {
    const { unmount } = render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    unmount();
    expect(env.stream.track.stop).toHaveBeenCalled();
  });

  it("uses the design's large round voice controls (6rem) for record and stop", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    expect(screen.getByRole("button", { name: "Record" }).className).toContain("size-24");
    await click("Record");
    expect(screen.getByRole("button", { name: "Stop" }).className).toContain("size-24");
  });
});

describe("HandoffDictation: transcription is not connected (default)", () => {
  it("the default transcriber is unavailable and throws if called", async () => {
    expect(dictationTranscriber.available).toBe(false);
    await expect(dictationTranscriber.transcribe(new Blob())).rejects.toBeInstanceOf(
      TranscriptionNotConfiguredError,
    );
  });

  it("does not offer Transcribe, says it isn't connected, and never claims it works", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await recordAndStop();
    expect(screen.queryByRole("button", { name: /transcribe/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Transcription isn't connected yet/i)).toBeInTheDocument();
    expect(env.fetchSpy).not.toHaveBeenCalled();
  });
});

describe("HandoffDictation: review-and-edit flow (with a FAKE test transcriber, not a real service)", () => {
  it("transcribes to an editable draft that is NOT added to the note until the caregiver confirms", async () => {
    const onAccept = vi.fn();
    const t = fakeTranscriber(async () => ({
      text: "Rosa napped after lunch and seemed a bit tired.",
    }));
    render(<HandoffDictation onAccept={onAccept} transcriber={t} />);
    await recordAndStop();
    await click("Transcribe");
    const draft = (await screen.findByLabelText(/Draft from dictation/i)) as HTMLTextAreaElement;
    expect(draft.value).toBe("Rosa napped after lunch and seemed a bit tired.");
    expect(screen.getByText(/Not saved yet/i)).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.change(draft, {
      target: { value: "Rosa napped after lunch. She seemed a little tired." },
    });
    await click("Add to note");
    expect(onAccept).toHaveBeenCalledExactlyOnceWith(
      "Rosa napped after lunch. She seemed a little tired.",
    );
    expect(screen.queryByLabelText(/Draft from dictation/i)).not.toBeInTheDocument();
  });

  it("passes the recorded audio (and an abort signal) to the transcriber, nothing else", async () => {
    const t = fakeTranscriber(async () => ({ text: "ok" }));
    render(<HandoffDictation onAccept={() => {}} transcriber={t} />);
    await recordAndStop();
    await click("Transcribe");
    await screen.findByLabelText(/Draft from dictation/i);
    const [blob, opts] = (t.transcribe as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(opts!.signal).toBeInstanceOf(AbortSignal);
  });

  it("Discard draft drops it without adding anything", async () => {
    const onAccept = vi.fn();
    render(
      <HandoffDictation
        onAccept={onAccept}
        transcriber={fakeTranscriber(async () => ({ text: "draft text" }))}
      />,
    );
    await recordAndStop();
    await click("Transcribe");
    await screen.findByLabelText(/Draft from dictation/i);
    await click("Discard draft");
    expect(screen.queryByLabelText(/Draft from dictation/i)).not.toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("can't add an empty draft", async () => {
    render(
      <HandoffDictation
        onAccept={vi.fn()}
        transcriber={fakeTranscriber(async () => ({ text: "x" }))}
      />,
    );
    await recordAndStop();
    await click("Transcribe");
    const draft = await screen.findByLabelText(/Draft from dictation/i);
    fireEvent.change(draft, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Add to note" })).toBeDisabled();
  });

  it("a transcription failure keeps the recording and explains, without losing anything", async () => {
    const t = fakeTranscriber(async () => {
      throw new Error("boom");
    });
    render(<HandoffDictation onAccept={() => {}} transcriber={t} />);
    await recordAndStop();
    await click("Transcribe");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Couldn't turn this recording into text/i,
    );
    expect(screen.getByLabelText("Playback of your recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transcribe" })).toBeInTheDocument(); // retry possible
  });

  it("cancelling an in-flight transcription ignores a late result", async () => {
    let resolve!: (v: { text: string }) => void;
    const t = fakeTranscriber(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    render(<HandoffDictation onAccept={() => {}} transcriber={t} />);
    await recordAndStop();
    await click("Transcribe");
    await click(/Transcribing/);
    await act(async () => {
      resolve({ text: "too late" });
    });
    await waitFor(() =>
      expect(screen.queryByLabelText(/Draft from dictation/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Transcribe" })).toBeInTheDocument();
  });
});
