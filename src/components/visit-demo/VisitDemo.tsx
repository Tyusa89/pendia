import { FollowThrough } from "@/components/visit-demo/FollowThrough";
import { ReviewItems } from "@/components/visit-demo/ReviewItems";
import { WrapUp } from "@/components/visit-demo/WrapUp";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { FileText, Mic, RotateCcw, ShieldCheck, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, DemoBanner, StepHeading, StepIndicator } from "@/components/visit-demo/parts";
import { formatTimestamp } from "@/lib/format";
import {
  allRevealed,
  confirmedTasks,
  initialState,
  reducer,
  type Action,
  rolesComplete,
  speakerLabels,
  type RoleChoice,
  type DemoState,
} from "@/lib/visit-demo/state";
import { taskAssignmentText } from "@/lib/visit-demo/messages";
import {
  buildRestoredState,
  clearDemoState,
  loadDemoState,
  needsExtraction,
  needsTranscript,
  saveDemoState,
  type PersistedDemo,
} from "@/lib/visit-demo/persist";
import { useReducedMotion } from "@/lib/visit-demo/use-reduced-motion";
import { getVisitPipeline, simulatedReply } from "@/lib/visit-pipeline";
import { DEMO_DOCTOR, DEMO_PATIENT, DEMO_SPEAKER_SUGGESTION } from "@/lib/visit-pipeline/fixture";
import { NOT_MEDICAL_ADVICE, provenanceLabel } from "@/lib/visit-pipeline/labels";
import type {
  Delivery,
  SpeakerMap,
  SpeakerRole,
  TranscriptSegment,
} from "@/lib/visit-pipeline/types";

/** How much faster than real time the cached visit plays. */
const SPEED = 8;
const ROLE_LABEL: Record<SpeakerRole, string> = {
  doctor: "Doctor",
  patient: "Patient",
  family: "Family member",
  other: "Someone else",
};

/** What a person is called once the family has said who the speakers are. */
function nameFor(label: string, roles: DemoState["roles"], confirmed: boolean): string {
  const role = confirmed ? roles[label] : "";
  if (role === "doctor") return DEMO_DOCTOR;
  if (role === "patient") return DEMO_PATIENT;
  if (role === "family") return "Family member";
  if (role === "other") return "Someone else";
  return `Speaker ${label}`;
}

function Transcript({
  segments,
  shown,
  state,
  live,
}: {
  segments: TranscriptSegment[];
  shown: number;
  state: DemoState;
  live?: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown, live]);
  return (
    <ol
      role="log"
      aria-live={live ? "polite" : "off"}
      aria-label="Transcript of the simulated visit"
      className="space-y-3"
    >
      {segments.slice(0, shown).map((l, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-11 shrink-0 pt-0.5 font-mono text-sm text-muted-foreground">
            {formatTimestamp(l.start_s)}
          </span>
          <div className="min-w-0">
            <p
              className={`text-sm font-bold ${l.speaker === "A" ? "text-primary" : "text-success"}`}
            >
              {nameFor(l.speaker, state.roles, state.speakersConfirmed)}
            </p>
            <p className="text-lg">{l.text}</p>
          </div>
        </li>
      ))}
      <li ref={end} aria-hidden className="h-0" />
    </ol>
  );
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function VisitDemo({ onExit }: { onExit?: () => void }) {
  const pipeline = useMemo(() => getVisitPipeline(), []);
  const [s, rawDispatch] = useReducer(reducer, initialState);
  // "ready" until a saved session is found; then "restoring" until it is rebuilt from the synthetic fixtures.
  const [phase, setPhase] = useState<"ready" | "restoring">("ready");
  const [restored, setRestored] = useState(false);
  const triedRestore = useRef(false);
  const dispatch = useCallback((a: Action) => {
    if (a.type === "reset") clearDemoState(); // Start over is the only thing that clears saved progress
    setRestored(false);
    rawDispatch(a);
  }, []);

  // After an accidental reload or remount, return to the saved step. Runs before the first paint so the first screen is
  // never a misleading Step 1. Everything shown comes from the cached synthetic fixtures; no network is involved.
  useIsoLayoutEffect(() => {
    if (triedRestore.current) return;
    triedRestore.current = true;
    const saved = loadDemoState();
    if (!saved) return;
    setPhase("restoring");
    void restoreFrom(saved);
  }, []);

  async function restoreFrom(p: PersistedDemo) {
    try {
      const transcript = needsTranscript(p)
        ? await pipeline.transcribe.transcribe({ visitId: "demo", keywords: ["Lisinopril"] })
        : null;
      const extraction =
        needsExtraction(p) && transcript
          ? await pipeline.extract.extract({
              transcript,
              speakerMap: { map: p.roles as SpeakerMap, confirmed: true },
            })
          : null;
      const deliveries: Record<string, Delivery> = {};
      for (const task of extraction?.tasks ?? []) {
        const owner = p.owners[task.id];
        if (owner && p.followUps[task.id]?.delivered)
          deliveries[task.id] = await pipeline.notifier.send({
            kind: "task-assignment",
            to: { name: owner },
            body: taskAssignmentText(task, "Maria"),
          });
      }
      const state = buildRestoredState(p, {
        transcript,
        extraction,
        delivery: (id) => deliveries[id]!,
        reply: (owner) => simulatedReply(owner, "DONE"),
      });
      if (state) {
        rawDispatch({ type: "restore", state });
        setRestored(true);
      } else clearDemoState();
    } catch {
      clearDemoState(); // anything unexpected: start fresh rather than show a broken screen
    }
    setPhase("ready");
  }

  // Keep the saved progress current. Waits until any restore has finished so it can't overwrite what it is restoring.
  useEffect(() => {
    if (phase === "ready") saveDemoState(s);
  }, [s, phase]);
  const reduced = useReducedMotion();
  const segments = useMemo(() => s.transcript?.segments ?? [], [s.transcript]);

  // Play the cached visit: each line appears at its (sped-up) time. With reduced motion everything shows at once.
  useEffect(() => {
    if (s.step !== "visit" || !s.playing || !s.transcript) return;
    if (reduced) {
      dispatch({ type: "skipToEnd" });
      return;
    }
    if (allRevealed(s)) return;
    const prev = s.revealed === 0 ? 0 : segments[s.revealed - 1]!.start_s;
    const next = segments[s.revealed]!.start_s;
    const t = setTimeout(
      () => dispatch({ type: "reveal" }),
      s.revealed === 0 ? 300 : ((next - prev) / SPEED) * 1000,
    );
    return () => clearTimeout(t);
  }, [s, reduced, segments, dispatch]);

  // Entering the follow-up step: ask the (simulated) notifier to prepare each message. It never sends anything.
  useEffect(() => {
    if (s.step !== "followup") return;
    for (const t of confirmedTasks(s)) {
      if (s.followUps[t.id]?.delivery) continue;
      const to = s.owners[t.id]!;
      pipeline.notifier
        .send({ kind: "task-assignment", to: { name: to }, body: taskAssignmentText(t, "Maria") })
        .then((delivery) => dispatch({ type: "deliveryReady", taskId: t.id, delivery }))
        .catch((e: Error) => dispatch({ type: "failed", message: e.message }));
    }
  }, [s, pipeline, dispatch]);

  const startVisit = useCallback(() => {
    dispatch({ type: "startVisit" });
    pipeline.transcribe
      .transcribe({ visitId: "demo", keywords: ["Lisinopril"] })
      .then((transcript) =>
        dispatch({ type: "transcriptLoaded", transcript, suggestion: DEMO_SPEAKER_SUGGESTION }),
      )
      .catch((e: Error) => dispatch({ type: "failed", message: e.message }));
  }, [pipeline, dispatch]);

  const confirmSpeakers = useCallback(() => {
    if (!s.transcript || !rolesComplete(s)) return;
    dispatch({ type: "confirmSpeakers" });
    const map = s.roles as SpeakerMap;
    pipeline.extract
      .extract({ transcript: s.transcript, speakerMap: { map, confirmed: true } })
      .then((extraction) => dispatch({ type: "extractionLoaded", extraction, rejected: [] }))
      .catch((e: Error) => dispatch({ type: "failed", message: e.message }));
  }, [pipeline, s, dispatch]);

  const reset = () => {
    dispatch({ type: "reset" });
    onExit?.();
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <DemoBanner />
      <StepIndicator step={s.step} />
      {restored && (
        <p role="status" className="rounded-xl bg-muted p-3 font-semibold">
          Restored where you left off.
          {s.step === "visit" ? " Playback is paused: press Play to continue." : ""}
        </p>
      )}
      {s.error && (
        <p role="alert" className="rounded-xl bg-warning p-4 font-semibold text-warning-foreground">
          {s.error}
        </p>
      )}

      {phase === "restoring" && (
        <Card className="space-y-2" label="Restoring">
          <p role="status" aria-busy="true" className="text-lg font-semibold">
            Restoring your demo…
          </p>
        </Card>
      )}

      {phase === "ready" && s.step === "intro" && (
        <Card className="space-y-4">
          <StepHeading id="intro">See how Pendia handles a doctor visit</StepHeading>
          <p className="text-lg leading-relaxed">
            This walks through a simulated visit between {DEMO_DOCTOR} and {DEMO_PATIENT}. The
            conversation is a prerecorded synthetic example, not a real patient. Nothing is sent to
            an AI service, nothing is texted to anyone, and nothing is saved.
          </p>
          <p className="text-muted-foreground">
            In the real app, a family would see the same steps with their own visit: consent, a
            diarized transcript, confirming who spoke, and a summary they review before anything is
            acted on.
          </p>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => dispatch({ type: "begin" })}
          >
            Start a simulated doctor visit
          </Button>
        </Card>
      )}

      {s.step === "consent" && (
        <Card className="space-y-4">
          <StepHeading id="consent">Consent comes first</StepHeading>
          <p className="text-lg leading-relaxed">
            In a real visit, Pendia asks everyone present for permission before it records anything.
            Here, the "recording" is a prerecorded example: this demo never uses your microphone.
          </p>
          <label className="flex min-h-12 items-start gap-3 rounded-xl bg-muted p-4 text-lg">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={s.consent}
              onChange={(e) => dispatch({ type: "setConsent", value: e.target.checked })}
            />
            <span>
              Everyone in this simulated visit has agreed to be recorded. (Pretend consent: no audio
              is captured.)
            </span>
          </label>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={!s.consent || s.busy}
            onClick={startVisit}
          >
            <Mic /> {s.busy ? "Starting…" : "Start the simulated visit"}
          </Button>
        </Card>
      )}

      {s.step === "visit" && s.transcript && (
        <Card className="space-y-4">
          <StepHeading id="visit">Simulated visit in progress</StepHeading>
          <p className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-semibold">
            <span
              className={`size-2.5 rounded-full ${s.playing ? "animate-pulse bg-warning-foreground" : "bg-muted-foreground"}`}
              aria-hidden
            />
            Prerecorded example · no audio is being captured
          </p>
          <Transcript segments={segments} shown={s.revealed} state={s} live />
          <div className="flex flex-wrap gap-3">
            {!allRevealed(s) ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => dispatch({ type: "setPlaying", value: !s.playing })}
                >
                  {s.playing ? "Pause" : "Play"}
                </Button>
                <Button variant="outline" onClick={() => dispatch({ type: "skipToEnd" })}>
                  <SkipForward /> Skip to the end
                </Button>
              </>
            ) : (
              <Button size="lg" onClick={() => dispatch({ type: "toSpeakers" })}>
                Continue: who was speaking?
              </Button>
            )}
          </div>
        </Card>
      )}

      {s.step === "speakers" && s.transcript && (
        <Card className="space-y-4">
          <StepHeading id="speakers">Who was speaking?</StepHeading>
          <p className="text-lg leading-relaxed">
            The transcript labels voices only as Speaker A and Speaker B. Pendia needs you to say
            who is who before it reads anything for tasks or medication changes. Pendia's suggestion
            is filled in; please check it.
          </p>
          <div className="space-y-3">
            {speakerLabels(s.transcript).map((label) => {
              const first = segments.find((x) => x.speaker === label)!;
              return (
                <div key={label} className="rounded-xl bg-muted p-4">
                  <label htmlFor={`role-${label}`} className="font-bold">
                    Speaker {label}
                  </label>
                  <p className="mt-1 text-muted-foreground">
                    Starts with: "{first.text}" ({formatTimestamp(first.start_s)})
                  </p>
                  <select
                    id={`role-${label}`}
                    className="mt-2 h-12 w-full rounded-md border border-input bg-background px-3 text-lg"
                    value={s.roles[label] ?? ""}
                    disabled={s.busy}
                    onChange={(e) =>
                      dispatch({ type: "setRole", label, role: e.target.value as RoleChoice })
                    }
                  >
                    <option value="">Choose…</option>
                    {(Object.keys(ROLE_LABEL) as SpeakerRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {!rolesComplete(s) && (
            <p className="font-semibold text-warning-foreground">
              Choose a role for every speaker, including who the doctor is.
            </p>
          )}
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={!rolesComplete(s) || s.busy}
            onClick={confirmSpeakers}
          >
            <ShieldCheck /> {s.busy ? "Reading the visit…" : "Yes, this is right"}
          </Button>
        </Card>
      )}

      {s.step === "summary" && s.extraction && s.transcript && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Card className="space-y-3 bg-secondary">
              <StepHeading id="summary">What was said, in plain language</StepHeading>
              <p className="text-lg leading-relaxed">{s.extraction.summary}</p>
              <p className="text-sm font-semibold text-muted-foreground">
                {provenanceLabel(s.extraction.provenance)}
              </p>
            </Card>

            <ReviewItems s={s} dispatch={dispatch} nameFor={(l) => nameFor(l, s.roles, true)} />

            <p className="text-sm font-semibold text-muted-foreground">{NOT_MEDICAL_ADVICE}</p>
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Start over
            </Button>
          </div>

          <Card className="min-w-0 space-y-3" label="Transcript">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="size-5 text-primary" /> Transcript
            </h3>
            <p className="text-sm text-muted-foreground">
              {provenanceLabel(s.transcript.provenance)}
            </p>
            <Transcript segments={segments} shown={segments.length} state={s} />
          </Card>
        </div>
      )}

      {s.step === "followup" && <FollowThrough s={s} dispatch={dispatch} />}
      {s.step === "done" && <WrapUp s={s} dispatch={dispatch} />}
    </div>
  );
}
