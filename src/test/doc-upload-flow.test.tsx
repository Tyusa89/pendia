// Caregiver confirmation, extraction failure and cancellation, with every dependency injected (no network, no storage).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/documents", async (orig) => {
  const actual = await orig<typeof import("@/services/documents")>();
  return {
    ...actual,
    documentService: {
      ...actual.documentService,
      signedUrl: async () => "https://signed.example/doc?token=t",
    },
  };
});
import { DocumentUploadFlow, type FlowDeps } from "@/components/DocumentUploadFlow";
import type { AppointmentInput } from "@/lib/appointments";
import { SIMULATED_EXTRACTION } from "@/lib/doc-upload/contract";
import { FAM_A, JPEG_PAGE, PATH_A } from "./doc-upload-helpers";

afterEach(cleanup);
const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const pdfFile = () => new File([PDF_BYTES], "letter.pdf", { type: "application/pdf" });

function deps(over: Record<string, unknown> = {}) {
  const d = {
    documents: {
      uploadPending: vi.fn(async () => PATH_A),
      remove: vi.fn(async () => true),
      sweepAbandoned: vi.fn(async () => []),
    },
    status: vi.fn(async () => ({ mode: "simulated" as const, state: "available" })),
    render: vi.fn(async () => [JPEG_PAGE]),
    extract: vi.fn(async () => ({
      ok: true as const,
      source: "simulated" as const,
      extraction: SIMULATED_EXTRACTION,
      timeZone: "America/Chicago",
    })),
    save: vi.fn(async (_familyId: string, _input: AppointmentInput) => ({ id: "new-visit" })),
    listForSweep: vi.fn(async () => [{ document_path: null }]),
  };
  return { ...d, ...over } as typeof d;
}
function mount(d: unknown, canWrite = true) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DocumentUploadFlow
        familyId={FAM_A}
        timeZone="America/Chicago"
        canWrite={canWrite}
        others={[]}
        deps={d as FlowDeps}
        onDone={onDone}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { onDone, onCancel };
}
const pick = async (file: File) => {
  const input = await screen.findByLabelText(/Appointment letter/);
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};
// File.slice().arrayBuffer is missing in jsdom 20; give File a minimal one for these tests
(File.prototype as { arrayBuffer?: unknown }).arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.readAsArrayBuffer(this);
  });
};
const hasArrayBuffer = (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer;
(Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.readAsArrayBuffer(this);
  });
};
void hasArrayBuffer;

describe("only organizers can use it", () => {
  it("shows no upload control to a non-organizer and never touches storage", () => {
    const d = deps();
    mount(d, false);
    expect(screen.getByText(/Only the organizer/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Appointment letter/)).toBeNull();
    expect(d.documents.sweepAbandoned).not.toHaveBeenCalled();
  });
});

describe("file validation happens before anything is stored", () => {
  it("rejects a wrong type, a renamed file and an oversize file with no upload", async () => {
    const d = deps();
    mount(d);
    await pick(
      new File([new Uint8Array([0x4d, 0x5a, 0x90, 0])], "x.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByText(/PDF, JPG and PNG files only/)).toBeInTheDocument();
    await pick(
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
        "x.pdf",
        { type: "application/pdf" },
      ),
    );
    expect(await screen.findByText(/contents don't match/)).toBeInTheDocument();
    const big = pdfFile();
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await pick(big);
    expect(await screen.findByText(/larger than 10 MB/)).toBeInTheDocument();
    expect(d.documents.uploadPending).not.toHaveBeenCalled();
  });
  it("a failed upload stores nothing and creates no appointment", async () => {
    const d = deps({
      documents: {
        uploadPending: vi.fn(async () => {
          throw new Error("denied");
        }),
        remove: vi.fn(async () => true),
        sweepAbandoned: vi.fn(async () => []),
      },
    });
    mount(d);
    await pick(pdfFile());
    expect(await screen.findByText(/couldn't store that document/)).toBeInTheDocument();
    expect(d.save).not.toHaveBeenCalled();
    expect(d.extract).not.toHaveBeenCalled();
  });
});

describe("caregiver confirmation", () => {
  it("shows simulated output as SIMULATED, prefilled and tagged, and saves nothing until the button is pressed", async () => {
    const d = deps();
    mount(d);
    await pick(pdfFile());
    expect(await screen.findByTestId("doc-notice")).toHaveTextContent(/Simulated sample/);
    expect(screen.getByLabelText("Doctor or provider")).toHaveValue("Dr. Alma Reyes (fictional)");
    expect(screen.getAllByTestId("hint-extracted").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("hint-unclear").length).toBeGreaterThan(0); // the location is uncertain in the sample
    expect(d.save).not.toHaveBeenCalled();
    expect(d.documents.remove).not.toHaveBeenCalled();
  });
  it("shows the uploaded filename, type, size and an open action as soon as the document is stored", async () => {
    const d = deps();
    mount(d);
    await pick(pdfFile());
    expect(await screen.findByTestId("uploaded-document-name")).toHaveTextContent("letter.pdf");
    expect(screen.getByTestId("uploaded-document")).toHaveTextContent(/PDF/);
    expect(screen.getByTestId("uploaded-document")).toHaveTextContent(/stored privately/);
    expect(screen.getByRole("button", { name: /View uploaded document/ })).toBeInTheDocument();
    expect(d.save).not.toHaveBeenCalled();
  });
  it("a pending (not yet saved) upload can be viewed: clicking the button offers Open in new tab, Download and Preview", async () => {
    const d = deps();
    mount(d);
    await pick(pdfFile());
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /View uploaded document/ }));
    });
    expect(await screen.findByRole("link", { name: /Open in new tab/ })).toHaveAttribute(
      "href",
      "https://signed.example/doc?token=t",
    );
    expect(screen.getByRole("button", { name: /Download/ })).toBeInTheDocument();
    expect(d.save).not.toHaveBeenCalled();
  });
  it("keeps the uploaded document visible when reading fails or is switched off (manual entry)", async () => {
    const d = deps({ status: vi.fn(async () => ({ mode: "off" as const, state: "not_enabled" })) });
    mount(d);
    await pick(pdfFile());
    expect(await screen.findByTestId("uploaded-document-name")).toHaveTextContent("letter.pdf");
    expect(screen.getByRole("button", { name: /View uploaded document/ })).toBeInTheDocument();
  });
  it("saves only on explicit confirmation, with the edited values and the document attached", async () => {
    const d = deps();
    const { onDone } = mount(d);
    await pick(pdfFile());
    const provider = await screen.findByLabelText("Doctor or provider");
    fireEvent.change(provider, { target: { value: "Dr. Corrected Name" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    await waitFor(() => expect(d.save).toHaveBeenCalledTimes(1));
    const [familyId, input] = d.save.mock.calls[0]!;
    expect(familyId).toBe(FAM_A);
    expect(input).toMatchObject({
      provider_name: "Dr. Corrected Name",
      document_path: PATH_A,
      confirmation_status: "unconfirmed",
    });
    expect(onDone).toHaveBeenCalledWith("new-visit");
  });
  it("a missing time stays missing: the form asks for it instead of assuming one", async () => {
    const d = deps({
      extract: vi.fn(async () => ({
        ok: true as const,
        source: "meta" as const,
        extraction: { ...SIMULATED_EXTRACTION, time: null },
        timeZone: "America/Chicago",
      })),
    });
    mount(d);
    await pick(pdfFile());
    expect(await screen.findByText(/Read by AI/)).toBeInTheDocument();
    expect(screen.getByTestId("hint-missing")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    expect(await screen.findByText(/Choose a date and time/)).toBeInTheDocument();
    expect(d.save).not.toHaveBeenCalled();
  });
  it("a failed save keeps the form and the stored document, and adds nothing", async () => {
    const d = deps({
      save: vi.fn(async () => {
        throw new Error("Database said no");
      }),
    });
    const { onDone } = mount(d);
    await pick(pdfFile());
    await screen.findByTestId("doc-notice");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    expect(await screen.findByText(/Database said no.*still stored/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(d.documents.remove).not.toHaveBeenCalled();
    // retry works
    d.save.mockResolvedValueOnce({ id: "v2" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("v2"));
  });
});

describe("extraction failure or switched off: manual entry, document kept", () => {
  it("extraction failure -> empty form, document stays attached, fixed message", async () => {
    const d = deps({ extract: vi.fn(async () => ({ ok: false as const, code: "unreadable" })) });
    const { onDone } = mount(d);
    await pick(pdfFile());
    expect(await screen.findByTestId("doc-notice")).toHaveTextContent(
      /couldn't read details.*document is saved/i,
    );
    expect(screen.getByLabelText("Doctor or provider")).toHaveValue("");
    expect(d.documents.remove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-11-20T09:00" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    await waitFor(() =>
      expect(d.save.mock.calls[0]![1]).toMatchObject({
        document_path: PATH_A,
        provider_name: null,
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });
  it("a thrown extraction, and a page-render failure, both fall back to manual entry", async () => {
    const d1 = deps({
      extract: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    mount(d1);
    await pick(pdfFile());
    expect(await screen.findByTestId("doc-notice")).toHaveTextContent(/document is saved/i);
    cleanup();
    const d2 = deps({
      render: vi.fn(async () => {
        throw new Error("canvas");
      }),
    });
    mount(d2);
    await pick(pdfFile());
    expect(await screen.findByTestId("doc-notice")).toHaveTextContent(/document is saved/i);
    expect(d2.extract).not.toHaveBeenCalled();
  });
  it("extraction switched off -> no render, no extract, manual form with the document attached", async () => {
    const d = deps({ status: vi.fn(async () => ({ mode: "off" as const, state: "not_enabled" })) });
    mount(d);
    await screen.findByText(/Automatic reading is not switched on/);
    await pick(pdfFile());
    expect(await screen.findByTestId("doc-notice")).toHaveTextContent(/isn't switched on.*saved/i);
    expect(d.render).not.toHaveBeenCalled();
    expect(d.extract).not.toHaveBeenCalled();
  });
});

describe("cancellation and abandoned uploads", () => {
  it("cancelling the review removes the stored document and saves nothing", async () => {
    const d = deps();
    const { onCancel } = mount(d);
    await pick(pdfFile());
    await screen.findByTestId("doc-notice");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await waitFor(() => expect(d.documents.remove).toHaveBeenCalledWith(PATH_A));
    expect(d.save).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
  it("on open, sweeps old unattached uploads, telling the sweeper which documents appointments reference", async () => {
    const d = deps({
      listForSweep: vi.fn(async () => [{ document_path: PATH_A }, { document_path: null }]),
    });
    mount(d);
    await waitFor(() => expect(d.documents.sweepAbandoned).toHaveBeenCalledTimes(1));
    const [fam, referenced] = d.documents.sweepAbandoned.mock.calls[0]! as unknown as [
      string,
      Set<string>,
    ];
    expect(fam).toBe(FAM_A);
    expect([...referenced]).toEqual([PATH_A]);
  });
  it("a failing sweep never breaks the page", async () => {
    const d = deps({
      listForSweep: vi.fn(async () => {
        throw new Error("x");
      }),
    });
    mount(d);
    expect(await screen.findByLabelText(/Appointment letter/)).toBeInTheDocument();
  });
});
