// Harness stand-in for src/services/documents.ts. The REAL components under test (DocumentUploadFlow, AppointmentDocumentLink) are
// rendered unchanged; only their storage service is replaced, exactly like the vi.mock used by the existing unit tests.
export const DOC_SIGNED_URL_TTL_SECONDS = 300;

const params = new URLSearchParams(location.search);

export const documentService = {
  async signedUrl(_path: string): Promise<string> {
    if (params.get("sign") === "fail") throw new Error("harness: signed link refused");
    return `${location.origin}/fixtures/letter.pdf`;
  },
  async uploadPending(): Promise<string> {
    throw new Error("harness: uploads go through the injected deps");
  },
  async remove(): Promise<boolean> {
    return true;
  },
  async sweepAbandoned(): Promise<string[]> {
    return [];
  },
};
export const createDocumentService = () => documentService;
