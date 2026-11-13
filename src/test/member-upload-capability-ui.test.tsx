// Family-member document upload capability in the app: the organizer's switch, the upload-only screen for a granted member,
// the unchanged denial for an ungranted member, and the organizer's review list. The data layer is mocked; fictional data only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAM = "11111111-1111-4111-8111-111111111111";
const DOC = `${FAM}/doc/44444444-4444-4444-8444-444444444444/letter.pdf`;
const world = vi.hoisted(() => ({
  me: {
    id: "m1",
    family_id: "11111111-1111-4111-8111-111111111111",
    name: "Elena",
    role: "organizer",
    can_see_meds: true,
    can_see_schedule: true,
    can_see_visits: true,
    can_upload_documents: false,
  } as Record<string, unknown>,
  waiting: [] as Array<{
    path: string;
    uploader_member_id: string;
    uploader_name: string;
    created_at: string;
  }>,
}));
const updateMember = vi.fn(async (_id: string, _patch: unknown) => ({}));
const createAppointment = vi.fn(async (_fid: string, input: Record<string, unknown>) => ({
  id: "new-visit",
  ...input,
}));
const uploadPending = vi.fn(
  async (_fid: string, _file: Blob, _kind: string) => `${FAM}/doc/x/letter.pdf`,
);

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({
      to,
      search,
      children,
      ...rest
    }: {
      to: string;
      search?: Record<string, string>;
      children: ReactNode;
    }) => (
      <a
        href={search ? `${to}?${new URLSearchParams(search).toString()}` : to}
        {...(rest as object)}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@/hooks/use-family", () => ({
  useFamily: () => ({
    isLoading: false,
    data: { family: { id: FAM, name: "Test Family", timezone: "America/Chicago" }, me: world.me },
  }),
  useMembers: () => ({ data: [] }),
  familyKey: ["my-family"],
}));
vi.mock("@/services", () => ({
  familyService: { updateMember: (id: string, patch: unknown) => updateMember(id, patch) },
  visitService: {
    list: async () => [],
    pendingMemberDocuments: async () => world.waiting,
    createAppointment: (fid: string, input: Record<string, unknown>) =>
      createAppointment(fid, input),
  },
}));
vi.mock("@/services/documents", () => ({
  DOC_SIGNED_URL_TTL_SECONDS: 300,
  documentService: {
    uploadPending: (fid: string, file: Blob, kind: string) => uploadPending(fid, file, kind),
    remove: async () => true,
    sweepAbandoned: async () => [],
    signedUrl: async () => "https://signed.example/x",
  },
}));
vi.mock("@/lib/doc-upload/doc-extract.functions", () => ({
  extractAppointmentFn: vi.fn(),
  getDocExtractStatus: async () => ({ mode: "off", state: "not_enabled" }),
}));
vi.mock("@/lib/doc-upload/render-pages", () => ({ renderPages: async () => [] }));

import { AppointmentEditor } from "@/components/AppointmentEditor";
import { MemberRow } from "@/components/FamilyMembers";
import { MemberDocumentUpload } from "@/components/MemberDocumentUpload";
import { PendingMemberDocuments } from "@/components/PendingMemberDocuments";
import { Route as UploadRoute } from "@/routes/_authenticated/visits.upload";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);
const member = (over: object = {}) => ({
  id: "mem-a",
  family_id: FAM,
  name: "Member A",
  role: "member",
  phone: null,
  language: "en",
  user_id: "u",
  can_see_meds: true,
  can_see_schedule: true,
  can_see_visits: true,
  can_upload_documents: false,
  created_at: "",
  ...over,
});
const PDF = () =>
  new File(
    [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0])],
    "letter.pdf",
    { type: "application/pdf" },
  );
const TXT = () =>
  new File([new Uint8Array([0x68, 0x69, 0, 0])], "note.txt", { type: "text/plain" });
(Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.readAsArrayBuffer(this);
  });
};

beforeEach(() => {
  world.me = { ...world.me, role: "organizer", can_upload_documents: false };
  world.waiting = [];
  updateMember.mockClear();
  createAppointment.mockClear();
  uploadPending.mockClear();
});
afterEach(cleanup);

describe("organizer switch on a member card", () => {
  it("an organizer can turn the permission on and off for a member; it changes only that field", async () => {
    render(wrap(<MemberRow m={member() as never} editable />));
    const sw = screen.getByRole("switch", { name: /Upload appointment documents/ });
    expect(sw).not.toBeChecked();
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(updateMember).toHaveBeenCalledWith("mem-a", { can_upload_documents: true });
  });
  it("the upload switch is a full-height touch target (44px or more), unlike the older 32px switches", () => {
    render(wrap(<MemberRow m={member() as never} editable />));
    expect(screen.getByRole("switch", { name: /Upload appointment documents/ }).className).toMatch(
      /\bh-11\b/,
    );
    expect(screen.getByRole("switch", { name: /Medications/ }).className).toMatch(/\bh-8\b/); // older switches deliberately unchanged
  });
  it("a non-organizer sees the state but cannot change it", () => {
    render(
      wrap(<MemberRow m={member({ can_upload_documents: true }) as never} editable={false} />),
    );
    const sw = screen.getByRole("switch", { name: /Upload appointment documents/ });
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
  });
  it("organizers always can upload, so no switch is drawn on an organizer card", () => {
    render(wrap(<MemberRow m={member({ role: "organizer" }) as never} editable />));
    expect(
      screen.queryByRole("switch", { name: /Upload appointment documents/ }),
    ).not.toBeInTheDocument();
  });
});

describe("upload page by role", () => {
  const Page = UploadRoute.options.component as ComponentType;
  it("ungranted member: unchanged denial, no file picker", async () => {
    world.me = { ...world.me, role: "member", can_upload_documents: false };
    render(wrap(<Page />));
    expect(await screen.findByText(/Only the organizer can add appointments/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Appointment letter/)).not.toBeInTheDocument();
  });
  it("granted member: upload-only screen, no review form, no waiting list", async () => {
    world.me = { ...world.me, role: "member", can_upload_documents: true };
    world.waiting = [
      {
        path: DOC,
        uploader_member_id: "x",
        uploader_name: "Someone",
        created_at: new Date().toISOString(),
      },
    ];
    render(wrap(<Page />));
    expect(await screen.findByRole("heading", { name: "Send a document" })).toBeInTheDocument();
    expect(screen.getByLabelText("Appointment letter")).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for you/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add appointment/ })).not.toBeInTheDocument();
  });
  it("organizer: the existing upload flow, plus the waiting list when members sent something", async () => {
    world.waiting = [
      {
        path: DOC,
        uploader_member_id: "mem-a",
        uploader_name: "Member A",
        created_at: new Date().toISOString(),
      },
    ];
    render(wrap(<Page />));
    expect(await screen.findByText(/Waiting for you · 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Appointment letter/)).toBeInTheDocument();
  });
});

describe("granted member upload screen", () => {
  it("rejects an unsupported file before anything is stored", async () => {
    render(<MemberDocumentUpload familyId={FAM} documents={{ uploadPending }} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Appointment letter"), { target: { files: [TXT()] } });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PDF, JPG and PNG/);
    expect(uploadPending).not.toHaveBeenCalled();
  });
  it("stores a valid file privately and says it was sent to the organizers", async () => {
    render(<MemberDocumentUpload familyId={FAM} documents={{ uploadPending }} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Appointment letter"), { target: { files: [PDF()] } });
    });
    await waitFor(() => expect(uploadPending).toHaveBeenCalledWith(FAM, expect.anything(), "pdf"));
    expect(await screen.findByText("Sent to the organizers")).toBeInTheDocument();
  });
  it("a refused upload (for example after the permission was revoked) shows a clear, non-technical message", async () => {
    const refuse = vi.fn(async () => {
      throw new Error("rls");
    });
    render(<MemberDocumentUpload familyId={FAM} documents={{ uploadPending: refuse }} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Appointment letter"), { target: { files: [PDF()] } });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /ask an organizer whether your upload permission is still on/,
    );
    expect(screen.queryByText("Sent to the organizers")).not.toBeInTheDocument();
  });
});

describe("organizer review", () => {
  it("lists a member's waiting document with a link that opens the new-appointment form for that document", async () => {
    world.waiting = [
      {
        path: DOC,
        uploader_member_id: "mem-a",
        uploader_name: "Member A",
        created_at: new Date().toISOString(),
      },
    ];
    render(wrap(<PendingMemberDocuments familyId={FAM} timeZone="America/Chicago" />));
    const region = await screen.findByRole("region", { name: "Waiting for you" });
    expect(within(region).getByText("Member A")).toBeInTheDocument();
    expect(
      within(region)
        .getByRole("link", { name: /Add appointment from this document/ })
        .getAttribute("href"),
    ).toBe(`/visits/new?doc=${encodeURIComponent(DOC)}`);
  });
  it("draws nothing when nothing is waiting", async () => {
    render(wrap(<PendingMemberDocuments familyId={FAM} timeZone="America/Chicago" />));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Waiting for you" })).not.toBeInTheDocument(),
    );
  });
  it("saving the appointment attaches the document, which is what confirms it", async () => {
    render(
      wrap(
        <AppointmentEditor
          familyId={FAM}
          timeZone="America/Chicago"
          canWrite
          documentPath={DOC}
          onDone={() => undefined}
          onCancel={() => undefined}
        />,
      ),
    );
    const starts = await screen.findByLabelText("Starts");
    fireEvent.change(starts, { target: { value: "2026-12-01T10:30" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
    expect(createAppointment.mock.calls[0]![1]).toMatchObject({ document_path: DOC });
  });
  it("without a document the appointment is created exactly as before", async () => {
    render(
      wrap(
        <AppointmentEditor
          familyId={FAM}
          timeZone="America/Chicago"
          canWrite
          onDone={() => undefined}
          onCancel={() => undefined}
        />,
      ),
    );
    fireEvent.change(await screen.findByLabelText("Starts"), {
      target: { value: "2026-12-01T10:30" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add appointment" }));
    });
    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
    expect(createAppointment.mock.calls[0]![1]).not.toHaveProperty("document_path", DOC);
  });
});
