// Upload an appointment letter -> store privately -> (optionally) read it -> the caregiver reviews and corrects -> only then save.
// Nothing becomes an appointment until the caregiver presses the submit button on the review form. If reading fails or is switched
// off, the same form is shown empty (manual entry) and the uploaded document stays attached. Cancelling removes the upload.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";
import { AppointmentForm, type FormPrefill, type HintState } from "@/components/AppointmentForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppointmentInput, Appointment } from "@/lib/appointments";
import {
  FILE_ERROR_COPY,
  SIMULATED_NOTICE,
  toDraft,
  validateFile,
  type Draft,
  type DocKind,
  type Extraction,
} from "@/lib/doc-upload/contract";
import type { PageImage } from "@/lib/doc-upload/prompt";
import { documentService as realDocs } from "@/services/documents";

export type ExtractOutcome =
  | { ok: true; source: "meta" | "simulated"; extraction: Extraction; timeZone: string }
  | { ok: false; code: string };
export type StatusOutcome = { mode: "live" | "simulated" | "off"; state: string };

export interface FlowDeps {
  documents: Pick<typeof realDocs, "uploadPending" | "remove" | "sweepAbandoned">;
  status: (familyId: string) => Promise<StatusOutcome>;
  render: (file: Blob, kind: DocKind) => Promise<PageImage[]>;
  extract: (input: {
    familyId: string;
    path: string;
    pages: PageImage[];
  }) => Promise<ExtractOutcome>;
  save: (familyId: string, input: AppointmentInput) => Promise<{ id: string }>;
  listForSweep: (familyId: string) => Promise<Array<Pick<Appointment, "document_path">>>;
}

const REASON: Record<string, string> = {
  not_enabled: "Automatic reading isn't switched on.",
  not_demo_family: "Automatic reading is only available for demo families right now.",
  not_a_letter: "That doesn't look like an appointment letter.",
  unreadable: "We couldn't read details from that document.",
  provider_error: "The reading service didn't respond.",
  rate_limited: "Too many documents were read recently.",
  bad_input: "The pages couldn't be prepared for reading.",
  render_failed: "The pages couldn't be prepared for reading.",
};

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type Step =
  | { s: "choose"; error?: string | undefined }
  | { s: "working"; label: string }
  | {
      s: "review";
      path: string;
      /** The file the caregiver chose, shown so the stored upload is visible and openable. */
      file: { name: string; size: number; kind: DocKind };
      draft: Draft | null;
      notice: string;
      timeZone: string;
    };

export function DocumentUploadFlow({
  familyId,
  timeZone,
  canWrite,
  others,
  deps,
  onDone,
  onCancel,
}: {
  familyId: string;
  timeZone: string;
  canWrite: boolean;
  others: Appointment[];
  deps: FlowDeps;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>({ s: "choose" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["doc-extract-status", familyId],
    queryFn: () => deps.status(familyId),
    enabled: canWrite,
    retry: 1,
    staleTime: 0,
    gcTime: 0,
  });

  // Clean up this family's old, unattached uploads (closed tabs, crashes). Best effort; never blocks the page.
  useEffect(() => {
    if (!canWrite) return;
    let live = true;
    void (async () => {
      try {
        const rows = await deps.listForSweep(familyId);
        if (!live) return;
        const referenced = new Set(
          rows.map((r) => r.document_path).filter((p): p is string => !!p),
        );
        await deps.documents.sweepAbandoned(familyId, referenced);
      } catch {
        /* a failed sweep must never affect the caregiver */
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, canWrite]);

  if (!canWrite)
    return <p className="text-muted-foreground">Only the organizer can add appointments.</p>;

  async function onFile(file: File | undefined) {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = validateFile({ size: file.size, claimedMime: file.type, head });
    if (!check.ok) return setStep({ s: "choose", error: FILE_ERROR_COPY[check.code] });

    const stored = { name: file.name, size: file.size, kind: check.kind };
    setStep({ s: "working", label: "Storing your document privately…" });
    let path: string;
    try {
      path = await deps.documents.uploadPending(familyId, file, check.kind);
    } catch {
      return setStep({
        s: "choose",
        error:
          "We couldn't store that document. Nothing was saved. You can try again or add the appointment by hand.",
      });
    }

    // the availability check may still be loading when a file is picked: ask again rather than assume "off"
    let current = status;
    if (!current) {
      try {
        current = await deps.status(familyId);
      } catch {
        current = undefined;
      }
    }
    const mode = current?.mode ?? "off";
    if (mode === "off") {
      return setStep({
        s: "review",
        path,
        file: stored,
        draft: null,
        timeZone,
        notice: `${REASON["not_enabled"]} Your document is saved; enter the details below.`,
      });
    }
    setStep({ s: "working", label: "Reading your document…" });
    let pages: PageImage[];
    try {
      pages = await deps.render(file, check.kind);
    } catch {
      return setStep({
        s: "review",
        path,
        file: stored,
        draft: null,
        timeZone,
        notice: `${REASON["render_failed"]} Your document is saved; enter the details below.`,
      });
    }
    let out: ExtractOutcome;
    try {
      out = await deps.extract({ familyId, path, pages });
    } catch {
      out = { ok: false, code: "provider_error" };
    }
    if (!out.ok)
      return setStep({
        s: "review",
        path,
        file: stored,
        draft: null,
        timeZone,
        notice: `${REASON[out.code] ?? "We couldn't read that document."} Your document is saved; enter the details below.`,
      });
    const draft = toDraft(out.extraction, out.source, out.timeZone);
    setStep({
      s: "review",
      path,
      file: stored,
      draft,
      timeZone: out.timeZone,
      notice:
        out.source === "simulated"
          ? SIMULATED_NOTICE
          : "Read by AI (Meta Muse Spark). It can be wrong or incomplete: check every field against the document before saving.",
    });
  }

  async function discard(path: string) {
    await deps.documents.remove(path); // best effort; anything left is swept after 24 hours
    setStep({ s: "choose" });
    onCancel();
  }

  async function submit(path: string, input: AppointmentInput) {
    setSaving(true);
    setSaveError(null);
    try {
      const row = await deps.save(familyId, { ...input, document_path: path });
      onDone(row.id);
    } catch (e) {
      // The document stays stored so the caregiver can retry; nothing was added to the schedule.
      setSaveError(
        `${(e as Error).message || "The appointment couldn't be saved."} Your document is still stored.`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (step.s === "working")
    return (
      <p role="status" className="rounded-xl bg-muted p-4">
        {step.label}
      </p>
    );

  if (step.s === "review") {
    const d = step.draft;
    const prefill: FormPrefill | undefined = d ? d.fields : undefined;
    const hints:
      Partial<Record<"start" | "provider" | "address" | "notes", HintState>> | undefined = d
      ? d.states
      : undefined;
    return (
      <div className="space-y-4">
        <section
          aria-label="Uploaded document"
          className="space-y-2 rounded-2xl border bg-card p-4 shadow-card"
          data-testid="uploaded-document"
        >
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Uploaded document
          </p>
          <p className="break-all text-lg font-semibold" data-testid="uploaded-document-name">
            {step.file.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {step.file.kind === "pdf"
              ? "PDF"
              : step.file.kind === "jpeg"
                ? "JPG image"
                : "PNG image"}{" "}
            · {formatSize(step.file.size)} · stored privately. It is attached to the appointment
            when you press "Add appointment" below, and removed if you cancel.
          </p>
          <AppointmentDocumentLink path={step.path} label="View uploaded document" />
        </section>
        <p role="status" className="flex gap-3 rounded-xl bg-muted p-4" data-testid="doc-notice">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden /> <span>{step.notice}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing is added to the schedule until you press the button below.
        </p>
        <AppointmentForm
          timeZone={step.timeZone}
          others={others}
          busy={saving}
          error={saveError}
          submitLabel="Add appointment"
          prefill={prefill}
          hints={hints}
          onSubmit={(input) => void submit(step.path, input)}
          onCancel={() => void discard(step.path)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <label htmlFor="doc-file" className="mb-2 block text-base font-semibold">
          Appointment letter (PDF, JPG or PNG, up to 10 MB)
        </label>
        <Input
          id="doc-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="h-auto py-3 text-base"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          Your document is stored privately and only family members who can see appointments can
          open it.
          {status?.mode === "live" &&
            " To read it, the pages are sent to Meta's Muse Spark AI. Use fictional letters only while this is in testing."}
          {status?.mode === "simulated" &&
            " Reading is simulated for testing: example text will be shown, not your document's."}
          {(!status || status.mode === "off") &&
            " Automatic reading is not switched on, so you will enter the details yourself."}
        </p>
        {step.error && (
          <p role="alert" className="mt-3 rounded-xl bg-warning p-3 text-warning-foreground">
            {step.error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
