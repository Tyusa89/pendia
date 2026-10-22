// Demo Mode review and follow-through: every item is decided by a person, a follow-up needs a named owner, the "text" is
// only shown and never sent, and the wrap-up says what really happened (nothing saved, nothing sent). Fictional data only.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisitDemo } from "@/components/visit-demo/VisitDemo";

const forbidden = vi.fn(() => {
  throw new Error("Demo Mode must not do this");
});
beforeEach(() => {
  sessionStorage.clear(); // saved demo progress is per tab; every test starts a fresh tab
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

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await flush();
};
async function toReview() {
  render(<VisitDemo />);
  await click(/Start a simulated doctor visit/);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox"));
  });
  await click(/Start the simulated visit/);
  await click(/Skip to the end/);
  await click(/Continue: who was speaking/);
  await click(/Yes, this is right/);
}
const med = () => screen.getByRole("region", { name: "Medication change: Lisinopril" });
const task = () => screen.getByRole("region", { name: "Follow-up: Drive Rosa to her blood test" });
const watch = () => screen.getByRole("region", { name: /Watch for:/ });
const pickOwner = (name: string) =>
  fireEvent.change(screen.getByLabelText("Who will do this?"), { target: { value: name } });
async function decideEverything(taskAnswer: "confirm" | "reject" = "confirm") {
  await act(async () => {
    fireEvent.click(within(med()).getByRole("button", { name: /Confirm the Lisinopril change/ }));
  });
  if (taskAnswer === "confirm") {
    pickOwner("Carlos");
    await act(async () => {
      fireEvent.click(within(task()).getByRole("button", { name: /Confirm the follow-up/ }));
    });
  } else {
    await act(async () => {
      fireEvent.click(within(task()).getByRole("button", { name: /Reject the follow-up/ }));
    });
  }
  await act(async () => {
    fireEvent.click(within(watch()).getByRole("button", { name: /Reject the watch item/ }));
  });
}

describe("every item is decided by a person", () => {
  it("each item has its own Confirm and Reject; there is no confirm-all", async () => {
    await toReview();
    for (const card of [med(), task(), watch()]) {
      expect(
        within(card)
          .getAllByRole("button")
          .map((b) => b.textContent!.trim()),
      ).toEqual(expect.arrayContaining(["Confirm", "Reject"]));
    }
    expect(
      screen.queryByRole("button", { name: /confirm all|accept all|approve all/i }),
    ).toBeNull();
    expect(screen.getAllByText(/Proposed · not confirmed/)).toHaveLength(3);
  });
  it("Continue is disabled until all three are decided", async () => {
    await toReview();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(within(med()).getByRole("button", { name: /Confirm the Lisinopril change/ }));
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText(/Confirm or reject every item to continue/)).toBeInTheDocument();
  });
  it("confirming the medication change says it is demo-only and changes nothing real", async () => {
    await toReview();
    await act(async () => {
      fireEvent.click(within(med()).getByRole("button", { name: /Confirm the Lisinopril change/ }));
    });
    expect(within(med()).getByText("Confirmed · demo only")).toBeInTheDocument();
    expect(med()).toHaveTextContent(
      /In the real app, confirming adds this to the family's medication list after your review. Nothing was changed here/,
    );
  });
  it("a follow-up cannot be confirmed until a family member is chosen, and Pendia does not pick for you", async () => {
    await toReview();
    expect(within(task()).getByRole("button", { name: /Confirm the follow-up/ })).toBeDisabled();
    expect(screen.getByLabelText("Who will do this?")).toHaveValue("");
    expect(screen.getByText(/Pendia doesn't pick for you/)).toBeInTheDocument();
    pickOwner("Carlos");
    expect(within(task()).getByRole("button", { name: /Confirm the follow-up/ })).toBeEnabled();
  });
  it("rejecting works, shows Rejected, and a person can change their answer", async () => {
    await toReview();
    await act(async () => {
      fireEvent.click(within(watch()).getByRole("button", { name: /Reject the watch item/ }));
    });
    expect(within(watch()).getByText("Rejected")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(watch()).getByRole("button", { name: /Change my answer/ }));
    });
    expect(within(watch()).getByText(/Proposed · not confirmed/)).toBeInTheDocument();
  });
});

describe("family follow-through, simulated", () => {
  it("shows the text that WOULD be sent, labeled simulated and not sent, with the confirmed owner's name", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    const group = screen.getByRole("group", { name: "Follow-up for Carlos" });
    expect(group).toHaveTextContent("Pendia → Carlos");
    expect(group).toHaveTextContent("Simulated · not sent");
    expect(group).toHaveTextContent(
      "Pendia: Maria asked you to: Drive Rosa to her blood test (within the next two weeks). Reply DONE when it's finished.",
    );
    expect(screen.getByTestId("status-task-1")).toHaveTextContent("Waiting for Carlos (simulated)");
    expect(screen.getByText(/nothing was sent/)).toBeInTheDocument();
  });
  it("the viewer can pretend the owner replies DONE; the reply is labeled simulated and the family status updates", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    await click(/Pretend Carlos replies/);
    const group = screen.getByRole("group", { name: "Follow-up for Carlos" });
    expect(group).toHaveTextContent("Simulated reply");
    expect(group).toHaveTextContent("DONE");
    expect(screen.getByTestId("status-task-1")).toHaveTextContent(
      "Done · Carlos (simulated reply)",
    );
    expect(screen.queryByRole("button", { name: /Pretend Carlos replies/ })).toBeNull();
  });
  it("if the follow-up is rejected there is no follow-up step and no text is prepared", async () => {
    await toReview();
    await decideEverything("reject");
    await click("Continue");
    expect(screen.queryByRole("group", { name: /Follow-up for/ })).toBeNull();
    expect(screen.getByText("That's the loop")).toBeInTheDocument();
  });
});

describe("wrap-up", () => {
  it("counts what the person decided and says nothing was saved or sent", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    await click(/Pretend Carlos replies/);
    await click(/Finish the demo/);
    expect(screen.getByText(/You confirmed/)).toHaveTextContent(
      "You confirmed 2 and rejected 1 of 3 proposed items",
    );
    expect(screen.getByText(/follow-up text/)).toHaveTextContent(
      "1 follow-up text shown, 0 sent; 1 simulated reply",
    );
    expect(
      screen.getByText("This was a prerecorded synthetic example. Nothing was saved or sent."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not medical advice. Check with your doctor or pharmacist."),
    ).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Demo mode notice" })).toBeInTheDocument();
  });
  it("start over forgets every decision and every simulated message", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    await click(/Finish the demo/);
    await click(/Start over/);
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    await click(/Start a simulated doctor visit/);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    await click(/Start the simulated visit/);
    await click(/Skip to the end/);
    await click(/Continue: who was speaking/);
    await click(/Yes, this is right/);
    expect(screen.getAllByText(/Proposed · not confirmed/)).toHaveLength(3);
  });
  it("describes the real app only in the conditional ('In the real app'), never as something that happened", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    await click(/Finish the demo/);
    const real = screen.getByText("In the real app").parentElement!;
    expect(real).toHaveTextContent(/updates the family's medication list/);
    expect(document.body.textContent).not.toMatch(
      /was (added|texted|sent) to|has been (sent|saved)/i,
    );
  });
});

describe("still nothing leaves the page", () => {
  it("a full review and follow-through makes no network call and opens no socket", async () => {
    await toReview();
    await decideEverything();
    await click("Continue");
    await click(/Pretend Carlos replies/);
    await click(/Finish the demo/);
    expect(forbidden).not.toHaveBeenCalled();
  });
});
