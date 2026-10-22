import { MessageSquare } from "lucide-react";
import type { Dispatch } from "react";
import { Button } from "@/components/ui/button";
import { Card, StepHeading } from "@/components/visit-demo/parts";
import { confirmedTasks, type Action, type DemoState } from "@/lib/visit-demo/state";
import { simulatedReply } from "@/lib/visit-pipeline";

const Tag = ({ children }: { children: string }) => (
  <span className="rounded-full border border-dashed border-warning-foreground/60 bg-warning px-2.5 py-0.5 text-[0.75rem] font-bold uppercase tracking-wide text-warning-foreground">
    {children}
  </span>
);

/**
 * Family follow-through, simulated. The text below is what a family member WOULD receive; it was not sent, and the reply is
 * a button the viewer presses. No SMS provider exists anywhere in this demo.
 */
export function FollowThrough({ s, dispatch }: { s: DemoState; dispatch: Dispatch<Action> }) {
  const tasks = confirmedTasks(s);
  return (
    <Card className="space-y-4">
      <StepHeading id="followup">Following through, with no real texts</StepHeading>
      <p className="text-lg leading-relaxed">
        When a family confirms a follow-up and picks who will do it, the real app would text that
        person and wait for their reply. Here the message is only shown:{" "}
        <strong>nothing was sent</strong>, and no phone was contacted.
      </p>
      {tasks.map((t) => {
        const f = s.followUps[t.id];
        const owner = s.owners[t.id]!;
        return (
          <div
            key={t.id}
            className="space-y-3 rounded-xl bg-muted p-4"
            role="group"
            aria-label={`Follow-up for ${owner}`}
          >
            <p className="font-bold">
              {t.title} · {owner}
            </p>
            {f?.delivery && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <MessageSquare className="size-4" aria-hidden /> Pendia → {owner}{" "}
                  <Tag>{f.delivery.sent ? "Sent" : "Simulated · not sent"}</Tag>
                </div>
                <p className="max-w-prose rounded-2xl rounded-tl-sm bg-card p-3 text-lg shadow-card">
                  {f.delivery.channel === "simulated" ? f.delivery.preview : ""}
                </p>
              </div>
            )}
            {f?.reply && (
              <div className="space-y-1 sm:ml-8">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
                  {owner} → Pendia <Tag>Simulated reply</Tag>
                </div>
                <p className="w-fit rounded-2xl rounded-tr-sm bg-secondary p-3 text-lg font-semibold text-secondary-foreground">
                  {f.reply.text}
                </p>
              </div>
            )}
            {f?.delivery && !f.reply && (
              <Button
                variant="outline"
                onClick={() =>
                  dispatch({
                    type: "replyReceived",
                    taskId: t.id,
                    reply: simulatedReply(owner, "DONE"),
                  })
                }
              >
                Pretend {owner} replies “DONE”
              </Button>
            )}
            <p className="font-semibold" data-testid={`status-${t.id}`}>
              Status the family sees:{" "}
              {f?.reply ? `Done · ${owner} (simulated reply)` : `Waiting for ${owner} (simulated)`}
            </p>
          </div>
        );
      })}
      <Button size="lg" onClick={() => dispatch({ type: "finish" })}>
        Finish the demo
      </Button>
    </Card>
  );
}
