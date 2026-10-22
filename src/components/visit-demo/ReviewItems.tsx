import { Check, Undo2, X } from "lucide-react";
import type { Dispatch } from "react";
import { Button } from "@/components/ui/button";
import { Card, ProposedBadge } from "@/components/visit-demo/parts";
import { formatTimestamp } from "@/lib/format";
import {
  allDecided,
  itemIds,
  type Action,
  type Decision,
  type DemoState,
} from "@/lib/visit-demo/state";
import { DEMO_FAMILY } from "@/lib/visit-pipeline/fixture";
import type { SourceRef } from "@/lib/visit-pipeline/types";

function Source({ speaker, source }: { speaker: string; source: SourceRef }) {
  return (
    <p className="text-[0.9412rem] text-muted-foreground">
      Heard at {formatTimestamp(source.start_s)} · {speaker}: “{source.quote}”
    </p>
  );
}

function DecisionBadge({ decision }: { decision: Decision | undefined }) {
  if (decision === "confirmed")
    return (
      <span className="shrink-0 rounded-full bg-success px-3 py-1 text-[0.8235rem] font-bold text-success-foreground">
        Confirmed · demo only
      </span>
    );
  if (decision === "rejected")
    return (
      <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-[0.8235rem] font-bold text-muted-foreground">
        Rejected
      </span>
    );
  return <ProposedBadge />;
}

/** One Confirm / Reject pair. Every item is decided on its own: there is deliberately no "confirm all". */
function Decide({
  id,
  decision,
  disabledConfirm,
  dispatch,
  what,
}: {
  id: string;
  decision: Decision | undefined;
  disabledConfirm?: boolean;
  dispatch: Dispatch<Action>;
  what: string;
}) {
  if (decision)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 text-primary"
        onClick={() => dispatch({ type: "decide", id, decision: null })}
      >
        <Undo2 /> Change my answer
      </Button>
    );
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="success"
        disabled={disabledConfirm}
        onClick={() => dispatch({ type: "decide", id, decision: "confirmed" })}
        aria-label={`Confirm ${what}`}
      >
        <Check /> Confirm
      </Button>
      <Button
        variant="outline"
        onClick={() => dispatch({ type: "decide", id, decision: "rejected" })}
        aria-label={`Reject ${what}`}
      >
        <X /> Reject
      </Button>
    </div>
  );
}

/** The proposed items, each waiting for a person's decision. Nothing is applied anywhere; this is a demonstration. */
export function ReviewItems({
  s,
  dispatch,
  nameFor,
}: {
  s: DemoState;
  dispatch: Dispatch<Action>;
  nameFor: (label: string) => string;
}) {
  const x = s.extraction!;
  const none = !itemIds(x).length;
  return (
    <section aria-label="Proposed items" className="space-y-3">
      <p className="rounded-xl bg-muted p-3 text-[0.9412rem]">
        <Check className="mr-1 inline size-4" aria-hidden />
        Everything below came from the doctor's words, with the moment it was heard. Review each
        item yourself: nothing is confirmed until a person confirms it, and in this demo confirming
        changes nothing real.
      </p>
      {none && (
        <p
          role="status"
          className="rounded-xl bg-warning p-4 font-semibold text-warning-foreground"
        >
          Nothing was proposed. Pendia only reads what the doctor said, so check that the doctor is
          the right speaker, then start over.
        </p>
      )}

      {x.med_changes.map((m) => (
        <Card key={m.id} label={`Medication change: ${m.medication}`} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-semibold">{m.medication}</h3>
            <DecisionBadge decision={s.decisions[m.id]} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-lg">
            <span className="rounded-lg bg-muted px-3 py-1 line-through decoration-muted-foreground/60">
              {m.before}
            </span>
            <span aria-hidden>→</span>
            <span className="rounded-lg bg-accent px-3 py-1 font-semibold">{m.after}</span>
          </div>
          {m.timing && <p className="font-semibold">{m.timing}</p>}
          <Source speaker={nameFor(m.source.speaker)} source={m.source} />
          <Decide
            id={m.id}
            decision={s.decisions[m.id]}
            dispatch={dispatch}
            what={`the ${m.medication} change`}
          />
          {s.decisions[m.id] === "confirmed" && (
            <p className="text-[0.9412rem] text-muted-foreground">
              In the real app, confirming adds this to the family's medication list after your
              review. Nothing was changed here.
            </p>
          )}
        </Card>
      ))}

      {x.tasks.map((t) => (
        <Card key={t.id} label={`Follow-up: ${t.title}`} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-semibold">{t.title}</h3>
            <DecisionBadge decision={s.decisions[t.id]} />
          </div>
          {t.due_hint && <p className="font-semibold">{t.due_hint}</p>}
          <Source speaker={nameFor(t.source.speaker)} source={t.source} />
          {!s.decisions[t.id] && (
            <div>
              <label htmlFor={`owner-${t.id}`} className="font-semibold">
                Who will do this?
              </label>
              <select
                id={`owner-${t.id}`}
                className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-lg"
                value={s.owners[t.id] ?? ""}
                onChange={(e) =>
                  dispatch({ type: "setOwner", taskId: t.id, owner: e.target.value })
                }
              >
                <option value="">Choose a family member…</option>
                {DEMO_FAMILY.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-muted-foreground">
                Pendia doesn't pick for you. Confirming needs a name.
              </p>
            </div>
          )}
          {s.decisions[t.id] === "confirmed" && (
            <p className="font-semibold">Assigned to {s.owners[t.id]}</p>
          )}
          <Decide
            id={t.id}
            decision={s.decisions[t.id]}
            disabledConfirm={!s.owners[t.id]}
            dispatch={dispatch}
            what={`the follow-up "${t.title}"`}
          />
        </Card>
      ))}

      {x.watch_items.map((w) => (
        <Card key={w.id} label={`Watch for: ${w.text}`} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-semibold">{w.text}</h3>
            <DecisionBadge decision={s.decisions[w.id]} />
          </div>
          <Source speaker={nameFor(w.source.speaker)} source={w.source} />
          <Decide
            id={w.id}
            decision={s.decisions[w.id]}
            dispatch={dispatch}
            what={`the watch item "${w.text}"`}
          />
        </Card>
      ))}

      {!none && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={!allDecided(s)}
            onClick={() => dispatch({ type: "toFollowup" })}
          >
            Continue
          </Button>
          {!allDecided(s) && (
            <p className="text-muted-foreground">Confirm or reject every item to continue.</p>
          )}
        </div>
      )}
    </section>
  );
}
