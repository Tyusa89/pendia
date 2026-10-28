// Feature C screens: the wording and the offered actions. Synthetic data only.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OccurrenceCard } from "@/components/medication-day/OccurrenceCard";
import { ReportDialog } from "@/components/medication-day/ReportDialog";
import type { Actions, DoseOccurrence } from "@/lib/dose-administration";

const occ = (over: Partial<DoseOccurrence> = {}): DoseOccurrence => ({
  schedule_id: "s",
  medication_id: "m",
  medication_name: "Synthetic A",
  dose_text: "1 tablet",
  local_date: "2026-10-28",
  local_time: "08:00:00",
  tz: "America/Chicago",
  scheduled_at: "2026-10-28T13:00:00Z",
  time_state: "normal",
  status: "not_confirmed",
  head_id: null,
  reported_by: null,
  reported_by_name: null,
  reported_at: null,
  not_given_reason: null,
  change_reason: null,
  outside_window: false,
  reports_differ: false,
  open_disagreements: 0,
  history_count: 0,
  ...over,
});
const none: Actions = { report: false, change: false, flag: false, lateOnly: false, why: null };
const noop = () => {};
const card = (o: DoseOccurrence, a: Actions) =>
  render(
    <OccurrenceCard
      occurrence={o}
      actions={a}
      onReport={noop}
      onChange={noop}
      onFlag={noop}
      onHistory={noop}
    />,
  );

describe("OccurrenceCard", () => {
  it("an unreported dose is Not confirmed and offers a report", () => {
    card(occ(), { ...none, report: true });
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report dose" })).toBeTruthy();
    expect(screen.queryByText(/does not check/)).toBeNull();
  });
  it("a reported dose names the reporter as a report and carries the footnote", () => {
    card(
      occ({
        status: "given",
        reported_by_name: "Carlos",
        reported_at: "2026-10-28T13:02:00Z",
        head_id: "h",
        reported_by: "c",
      }),
      { ...none, flag: true },
    );
    expect(screen.getByText("Given")).toBeTruthy();
    expect(screen.getByText(/Reported given by Carlos/)).toBeTruthy();
    expect(screen.getByText(/does not check that the medication was taken/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I disagree" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change report" })).toBeNull();
  });
  it("shows differing reports and disagreement flags without changing the status", () => {
    card(
      occ({
        status: "given",
        reported_at: "2026-10-28T13:02:00Z",
        reported_by_name: "Carlos",
        reports_differ: true,
      }),
      none,
    );
    expect(screen.getByText(/reports differ/i)).toBeTruthy();
    expect(screen.getByText("Given")).toBeTruthy();
  });
  it("says why nothing can be done", () => {
    card(occ(), { ...none, why: "Not due yet." });
    expect(screen.getByText("Not due yet.")).toBeTruthy();
  });
});

describe("ReportDialog", () => {
  const open = (
    mode: "report" | "change" | "flag",
    o = occ(),
    needsReason = false,
    onSubmit = vi.fn(),
  ) => {
    render(
      <ReportDialog
        occurrence={o}
        mode={mode}
        needsReason={needsReason}
        busy={false}
        error={null}
        onSubmit={onSubmit}
        onClose={noop}
      />,
    );
    return onSubmit;
  };
  it("a first report submits Given with a request id and no free text", () => {
    const submit = open("report");
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "report",
        status: "given",
        changeReason: null,
        notGivenReason: null,
        requestId: expect.any(String),
      }),
    );
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("a change cannot be saved without a reason", () => {
    const submit = open("change", occ({ status: "given", head_id: "h", reported_by: "c" }));
    const save = screen.getByRole("button", { name: "Save report" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why are you changing this/), {
      target: { value: "reported_by_mistake" },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not_given", changeReason: "reported_by_mistake" }),
    );
  });
  it("a late organizer report needs a reason too", () => {
    open("report", occ(), true);
    expect(
      (screen.getByRole("button", { name: "Save report" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("Not given offers predefined reasons only", () => {
    open("report");
    fireEvent.click(screen.getByLabelText("Not given"));
    const sel = screen.getByLabelText(/Reason \(optional\)/) as HTMLSelectElement;
    expect([...sel.options].map((x) => x.value)).toEqual([
      "",
      "refused",
      "unwell",
      "unavailable",
      "skipped_on_purpose",
      "other",
    ]);
  });
  it("a disagreement flag says it does not change the report", () => {
    const submit = open("flag", occ({ status: "given", head_id: "h", reported_by: "c" }));
    expect(screen.getByText(/does not change the report/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ mode: "flag" }));
  });
});
