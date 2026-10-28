// @vitest-environment node
// The context pack: category gates, Amendment A (handoff field-level privacy), Q1 (free-text medication screen), windows, caps,
// the 6,000-character ceiling, truncation and exclusions. Pure; no network.
import { describe, expect, it } from "vitest";
import { AGENT_LIMITS } from "@/lib/care-agent/contract";
import {
  NOT_VISIBLE_LINES,
  WITHHELD_FREE_TEXT_LINE,
  WITHHELD_HANDOFF_LINE,
  buildContextPack,
  capItem,
  cleanText,
  containsMedicationName,
  type PackAccess,
  type PackRows,
} from "@/lib/care-agent/pack";
import {
  ALL,
  MED_BLIND,
  NOW,
  SCHEDULE_BLIND,
  SENTINEL,
  SENTINEL_DOSE,
  SENTINEL_NAME,
  TZ,
  VISIT_BLIND,
  baseRows,
  dose,
} from "./care-agent-helpers";

const build = (access: PackAccess, rows: PackRows, language: "en" | "es" = "en") => {
  const r = buildContextPack({ now: NOW, timezone: TZ, language, access, rows });
  if (!r.ok) throw new Error(r.code);
  return r.pack;
};
const types = (p: ReturnType<typeof build>) => p.items.map((i) => i.type);
/** Everything that could reach the model, a label or the client, serialised. */
const everything = (p: ReturnType<typeof build>) =>
  JSON.stringify({
    rendered: p.rendered,
    items: p.items,
    labels: p.items.map((i) => i.label),
    notes: p.notes,
  });

const sentinelHandoff = {
  id: "h-sentinel",
  created_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
  author_member_id: "m-jordan",
  ate: true,
  meds_taken: true,
  note: `Gave ${SENTINEL} this morning`,
  unusual: `Refused the ${SENTINEL_NAME}`,
  watch_answers: { "Dose check": `${SENTINEL} given` },
};

describe("Amendment A: handoff field-level privacy (sentinel tests)", () => {
  it("SCHEDULE-VISIBLE / MED-BLIND: the pack object, rendered prompt and every label contain no sentinel text and no meds_taken value", () => {
    const p = build(MED_BLIND, baseRows({ handoffs: [sentinelHandoff as never] }));
    const all = everything(p);
    expect(all).not.toContain(SENTINEL_NAME);
    expect(all).not.toContain(SENTINEL_DOSE);
    expect(all).not.toMatch(/meds[_ ]taken/i);
    expect(p.items.filter((i) => i.type === "handoff")).toHaveLength(1);
    expect(p.notes).toContain(WITHHELD_HANDOFF_LINE);
    expect(p.rendered).toContain(WITHHELD_HANDOFF_LINE);
  });
  it("renders only id, generic label, timestamp and the ate value for the med-blind member", () => {
    const p = build(MED_BLIND, baseRows({ handoffs: [sentinelHandoff as never] }));
    const h = p.items.find((i) => i.type === "handoff")!;
    expect(h.id).toBe("handoff:h-sentinel");
    expect(h.label).toMatch(/^Handoff — Jordan, /);
    expect(h.body).toMatch(/^Handoff at .+ by Jordan\. Ate: ate\.$/);
    expect(h.withheld).toBe(true);
  });
  it.each([
    [true, "Ate: ate."],
    [false, "Ate: did not eat."],
    [null, "Ate: not recorded."],
  ])("ate=%s is rendered as '%s' (null is never inferred)", (ate, text) => {
    const p = build(MED_BLIND, baseRows({ handoffs: [{ ...sentinelHandoff, ate } as never] }));
    expect(p.items.find((i) => i.type === "handoff")!.body).toContain(text);
  });
  it("SCHEDULE-BLIND: zero handoff items (and the visibility line is present)", () => {
    const p = build(SCHEDULE_BLIND, baseRows({ handoffs: [sentinelHandoff as never] }));
    expect(types(p)).not.toContain("handoff");
    expect(p.notes).toContain(NOT_VISIBLE_LINES.schedule);
    expect(everything(p)).not.toContain(SENTINEL_NAME);
  });
  it("MED-VISIBLE: handoff fields are present, subject to caps", () => {
    const p = build(ALL, baseRows({ handoffs: [sentinelHandoff as never] }));
    const h = p.items.find((i) => i.type === "handoff")!;
    expect(h.body).toContain(`Gave ${SENTINEL} this morning`);
    expect(h.body).toContain("meds taken (caregiver answer): yes");
    expect(h.body).toContain(`Refused the ${SENTINEL_NAME}`);
    expect(h.body).toContain("watch answers: Dose check");
    expect(p.notes).not.toContain(WITHHELD_HANDOFF_LINE);
  });
  it("the withheld line is the Brief's text, verbatim", () => {
    expect(WITHHELD_HANDOFF_LINE).toBe(
      "Handoff details: free-text and medication-related handoff fields are withheld from this member because they may contain medication information outside this member's visibility.",
    );
  });
  it("only the 3 most recent handoffs are included, newest first", () => {
    const hs = [1, 2, 3, 4, 5].map((n) => ({
      id: `h${n}`,
      created_at: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
      author_member_id: "m-jordan",
      ate: true,
      meds_taken: null,
      note: null,
      unusual: null,
      watch_answers: {},
    }));
    const p = build(ALL, baseRows({ handoffs: hs as never }));
    expect(p.items.filter((i) => i.type === "handoff").map((i) => i.id)).toEqual([
      "handoff:h1",
      "handoff:h2",
      "handoff:h3",
    ]);
  });
  it("an unresolved author becomes 'a family member' (never a guess)", () => {
    const p = build(MED_BLIND, baseRows({ members: [], handoffs: [sentinelHandoff as never] }));
    expect(p.items.find((i) => i.type === "handoff")!.label).toMatch(
      /^Handoff — a family member, /,
    );
  });
});

describe("Q1: free text for a member without medication visibility", () => {
  const medNames = [SENTINEL_NAME, "Lisinopril"];
  const rowsWith = (over: Partial<PackRows>) => baseRows({ medNames, ...over });
  const sentinelVisit = {
    id: "v-s",
    status: "scheduled",
    confirmation_status: "confirmed",
    scheduled_start: new Date(NOW.getTime() + 86_400_000).toISOString(),
    scheduled_end: null,
    provider_name: "Dr. Sample",
    office_name: null,
    reason: `Discuss ${SENTINEL}`,
    notes: `Bring ${SENTINEL_NAME}`,
    summary: `Started ${SENTINEL}`,
  };

  it("a visit's reason, notes and summary containing a medication name are withheld WHOLE; structured metadata remains", () => {
    const p = build(MED_BLIND, rowsWith({ visits: [sentinelVisit] }));
    const v = p.items.find((i) => i.type === "visit")!;
    expect(everything(p)).not.toContain(SENTINEL_NAME);
    expect(everything(p)).not.toContain(SENTINEL_DOSE);
    expect(v.body).toContain("provider: Dr. Sample");
    expect(v.body).toContain("[details withheld]");
    expect(v.withheld).toBe(true);
    expect(p.notes).toContain(WITHHELD_FREE_TEXT_LINE);
  });
  it("a task, a follow-up and a watch item containing the sentinel are reduced to metadata only", () => {
    const p = build(
      MED_BLIND,
      rowsWith({
        tasks: [
          {
            id: "t-s",
            title: `Pick up ${SENTINEL}`,
            status: "open",
            due_date: "2026-10-30",
            owner_member_id: "m-jordan",
            source_visit_id: null,
          },
        ],
        watch: [
          {
            id: "w-s",
            text: `Watch for effects of ${SENTINEL_NAME}`,
            status: "active",
            ends_on: null,
            source_visit_id: null,
          },
        ],
        followUpTasks: [
          {
            id: "t-fu-s",
            title: `Ask about ${SENTINEL}`,
            status: "open",
            due_date: null,
            owner_member_id: null,
            source_visit_id: "v-last",
          },
        ],
      }),
    );
    expect(everything(p)).not.toContain(SENTINEL_NAME);
    expect(everything(p)).not.toContain(SENTINEL_DOSE);
    const task = p.items.find((i) => i.id === "task:t-s")!;
    expect(task.body).toContain("owner: Jordan");
    expect(task.body).toContain("due:");
    expect(task.body).toContain("[details withheld]");
    expect(p.items.find((i) => i.id === "watch:w-s")!.body).toContain("[details withheld]");
    expect(p.items.find((i) => i.id === "task:t-fu-s")!.body).toContain("[details withheld]");
  });
  it("an otherwise similar text WITHOUT a medication name remains available", () => {
    const p = build(
      MED_BLIND,
      rowsWith({
        tasks: [
          {
            id: "t-ok",
            title: "Pick up the library books",
            status: "open",
            due_date: null,
            owner_member_id: null,
            source_visit_id: null,
          },
        ],
        watch: [
          {
            id: "w-ok",
            text: "Watch for ankle swelling",
            status: "active",
            ends_on: null,
            source_visit_id: null,
          },
        ],
      }),
    );
    expect(p.items.find((i) => i.id === "task:t-ok")!.body).toContain(
      'text: "Pick up the library books"',
    );
    expect(p.items.find((i) => i.id === "watch:w-ok")!.body).toContain(
      'text: "Watch for ankle swelling"',
    );
    expect(p.items.find((i) => i.id === "task:t-ok")!.withheld).toBe(false);
  });
  it("matching is case-insensitive and also catches a distinctive word of a multi-word name", () => {
    expect(containsMedicationName(`take ${SENTINEL_NAME.toUpperCase()}`, medNames)).toBe(true);
    expect(containsMedicationName("vitamin d3 daily", ["Vitamin D3 1000 IU"])).toBe(true);
    expect(containsMedicationName("a walk after lunch", medNames)).toBe(false);
  });
  it("FAILS CLOSED: when the medication-name set cannot be established (always the case under a med-blind caller's own RLS), ALL free text is withheld", () => {
    for (const names of [null, []] as const) {
      const p = build(MED_BLIND, baseRows({ medNames: names as never }));
      expect(p.items.find((i) => i.id === "task:t1")!.body).toContain("[details withheld]");
      expect(p.items.find((i) => i.id === "task:t1")!.body).not.toContain("Refill");
      expect(p.items.find((i) => i.type === "visit")!.body).not.toContain("Bring the folder");
      expect(p.notes).toContain(WITHHELD_FREE_TEXT_LINE);
    }
  });
  it("a MEDICATION-VISIBLE member's free text flows normally", () => {
    const p = build(ALL, rowsWith({ visits: [sentinelVisit] }));
    expect(p.items.find((i) => i.type === "visit")!.body).toContain(`Discuss ${SENTINEL}`);
    expect(p.notes).not.toContain(WITHHELD_FREE_TEXT_LINE);
  });
  it("the medication-name set itself never appears in the pack", () => {
    const p = build(MED_BLIND, rowsWith({}));
    expect(everything(p)).not.toContain("Metformin");
    expect(everything(p)).not.toContain(SENTINEL_NAME);
  });
});

describe("category gates", () => {
  it("visits=false: no visit, visit-follow-up or medication-change items", () => {
    const p = build({ visits: false, meds: true, schedule: true }, baseRows());
    expect(types(p)).not.toContain("visit");
    expect(types(p)).not.toContain("medchange");
    expect(p.items.some((i) => i.id === "task:t-fu")).toBe(false);
    expect(p.notes).toContain(NOT_VISIBLE_LINES.visits);
  });
  it("meds=false: no medication, dose-report or medication-change items", () => {
    const p = build(MED_BLIND, baseRows());
    for (const t of ["med", "dose", "medchange"]) expect(types(p)).not.toContain(t);
    expect(p.notes).toContain(NOT_VISIBLE_LINES.meds);
    expect(everything(p)).not.toContain("Lisinopril");
  });
  it("schedule=false: no shift, task, watch-item or handoff items; visit follow-ups follow the VISIT gate", () => {
    const p = build(SCHEDULE_BLIND, baseRows());
    for (const t of ["shift", "handoff"]) expect(types(p)).not.toContain(t);
    expect(p.items.some((i) => i.id === "task:t1")).toBe(false); // coordination task
    expect(p.items.some((i) => i.id === "watch:w1")).toBe(false);
    expect(p.items.some((i) => i.id === "task:t-fu")).toBe(true); // visit follow-up: visit gate only
  });
  it("visibility lines are always present for a blind member", () => {
    const p = build({ visits: false, meds: false, schedule: false }, baseRows());
    for (const l of Object.values(NOT_VISIBLE_LINES)) expect(p.rendered).toContain(l);
  });
  it("a medication change needs BOTH the visits and the meds gates", () => {
    expect(types(build(ALL, baseRows()))).toContain("medchange");
    expect(types(build({ visits: true, meds: false, schedule: true }, baseRows()))).not.toContain(
      "medchange",
    );
    expect(types(build({ visits: false, meds: true, schedule: true }, baseRows()))).not.toContain(
      "medchange",
    );
  });
  it("pending or unclear medication changes never appear", () => {
    const p = build(
      ALL,
      baseRows({
        medChanges: [
          {
            id: "mc-u",
            visit_id: "v-last",
            medication: "X",
            before: null,
            after: null,
            confirmed_at: null,
            unclear: false,
          },
          {
            id: "mc-v",
            visit_id: "v-last",
            medication: "Y",
            before: null,
            after: null,
            confirmed_at: NOW.toISOString(),
            unclear: true,
          },
        ],
      }),
    );
    expect(types(p)).not.toContain("medchange");
  });
});

describe("windows, caps and ordering", () => {
  it("includes only the next upcoming visit and the most recent completed visit", () => {
    const extra = [1, 2, 3].map((n) => ({
      id: `vx${n}`,
      status: "scheduled",
      confirmation_status: "confirmed",
      scheduled_start: new Date(NOW.getTime() + (200 + n) * 3_600_000).toISOString(),
      scheduled_end: null,
      provider_name: null,
      office_name: null,
      reason: null,
      notes: null,
      summary: null,
    }));
    const p = build(ALL, baseRows({ visits: [...baseRows().visits, ...extra] }));
    expect(p.items.filter((i) => i.type === "visit").map((i) => i.id)).toEqual([
      "visit:v-next",
      "visit:v-last",
    ]);
  });
  it("dose reports cover only the last 48 hours; a skipped (nonexistent) local time is excluded", () => {
    const h = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
    const p = build(
      ALL,
      baseRows({
        doses: [
          dose({ schedule_id: "s-in", local_date: "2026-10-27", scheduled_at: h(47) }),
          dose({ schedule_id: "s-out", local_date: "2026-10-26", scheduled_at: h(49) }),
          dose({
            schedule_id: "s-skip",
            local_date: "2026-10-28",
            scheduled_at: null,
            time_state: "skipped",
          }),
          dose({
            schedule_id: "s-future",
            local_date: "2026-10-29",
            scheduled_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
          }),
        ],
      }),
    );
    expect(p.items.filter((i) => i.type === "dose").map((i) => i.id)).toEqual([
      "dose:s-in:2026-10-27",
    ]);
  });
  it("medications + dose reports share a combined cap of 12 (doses fill what medications leave, newest first)", () => {
    const meds = Array.from({ length: 4 }, (_, n) => ({
      id: `m${n}`,
      name: `Med${n}`,
      dose: "1 mg",
      schedule: null,
      status: "active",
    }));
    const doses = Array.from({ length: 20 }, (_, n) =>
      dose({
        schedule_id: `sch-${n}`,
        local_date: "2026-10-28",
        scheduled_at: new Date(NOW.getTime() - (n + 1) * 3_600_000).toISOString(),
      }),
    );
    const p = build(ALL, baseRows({ medications: meds, doses }));
    const section = p.items.filter((i) => i.type === "med" || i.type === "dose");
    expect(section).toHaveLength(AGENT_LIMITS.medicationSectionMax);
    expect(p.items.filter((i) => i.type === "dose")[0]!.id).toBe("dose:sch-0:2026-10-28");
  });
  it("only ACTIVE medications are included", () => {
    const p = build(
      ALL,
      baseRows({
        medications: [
          { id: "a", name: "ActiveMed", dose: null, schedule: null, status: "active" },
          { id: "p", name: "PausedMed", dose: null, schedule: null, status: "paused" },
          { id: "s", name: "StoppedMed", dose: null, schedule: null, status: "stopped" },
        ],
      }),
    );
    expect(everything(p)).toContain("ActiveMed");
    expect(everything(p)).not.toContain("PausedMed");
    expect(everything(p)).not.toContain("StoppedMed");
  });
  it("coordination covers the next 7 days only and is capped at 8 combined (shifts, then tasks, then watch)", () => {
    const shifts = Array.from({ length: 6 }, (_, n) => ({
      id: `s${n}`,
      start: new Date(NOW.getTime() + (n + 1) * 3_600_000 * 20).toISOString(),
      end: new Date(NOW.getTime() + ((n + 1) * 20 + 4) * 3_600_000).toISOString(),
      assigned_member_id: null,
      status: "open",
    }));
    const far = {
      id: "s-far",
      start: new Date(NOW.getTime() + 9 * 86_400_000).toISOString(),
      end: new Date(NOW.getTime() + 9.2 * 86_400_000).toISOString(),
      assigned_member_id: null,
      status: "open",
    };
    const tasks = Array.from({ length: 4 }, (_, n) => ({
      id: `tk${n}`,
      title: `Task ${n}`,
      status: "open",
      due_date: null,
      owner_member_id: null,
      source_visit_id: null,
    }));
    const p = build(
      ALL,
      baseRows({
        shifts: [...shifts, far],
        tasks,
        watch: [
          { id: "w9", text: "watch", status: "active", ends_on: null, source_visit_id: null },
        ],
      }),
    );
    const coord = p.items.filter(
      (i) =>
        i.type === "shift" || (i.type === "task" && !i.id.includes("t-fu")) || i.type === "watch",
    );
    expect(coord).toHaveLength(AGENT_LIMITS.coordinationMax);
    expect(p.items.some((i) => i.id === "shift:s-far")).toBe(false);
    expect(p.items.filter((i) => i.type === "shift")).toHaveLength(6);
  });
  it("unassigned shifts are labelled 'unassigned'; gaps are never computed and the pack says so", () => {
    const p = build(
      ALL,
      baseRows({
        shifts: [
          {
            id: "s-u",
            start: new Date(NOW.getTime() + 3_600_000).toISOString(),
            end: new Date(NOW.getTime() + 7_200_000).toISOString(),
            assigned_member_id: null,
            status: "open",
          },
        ],
      }),
    );
    expect(p.items.find((i) => i.id === "shift:s-u")!.body).toContain("assigned: unassigned");
    expect(p.notes.join(" ")).toMatch(/Coverage gaps are not computed/);
  });
  it("visit-associated medication changes and follow-ups share a cap of 8", () => {
    const tasks = Array.from({ length: 12 }, (_, n) => ({
      id: `fu${n}`,
      title: `Follow up ${n}`,
      status: "open",
      due_date: null,
      owner_member_id: null,
      source_visit_id: "v-last",
    }));
    const p = build(ALL, baseRows({ followUpTasks: tasks }));
    const assoc = p.items.filter((i) => i.type === "medchange" || i.id.startsWith("task:fu"));
    expect(assoc).toHaveLength(AGENT_LIMITS.visitAssociatedMax);
  });
});

describe("size: per-item cap, truncation marker and the 6,000-character ceiling", () => {
  it("an over-long item is truncated at a word boundary and ends with [truncated]", () => {
    const long = "word ".repeat(300);
    const out = capItem(long);
    expect(out.length).toBeLessThanOrEqual(AGENT_LIMITS.itemMaxChars);
    expect(out.endsWith(" [truncated]")).toBe(true);
    expect(out.slice(0, -" [truncated]".length)).toMatch(/word$/);
    expect(capItem("short")).toBe("short");
  });
  it("item detail in a built pack is capped at 600 characters", () => {
    const p = build(
      ALL,
      baseRows({ handoffs: [{ ...sentinelHandoff, note: "lorem ".repeat(400) } as never] }),
    );
    for (const i of p.items) expect(i.body.length).toBeLessThanOrEqual(AGENT_LIMITS.itemMaxChars);
    expect(p.items.find((i) => i.type === "handoff")!.body).toMatch(/\[truncated\]$/);
  });
  const bulky = () => {
    const note = "detail ".repeat(60);
    return baseRows({
      handoffs: [1, 2, 3].map((n) => ({
        id: `hh${n}`,
        created_at: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
        author_member_id: "m-jordan",
        ate: true,
        meds_taken: true,
        note,
        unusual: note,
        watch_answers: {},
      })) as never,
      watch: Array.from({ length: 6 }, (_, n) => ({
        id: `ww${n}`,
        text: note,
        status: "active",
        ends_on: null,
        source_visit_id: null,
      })),
      tasks: Array.from({ length: 6 }, (_, n) => ({
        id: `tt${n}`,
        title: note,
        status: "open",
        due_date: null,
        owner_member_id: null,
        source_visit_id: null,
      })),
      doses: Array.from({ length: 8 }, (_, n) =>
        dose({
          schedule_id: `ds-${n}`,
          local_date: "2026-10-28",
          scheduled_at: new Date(NOW.getTime() - (n + 1) * 3_600_000).toISOString(),
        }),
      ),
    });
  };
  it("never exceeds 6,000 characters; omits watch items first, then tasks, then older dose reports", () => {
    const p = build(ALL, bulky());
    expect(p.rendered.length).toBeLessThanOrEqual(AGENT_LIMITS.packMaxChars);
    expect(p.omitted.watch).toBe(true);
    expect(p.rendered).toMatch(/lower-priority items .* were omitted to fit/);
  });
  it("watch items go before tasks, and tasks before dose reports", () => {
    const full = build(
      ALL,
      baseRows({ watch: bulky().watch, tasks: bulky().tasks, handoffs: bulky().handoffs }),
    );
    // with watch items removable first, tasks survive as long as removing watch items is enough
    if (full.omitted.watch && !full.omitted.tasks)
      expect(full.items.some((i) => i.type === "task")).toBe(true);
    const p = build(ALL, bulky());
    if (p.omitted.doses) expect(p.omitted.watch && p.omitted.tasks).toBe(true);
  });
  it("visibility and withheld-information lines are never omitted to save space", () => {
    const p = build(MED_BLIND, baseRows({ ...bulky(), medNames: null } as never));
    expect(p.rendered).toContain(WITHHELD_HANDOFF_LINE);
    expect(p.rendered).toContain(NOT_VISIBLE_LINES.meds);
    expect(p.rendered).toContain(WITHHELD_FREE_TEXT_LINE);
  });
  it("when nothing droppable remains and the pack is still too large, the ask fails closed (no silent cut)", () => {
    const huge = Array.from({ length: 3 }, (_, n) => ({
      id: `hx${n}`,
      created_at: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
      author_member_id: "m-jordan",
      ate: true,
      meds_taken: true,
      note: "x ".repeat(400),
      unusual: "y ".repeat(400),
      watch_answers: {},
    }));
    const longName = "n".repeat(580);
    const meds = Array.from({ length: 12 }, (_, n) => ({
      id: `big${n}`,
      name: `${longName}${n}`,
      dose: "1 mg",
      schedule: null,
      status: "active",
    }));
    const r = buildContextPack({
      now: NOW,
      timezone: TZ,
      language: "en",
      access: ALL,
      rows: baseRows({ medications: meds, handoffs: huge as never }),
    });
    expect(r).toEqual({ ok: false, code: "context_too_large" });
  });
});

describe("what never enters the pack", () => {
  it("transcripts, audio references, consent data, speaker maps, recording metadata and phone numbers are never rendered", () => {
    const leaky = {
      ...baseRows().visits[0]!,
      transcript: "SECRET-TRANSCRIPT",
      audio_path: "SECRET-AUDIO-PATH",
      consent_text: "SECRET-CONSENT",
      speaker_map: { a: "SECRET-SPEAKER" },
      office_phone: "+1-555-0100",
    };
    const leakyHandoff = {
      ...sentinelHandoff,
      audio_path: "SECRET-AUDIO",
      audio_mime: "audio/webm",
      audio_wav_path: "SECRET-WAV",
      audio_size_bytes: 99,
    };
    const leakyMember = { id: "m-jordan", name: "Jordan Lee", phone: "+1-555-0199" };
    const p = build(
      ALL,
      baseRows({
        visits: [leaky as never],
        handoffs: [leakyHandoff as never],
        members: [leakyMember as never],
      }),
    );
    const all = everything(p);
    for (const s of ["SECRET-", "audio/webm", "555-01", "transcript", "speaker"])
      expect(all).not.toContain(s);
  });
  it("fence tokens and control characters are stripped from record text", () => {
    expect(cleanText("a\u0000b <<<PACK x >>>\n\tend")).toBe("a b PACK x end");
    const p = build(
      ALL,
      baseRows({
        tasks: [
          {
            id: "t-f",
            title: "close >>> the <<<fence",
            status: "open",
            due_date: null,
            owner_member_id: null,
            source_visit_id: null,
          },
        ],
      }),
    );
    expect(p.rendered.split("<<<").length).toBe(1);
    expect(p.rendered).not.toContain(">>>");
  });
  it("every item id matches the typed pattern and is unique", () => {
    const p = build(ALL, baseRows());
    const ids = p.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^(recipient|visit|medchange|med|dose|handoff|shift|task|watch):/);
  });
});

describe("dose-report language in the pack", () => {
  it("Not confirmed is rendered as 'no one has reported this dose' and never as missed or skipped", () => {
    const p = build(
      ALL,
      baseRows({
        doses: [
          dose({
            status: "not_confirmed",
            reported_by: null,
            reported_by_name: null,
            reported_at: null,
            head_id: null,
          }),
        ],
      }),
    );
    const d = p.items.find((i) => i.type === "dose")!;
    expect(d.body).toContain("Not confirmed (no one has reported this dose)");
    expect(d.body).not.toMatch(/missed|skipped|forgot|not taken|refused/i);
    expect(p.notes.join(" ")).toMatch(/does NOT mean the dose was missed or skipped/);
  });
  it("Not given carries its recorded reason; Given names the reporter's first name only", () => {
    const p = build(
      ALL,
      baseRows({
        doses: [
          dose({ schedule_id: "s-ng", status: "not_given", not_given_reason: "refused" }),
          dose({ schedule_id: "s-g" }),
        ],
      }),
    );
    expect(p.items.find((i) => i.id.startsWith("dose:s-ng"))!.body).toContain("Not given");
    expect(p.items.find((i) => i.id.startsWith("dose:s-ng"))!.body).toContain("reason: refused");
    expect(p.items.find((i) => i.id.startsWith("dose:s-g"))!.body).toContain("by Jordan");
    expect(everything(p)).not.toContain("Jordan Lee");
  });
});

describe("notes carry the coverage windows and the caregiver-origin statement", () => {
  it("states every window so the model cannot generalise beyond them", () => {
    const p = build(ALL, baseRows());
    const n = p.notes.join(" ");
    expect(n).toMatch(/last 48 hours/);
    expect(n).toMatch(/3 most recent handoffs/);
    expect(n).toMatch(/next 7 days/);
    expect(n).toMatch(/entered or reported by family caregivers/);
  });
});
