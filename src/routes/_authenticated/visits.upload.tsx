import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { DocumentUploadFlow, type FlowDeps } from "@/components/DocumentUploadFlow";
import { extractAppointmentFn, getDocExtractStatus } from "@/lib/doc-upload/doc-extract.functions";
import { renderPages } from "@/lib/doc-upload/render-pages";
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
  navigate,
  invalidate,
}: {
  familyId: string;
  timeZone: string;
  canWrite: boolean;
  navigate: ReturnType<typeof useNavigate>;
  invalidate: () => Promise<void>;
}) {
  const { data: all = [] } = useQuery({
    queryKey: ["visits", familyId],
    queryFn: () => visitService.list(familyId),
  });
  return (
    <>
      <PageTitle
        title="Add from a document"
        subtitle="Upload an appointment letter, then check the details before anything is saved."
      />
      <DocumentUploadFlow
        familyId={familyId}
        timeZone={timeZone}
        canWrite={canWrite}
        others={all}
        deps={deps}
        onDone={async (id) => {
          await invalidate();
          void navigate({ to: "/visits/$id", params: { id } });
        }}
        onCancel={() => void navigate({ to: "/visits" })}
      />
    </>
  );
}
