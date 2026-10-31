import { useEffect, useRef, useState } from "react";
import { Download, Eye, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { docFileName, type DocKind } from "@/lib/doc-upload/contract";
import { renderPages } from "@/lib/doc-upload/render-pages";
import { DOC_SIGNED_URL_TTL_SECONDS, documentService } from "@/services/documents";

/** Fixed messages only: a browser, network or storage error is never shown, because it can carry the signed link and its access token. */
const COULD_NOT_OPEN = "Couldn't open the document. Please try again.";
const COULD_NOT_DOWNLOAD =
  "Couldn't download the document here. Use “Open in new tab”, or open Pendia in its own browser tab and try again.";

const COULD_NOT_PREVIEW =
  "Couldn't show a preview here. Use Download or “Open in new tab” instead.";
const kindOf = (path: string): DocKind =>
  /\.pdf$/i.test(path) ? "pdf" : /\.png$/i.test(path) ? "png" : "jpeg";

/** Hide the actions a little before the 5-minute link expires, so a dead link is never offered. */
const HIDE_AFTER_MS = (DOC_SIGNED_URL_TTL_SECONDS - 30) * 1000;

/**
 * View or download the uploaded letter through a short-lived signed link that is fetched only when asked. Storage RLS decides who
 * can get one.
 *
 * Why two steps: a page embedded in a sandboxed preview frame is not allowed to script a new tab (open a blank tab, then set its
 * location): the browser refuses the navigation and leaves a blank tab. So the click only fetches the link; opening is then a plain
 * user click on a real link (`target="_blank"`), and Download fetches the file and saves it from this page, which needs no new tab.
 * The signed link is kept in memory only, never shown as text, and dropped when it is about to expire.
 */
export function AppointmentDocumentLink({
  path,
  label = "View document",
}: {
  path: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function prepare() {
    setBusy(true);
    setError(null);
    setUrl(null);
    setPreview(null);
    if (timer.current) clearTimeout(timer.current);
    try {
      const signed = await documentService.signedUrl(path);
      if (!mounted.current) return;
      setUrl(signed);
      timer.current = setTimeout(() => {
        setUrl(null);
        setPreview(null);
      }, HIDE_AFTER_MS);
    } catch {
      if (mounted.current) setError(COULD_NOT_OPEN);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  /** Shows the document right here (first pages as images). No new tab, no download: works inside any sandboxed preview frame. */
  async function showPreview() {
    if (!url) return;
    setError(null);
    setPreviewing(true);
    try {
      const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error("preview_failed");
      const pages = await renderPages(await res.blob(), kindOf(path));
      if (mounted.current) setPreview(pages.map((pg) => `data:${pg.mime};base64,${pg.base64}`));
    } catch {
      if (mounted.current) setError(COULD_NOT_PREVIEW);
    } finally {
      if (mounted.current) setPreviewing(false);
    }
  }

  async function download() {
    if (!url) return;
    setError(null);
    try {
      const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error("download_failed");
      const objectUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = docFileName(path);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      if (mounted.current) setError(COULD_NOT_DOWNLOAD);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={prepare} disabled={busy}>
        <FileText /> {busy ? "Opening…" : label}
      </Button>
      {url && (
        <div className="flex flex-wrap items-center gap-2" data-testid="document-actions">
          <Button asChild variant="default">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open in new tab
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void showPreview()}
            disabled={previewing}
          >
            <Eye /> {previewing ? "Preparing…" : "Preview here"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void download()}>
            <Download /> Download
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            {docFileName(path)} · this private link works for a few minutes.
          </p>
        </div>
      )}
      {preview && (
        <div className="space-y-3" data-testid="document-preview">
          {preview.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`${docFileName(path)}, page ${i + 1}`}
              className="max-w-full rounded-lg border"
            />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-warning-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
