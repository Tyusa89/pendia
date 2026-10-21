// In-memory stand-in for visitService, mirroring what the database does for appointments (defaults, doctor mirror,
// date in the family's timezone). Fictional data only.
import { vi } from "vitest";
import type { Appointment, AppointmentInput } from "@/lib/appointments";
import { dateInZone } from "@/lib/zoned-time";

export const FAMILY = "aaaaaaaa-0000-4000-8000-00000000000a";
export const TZ = "America/New_York";
export const NOW_ISO = "2026-11-10T15:00:00Z";

let seq = 0;
export const makeRow = (patch: Partial<Appointment> = {}): Appointment => ({
  id: `v${++seq}`,
  family_id: FAMILY,
  date: "2026-11-20",
  doctor: patch.provider_name === undefined ? "Dr. Example" : patch.provider_name,
  provider_name: "Dr. Example",
  office_name: null,
  office_address: "1 Example Rd",
  office_phone: "555-0100",
  scheduled_start: "2026-11-20T15:00:00Z",
  scheduled_end: null,
  reason: null,
  notes: null,
  status: "scheduled",
  confirmation_status: "unconfirmed",
  reminder_prefs: {},
  archived_at: null,
  created_at: "2026-11-01T00:00:00Z",
  audio_path: null,
  audio_url: null,
  consent_at: null,
  consent_by: null,
  consent_text: null,
  duration_seconds: null,
  speaker_map: {},
  speaker_map_confirmed_at: null,
  speaker_map_confirmed_by: null,
  summary: null,
  transcript: [],
  ...patch,
});

export const store = { rows: [] as Appointment[] };
export const calls = {
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
};
export function resetStore(rows: Appointment[] = []) {
  store.rows = rows.map((r) => ({ ...r }));
  Object.values(calls).forEach((c) => c.mockClear());
}
const find = (id: string) => {
  const r = store.rows.find((x) => x.id === id);
  if (!r) throw new Error("not found");
  return r;
};
const apply = (r: Appointment, a: AppointmentInput) => {
  Object.assign(r, a, { doctor: a.provider_name, date: dateInZone(a.scheduled_start, TZ) });
  return { ...r };
};

export const fakeVisitService = {
  list: async (familyId: string) =>
    store.rows.filter((r) => r.family_id === familyId).map((r) => ({ ...r })),
  get: async (id: string) => ({
    visit: { ...find(id) },
    changes: [] as unknown[],
    tasks: [] as unknown[],
    watch: [] as unknown[],
  }),
  createAppointment: async (familyId: string, a: AppointmentInput) => {
    calls.create(familyId, a);
    const r = makeRow({ family_id: familyId });
    Object.assign(r, {
      provider_name: null,
      office_address: null,
      office_phone: null,
      status: "scheduled",
      confirmation_status: "unconfirmed",
    });
    store.rows.push(r);
    return apply(r, a);
  },
  updateAppointment: async (id: string, a: AppointmentInput) => {
    calls.update(id, a);
    return apply(find(id), a);
  },
  cancelAppointment: async (id: string) => {
    calls.cancel(id);
    find(id).status = "canceled";
    return { ...find(id) };
  },
  archiveAppointment: async (id: string) => {
    calls.archive(id);
    find(id).archived_at = "2026-11-10T15:00:00Z";
    return { ...find(id) };
  },
  unarchiveAppointment: async (id: string) => {
    calls.unarchive(id);
    find(id).archived_at = null;
    return { ...find(id) };
  },
};
