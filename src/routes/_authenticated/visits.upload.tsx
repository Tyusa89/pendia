import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { DocumentUploadFlow, type FlowDeps } from "@/components/DocumentUploadFlow";
import { extractAppointmentFn, getDocExtractStatus } from "@/lib/doc-upload/doc-extract.functions";
import { renderPages } from "@/lib/doc-upload/render-pages";
import { MemberDocumentUpload } from "@/components/MemberDocumentUpload";
import { PendingMemberDocuments } from "@/components/PendingMemberDocuments";
import { documentService } from "@/services/documents";
import { visitService } from "@/services";

export const Route = createFileRoute("/_authenticated/visits/upload")({
  head: () => ({
    meta: [
      { title: "Add from a document — Pendia" },
      {
        name: "description",
        content: "Upload an appointment letter and review the details before saving.",
      },
      { property: "og:title", content: "Add from a document — Pendia" },
      {
        property: "og:description",
        content: "Upload an appointment letter and review the details before saving.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadAppointment,
});

const deps: FlowDeps = {
  documents: documentService,
  status: async (familyId) =>
    (await getDocExtractStatus({ data: { familyId } })) as {
      mode: "live" | "simulated" | "off";
      state: string;
    },
  render: renderPages,
  extract: async (input) =>
    (await extractAppointmentFn({ data: input })) as Awaited<ReturnType<FlowDeps["extract"]>>,
  save: (familyId, input) => visitService.createAppointment(familyId, input),
  listForSweep: (familyId) => visitService.list(familyId),
};

function UploadAppointment() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <WithFamily>
      {({ family, me }) => (
        <Inner
          familyId={family.id}
          timeZone={family.timezone}
          canWrite={me.role === "organizer"}
          canMemberUpload={me.role === "member" && me.can_upload_documents}
          navigate={navigate}
          invalidate={() => qc.invalidateQueries({ queryKey: ["visits", family.id] })}
        />
      )}
    </WithFamily>
  );
}

function Inner({
  familyId,
  timeZone,
  canWrite,
  canMemberUpload,
  navigate,
  invalidate,
}: {
  familyId: string;
  timeZone: string;
  canWrite: boolean;
  canMemberUpload: boolean;
  navigate: ReturnType<typeof useNavigate>;
  invalidate: () => Promise<void>;
}) {
  const { data: all = [] } = useQuery({
    queryKey: ["visits", familyId],
    queryFn: () => visitService.list(familyId),
  });
  if (canMemberUpload && !canWrite)
    return (
      <>
        <PageTitle title="Send a document" subtitle="An organizer reviews what you upload and adds the appointment." />
        <MemberDocumentUpload familyId={familyId} />
      </>
    );
  // Documents family members uploaded and an organizer has not saved yet must not be swept as "abandoned" while they wait
  // (the sweep deletes unreferenced uploads older than 24 hours). They count as referenced for up to 30 days.
  const flowDeps: FlowDeps = {
    ...deps,
    listForSweep: async (fid) => {
      const [rows, waiting] = await Promise.all([visitService.list(fid), visitService.pendingMemberDocuments(fid)]);
      return [...rows, ...waiting.map((w) => ({ document_path: w.path }))] as Awaited<ReturnType<FlowDeps["listForSweep"]>>;
    },
  };
  return (
    <>
      <PageTitle
        title="Add from a document"
        subtitle="Upload an appointment letter, then check the details before anything is saved."
      />
      {canWrite && <PendingMemberDocuments familyId={familyId} timeZone={timeZone} />}
      <DocumentUploadFlow
        familyId={familyId}
        timeZone={timeZone}
        canWrite={canWrite}
        others={all}
        deps={flowDeps}
        onDone={async (id) => {
          await invalidate();
          void navigate({ to: "/visits/$id", params: { id } });
        }}
        onCancel={() => void navigate({ to: "/visits" })}
      />
    </>
  );
}
