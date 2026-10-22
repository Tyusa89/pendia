// Demo Mode recovery, end to end through the screens: after a reload or remount the walkthrough returns to the same step with
// the same choices; Start over clears it; bad storage is ignored; nothing leaves the page. Synthetic data only.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisitDemo } from "@/components/visit-demo/VisitDemo";
import { STORAGE_KEY } from "@/lib/visit-demo/persist";

const forbidden = vi.fn(() => {
  throw new Error("Demo Mode must not do this");
});
beforeEach(() => {
  sessionStorage.clear();
  forbidden.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", forbidden);
  vi.stubGlobal("WebSocket", forbidden);
  vi.stubGlobal("XMLHttpRequest", forbidden);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await flush();
};
/** A browser reload or remount: the page and its React state are gone, sessionStorage is not. */
async function reload() {
  cleanup();
  render(<VisitDemo />);
  await flush();
}
async function fresh() {
  render(<VisitDemo />);
  await flush();
}
async function tickConsent() {
  await click(/Start a simulated doctor visit/);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox"));
  });
}
async function toVisit() {
  await tickConsent();
  await click(/Start the simulated visit/);
}
async function toSpeakers() {
  await toVisit();
  await click(/Skip to the end/);
  await click(/Continue: who was speaking/);
}
async function toReview() {
  await toSpeakers();
  await click(/Yes, this is right/);
}
const med = () => screen.getByRole("region", { name: "Medication change: Lisinopril" });
const task = () => screen.getByRole("region", { name: "Follow-up: Drive Rosa to her blood test" });
const watch = () => screen.getByRole("region", { name: /Watch for:/ });
async function decideAll() {
  await act(async () => {
    fireEvent.click(within(med()).getByRole("button", { name: /Confirm the Lisinopril change/ }));
  });
  fireEvent.change(screen.getByLabelText("Who will do this?"), { target: { value: "Jenny" } });
  await act(async () => {
    fireEvent.click(within(task()).getByRole("button", { name: /Confirm the follow-up/ }));
  });
  await act(async () => {
    fireEvent.click(within(watch()).getByRole("button", { name: /Reject the watch item/ }));
  });
}
const notice = () => screen.queryByText(/Restored where you left off/);
const saved = () => sessionStorage.getItem(STORAGE_KEY);

describe("fresh visits are unaffected", () => {
  it("with nothing saved the demo starts at Step 1, with no restore notice", async () => {
    await fresh();
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    expect(notice()).toBeNull();
    expect(saved()).toBeNull(); // nothing is written until the person does something
  });
});

describe("remount at each step", () => {
  it("Step 2 (consent): the consent tick is kept", async () => {
    await fresh();
    await tickConsent();
    await reload();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: /Start the simulated visit/ })).toBeEnabled();
    expect(notice()).toBeInTheDocument();
  });

  it("Step 3 (visit): the same lines are back, playback is PAUSED, and Play resumes from there", async () => {
    await fresh();
    await toVisit();
    await flush(2500); // a few lines have appeared
    const before = screen.getByRole("log").textContent!;
    expect(before).toContain("Good morning, Rosa");
    expect(before).not.toContain("Thank you, doctor");
    await reload();
    const log = () => screen.getByRole("log").textContent!;
    expect(log()).toBe(before);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument(); // paused, not "Pause"
    expect(screen.getByText(/Playback is paused: press Play to continue/)).toBeInTheDocument();
    await flush(20000);
    expect(log()).toBe(before); // still paused: nothing advanced by itself
    await click("Play");
    for (let i = 0; i < 40; i++) await flush(500);
    expect(log()).toContain("Thank you, doctor");
  });

  it("Step 4 (speakers): the chosen roles are kept, and confirmation is still required", async () => {
    await fresh();
    await toSpeakers();
    fireEvent.change(screen.getByLabelText("Speaker B"), { target: { value: "family" } });
    await reload();
    expect(screen.getByLabelText("Speaker A")).toHaveValue("doctor");
    expect(screen.getByLabelText("Speaker B")).toHaveValue("family");
    expect(screen.queryByText(/What was said, in plain language/)).toBeNull(); // not confirmed, so no summary
    expect(screen.getByRole("button", { name: /Yes, this is right/ })).toBeEnabled();
  });

  it("Step 5 (review): confirmations, the rejection and the assigned family member are kept", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await reload();
    expect(within(med()).getByText("Confirmed · demo only")).toBeInTheDocument();
    expect(within(task()).getByText("Confirmed · demo only")).toBeInTheDocument();
    expect(task()).toHaveTextContent("Assigned to Jenny");
    expect(within(watch()).getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Patel said Rosa's blood pressure/)).toBeInTheDocument(); // summary rebuilt from the fixtures
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    // and the person can still change their mind
    await act(async () => {
      fireEvent.click(within(watch()).getByRole("button", { name: /Change my answer/ }));
    });
    expect(within(watch()).getByText(/Proposed · not confirmed/)).toBeInTheDocument();
  });

  it("Step 5 with nothing decided yet: nothing is invented", async () => {
    await fresh();
    await toReview();
    await reload();
    expect(screen.getAllByText(/Proposed · not confirmed/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("Step 6 (follow-up) before the reply: the simulated text to Jenny is back, still labeled not sent, and the reply is still available", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await click("Continue");
    await reload();
    const group = screen.getByRole("group", { name: "Follow-up for Jenny" });
    expect(group).toHaveTextContent(
      "Pendia: Maria asked you to: Drive Rosa to her blood test (within the next two weeks). Reply DONE when it's finished.",
    );
    expect(group).toHaveTextContent(/simulated · not sent/i);
    expect(screen.getByTestId("status-task-1")).toHaveTextContent("Waiting for Jenny (simulated)");
    expect(screen.getByRole("button", { name: /Pretend Jenny replies/ })).toBeInTheDocument();
  });

  it("Step 6 after Jenny's simulated DONE: the reply and the Done status survive, and cannot be sent twice", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await click("Continue");
    await click(/Pretend Jenny replies/);
    expect(screen.getByTestId("status-task-1")).toHaveTextContent("Done · Jenny (simulated reply)");
    await reload();
    const group = screen.getByRole("group", { name: "Follow-up for Jenny" });
    expect(group).toHaveTextContent("Simulated reply");
    expect(group).toHaveTextContent("DONE");
    expect(screen.getByTestId("status-task-1")).toHaveTextContent("Done · Jenny (simulated reply)");
    expect(screen.queryByRole("button", { name: /Pretend Jenny replies/ })).toBeNull();
  });

  it("Step 7 (wrap-up): stays restorable, with the same counts", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await click("Continue");
    await click(/Pretend Jenny replies/);
    await click(/Finish the demo/);
    await reload();
    expect(screen.getByText("That's the loop")).toBeInTheDocument();
    expect(screen.getByText(/You confirmed/)).toHaveTextContent(
      "You confirmed 2 and rejected 1 of 3 proposed items",
    );
    expect(screen.getByText(/follow-up text/)).toHaveTextContent(
      "1 follow-up text shown, 0 sent; 1 simulated reply",
    );
    expect(
      screen.getByText("This was a prerecorded synthetic example. Nothing was saved or sent."),
    ).toBeInTheDocument();
  });

  it("a second reload in a row still restores (the restored state is saved again)", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await reload();
    await reload();
    expect(task()).toHaveTextContent("Assigned to Jenny");
  });

  it("the banner is shown throughout, including while restoring and after", async () => {
    await fresh();
    await toReview();
    cleanup();
    render(<VisitDemo />);
    expect(screen.getByRole("note", { name: "Demo mode notice" })).toBeInTheDocument();
    expect(screen.getByText("Restoring your demo…")).toBeInTheDocument(); // not a blank screen, and not a misleading Step 1
    expect(screen.queryByRole("button", { name: /Start a simulated doctor visit/ })).toBeNull();
    await flush();
    expect(screen.getByRole("note", { name: "Demo mode notice" })).toBeInTheDocument();
    expect(screen.queryByText("Restoring your demo…")).toBeNull();
  });

  it("the restore notice goes away as soon as the person acts", async () => {
    await fresh();
    await toReview();
    await reload();
    expect(notice()).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(watch()).getByRole("button", { name: /Reject the watch item/ }));
    });
    expect(notice()).toBeNull();
  });
});

describe("Start over is the only thing that clears saved progress", () => {
  it("clears it at the review step and at the wrap-up; the next load is a fresh Step 1", async () => {
    await fresh();
    await toReview();
    expect(saved()).not.toBeNull();
    await click(/Start over/);
    expect(saved()).toBeNull();
    await reload();
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    expect(notice()).toBeNull();

    await toReview();
    await decideAll();
    await click("Continue");
    await click(/Finish the demo/);
    expect(saved()).not.toBeNull(); // finishing alone does not clear it
    await click(/Start over/);
    expect(saved()).toBeNull();
  });
  it("starting over then going again saves the new run, not the old one", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await click(/Start over/);
    await toReview();
    await reload();
    expect(screen.getAllByText(/Proposed · not confirmed/)).toHaveLength(3);
  });
});

describe("bad storage is ignored safely", () => {
  it.each([
    ["not JSON", "{broken"],
    ["an older version", JSON.stringify({ v: 0, step: "summary" })],
    [
      "extra text smuggled in",
      JSON.stringify({
        v: 1,
        step: "consent",
        consent: true,
        revealed: 0,
        roles: {},
        speakersConfirmed: false,
        decisions: {},
        owners: {},
        followUps: {},
        transcript: "Good morning, Rosa.",
      }),
    ],
    [
      "an impossible step",
      JSON.stringify({
        v: 1,
        step: "followup",
        consent: true,
        revealed: 12,
        roles: { A: "doctor", B: "patient" },
        speakersConfirmed: true,
        decisions: {},
        owners: {},
        followUps: {},
      }),
    ],
    ["an oversized value", "x".repeat(5000)],
  ])("%s: the demo starts fresh and the entry is removed", async (_n, raw) => {
    sessionStorage.setItem(STORAGE_KEY, raw);
    await fresh();
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    expect(notice()).toBeNull();
    expect(saved()).toBeNull();
  });

  it("unavailable storage: the demo still works end to end", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await fresh();
    await toReview();
    await decideAll();
    await click("Continue");
    expect(screen.getByRole("group", { name: "Follow-up for Jenny" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe("recovery makes no network or device calls", () => {
  it("saving and restoring through the whole walkthrough touch no fetch, socket or XHR", async () => {
    await fresh();
    await toReview();
    await decideAll();
    await click("Continue");
    await click(/Pretend Jenny replies/);
    await reload();
    await click(/Finish the demo/);
    await reload();
    expect(forbidden).not.toHaveBeenCalled();
  });
});
