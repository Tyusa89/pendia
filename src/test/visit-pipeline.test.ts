// @vitest-environment node
// Phase D, PR 1: the visit pipeline contracts, the cached synthetic visit, the validator, the clinician-only guard and the
// demo providers. Synthetic data only. Nothing here may touch the database, the network or a microphone.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEMO_BANNER_TEXT,
  DEMO_EXTRACTION,
  DEMO_SPEAKER_SUGGESTION,
  DEMO_TRANSCRIPT,
  GuardError,
  ProviderOutputError,
  assertSpeakerMap,
  checkAgainstTranscript,
  getVisitPipeline,
  guardExtraction,
  parseTranscriptResult,
  parseVisitExtraction,
  provenanceLabel,
  simulatedReply,
  type ConfirmedSpeakerMap,
  type VisitExtraction,
} from "@/lib/visit-pipeline";
import {
  createDemoExtractionProvider,
  createDemoTranscribeProvider,
  createSimulatedNotifier,
} from "@/lib/visit-pipeline/demo";

const confirmed = (
  map: Record<string, "doctor" | "patient" | "family" | "other">,
): ConfirmedSpeakerMap => ({ map, confirmed: true });
const GOOD = confirmed(DEMO_SPEAKER_SUGGESTION);
const clone = <T>(v: T): T => structuredClone(v);

describe("the cached visit is exactly the approved two-voice script", () => {
  const md = readFileSync(join(process.cwd(), "fixtures/spike/two-voice-script.md"), "utf8");
  const rows = [...md.matchAll(/^\|\s*(\d+)\s*\|\s*([DP])\s*\|\s*(.+?)\s*\|$/gm)].map((m) => ({
    n: Number(m[1]),
    who: m[2]!,
    text: m[3]!.replace(/~/g, "").replace(/\s+/g, " ").trim(),
  }));
  it("has the same 12 turns, in order, with the same words (overlap marks aside)", () => {
    expect(rows).toHaveLength(12);
    expect(DEMO_TRANSCRIPT.segments).toHaveLength(12);
    rows.forEach((r, i) => expect(DEMO_TRANSCRIPT.segments[i]!.text, `turn ${r.n}`).toBe(r.text));
  });
  it("uses one anonymous label per voice: the doctor's turns are all A, the patient's all B", () => {
    rows.forEach((r, i) =>
      expect(DEMO_TRANSCRIPT.segments[i]!.speaker, `turn ${r.n}`).toBe(r.who === "D" ? "A" : "B"),
    );
  });
  it("starts turns in order; only the two scripted interruption turns (7 and 8) overlap", () => {
    const s = DEMO_TRANSCRIPT.segments;
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.start_s).toBeGreaterThan(s[i - 1]!.start_s);
      const overlaps = s[i]!.start_s < s[i - 1]!.end_s;
      expect(overlaps, `turn ${i + 1}`).toBe(i === 7);
    }
  });
  it("is plainly synthetic: demo provenance, no model, no live AI", () => {
    expect(DEMO_TRANSCRIPT.provenance).toMatchObject({ mode: "demo", model: null, liveAi: false });
    expect(DEMO_EXTRACTION.provenance).toMatchObject({ mode: "demo", model: null, liveAi: false });
  });
});

describe("the cached extraction", () => {
  it("passes the validator and every quote is really in the turn it cites", () => {
    expect(() => parseVisitExtraction(clone(DEMO_EXTRACTION))).not.toThrow();
    expect(checkAgainstTranscript(DEMO_EXTRACTION, DEMO_TRANSCRIPT)).toEqual([]);
  });
  it("contains exactly the expected items: a Lisinopril 10 -> 20 mg change, a ride to the blood test, an ankle-swelling watch item", () => {
    expect(DEMO_EXTRACTION.med_changes).toMatchObject([
      {
        medication: "Lisinopril",
        before: expect.stringContaining("10 mg"),
        after: expect.stringContaining("20 mg"),
        timing: "starting tomorrow",
      },
    ]);
    expect(DEMO_EXTRACTION.tasks).toMatchObject([
      { title: "Drive Rosa to her blood test", due_hint: "within the next two weeks" },
    ]);
    expect(DEMO_EXTRACTION.watch_items).toHaveLength(1);
  });
  it("every item comes from a doctor turn; the patient's turns (2, 4, 7, 10, 12) produce nothing", () => {
    const patientStarts = [2, 4, 7, 10, 12].map((n) => DEMO_TRANSCRIPT.segments[n - 1]!.start_s);
    const sources = [
      ...DEMO_EXTRACTION.med_changes,
      ...DEMO_EXTRACTION.tasks,
      ...DEMO_EXTRACTION.watch_items,
    ].map((i) => i.source);
    expect(sources).toHaveLength(3);
    for (const s of sources) {
      expect(s.speaker).toBe("A");
      expect(patientStarts).not.toContain(s.start_s);
    }
  });
  it("does not turn the patient's trap lines into items (the 'call the lab first' instruction, the stated dose)", () => {
    const all = JSON.stringify(DEMO_EXTRACTION);
    expect(all).not.toMatch(/call the lab/i);
    expect(DEMO_EXTRACTION.tasks.every((t) => !/lab first/i.test(t.title))).toBe(true);
  });
  it("explains and does not advise", () => {
    expect(DEMO_EXTRACTION.summary).toMatch(/Dr\. Patel said/);
    expect(DEMO_EXTRACTION.summary).not.toMatch(/\byou should\b|\bI recommend\b|\bshould take\b/i);
  });
});

describe("the validator fails closed", () => {
  const t = () => clone(DEMO_TRANSCRIPT) as unknown as Record<string, unknown>;
  const e = () => clone(DEMO_EXTRACTION) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  it("rejects unknown keys, bad shapes and impossible times", () => {
    expect(() => parseTranscriptResult({ ...t(), extra: 1 })).toThrow(ProviderOutputError);
    expect(() => parseTranscriptResult({ ...t(), segments: [] })).toThrow(ProviderOutputError);
    expect(() =>
      parseTranscriptResult({
        ...t(),
        segments: [{ speaker: "A", start_s: 5, end_s: 2, text: "x" }],
      }),
    ).toThrow(/cannot end before/);
    expect(() => parseTranscriptResult("nope")).toThrow(ProviderOutputError);
  });
  it("a demo result cannot claim live AI, and a live one needs a real, non-contributor model", () => {
    expect(() =>
      parseTranscriptResult({
        ...t(),
        provenance: { ...DEMO_TRANSCRIPT.provenance, liveAi: true },
      }),
    ).toThrow(ProviderOutputError);
    const live = (model: string) => ({
      ...t(),
      provenance: {
        mode: "live",
        source: "meta",
        model,
        liveAi: true,
        generatedAt: "2026-11-01T00:00:00Z",
      },
    });
    expect(parseTranscriptResult(live("muse-voice-transcribe-1.0")).provenance.mode).toBe("live");
    expect(() => parseTranscriptResult(live("muse-spark-1.3-contributor"))).toThrow(/contributor/);
    expect(() => parseTranscriptResult(live(""))).toThrow(ProviderOutputError);
  });
  it("rejects an item with no source, duplicate ids, or extra fields", () => {
    const noSource = e();
    delete noSource["tasks"][0].source;
    expect(() => parseVisitExtraction(noSource)).toThrow(ProviderOutputError);
    const dup = e();
    dup["tasks"][0].id = "med-1";
    expect(() => parseVisitExtraction(dup)).toThrow(/unique/);
    const extra = e();
    extra["med_changes"][0].dose_advice = "take with food";
    expect(() => parseVisitExtraction(extra)).toThrow(ProviderOutputError);
  });
  it("rejects a quote that was never said, a wrong speaker, or a wrong time", () => {
    const made = clone(DEMO_EXTRACTION) as VisitExtraction;
    made.tasks[0]!.source.quote = "Please also pick up her prescription";
    expect(checkAgainstTranscript(made, DEMO_TRANSCRIPT)[0]).toMatch(/quote is not in that turn/);
    const wrongWho = clone(DEMO_EXTRACTION) as VisitExtraction;
    wrongWho.tasks[0]!.source.speaker = "B";
    expect(checkAgainstTranscript(wrongWho, DEMO_TRANSCRIPT)[0]).toMatch(/no turn by speaker B/);
    const wrongTime = clone(DEMO_EXTRACTION) as VisitExtraction;
    wrongTime.watch_items[0]!.source.start_s = 1;
    expect(checkAgainstTranscript(wrongTime, DEMO_TRANSCRIPT)[0]).toMatch(/starts at 1s/);
  });
  it("ignores punctuation and case when matching a quote, nothing else", () => {
    const ok = clone(DEMO_EXTRACTION) as VisitExtraction;
    ok.med_changes[0]!.source.quote =
      "i want to increase the LISINOPRIL from ten milligrams to twenty milligrams starting tomorrow!";
    expect(checkAgainstTranscript(ok, DEMO_TRANSCRIPT)).toEqual([]);
  });
});

describe("the clinician-only guard", () => {
  it("passes the real extraction through unchanged", () => {
    const r = guardExtraction(DEMO_EXTRACTION, DEMO_TRANSCRIPT, GOOD);
    expect(r.rejected).toEqual([]);
    expect(r.extraction).toEqual(DEMO_EXTRACTION);
  });
  it("rejects an item sourced from the patient's turn, and says why", () => {
    const leak = clone(DEMO_EXTRACTION) as VisitExtraction;
    leak.tasks.push({
      id: "task-x",
      title: "Call the lab first",
      due_hint: null,
      unclear: false,
      source: { speaker: "B", start_s: 39.8, quote: "Tell him to call the lab first" },
    });
    const r = guardExtraction(leak, DEMO_TRANSCRIPT, GOOD);
    expect(r.rejected).toEqual([
      {
        id: "task-x",
        speaker: "B",
        role: "patient",
        reason: expect.stringMatching(/Only what the doctor said/),
      },
    ]);
    expect(r.extraction.tasks.map((x) => x.id)).toEqual(["task-1"]);
  });
  it("with the speakers mapped the wrong way round, every item is rejected rather than trusted", () => {
    const r = guardExtraction(
      DEMO_EXTRACTION,
      DEMO_TRANSCRIPT,
      confirmed({ A: "patient", B: "doctor" }),
    );
    expect(r.rejected).toHaveLength(3);
    expect(r.extraction.med_changes).toEqual([]);
    expect(r.extraction.tasks).toEqual([]);
    expect(r.extraction.watch_items).toEqual([]);
  });
  it("refuses to run without a confirmed map that names a doctor and covers every speaker", () => {
    const unconfirmed = {
      map: DEMO_SPEAKER_SUGGESTION,
      confirmed: false,
    } as unknown as ConfirmedSpeakerMap;
    expect(() => assertSpeakerMap(unconfirmed, DEMO_TRANSCRIPT)).toThrow(GuardError);
    expect(() =>
      assertSpeakerMap(undefined as unknown as ConfirmedSpeakerMap, DEMO_TRANSCRIPT),
    ).toThrow(/confirmed/);
    expect(() =>
      assertSpeakerMap(confirmed({ A: "patient", B: "family" }), DEMO_TRANSCRIPT),
    ).toThrow(/which speaker is the doctor/);
    expect(() => assertSpeakerMap(confirmed({ A: "doctor" }), DEMO_TRANSCRIPT)).toThrow(
      /Speaker B has no role/,
    );
  });
});

describe("demo providers", () => {
  it("transcribe returns a validated copy; changing it never changes the cached visit", async () => {
    const r = await createDemoTranscribeProvider().transcribe({
      visitId: "demo",
      keywords: ["Lisinopril"],
    });
    expect(r.segments).toHaveLength(12);
    r.segments[0]!.text = "tampered";
    expect(DEMO_TRANSCRIPT.segments[0]!.text).toMatch(/^Good morning/);
  });
  it("extract needs a confirmed speaker map and returns the guarded items", async () => {
    const p = createDemoExtractionProvider();
    await expect(
      p.extract({
        transcript: DEMO_TRANSCRIPT,
        speakerMap: {
          map: DEMO_SPEAKER_SUGGESTION,
          confirmed: false,
        } as unknown as ConfirmedSpeakerMap,
      }),
    ).rejects.toThrow(GuardError);
    const r = await p.extract({ transcript: DEMO_TRANSCRIPT, speakerMap: GOOD });
    expect([r.med_changes.length, r.tasks.length, r.watch_items.length]).toEqual([1, 1, 1]);
    const swapped = await p.extract({
      transcript: DEMO_TRANSCRIPT,
      speakerMap: confirmed({ A: "patient", B: "doctor" }),
    });
    expect([swapped.med_changes.length, swapped.tasks.length, swapped.watch_items.length]).toEqual([
      0, 0, 0,
    ]);
  });
  it("extract refuses a transcript the cached summary does not match", async () => {
    const other = clone(DEMO_TRANSCRIPT);
    other.segments[2]!.text = "Your blood pressure is fine today.";
    await expect(
      createDemoExtractionProvider().extract({ transcript: other, speakerMap: GOOD }),
    ).rejects.toThrow(/not in the transcript/);
  });
  it("the notifier never sends: a delivery is simulated, flagged not sent, and keeps the preview text", async () => {
    const d = await createSimulatedNotifier().send({
      kind: "task-assignment",
      to: { name: "Carlos" },
      body: "Can you drive Rosa?",
    });
    expect(d).toMatchObject({
      channel: "simulated",
      sent: false,
      preview: "Can you drive Rosa?",
      to: "Carlos",
    });
    expect(simulatedReply("Carlos", "DONE")).toMatchObject({
      channel: "simulated",
      from: "Carlos",
      text: "DONE",
    });
  });
  it("the only pipeline available is the demo; live is refused", () => {
    expect(getVisitPipeline().mode).toBe("demo");
    expect(() => getVisitPipeline("live")).toThrow(/not enabled/);
    expect(() => getVisitPipeline("anything")).toThrow(/not enabled/);
  });
});

describe("nothing leaves the page", () => {
  it("a full demo pass makes no network call, opens no socket and asks for no microphone", async () => {
    const boom = vi.fn(() => {
      throw new Error("forbidden");
    });
    vi.stubGlobal("fetch", boom);
    vi.stubGlobal("WebSocket", boom);
    vi.stubGlobal("XMLHttpRequest", boom);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: boom } });
    try {
      const p = getVisitPipeline();
      const tr = await p.transcribe.transcribe({ visitId: "demo", keywords: [] });
      const ex = await p.extract.extract({ transcript: tr, speakerMap: GOOD });
      await p.notifier.send({
        kind: "task-assignment",
        to: { name: "Carlos" },
        body: ex.tasks[0]!.title,
      });
      expect(boom).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("the pipeline's source files import no database client, service layer or React hooks", () => {
    const dir = join(process.cwd(), "src/lib/visit-pipeline");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(
        /integrations\/supabase|@\/services|@\/hooks|twilio|api\.meta\.ai|META_API_KEY|process\.env|import\.meta\.env/i,
      );
    }
  });
});

describe("labels come from provenance", () => {
  it("a demo result reads as a prerecorded example and never as live", () => {
    const l = provenanceLabel(DEMO_TRANSCRIPT.provenance);
    expect(l).toMatch(/Prerecorded synthetic example/);
    expect(l).toMatch(/not processed by live AI/);
    expect(l).not.toMatch(/^Live/);
  });
  it("a live result names its model and says live", () => {
    expect(
      provenanceLabel({
        mode: "live",
        source: "meta",
        model: "muse-spark-1.3",
        liveAi: true,
        generatedAt: "2026-11-01T10:00:00Z",
      }),
    ).toBe("Live · muse-spark-1.3 · 2026-11-01T10:00:00Z");
  });
  it("the banner is exactly the approved wording", () => {
    expect(DEMO_BANNER_TEXT).toBe(
      "DEMO MODE · Prerecorded synthetic data · No live Meta AI · No real SMS · Nothing is saved",
    );
  });
});
