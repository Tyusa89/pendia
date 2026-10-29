// Browser-side preparation of a validated file for the extractor: images are downscaled and re-encoded as JPEG; PDFs are rendered
// page by page (at most DOC_MAX_PAGES) with pdf.js. Nothing is uploaded from here and nothing is stored. Untested in jsdom (needs a
// real canvas); the pure pieces it relies on are covered by contract tests.
import { DOC_MAX_PAGES, PAGE_IMAGE_MAX_BYTES, type DocKind } from "./contract";
import type { PageImage } from "./prompt";

const MAX_SIDE = 1600;

async function canvasToJpegBase64(canvas: HTMLCanvasElement): Promise<string> {
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= PAGE_IMAGE_MAX_BYTES) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000)
        s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }
  }
  throw new Error("page_too_large");
}

function scaled(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function imagePage(file: Blob): Promise<PageImage> {
  const bmp = await createImageBitmap(file);
  const { w, h } = scaled(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { mime: "image/jpeg", base64: await canvasToJpegBase64(canvas) };
}

async function pdfPages(file: Blob): Promise<PageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: PageImage[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, DOC_MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const k = Math.min(2, MAX_SIDE / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale: k });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ mime: "image/jpeg", base64: await canvasToJpegBase64(canvas) });
  }
  return out;
}

export async function renderPages(file: Blob, kind: DocKind): Promise<PageImage[]> {
  return kind === "pdf" ? pdfPages(file) : [await imagePage(file)];
}
