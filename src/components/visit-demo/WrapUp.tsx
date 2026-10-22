import { RotateCcw } from "lucide-react";
import type { Dispatch } from "react";
import { Button } from "@/components/ui/button";
import { Card, StepHeading } from "@/components/visit-demo/parts";
import { itemIds, type Action, type DemoState } from "@/lib/visit-demo/state";
import { NOT_MEDICAL_ADVICE } from "@/lib/visit-pipeline/labels";

export function WrapUp({ s, dispatch }: { s: DemoState; dispatch: Dispatch<Action> }) {
  const ids = itemIds(s.extraction);
  const confirmed = ids.filter((id) => s.decisions[id] === "confirmed").length;
  const rejected = ids.filter((id) => s.decisions[id] === "rejected").length;
  const replied = Object.values(s.followUps).filter((f) => f.reply).length;
  return (
    <Card className="space-y-4">
      <StepHeading id="done">That's the loop</StepHeading>
      <ul className="space-y-2 text-lg">
        <li>
          You confirmed <strong>{confirmed}</strong> and rejected <strong>{rejected}</strong> of{" "}
          {ids.length} proposed items. Nothing was applied without a person's decision.
        </li>
        {Object.keys(s.followUps).length > 0 && (
          <li>
            {Object.keys(s.followUps).length} follow-up text
            {Object.keys(s.followUps).length === 1 ? "" : "s"} shown, <strong>0 sent</strong>
            {replied ? `; ${replied} simulated repl${replied === 1 ? "y" : "ies"}` : ""}.
          </li>
        )}
      </ul>
      <div className="rounded-xl bg-muted p-4">
        <p className="font-bold">In the real app</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            A confirmed medication change updates the family's medication list, with who confirmed
            it and when.
          </li>
          <li>
            A confirmed follow-up is assigned and texted to the person you chose; their reply
            updates the family's view.
          </li>
          <li>
            The visit's audio would be recorded only after consent, and the transcript and summary
            would come from the live pipeline once it is connected.
          </li>
        </ul>
      </div>
      <p className="text-lg font-semibold">
        This was a prerecorded synthetic example. Nothing was saved or sent.
      </p>
      <p className="text-sm font-semibold text-muted-foreground">{NOT_MEDICAL_ADVICE}</p>
      <Button variant="outline" onClick={() => dispatch({ type: "reset" })}>
        <RotateCcw /> Start over
      </Button>
    </Card>
  );
}
