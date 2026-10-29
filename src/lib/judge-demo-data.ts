import type { Tables } from "@/integrations/supabase/types";
import { JUDGE_DEMO_FAMILY_ID as fid, JUDGE_DEMO_USER_ID } from "./judge-demo";

// Fictional display snapshot. Never seeded into the database; no patient/account contact information.
export function judgeDemoData(now = new Date()) {
  const created_at = "2026-10-29T12:00:00Z";
  const family: Tables<"family"> = { id: fid, name: "Pendia Hackathon — Fictional Demo Family", is_demo: true, timezone: "America/Chicago", created_by: null, created_at };
  const member = (id: string, name: string, role: string, phone: string | null): Tables<"member"> => ({ id, family_id: fid, name, role, phone, language: "en", user_id: null, can_see_meds: true, can_see_schedule: true, can_see_visits: true, created_at });
  const members = [member("demo-elena", "Elena", "organizer", "+12125550101"), member("demo-marco", "Marco", "member", "+12125550102"), member("demo-lucia", "Lucía", "member", "+12125550103")];
  const me = { ...member("demo-judge", "Demo Caregiver", "member", null), user_id: JUDGE_DEMO_USER_ID };
  const recipient: Tables<"care_recipient"> = { id: "demo-rosa", family_id: fid, name: "Grandma Rosa", notes: "Fictional care recipient. Enjoys gardening and afternoon walks.", created_at };
  const medications: Tables<"medication">[] = [{ id: "141481e0-54dc-4a0f-8e6e-354c8861d432", family_id: fid, name: "Lisinopril", dose: "10 mg", status: "active", schedule: null, created_at }];
  const tomorrow = new Date(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(15, 0, 0, 0);
  const visits: Tables<"visit">[] = [{ id: "demo-appointment", family_id: fid, date: tomorrow.toISOString().slice(0, 10), scheduled_start: tomorrow.toISOString(), scheduled_end: new Date(tomorrow.getTime() + 1800000).toISOString(), status: "scheduled", provider_name: "Dr. Rivera (fictional)", reason: "Routine check-up", office_name: "Fictional Community Clinic", office_address: null, office_phone: null, doctor: null, notes: "Bring the medication list.", summary: null, transcript: [], speaker_map: {}, reminder_prefs: {}, confirmation_status: "unconfirmed", archived_at: null, audio_path: null, audio_url: null, consent_at: null, consent_by: null, consent_text: null, duration_seconds: null, speaker_map_confirmed_at: null, speaker_map_confirmed_by: null, created_at }];
  const start = new Date(now); start.setUTCHours(13, 0, 0, 0);
  const shifts: Tables<"shift">[] = Array.from({ length: 7 }, (_, i) => {
    const s = new Date(start); s.setUTCDate(s.getUTCDate() + i);
    return { id: `demo-shift-${i}`, family_id: fid, start: s.toISOString(), end: new Date(s.getTime() + 4 * 3600000).toISOString(), assigned_member_id: members[i % 3]?.id ?? null, status: "claimed", created_at };
  });
  const handoffs: Tables<"handoff">[] = [{ id: "demo-handoff", family_id: fid, author_member_id: "demo-elena", ate: true, meds_taken: true, note: "Rosa enjoyed lunch and a short walk.", unusual: "Nothing unusual today.", watch_answers: {}, shift_id: null, audio_mime: null, audio_path: null, audio_size_bytes: null, audio_wav_mime: null, audio_wav_path: null, audio_wav_size_bytes: null, duration_seconds: null, created_at: now.toISOString() }];
  const digests: Tables<"digest">[] = [{ id: "demo-digest", family_id: fid, member_id: me.id, language: "en", week: now.toISOString().slice(0, 10), text: "Changed: no medication changes.\nDone: the family shared a handoff.\nOpen: no outstanding tasks.\nCoverage: family members share morning visits.\nNext: a routine check-up at the fictional clinic.", sent_at: null, created_at }];
  return { family, me, members: [me, ...members], recipient, medications, visits, shifts, handoffs, digests };
}