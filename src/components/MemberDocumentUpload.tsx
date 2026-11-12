import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/AppShell";
import { FILE_ERROR_COPY, validateFile } from "@/lib/doc-upload/contract";
import { documentService } from "@/services/documents";

type Docs = Pick<typeof documentService, "uploadPending">;

/**
 * Upload-only screen for a family member an organizer has allowed to upload appointment documents. The document is stored privately
 * and waits for an organizer, who reads it and saves the appointment. Nothing is read by AI here and no appointment is created.
 */
export function MemberDocumentUpload({ familyId, documents = documentService }: { familyId: string; documents?: Docs }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = validateFile({ size: file.size, claimedMime: file.type, head });
    if (!check.ok) return setError(FILE_ERROR_COPY[check.code]);
    setBusy(true);
    try {
      await documents.uploadPending(familyId, file, check.kind);
      setSent((s) => [file.name, ...s]);
    } catch {
      setError("We couldn't store that document. Nothing was saved. You can try again; if it keeps failing, ask an organizer whether your upload permission is still on.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Panel aria-label="Upload a document for the organizers" className="space-y-4">
      <h2 className="text-xl">Send an appointment letter</h2>
      <p className="text-muted-foreground">
        Upload a PDF, JPG or PNG (up to 10 MB). It is stored privately. An organizer will look at it and add the appointment. You can't
        open it again from here.
      </p>
      <div className="space-y-2">
        <label htmlFor="member-doc" className="block font-semibold">Appointment letter</label>
        <input
          id="member-doc"
          ref={input}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="block w-full text-base"
        />
      </div>
      {busy && <p role="status">Storing your document privately…</p>}
      {error && <p role="alert" className="font-semibold text-destructive">{error}</p>}
      {sent.length > 0 && (
        <div role="status" className="rounded-2xl bg-secondary p-4 text-secondary-foreground">
          <p className="flex items-center gap-2 font-bold"><FileUp className="size-4" aria-hidden /> Sent to the organizers</p>
          <ul className="mt-1 list-disc pl-5">{sent.map((n, i) => <li key={`${n}-${i}`} className="break-words">{n}</li>)}</ul>
        </div>
      )}
      <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy}>Choose another file</Button>
    </Panel>
  );
}
