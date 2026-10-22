// The text a family member WOULD get when a follow-up is assigned. In Demo Mode it is only shown, never sent.
import type { ProposedTask } from "@/lib/visit-pipeline/types";

export function taskAssignmentText(task: ProposedTask, requestedBy: string): string {
  const when = task.due_hint ? ` (${task.due_hint})` : "";
  return `Pendia: ${requestedBy} asked you to: ${task.title}${when}. Reply DONE when it's finished.`;
}
