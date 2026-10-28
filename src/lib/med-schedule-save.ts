// Saves the dose times chosen in the Add medication form, safely and repeatably.
// Pure orchestration over injected service calls so retries can be tested: a time that already exists (same medication,
// time, days, start, no end) is never inserted twice, and a duplicate error only counts as saved once the matching
// persisted schedule has been read back.
import { DoseError, type ScheduleInput } from "@/lib/dose-administration";

export interface PersistedSchedule {
  id: string;
  medication_id: string;
  local_time: string;
  days_of_week: number[];
  starts_on: string;
  ends_on: string | null;
}

export interface ScheduleSaveDeps {
  list: () => Promise<PersistedSchedule[]>;
  add: (input: ScheduleInput) => Promise<unknown>;
}

const hhmm = (t: string) => t.slice(0, 5);
const daysKey = (d: number[]) => [...d].sort((a, b) => a - b).join(",");

export function matchesInput(s: PersistedSchedule, i: ScheduleInput): boolean {
  return (
    s.medication_id === i.medication_id &&
    hhmm(s.local_time) === hhmm(i.local_time) &&
    daysKey(s.days_of_week) === daysKey(i.days_of_week) &&
    s.starts_on === i.starts_on &&
    (s.ends_on ?? null) === (i.ends_on ?? null)
  );
}

/** Unique, sorted HH:MM times; blanks dropped. */
export function normalizeTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()).filter(Boolean).map(hhmm))].sort();
}

export function buildInputs(
  medicationId: string,
  times: string[],
  days: number[],
  startsOn: string,
): ScheduleInput[] {
  return normalizeTimes(times).map((t) => ({
    medication_id: medicationId,
    local_time: t,
    days_of_week: [...days].sort((a, b) => a - b),
    starts_on: startsOn,
    ends_on: null,
  }));
}

/**
 * Inserts each missing schedule, then re-reads and confirms every input is persisted.
 * Resolves only when all inputs are confirmed; otherwise throws with the inputs still missing.
 */
export async function saveSchedules(inputs: ScheduleInput[], deps: ScheduleSaveDeps) {
  const existing = await deps.list();
  for (const i of inputs) {
    if (existing.some((s) => matchesInput(s, i))) continue;
    try {
      await deps.add(i);
    } catch (e) {
      // a duplicate is only acceptable if the exact schedule is confirmed below; anything else stops here
      if (!(e instanceof DoseError && e.code === "dose_duplicate_schedule")) throw e;
    }
  }
  const after = await deps.list();
  const missing = inputs.filter((i) => !after.some((s) => matchesInput(s, i)));
  if (missing.length) {
    throw new DoseError("unknown", "Some dose times could not be confirmed as saved.");
  }
  return after;
}
