// Renders the REAL DocumentUploadFlow and AppointmentDocumentLink with injected fake dependencies, driven by the URL:
//   ?kind=flow&mode=simulated|off|meta&fail=none|upload|render|extract|save&write=1|0
//   ?kind=link&sign=ok|fail
// Used by the browser specs for layout, accessibility and screenshots, and by humans to look at the states.
import "@/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";
import { DocumentUploadFlow, type FlowDeps } from "@/components/DocumentUploadFlow";
import { SIMULATED_EXTRACTION, docPath } from "@/lib/doc-upload/contract";

const q = new URLSearchParams(location.search);
const FAMILY = "11111111-1111-4111-8111-111111111111";
const PATH = docPath(
  FAMILY,
  "44444444-4444-4444-8444-444444444444",
  "pdf",
  "appointment-letter.pdf",
);
const mode = (q.get("mode") ?? "simulated") as "simulated" | "off" | "meta";
const fail = q.get("fail") ?? "none";

const deps: FlowDeps = {
  documents: {
    uploadPending: async () => {
      if (fail === "upload") throw new Error("harness: upload failed");
      return PATH;
    },
    remove: async () => true,
    sweepAbandoned: async () => [],
  },
  status: async () =>
    mode === "off"
      ? { mode: "off", state: "not_enabled" }
      : { mode: mode === "meta" ? "live" : "simulated", state: "available" },
  render: async () => {
    if (fail === "render") throw new Error("harness: render failed");
    return [{ mime: "image/jpeg", base64: "/9j/4AAQSkZJRg==" }];
  },
  extract: async () =>
    fail === "extract"
      ? { ok: false, code: "unreadable" }
      : {
          ok: true,
          source: mode === "meta" ? "meta" : "simulated",
          extraction: SIMULATED_EXTRACTION,
          timeZone: "America/Chicago",
        },
  save: async () => {
    if (fail === "save") throw new Error("The appointment couldn't be saved.");
    return { id: "new-visit" };
  },
  listForSweep: async () => [],
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    {q.get("kind") === "link" ? (
      <AppointmentDocumentLink path={PATH} />
    ) : (
      <DocumentUploadFlow
        familyId={FAMILY}
        timeZone="America/Chicago"
        canWrite={q.get("write") !== "0"}
        others={[]}
        deps={deps}
        onDone={() => undefined}
        onCancel={() => undefined}
      />
    )}
  </QueryClientProvider>,
);
