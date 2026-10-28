// Ask Pendia: the question-and-answer panel, shown only when the server reports the Care Agent available for this family (the
// controlled demo-family test window). Every answer is labelled as AI-generated, carries the records it came from as links, and
// lists what the records do not contain. Nothing here is stored in the browser.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_LIMITS, type AskResult, type Language } from "@/lib/care-agent/contract";
import { UI_COPY, UNVERIFIED_COPY } from "@/lib/care-agent/copy";
import { useCareAgentConversation } from "@/lib/care-agent/useCareAgent";

function SourceLink({ id, label }: { id: string; label: string }) {
  const [kind, key] = id.split(":");
  if (kind === "visit" && key)
    return (
      <Link to="/visits/$id" params={{ id: key }}>
        {label}
      </Link>
    );
  if (kind === "med" || kind === "dose" || kind === "medchange")
    return <Link to="/meds">{label}</Link>;
  if (kind === "handoff") return <Link to="/handoffs">{label}</Link>;
  if (kind === "shift") return <Link to="/coverage">{label}</Link>;
  return <Link to="/family">{label}</Link>;
}

function Result({ result, language }: { result: AskResult; language: Language }) {
  if (!result.ok) {
    const l = result.language;
    const text =
      result.code === "rate_limited"
        ? UI_COPY[l].rateLimited
        : result.code === "unverified"
          ? UNVERIFIED_COPY[l]
          : UI_COPY[l].error;
    return (
      <p role="alert" className="rounded-xl bg-muted p-4">
        {text}
      </p>
    );
  }
  const c = UI_COPY[result.language ?? language];
  const { answer, sources } = result;
  return (
    <div className="rounded-2xl border border-border p-4" lang={result.language}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {c.answerHeading}
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{c.aiBadge}</span>
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
      {!answer.refusal && (
        <>
          <h4 className="mt-4 text-sm font-bold">{c.sourcesHeading}</h4>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">{c.noSources}</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {sources.map((s) => (
                <li key={s.id}>
                  <SourceLink id={s.id} label={s.label} />
                </li>
              ))}
            </ul>
          )}
          {answer.missing.length > 0 && (
            <>
              <h4 className="mt-4 text-sm font-bold">{c.missingHeading}</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {answer.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{c.footer}</p>
    </div>
  );
}

export function CareAgentPanel({ familyId, language }: { familyId: string; language: Language }) {
  const c = UI_COPY[language];
  const { turns, pending, ask, cancel } = useCareAgentConversation(familyId);
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const tooLong = text.length > AGENT_LIMITS.questionMax;
  const canAsk = trimmed.length > 0 && !tooLong && pending === null;
  const submit = () => {
    if (!canAsk) return;
    setText("");
    void ask(trimmed);
  };
  return (
    <section aria-label="Ask Pendia" className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl bg-muted p-4 text-sm leading-relaxed">
        <Bot className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> {c.demoBanner}
      </p>
      <ul className="space-y-6" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">{c.youSaid}:</span> {t.question}
            </p>
            <Result result={t.result} language={language} />
          </li>
        ))}
        {pending !== null && (
          <li className="space-y-2" role="status">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">{c.youSaid}:</span> {pending}
            </p>
            <p>{c.asking}</p>
            <Button variant="outline" onClick={cancel}>
              {c.cancel}
            </Button>
          </li>
        )}
      </ul>
      <div>
        <label htmlFor="ask-question" className="mb-2 block font-semibold">
          {c.questionLabel}
        </label>
        <Textarea
          id="ask-question"
          value={text}
          maxLength={AGENT_LIMITS.questionMax + 200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          aria-describedby="ask-count"
          rows={3}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span id="ask-count" className={tooLong ? "font-semibold text-destructive" : undefined}>
            {text.length}/{AGENT_LIMITS.questionMax}
          </span>
        </div>
        <Button className="mt-3" onClick={submit} disabled={!canAsk}>
          {pending !== null ? c.asking : c.ask}
        </Button>
      </div>
      {turns.length === 0 && pending === null && (
        <div>
          <p className="mb-2 text-sm font-bold">{c.exampleHeading}</p>
          <ul className="flex flex-wrap gap-2">
            {c.examples.map((ex) => (
              <li key={ex}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal py-2"
                  onClick={() => setText(ex)}
                >
                  {ex}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
