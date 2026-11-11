// Document Upload in a real browser: the REAL DocumentUploadFlow and AppointmentDocumentLink (unchanged) rendered by the harness with
// fake storage/extraction services. Each state is driven through the real file input, then checked for functional behaviour, layout,
// accessibility and a screenshot. Complements the existing Vitest suites (which stay as they are) and the class-free accessible
// snapshots in src/test/redesign-doc-upload-a11y.test.tsx.
//
// These checks run before and after every shared-token, component and shell change, so a redesign cannot silently break the page
// while only its appearance is meant to change.
import path from "node:path";
import type { Page } from "@playwright/test";
import { axeCounts, collectLayout, settle } from "../support/invariants.ts";
import { checkCount, checkCounts } from "../support/ratchet.ts";
import { HARNESS_PORT } from "../support/env.ts";
import { expect, test } from "../support/test.ts";

const HARNESS = `http://127.0.0.1:${HARNESS_PORT}/`;
const WIDTHS = [320, 390, 820, 1440] as const;
const OUT = path.resolve(
  process.cwd(),
  "visual-artifacts",
  process.env["CAPTURE_LABEL"] ?? "before",
  "doc-upload",
);

// Synthetic files only (valid magic bytes, no content).
const pdf = {
  name: "appointment-letter.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(32)]),
};
const txt = { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") };
const big = {
  name: "huge.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024)]),
};

type File = { name: string; mimeType: string; buffer: Buffer };
const pick = (page: Page, file: File) => page.getByLabel(/Appointment letter/).setInputFiles(file);

interface Scenario {
  id: string;
  query: string;
  run: (page: Page) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    id: "choose",
    query: "kind=flow",
    run: async (p) => {
      await expect(p.getByLabel(/Appointment letter/)).toBeVisible();
    },
  },
  {
    id: "read-only-member",
    query: "kind=flow&write=0",
    run: async (p) => {
      await expect(p.getByText(/Only the organizer/)).toBeVisible();
      await expect(p.getByLabel(/Appointment letter/)).toHaveCount(0);
    },
  },
  {
    id: "unsupported-file",
    query: "kind=flow",
    run: async (p) => {
      await pick(p, txt);
      await expect(p.getByText(/PDF, JPG and PNG files only/)).toBeVisible();
    },
  },
  {
    id: "oversize-file",
    query: "kind=flow",
    run: async (p) => {
      await pick(p, big);
      await expect(p.getByText(/larger than 10 MB/)).toBeVisible();
    },
  },
  {
    id: "upload-failure",
    query: "kind=flow&fail=upload",
    run: async (p) => {
      await pick(p, pdf);
      await expect(p.getByText(/couldn't store that document/)).toBeVisible();
    },
  },
  {
    id: "review-simulated",
    query: "kind=flow&mode=simulated",
    run: async (p) => {
      await pick(p, pdf);
      await expect(p.getByRole("button", { name: /Add appointment/ })).toBeVisible();
      await expect(p.getByRole("button", { name: /View uploaded document/ })).toBeVisible();
    },
  },
  {
    id: "review-reading-notice",
    query: "kind=flow&mode=meta",
    run: async (p) => {
      await pick(p, pdf);
      await expect(p.getByText(/Read by AI/)).toBeVisible();
    },
  },
  {
    id: "review-manual-entry",
    query: "kind=flow&mode=off",
    run: async (p) => {
      await pick(p, pdf);
      await expect(p.getByText(/enter the details below/)).toBeVisible();
    },
  },
  {
    id: "extraction-failure",
    query: "kind=flow&mode=meta&fail=extract",
    run: async (p) => {
      await pick(p, pdf);
      await expect(p.getByText(/couldn't read details/)).toBeVisible();
    },
  },
  {
    id: "save-failure",
    query: "kind=flow&mode=simulated&fail=save",
    run: async (p) => {
      await pick(p, pdf);
      await p.getByRole("button", { name: /Add appointment/ }).click();
      await expect(p.getByText(/couldn't be saved/)).toBeVisible();
    },
  },
  {
    id: "link-idle",
    query: "kind=link",
    run: async (p) => {
      await expect(p.getByRole("button", { name: /View/ })).toBeVisible();
    },
  },
  {
    id: "link-ready",
    query: "kind=link",
    run: async (p) => {
      await p.getByRole("button", { name: /View/ }).click();
      await expect(p.getByRole("link", { name: /Open in new tab/ })).toBeVisible();
      await expect(p.getByRole("button", { name: /Download/ })).toBeVisible();
    },
  },
  {
    id: "link-preview",
    query: "kind=link",
    run: async (p) => {
      await p.getByRole("button", { name: /View/ }).click();
      await p.getByRole("button", { name: /Preview here/ }).click();
      await expect(p.getByTestId("document-preview").getByRole("img")).toBeVisible();
    },
  },
  {
    id: "link-error",
    query: "kind=link&sign=fail",
    run: async (p) => {
      await p.getByRole("button", { name: /View/ }).click();
      await expect(p.getByRole("alert")).toBeVisible();
    },
  },
];

for (const s of SCENARIOS) {
  for (const w of WIDTHS) {
    test(`${s.id} @${w}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${HARNESS}?${s.query}`, { waitUntil: "networkidle" });
      await s.run(page);
      await settle(page);
      const f = await collectLayout(page);
      expect(errors, "uncaught page errors").toEqual([]);
      const key = `${s.id}@${w}`;
      checkCount("doc-overflow", key, f.overflowX, "horizontal overflow in px");
      checkCount("doc-target-sizes", key, f.smallTargets.length, f.smallTargets.join(" | "));
      checkCount("doc-clipped-text", key, f.clipped.length, f.clipped.join(" | "));
      checkCounts("doc-axe", key, await axeCounts(page));
      await page.screenshot({ path: path.join(OUT, `${s.id}-${w}.png`), fullPage: true });
    });
  }
}
