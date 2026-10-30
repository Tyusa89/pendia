import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentService } from "@/services/documents";

/**
 * Opens the uploaded letter through a short-lived (5 minute) signed link, fetched only when asked. Storage RLS decides who can get one.
 * A tab is opened synchronously on the click (so pop-up blockers allow it) and pointed at the link once it arrives; if the browser
 * still blocks it, a plain link is shown so the document can always be opened with a second tap.
 */
export function AppointmentDocumentLink({
  path,
  label = "View document",
}: {
  path: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    setFallback(null);
    const tab = window.open("", "_blank");
    try {
      const url = await documentService.signedUrl(path);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else setFallback(url);
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={open} disabled={busy}>
        <FileText /> {busy ? "Opening…" : label}
      </Button>
      {fallback && (
        <p className="text-sm">
          <a
            href={fallback}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline"
          >
            Your browser blocked the new tab. Open the document here{" "}
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-warning-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
