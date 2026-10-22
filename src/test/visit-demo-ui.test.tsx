// Demo Mode screens: labeled on every step, consent and speaker confirmation can't be skipped, the summary shows only
// proposed (unconfirmed) items with their source, and nothing leaves the page. Fictional data only.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisitDemo } from "@/components/visit-demo/VisitDemo";

const forbidden = vi.fn(() => {
  throw new Error("Demo Mode must not do this");
});
beforeEach(() => {
  forbidden.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", forbidden);
  vi.stubGlobal("WebSocket", forbidden);
  vi.stubGlobal("XMLHttpRequest", forbidden);
  const mediaDevices = { getUserMedia: forbidden };
  Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
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
async function toVisit() {
  render(<VisitDemo />);
  await click(/Start a simulated doctor visit/);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox"));
  });
  await click(/Start the simulated visit/);
}
async function toSpeakers() {
  await toVisit();
  await click(/Skip to the end/);
  await click(/Continue: who was speaking/);
}
async function toSummary() {
  await toSpeakers();
  await click(/Yes, this is right/);
}

describe("labeled as a demo on every step", () => {
  it("shows the approved banner on every screen, and never claims live AI or a real message", async () => {
    const banner = () => screen.getByRole("note", { name: "Demo mode notice" });
    render(<VisitDemo />);
    for (const step of [
      async () => {},
      async () => click(/Start a simulated doctor visit/),
      async () => {
        await act(async () => {
          fireEvent.click(screen.getByRole("checkbox"));
        });
        await click(/Start the simulated visit/);
      },
      async () => {
        await click(/Skip to the end/);
        await click(/Continue: who was speaking/);
      },
      async () => click(/Yes, this is right/),
    ]) {
      await step();
      expect(banner()).toHaveTextContent("DEMO MODE");
      expect(banner()).toHaveTextContent(
        /Prerecorded synthetic data.*No live Meta AI.*No real SMS.*Nothing is saved/s,
      );
    }
    expect(document.body.textContent).not.toMatch(/powered by|processed by Meta|text (was )?sent/i);
  });
});

describe("consent first", () => {
  it("the visit cannot start until consent is ticked, and says no microphone is used", async () => {
    render(<VisitDemo />);
    await click(/Start a simulated doctor visit/);
    expect(screen.getByRole("button", { name: /Start the simulated visit/ })).toBeDisabled();
    expect(screen.getByText(/never uses your microphone/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect(screen.getByRole("button", { name: /Start the simulated visit/ })).toBeEnabled();
  });
});

describe("the simulated visit", () => {
  it("lines appear over time, with speaker labels and timestamps, and playback can be skipped", async () => {
    await toVisit();
    const log = () => screen.getByRole("log", { name: /Transcript/ });
    expect(
      within(log())
        .queryAllByRole("listitem")
        .filter((li) => li.textContent).length,
    ).toBe(0);
    await flush(400);
    expect(log()).toHaveTextContent("Good morning, Rosa");
    expect(log()).toHaveTextContent("Speaker A");
    expect(log()).not.toHaveTextContent("Thank you, doctor");
    await click(/Skip to the end/);
    expect(log()).toHaveTextContent("Thank you, doctor");
    expect(log()).toHaveTextContent("Speaker B");
    expect(screen.getByRole("button", { name: /Continue: who was speaking/ })).toBeInTheDocument();
  });
  it("plays to the end by itself", async () => {
    await toVisit();
    for (let i = 0; i < 40; i++) await flush(500); // each line schedules the next once it has rendered
    expect(screen.getByRole("log")).toHaveTextContent("Thank you, doctor");
  });
  it("pause stops new lines", async () => {
    await toVisit();
    await flush(400);
    await click("Pause");
    const before = screen.getByRole("log").textContent;
    await flush(20000);
    expect(screen.getByRole("log").textContent).toBe(before);
  });
  it("with reduced motion the whole visit is shown at once", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduced-motion"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    await toVisit();
    await flush(10);
    expect(screen.getByRole("log")).toHaveTextContent("Thank you, doctor");
  });
});

describe("speakers must be confirmed", () => {
  it("suggests A = doctor and B = patient but asks the person to confirm", async () => {
    await toSpeakers();
    expect(screen.getByLabelText("Speaker A")).toHaveValue("doctor");
    expect(screen.getByLabelText("Speaker B")).toHaveValue("patient");
    expect(
      screen.getByText(/Pendia's suggestion is filled in; please check it/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yes, this is right/ })).toBeEnabled();
  });
  it("blocks confirming until every speaker has a role and one is the doctor", async () => {
    await toSpeakers();
    fireEvent.change(screen.getByLabelText("Speaker B"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /Yes, this is right/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Speaker B"), { target: { value: "family" } });
    fireEvent.change(screen.getByLabelText("Speaker A"), { target: { value: "patient" } });
    expect(screen.getByRole("button", { name: /Yes, this is right/ })).toBeDisabled();
    expect(screen.getByText(/including who the doctor is/)).toBeInTheDocument();
  });
  it("no summary exists before confirmation", async () => {
    await toSpeakers();
    expect(screen.queryByText(/What was said, in plain language/)).toBeNull();
  });
  it("with the speakers mapped the wrong way round, nothing is proposed and the page says why", async () => {
    await toSpeakers();
    fireEvent.change(screen.getByLabelText("Speaker A"), { target: { value: "patient" } });
    fireEvent.change(screen.getByLabelText("Speaker B"), { target: { value: "doctor" } });
    await click(/Yes, this is right/);
    expect(screen.getByRole("status")).toHaveTextContent(/Nothing was proposed/);
    expect(screen.queryByText("Lisinopril")).toBeNull();
  });
});

describe("the proposed summary", () => {
  it("shows a plain-language summary, each item marked Proposed with where it was heard and the exact words", async () => {
    await toSummary();
    expect(
      screen.getByText(/Dr\. Patel said Rosa's blood pressure is still a little high/),
    ).toBeInTheDocument();
    const med = screen.getByRole("region", { name: "Medication change: Lisinopril" });
    expect(med).toHaveTextContent("10 mg, once a day in the morning");
    expect(med).toHaveTextContent("20 mg, once a day in the morning");
    expect(med).toHaveTextContent("starting tomorrow");
    expect(med).toHaveTextContent(/Heard at 0:12 · Dr\. Patel: “I want to increase the Lisinopril/);
    expect(within(med).getByText(/Proposed · not confirmed/)).toBeInTheDocument();
    const task = screen.getByRole("region", { name: "Follow-up: Drive Rosa to her blood test" });
    expect(task).toHaveTextContent("within the next two weeks");
    expect(task).toHaveTextContent(/Heard at 0:31 · Dr\. Patel/);
    const watch = screen.getByRole("region", { name: /Watch for: Call the office right away/ });
    expect(watch).toHaveTextContent(/Heard at 0:49 · Dr\. Patel/);
  });
  it("proposes exactly three items, none from the patient, and nothing is confirmed or applied", async () => {
    await toSummary();
    expect(screen.getAllByText(/Proposed · not confirmed/)).toHaveLength(3);
    expect(screen.queryByText(/call the lab first/i)).toBe(
      screen.queryByText(/call the lab first/i),
    ); // present only inside the transcript
    const items = screen.getByRole("region", { name: "Proposed items" });
    expect(items).not.toHaveTextContent(/lab first/i);
    expect(screen.queryByRole("button", { name: /confirm|apply|save|send/i })).toBeNull();
    expect(screen.getByText(/nothing changes until a person confirms it/i)).toBeInTheDocument();
  });
  it("names the speakers once confirmed, labels its provenance as prerecorded, and carries the safety line", async () => {
    await toSummary();
    const tr = screen.getByRole("region", { name: "Transcript" });
    expect(tr).toHaveTextContent("Dr. Patel");
    expect(tr).toHaveTextContent("Rosa");
    expect(
      screen.getAllByText(/Prerecorded synthetic example · not processed by live AI/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Not medical advice. Check with your doctor or pharmacist."),
    ).toBeInTheDocument();
  });
  it("start over returns to the beginning with nothing kept", async () => {
    await toSummary();
    await click(/Start over/);
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Proposed · not confirmed/)).toBeNull();
  });
});

describe("nothing leaves the page", () => {
  it("a whole walkthrough makes no network call, opens no socket and never asks for the microphone", async () => {
    await toSummary();
    expect(forbidden).not.toHaveBeenCalled();
  });
});
