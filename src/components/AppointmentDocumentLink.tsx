import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentService } from "@/services/documents";

/** Opens the uploaded letter through a 5-minute signed link, fetched only when asked. Storage RLS decides who can get one. */
export function AppointmentDocumentLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const url = await documentService.signedUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Button type="button" variant="outline" onClick={open} disabled={busy}>
        <FileText /> {busy ? "Opening…" : "View document"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-warning-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
