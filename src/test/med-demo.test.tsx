// Medication Demo Mode: synthetic, isolated, same rules as the real feature. No data layer, no AI, no network.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MedDayDemo } from "@/components/med-demo/MedDayDemo";
import { DOSE_ERROR_TEXT } from "@/lib/dose-administration";
import { clear, restore, save, STORAGE_KEY } from "@/lib/med-demo/persist";
import {
  initialState,
  occurrencesOf,
  reduce,
  type Action,
  type DemoMemberId,
  type DemoState,
} from "@/lib/med-demo/state";

const run = (s: DemoState, ...as: Action[]) => {
  let state = s;
  let error: string | null = null;
  for (const a of as) {
    const o = reduce(state, a);
    state = o.state;
    error = o.error;
  }
  return { state, error };
};
const as = (actor: DemoMemberId): Action => ({ type: "actor", actor });
const rep = (
  scheduleId: string,
  expectedHead: string | null,
  status: "given" | "not_given" | "not_confirmed",
  changeReason: Action extends infer A ? never : never = undefined as never,
): Action =>
  ({
    type: "report",
    scheduleId,
    expectedHead,
    status,
    notGivenReason: null,
    changeReason: changeReason ?? null,
  }) as Action;
const occ = (s: DemoState, id: string) => occurrencesOf(s).find((o) => o.schedule_id === id)!;

describe("the synthetic day", () => {
  it("morning Given by Carlos, midday and evening Not confirmed, late dose not due yet", () => {
    const o = occurrencesOf(initialState());
    expect(o.map((x) => x.status)).toEqual([
      "given",
      "not_confirmed",
      "not_confirmed",
      "not_confirmed",
    ]);
    expect(o[0]).toMatchObject({ reported_by_name: "Carlos" });
  });
  it("uses only synthetic names", () => {
    const text = JSON.stringify(occurrencesOf(initialState()));
    expect(text).toMatch(/Medication Alpha/);
    expect(text).not.toMatch(/@|\d{3}-\d{4}/);
  });
});

describe("same rules as the real feature", () => {
  it("anyone may report an unreported due dose; not a dose that is not due", () => {
    expect(run(initialState(), as("lucia"), rep("sch-2", null, "given")).error).toBeNull();
    expect(run(initialState(), rep("sch-4", null, "given")).error).toBe("dose_future_not_allowed");
  });
  it("a stale view is a conflict, never an overwrite", () => {
    const r = run(
      initialState(),
      as("lucia"),
      rep("sch-2", null, "given"),
      as("carlos"),
      rep("sch-2", null, "not_given"),
    );
    expect(r.error).toBe("dose_conflict");
    expect(occ(r.state, "sch-2").status).toBe("given");
    expect(occ(r.state, "sch-2").history_count).toBe(1);
  });
  it("another family member cannot change a report; they can flag a disagreement, which changes nothing", () => {
    const base = initialState();
    const head = occ(base, "sch-1").head_id;
    expect(
      run(base, as("lucia"), {
        ...rep("sch-1", head, "not_given"),
        changeReason: "other",
      } as Action).error,
    ).toBe("dose_correction_not_allowed");
    const flagged = run(base, as("lucia"), {
      type: "flag",
      scheduleId: "sch-1",
      expectedHead: head,
    });
    expect(flagged.error).toBeNull();
    expect(occ(flagged.state, "sch-1")).toMatchObject({
      status: "given",
      open_disagreements: 1,
      history_count: 2,
    });
  });
  it("the reporter cannot flag their own report; a change needs a reason", () => {
    const base = initialState();
    const head = occ(base, "sch-1").head_id;
    expect(
      run(base, as("carlos"), { type: "flag", scheduleId: "sch-1", expectedHead: head }).error,
    ).toBe("dose_use_correction_instead");
    expect(run(base, as("carlos"), rep("sch-1", head, "not_given")).error).toBe(
      "dose_reason_required",
    );
    const ok = run(base, as("carlos"), {
      ...rep("sch-1", head, "not_given"),
      changeReason: "reported_by_mistake",
    } as Action);
    expect(ok.error).toBeNull();
    expect(occ(ok.state, "sch-1").status).toBe("not_given");
  });
  it("the organizer may change; history is append-only (entries only ever grow)", () => {
    const base = initialState();
    const r = run(base, {
      ...rep("sch-1", occ(base, "sch-1").head_id, "not_confirmed"),
      changeReason: "wrong_occurrence",
    } as Action);
    expect(r.error).toBeNull();
    expect(occ(r.state, "sch-1").status).toBe("not_confirmed");
    expect(r.state.entries.length).toBe(base.entries.length + 1);
    expect(r.state.entries.slice(0, base.entries.length)).toEqual(base.entries);
  });
  it("every error has plain words", () => {
    expect(DOSE_ERROR_TEXT.dose_conflict).toBeTruthy();
  });
});

describe("persistence", () => {
  beforeEach(() => clear());
  it("round-trips synthetic choices in this tab", () => {
    const s = run(initialState(), as("lucia"), rep("sch-2", null, "given")).state;
    save(s);
    expect(restore()).toEqual(s);
  });
  it("ignores anything that is not ours", () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, actor: "mallory", entries: [] }));
    expect(restore()).toEqual(initialState());
    sessionStorage.setItem(STORAGE_KEY, "x".repeat(10000));
    expect(restore()).toEqual(initialState());
    sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(restore()).toEqual(initialState());
  });
});

describe("screen", () => {
  beforeEach(() => clear());
  it("says it is a demo, lets a member report, and shows the report footnote", () => {
    render(<MedDayDemo />);
    expect(screen.getByText(/Nothing is saved or sent/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("You are"), { target: { value: "lucia" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Report this dose" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    expect(screen.getAllByText(/Reported given by Lucía/).length).toBe(1);
  });
});

describe("isolation", () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const demoFiles = [
    ...walk("src/lib/med-demo"),
    ...walk("src/components/med-demo"),
    "src/routes/demo-meds.tsx",
  ];
  const sharedFiles = [
    ...walk("src/components/medication-day").filter((f) => !/MedicationDay\.tsx$/.test(f)),
    "src/lib/dose-administration.ts",
  ];

  const imports = (f: string) =>
    [...readFileSync(f, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
  it("demo files import no data layer, client, hooks, shell, AI or network module", () => {
    for (const f of [...demoFiles, ...sharedFiles]) {
      const bad = imports(f).filter((i) =>
        /^@\/(services|hooks)\b|integrations\/supabase|visit-pipeline|use-family|AppShell/.test(i),
      );
      expect(bad, f).toEqual([]);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bfetch\(|XMLHttpRequest|mediaDevices/);
    }
  });
  it("the real medication-day container is the only one that touches the service", () => {
    const users = walk("src").filter(
      (f) => /dose-service|doseService/.test(readFileSync(f, "utf8")) && !f.startsWith("src/test/"),
    );
    expect(users.sort()).toEqual(
      [
        "src/components/medication-day/MedicationDay.tsx",
        "src/services/dose-service.ts",
        "src/services/index.ts",
      ].sort(),
    );
  });
  it("Feature A (value verification, Spark contract) and the dose modules do not import each other", () => {
    for (const f of walk("src/lib/visit-pipeline")) {
      expect(
        imports(f).filter((i) => /dose-administration|med-demo|medication-day/.test(i)),
        f,
      ).toEqual([]);
    }
    for (const f of [...demoFiles, ...sharedFiles, "src/services/dose-service.ts"]) {
      expect(
        imports(f).filter((i) => /med-verifier|spark|visit-pipeline/.test(i)),
        f,
      ).toEqual([]);
    }
  });
});
