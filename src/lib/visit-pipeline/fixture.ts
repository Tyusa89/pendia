// The cached synthetic doctor visit. Fictional people (Dr. Patel, Rosa), fictional medication change, no real patient data.
// The dialogue is exactly fixtures/spike/two-voice-script.md (a test keeps them identical), so a later live run on the
// same script can be compared like for like. Speaker labels are anonymous, as a real diarizer's would be.
import type { SpeakerMap, TranscriptResult, VisitExtraction } from "./types";

export const DEMO_NOTE = "Prerecorded synthetic example";

const demoProvenance = {
  mode: "demo",
  source: "prerecorded-synthetic",
  model: null,
  liveAi: false,
  note: DEMO_NOTE,
} as const;

/** A = the clinician's voice, B = the patient's, in this recording. */
export const DEMO_SPEAKER_SUGGESTION: SpeakerMap = { A: "doctor", B: "patient" };

export const DEMO_DOCTOR = "Dr. Patel";
export const DEMO_PATIENT = "Rosa";
/** Fictional family members the demo can assign a follow-up to. */
export const DEMO_FAMILY = ["Maria", "Carlos", "Jenny"] as const;

// [speaker, start, end, text]. Turns 7 and 8 overlap on purpose (an interruption).
const turns: Array<[string, number, number, string]> = [
  ["A", 0.0, 4.6, "Good morning, Rosa. How have you been feeling since the last visit?"],
  [
    "B",
    5.2,
    11.4,
    "Pretty good. I take the Lisinopril, ten milligrams, every morning with my coffee.",
  ],
  [
    "A",
    12.1,
    21.3,
    "Your blood pressure is still a little high today. I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow.",
  ],
  ["B", 22.0, 26.4, "Twenty? Okay. Should I take it with food?"],
  ["A", 27.0, 30.2, "Same as before, once a day in the morning."],
  [
    "A",
    31.5,
    38.9,
    "I'm also booking a blood test within the next two weeks. Someone will need to drive you there.",
  ],
  ["B", 39.8, 46.0, "My son Carlos can probably drive me. Tell him to call the lab first."],
  ["A", 44.5, 48.7, "Yes, the front desk will give you the lab's number."],
  ["A", 49.6, 55.2, "One more thing. If your ankles start to swell, call the office right away."],
  ["B", 56.0, 59.8, "Call the office if my ankles swell. I will."],
  ["A", 60.5, 63.9, "Good. We'll see you after the blood test."],
  ["B", 64.6, 66.5, "Thank you, doctor."],
];

export const DEMO_TRANSCRIPT: TranscriptResult = {
  provenance: demoProvenance,
  segments: turns.map(([speaker, start_s, end_s, text]) => ({ speaker, start_s, end_s, text })),
  keywords: ["Lisinopril"],
  language: "en",
};

const seg = (i: number) => DEMO_TRANSCRIPT.segments[i - 1]!;

export const DEMO_EXTRACTION: VisitExtraction = {
  provenance: demoProvenance,
  summary:
    "Dr. Patel said Rosa's blood pressure is still a little high today. The plan she described is to raise Rosa's Lisinopril from 10 mg to 20 mg, once a day in the morning, starting tomorrow. A blood test is being booked within the next two weeks, and someone will need to drive Rosa there. Dr. Patel also said to call the office right away if Rosa's ankles start to swell.",
  med_changes: [
    {
      id: "med-1",
      medication: "Lisinopril",
      before: "10 mg, once a day in the morning",
      after: "20 mg, once a day in the morning",
      timing: "starting tomorrow",
      unclear: false,
      source: {
        speaker: seg(3).speaker,
        start_s: seg(3).start_s,
        quote:
          "I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow",
      },
    },
  ],
  tasks: [
    {
      id: "task-1",
      title: "Drive Rosa to her blood test",
      due_hint: "within the next two weeks",
      unclear: false,
      source: {
        speaker: seg(6).speaker,
        start_s: seg(6).start_s,
        quote: "Someone will need to drive you there",
      },
    },
  ],
  watch_items: [
    {
      id: "watch-1",
      text: "Call the office right away if Rosa's ankles start to swell",
      source: {
        speaker: seg(9).speaker,
        start_s: seg(9).start_s,
        quote: "If your ankles start to swell, call the office right away",
      },
    },
  ],
};
