// Class-free accessible-tree snapshots of the Document Upload components, one per state, driven through the same fakes the existing
// Document Upload tests use (no network, no storage). They are the structural half of the redesign safety net: shared tokens and
// shared components may change how these screens LOOK, but their roles, names, text, states and behaviour must not change.
// The visual half runs in a real browser (scripts/visual/specs/doc-upload.spec.ts). The existing functional tests are untouched.
//
// If a snapshot differs, the Document Upload structure changed. Do not "update" it as part of a visual PR; that would hide the very
// drift this test exists to catch.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const signedUrl = vi.fn();
vi.mock("@/services/documents", () => ({
  DOC_SIGNED_URL_TTL_SECONDS: 300,
  documentService: { signedUrl: (p: string) => signedUrl(p) },
}));
vi.mock("@/lib/doc-upload/render-pages", () => ({ renderPages: async () => [] }));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";
import { DocumentUploadFlow, type FlowDeps } from "@/components/DocumentUploadFlow";
import { SIMULATED_EXTRACTION } from "@/lib/doc-upload/contract";
import { a11yTree } from "./a11y-tree";
import { FAM_A, JPEG_PAGE, PATH_A } from "./doc-upload-helpers";

afterEach(() => {
  cleanup();
  signedUrl.mockReset();
});

// jsdom lacks File.slice().arrayBuffer; same minimal shim the existing flow test uses.
(Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.readAsArrayBuffer(this);
  });
};

const PDF = new File(
  [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0])],
  "letter.pdf",
  { type: "application/pdf" },
);
const TXT = new File([new Uint8Array([0x68, 0x69, 0, 0])], "note.txt", { type: "text/plain" });
const BIG = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.pdf", {
  type: "application/pdf",
});

function deps(
  over: Partial<{
    mode: "live" | "simulated" | "off";
    upload: "ok" | "fail";
    extract: "ok" | "fail";
    save: "ok" | "fail";
  }> = {},
): FlowDeps {
  const o = {
    mode: "simulated" as const,
    upload: "ok" as const,
    extract: "ok" as const,
    save: "ok" as const,
    ...over,
  };
  return {
    documents: {
      uploadPending: async () => {
        if (o.upload === "fail") throw new Error("x");
        return PATH_A;
      },
      remove: async () => true,
      sweepAbandoned: async () => [],
    },
    status: async () => ({ mode: o.mode, state: o.mode === "off" ? "not_enabled" : "available" }),
    render: async () => [JPEG_PAGE],
    extract: async () =>
      o.extract === "fail"
        ? { ok: false as const, code: "unreadable" }
        : {
            ok: true as const,
            source: o.mode === "live" ? ("meta" as const) : ("simulated" as const),
            extraction: SIMULATED_EXTRACTION,
            timeZone: "America/Chicago",
          },
    save: async () => {
      if (o.save === "fail") throw new Error("The appointment couldn't be saved.");
      return { id: "new-visit" };
    },
    listForSweep: async () => [],
  };
}

function mountFlow(d: FlowDeps, canWrite = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentUploadFlow
        familyId={FAM_A}
        timeZone="America/Chicago"
        canWrite={canWrite}
        others={[]}
        deps={d}
        onDone={() => undefined}
        onCancel={() => undefined}
      />
    </QueryClientProvider>,
  );
}
const pick = async (file: File) => {
  const input = await screen.findByLabelText(/Appointment letter/);
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};
const snap = (name: string, c: HTMLElement) =>
  expect(a11yTree(c)).toMatchFileSnapshot(`./__snapshots__/doc-upload-a11y/${name}.txt`);

describe("DocumentUploadFlow: accessible tree per state", () => {
  it("choose a file", async () => {
    const { container } = mountFlow(deps());
    await screen.findByLabelText(/Appointment letter/);
    await snap("flow-choose", container);
  });
  it("member without upload permission", async () => {
    const { container } = mountFlow(deps(), false);
    await snap("flow-read-only-member", container);
  });
  it("unsupported file type", async () => {
    const { container } = mountFlow(deps());
    await pick(TXT);
    await screen.findByText(/PDF, JPG and PNG files only/);
    await snap("flow-unsupported-file", container);
  });
  it("oversize file", async () => {
    const { container } = mountFlow(deps());
    await pick(BIG);
    await screen.findByText(/larger than 10 MB/);
    await snap("flow-oversize-file", container);
  });
  it("upload failure", async () => {
    const { container } = mountFlow(deps({ upload: "fail" }));
    await pick(PDF);
    await screen.findByText(/couldn't store that document/);
    await snap("flow-upload-failure", container);
  });
  it("review with simulated sample", async () => {
    const { container } = mountFlow(deps());
    await pick(PDF);
    await screen.findByRole("button", { name: /Add appointment/ });
    await snap("flow-review-simulated", container);
  });
  it("review with the reading notice", async () => {
    const { container } = mountFlow(deps({ mode: "live" }));
    await pick(PDF);
    await screen.findByText(/Read by AI/);
    await snap("flow-review-reading-notice", container);
  });
  it("review as manual entry (reading switched off)", async () => {
    const { container } = mountFlow(deps({ mode: "off" }));
    await pick(PDF);
    await screen.findByText(/enter the details below/);
    await snap("flow-review-manual-entry", container);
  });
  it("extraction failure falls back to manual entry", async () => {
    const { container } = mountFlow(deps({ mode: "live", extract: "fail" }));
    await pick(PDF);
    await screen.findByText(/couldn't read details/);
    await snap("flow-extraction-failure", container);
  });
  it("save failure keeps the form and the document", async () => {
    const { container } = mountFlow(deps({ save: "fail" }));
    await pick(PDF);
    fireEvent.click(await screen.findByRole("button", { name: /Add appointment/ }));
    await screen.findByText(/couldn't be saved/);
    await snap("flow-save-failure", container);
  });
});

describe("AppointmentDocumentLink: accessible tree per state", () => {
  it("idle", async () => {
    const { container } = render(<AppointmentDocumentLink path={PATH_A} />);
    await snap("link-idle", container);
  });
  it("ready (open, download, preview offered; the signed link is never shown)", async () => {
    signedUrl.mockResolvedValue("https://signed.example/doc?token=t");
    const { container } = render(<AppointmentDocumentLink path={PATH_A} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /View/ }));
    });
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Open in new tab/ })).toBeInTheDocument(),
    );
    await snap("link-ready", container);
  });
  it("error", async () => {
    signedUrl.mockRejectedValue(new Error("nope"));
    const { container } = render(<AppointmentDocumentLink path={PATH_A} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /View/ }));
    });
    await screen.findByRole("alert");
    await snap("link-error", container);
  });
});
