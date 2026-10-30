import { judgeDemoData } from "@/lib/judge-demo-data";
import { JUDGE_DEMO_FAMILY_ID } from "@/lib/judge-demo";
import type { PackSource } from "./care-agent.server";

// No database client. Only this server-owned fictional snapshot can enter judge prompts.
export function createJudgePackSource(): PackSource {
  return {
    async getMember(id) { return id === JUDGE_DEMO_FAMILY_ID ? judgeDemoData().me : null; },
    async getFamily(id) { return id === JUDGE_DEMO_FAMILY_ID ? judgeDemoData().family : null; },
    async loadRows({ familyId, now }) {
      if (familyId !== JUDGE_DEMO_FAMILY_ID) throw new Error("not_demo_family");
      const d = judgeDemoData(now);
      return {
        recipient: { id: d.recipient.id, name: d.recipient.name },
        members: d.members.map(({ id, name }) => ({ id, name })),
        medications: d.medications.map(({ id, name, dose, schedule, status }) => ({ id, name, dose, schedule, status })),
        visits: d.visits.map(({ id, status, confirmation_status, scheduled_start, scheduled_end, provider_name, office_name, reason, notes, summary }) => ({ id, status, confirmation_status, scheduled_start, scheduled_end, provider_name, office_name, reason, notes, summary })),
        handoffs: d.handoffs.map(({ id, created_at, author_member_id, ate, meds_taken, note, unusual, watch_answers }) => ({ id, created_at, author_member_id, ate, meds_taken, note, unusual, watch_answers })),
        shifts: d.shifts.map(({ id, start, end, assigned_member_id, status }) => ({ id, start, end, assigned_member_id, status })),
        medChanges: [], followUpTasks: [], followUpWatch: [], doses: [], tasks: [], watch: [],
        medNames: d.medications.map(m => m.name),
      };
    },
  };
}