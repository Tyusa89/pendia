// Regression tests for the Android report: "Recorded 0:08", player shows 0:00, Play does nothing.
// Root causes covered here: (1) streaming-mode recording (start(timeslice)) yields a WebM with no duration
// (duration = Infinity -> player shows 0:00); (2) the playback blob URL was revoked by an effect cleanup that
// can re-run while state is kept (Fast Refresh / Activity), leaving a dead URL in the player; (3) a failing
// player gave no feedback. Fictional placeholder audio only; nothing is uploaded.
import { Activity, StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HandoffDictation } from "@/components/HandoffDictation";
import { FakeMediaRecorder, installRecorderEnv, type RecorderEnv } from "./recorder-fakes";

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
const player = () => screen.getByLabelText("Playback of your recording") as HTMLAudioElement;
const revokedUrls = () => env.revokeObjectURL.mock.calls.map((c) => c[0] as string);

describe("recording format (regression: Infinity duration / 0:00 player)", () => {
  it("starts the recorder WITHOUT a timeslice, so the browser writes a finalized file with a known duration", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    expect(FakeMediaRecorder.instances[0]!.startArgs).toEqual([]);
  });

  it("still keeps what was captured if the microphone is interrupted mid-recording (stop() flushes the data)", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    act(() => env.stream.track.fire("ended"));
    expect(player().src).toMatch(/^blob:/);
  });
});

describe("playback URL lifecycle (regression: dead blob URL in the player)", () => {
  const Wrapper = ({ mode, children }: { mode: "visible" | "hidden"; children: ReactNode }) => (
    <Activity mode={mode}>{children}</Activity>
  );

  it("never leaves a revoked URL in the player when effects are torn down and re-run with state kept", async () => {
    const ui = (mode: "visible" | "hidden") => (
      <Wrapper mode={mode}>
        <HandoffDictation onAccept={() => {}} />
      </Wrapper>
    );
    const { rerender } = render(ui("visible"));
    await click("Record");
    await click("Stop");
    expect(player().src).toMatch(/^blob:/);

    // Same effect teardown/re-run that Vite Fast Refresh causes in the live preview.
    await act(async () => rerender(ui("hidden")));
    await act(async () => rerender(ui("visible")));

    const src = player().src;
    expect(src).toMatch(/^blob:/);
    expect(revokedUrls()).not.toContain(src);
  });

  it("survives React StrictMode's double-run of effects", async () => {
    render(
      <StrictMode>
        <HandoffDictation onAccept={() => {}} />
      </StrictMode>,
    );
    await click("Record");
    await click("Stop");
    expect(revokedUrls()).not.toContain(player().src);
  });

  it("revokes each URL it creates exactly when it is replaced or discarded (no leaks, no early revoke)", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    await click("Stop");
    const first = player().src;
    expect(revokedUrls()).not.toContain(first);
    await click("Record again");
    expect(revokedUrls()).toContain(first);
    await click("Stop");
    const second = player().src;
    expect(second).not.toBe(first);
    await click("Discard recording");
    expect(revokedUrls()).toContain(second);
  });
});

describe("player failure feedback (regression: silent dead player)", () => {
  it("tells the caregiver when the browser cannot play the recording, with safe diagnostics, and offers Record again", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    await click("Stop");
    act(() => {
      fireEvent.error(player());
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't play the recording back/i);
    expect(alert).toHaveTextContent(/audio\/webm/); // the container, to help diagnose a device
    expect(alert).toHaveTextContent(/type your note/i);
    expect(screen.getByRole("button", { name: "Record again" })).toBeInTheDocument();
    expect(env.fetchSpy).not.toHaveBeenCalled(); // diagnostics are shown, never sent anywhere
  });

  it("clears the playback error when the caregiver records again", async () => {
    render(<HandoffDictation onAccept={() => {}} />);
    await click("Record");
    await click("Stop");
    act(() => {
      fireEvent.error(player());
    });
    await click("Record again");
    expect(screen.queryByText(/couldn't play the recording back/i)).not.toBeInTheDocument();
  });
});
