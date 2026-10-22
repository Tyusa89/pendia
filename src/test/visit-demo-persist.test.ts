// Demo Mode session recovery: what is saved, how it is validated, and that nothing but synthetic choices is ever stored.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STORED_BYTES,
  STORAGE_KEY,
  STORAGE_VERSION,
  buildRestoredState,
  clearDemoState,
  loadDemoState,
  parsePersisted,
  saveDemoState,
  toPersisted,
  type PersistedDemo,
} from "@/lib/visit-demo/persist";
import { initialState, reducer, type Action } from "@/lib/visit-demo/state";
import {
  DEMO_EXTRACTION,
  DEMO_SPEAKER_SUGGESTION,
  DEMO_TRANSCRIPT,
  simulatedReply,
} from "@/lib/visit-pipeline";
import { taskAssignmentText } from "@/lib/visit-demo/messages";

beforeEach(() => sessionStorage.clear());

const run = (...a: Action[]) => a.reduce(reducer, initialState);
const toSpeakers: Action[] = [
  { type: "begin" },
  { type: "setConsent", value: true },
  { type: "startVisit" },
  { type: "transcriptLoaded", transcript: DEMO_TRANSCRIPT, suggestion: DEMO_SPEAKER_SUGGESTION },
  { type: "skipToEnd" },
  { type: "toSpeakers" },
];
const toReview: Action[] = [
  ...toSpeakers,
  { type: "confirmSpeakers" },
  { type: "extractionLoaded", extraction: DEMO_EXTRACTION, rejected: [] },
];
const decided: Action[] = [
  { type: "setOwner", taskId: "task-1", owner: "Jenny" },
  { type: "decide", id: "med-1", decision: "confirmed" },
  { type: "decide", id: "task-1", decision: "confirmed" },
  { type: "decide", id: "watch-1", decision: "rejected" },
];
const delivery = { channel: "simulated", sent: false, preview: "x", to: "Jenny", at: "t" } as const;
const sources = (extra: Partial<Parameters<typeof buildRestoredState>[1]> = {}) => ({
  transcript: DEMO_TRANSCRIPT,
  extraction: DEMO_EXTRACTION,
  delivery: () => ({ ...delivery }),
  reply: (o: string) => simulatedReply(o, "DONE"),
  ...extra,
});
const good = (over: Partial<PersistedDemo> = {}): PersistedDemo => ({
  v: STORAGE_VERSION,
  step: "summary",
  consent: true,
  revealed: 12,
  roles: { A: "doctor", B: "patient" },
  speakersConfirmed: true,
  decisions: { "med-1": "confirmed" },
  owners: {},
  followUps: {},
  ...over,
});

describe("what is saved", () => {
  it("nothing at the very start", () => {
    expect(toPersisted(initialState)).toBeNull();
    saveDemoState(initialState);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("only synthetic choices: step, consent, position, roles, decisions, owners and two flags per follow-up", () => {
    const s = run(
      ...toReview,
      ...decided,
      { type: "toFollowup" },
      { type: "deliveryReady", taskId: "task-1", delivery },
    );
    const p = toPersisted(s)!;
    expect(Object.keys(p).sort()).toEqual([
      "consent",
      "decisions",
      "followUps",
      "owners",
      "revealed",
      "roles",
      "speakersConfirmed",
      "step",
      "v",
    ]);
    expect(p).toMatchObject({
      step: "followup",
      owners: { "task-1": "Jenny" },
      followUps: { "task-1": { delivered: true, replied: false } },
      decisions: { "med-1": "confirmed", "task-1": "confirmed", "watch-1": "rejected" },
    });
  });
  it("no transcript, summary, quote, message text or timestamp is ever written", () => {
    const s = run(
      ...toReview,
      ...decided,
      { type: "toFollowup" },
      { type: "deliveryReady", taskId: "task-1", delivery },
      { type: "replyReceived", taskId: "task-1", reply: simulatedReply("Jenny", "DONE") },
    );
    saveDemoState(s);
    const raw = sessionStorage.getItem(STORAGE_KEY)!;
    expect(raw.length).toBeLessThan(600);
    for (const word of [
      ...DEMO_TRANSCRIPT.segments.map((x) => x.text),
      DEMO_EXTRACTION.summary,
      "Lisinopril",
      "Dr. Patel",
      "Rosa",
      "blood",
      "ankles",
      "Pendia:",
      "DONE",
      "T00:",
      "202",
    ])
      expect(raw).not.toContain(word);
    expect(JSON.parse(raw).followUps).toEqual({ "task-1": { delivered: true, replied: true } });
  });
  it("a speaker confirmation still being processed is saved as not yet confirmed", () => {
    const s = run(...toSpeakers, { type: "confirmSpeakers" }); // extraction not back yet
    expect(s.speakersConfirmed).toBe(true);
    expect(toPersisted(s)!.speakersConfirmed).toBe(false);
  });
  it("round-trips through sessionStorage and Start over's clear removes it", () => {
    const s = run(...toReview, ...decided);
    saveDemoState(s);
    expect(loadDemoState()).toEqual(toPersisted(s));
    clearDemoState();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadDemoState()).toBeNull();
  });
});

describe("unsafe storage is ignored", () => {
  const stored = (v: unknown) =>
    sessionStorage.setItem(STORAGE_KEY, typeof v === "string" ? v : JSON.stringify(v));
  it.each([
    ["not JSON", "{oops"],
    ["a list", []],
    ["an old version", good({ v: 0 as never })],
    ["a future version", good({ v: 2 as never })],
    ["an unknown step", good({ step: "hacked" as never })],
    ["an extra key (possible text smuggling)", { ...good(), transcript: "Good morning, Rosa." }],
    ["an unknown role", good({ roles: { A: "admin" as never, B: "patient" } })],
    ["a bad speaker label", good({ roles: { "<script>": "doctor" as never } })],
    ["an unknown owner", good({ owners: { "task-1": "Mallory" as never } })],
    ["a bad item id", good({ decisions: { "../../x": "confirmed" } as never })],
    ["a bad decision", good({ decisions: { "med-1": "maybe" } as never })],
    ["a huge position", good({ revealed: 99999 })],
    ["a non-integer position", good({ revealed: 1.5 })],
  ])("%s", (_n, value) => {
    stored(value);
    expect(loadDemoState()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull(); // and it is removed
  });
  it("an oversized entry is refused and removed", () => {
    stored("x".repeat(MAX_STORED_BYTES + 1));
    expect(loadDemoState()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(parsePersisted("y".repeat(MAX_STORED_BYTES + 1))).toBeNull();
    // otherwise-valid content padded past the limit is refused on size alone
    const padded = JSON.stringify(good()) + " ".repeat(MAX_STORED_BYTES);
    expect(parsePersisted(padded)).toBeNull();
    expect(parsePersisted(JSON.stringify(good()))).not.toBeNull();
  });
  it("unavailable storage never throws: loads null, saves and clears are no-ops", () => {
    const boom = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const rm = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDemoState()).toBeNull();
    expect(() => saveDemoState(run(...toReview))).not.toThrow();
    expect(() => clearDemoState()).not.toThrow();
    boom.mockRestore();
    set.mockRestore();
    rm.mockRestore();
  });
});

describe("rebuilding a state from saved choices and the fixtures", () => {
  it("restores each step exactly, playback paused and nothing busy", () => {
    const visit = buildRestoredState(
      good({
        step: "visit",
        revealed: 4,
        roles: { A: "doctor", B: "patient" },
        speakersConfirmed: false,
        decisions: {},
      }),
      sources({ extraction: null }),
    )!;
    expect([visit.step, visit.revealed, visit.playing, visit.busy, visit.error]).toEqual([
      "visit",
      4,
      false,
      false,
      null,
    ]);
    const review = buildRestoredState(
      good({
        decisions: { "med-1": "confirmed", "watch-1": "rejected" },
        owners: { "task-1": "Jenny" },
      }),
      sources(),
    )!;
    expect(review.decisions).toEqual({ "med-1": "confirmed", "watch-1": "rejected" });
    expect(review.owners).toEqual({ "task-1": "Jenny" });
    expect(review.extraction).toBe(DEMO_EXTRACTION);
  });
  it("rebuilds the simulated text and the DONE reply from flags, not stored text", () => {
    const p = good({
      step: "followup",
      decisions: { "med-1": "confirmed", "task-1": "confirmed", "watch-1": "rejected" },
      owners: { "task-1": "Jenny" },
      followUps: { "task-1": { delivered: true, replied: true } },
    });
    const text = taskAssignmentText(DEMO_EXTRACTION.tasks[0]!, "Maria");
    const s = buildRestoredState(
      p,
      sources({
        delivery: () => ({
          channel: "simulated",
          sent: false,
          preview: text,
          to: "Jenny",
          at: "t",
        }),
      }),
    )!;
    expect(s.followUps["task-1"]!.delivery).toMatchObject({ sent: false, preview: text });
    expect(s.followUps["task-1"]!.reply).toMatchObject({
      channel: "simulated",
      from: "Jenny",
      text: "DONE",
    });
  });
  it.each([
    [
      "a step beyond consent without consent",
      good({ step: "visit", consent: false, decisions: {}, speakersConfirmed: false }),
    ],
    ["the review without confirmed speakers", good({ speakersConfirmed: false })],
    ["a decision on an item that does not exist", good({ decisions: { "med-9": "confirmed" } })],
    ["an owner for a task that does not exist", good({ owners: { "task-9": "Jenny" } })],
    ["a confirmed follow-up with no owner", good({ decisions: { "task-1": "confirmed" } })],
    [
      "the follow-up step before every item is decided",
      good({ step: "followup", decisions: { "med-1": "confirmed" }, owners: {}, followUps: {} }),
    ],
    [
      "the follow-up step with nothing to follow up",
      good({
        step: "followup",
        decisions: { "med-1": "confirmed", "task-1": "rejected", "watch-1": "rejected" },
      }),
    ],
    [
      "a reply that was never delivered",
      good({
        step: "done",
        decisions: { "med-1": "confirmed", "task-1": "confirmed", "watch-1": "rejected" },
        owners: { "task-1": "Jenny" },
        followUps: { "task-1": { delivered: false, replied: true } },
      }),
    ],
    [
      "follow-ups saved at the review step",
      good({ followUps: { "task-1": { delivered: true, replied: false } } }),
    ],
    [
      "the speakers step with the visit only part-played",
      good({ step: "speakers", revealed: 3, speakersConfirmed: false, decisions: {} }),
    ],
    [
      "a role for a voice that is not in the transcript",
      good({ roles: { A: "doctor", B: "patient", C: "family" } }),
    ],
    [
      "decisions saved before the review",
      good({
        step: "visit",
        revealed: 3,
        speakersConfirmed: false,
        decisions: { "med-1": "confirmed" },
      }),
    ],
    ["the review with no doctor", good({ roles: { A: "patient", B: "family" } })],
    ["an impossible 'intro'", good({ step: "intro" })],
  ])("refuses %s", (_n, p) => {
    expect(buildRestoredState(p, sources())).toBeNull();
  });
  it("refuses when a needed fixture is missing", () => {
    expect(buildRestoredState(good(), sources({ extraction: null }))).toBeNull();
    expect(
      buildRestoredState(
        good({ step: "visit", revealed: 2, speakersConfirmed: false, decisions: {} }),
        sources({ transcript: null }),
      ),
    ).toBeNull();
  });
  it("the reducer only accepts a restore into a fresh demo", () => {
    const restored = buildRestoredState(good(), sources())!;
    expect(reducer(initialState, { type: "restore", state: restored })).toBe(restored);
    const moved = run({ type: "begin" });
    expect(reducer(moved, { type: "restore", state: restored })).toBe(moved);
  });
});

describe("isolation", () => {
  it("no file outside the demo imports the persistence module (the real visit workflow never touches it)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) =>
        statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
      );
    const users = walk(join(process.cwd(), "src"))
      .filter(
        (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/src/test/") && !f.endsWith("persist.ts"),
      )
      .filter((f) => /visit-demo\/persist/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.slice(process.cwd().length + 1))).toEqual([
      "src/components/visit-demo/VisitDemo.tsx",
    ]);
  });
  it("the module imports no database client, service layer, hooks, network or AI package", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/visit-demo/persist.ts", "utf8");
    expect(src).not.toMatch(
      /integrations\/supabase|@\/services|@\/hooks|fetch\(|XMLHttpRequest|WebSocket|localStorage|twilio|META_API_KEY|process\.env/,
    );
    expect(src).toContain("sessionStorage");
  });
});
