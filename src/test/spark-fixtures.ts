// Synthetic model answers for the Spark contract tests. Fictional people, fictional medication change, no real data.
// The "model" here is just data: nothing in this file calls anything.
import { DEMO_SPEAKER_SUGGESTION, DEMO_TRANSCRIPT } from "@/lib/visit-pipeline";
import type { ConfirmedSpeakerMap } from "@/lib/visit-pipeline";

export const transcript = DEMO_TRANSCRIPT;
export const speakerMap: ConfirmedSpeakerMap = {
  map: { ...DEMO_SPEAKER_SUGGESTION },
  confirmed: true,
};

/** Turn ids are positions in the transcript: t1..t12. A = the doctor's voice, B = the patient's. */
export const DOCTOR_TURNS = [1, 3, 5, 6, 8, 9, 11] as const;
export const PATIENT_TURNS = [2, 4, 7, 10, 12] as const;
export const turnText = (n: number) => transcript.segments[n - 1]!.text;

export const clear = { state: "clear", reason: null } as const;

export const medItem = (over: Record<string, unknown> = {}) => ({
  medication: "Lisinopril",
  before: "10 mg, once a day in the morning",
  after: "20 mg, once a day in the morning",
  timing: "starting tomorrow",
  turnId: "t3",
  quote:
    "I want to increase the Lisinopril from ten milligrams to twenty milligrams, starting tomorrow",
  uncertainty: clear,
  ...over,
});
export const taskItem = (over: Record<string, unknown> = {}) => ({
  title: "Drive Rosa to her blood test",
  due_hint: "within the next two weeks",
  turnId: "t6",
  quote: "I'm also booking a blood test within the next two weeks",
  uncertainty: clear,
  ...over,
});
export const watchItem = (over: Record<string, unknown> = {}) => ({
  text: "Call the office right away if Rosa's ankles start to swell",
  turnId: "t9",
  quote: "If your ankles start to swell, call the office right away",
  uncertainty: clear,
  ...over,
});

export const answer = (
  over: { med_changes?: unknown[]; tasks?: unknown[]; watch_items?: unknown[] } = {},
) => ({
  med_changes: [medItem()],
  tasks: [taskItem()],
  watch_items: [watchItem()],
  ...over,
});

/** The words a patient said that sound like instructions (the leakage traps from the script). */
export const TRAPS = {
  2: "ten milligrams every morning",
  7: "Tell him to call the lab first",
  10: "Call the office if my ankles swell",
} as const;

/** A worst-case model: one watch item per turn of the visit, patient turns included, each quoting that turn. */
export function everyTurnAnswer() {
  return answer({
    med_changes: [],
    tasks: [],
    watch_items: transcript.segments.map((s, i) =>
      watchItem({
        text: `Item from turn ${i + 1}`,
        turnId: `t${i + 1}`,
        quote: s.text.split(/\s+/).slice(0, 5).join(" "),
      }),
    ),
  });
}
