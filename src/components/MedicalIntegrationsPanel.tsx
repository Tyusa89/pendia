import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

/** Settings entry for the (static, not-yet-connected) Medical Integrations page. Makes no request and reads no data. */
export function MedicalIntegrationsPanel() {
  return (
    <Panel aria-label="Medical integrations">
      <h2 className="mb-3 font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Medical integrations
      </h2>
      <p className="text-muted-foreground">
        Provider connections such as MyChart are coming soon and are not connected. No medical
        records are being imported.
      </p>
      <div className="mt-4">
        <Button asChild variant="outline">
          <Link to="/medical-integrations">Medical Integrations</Link>
        </Button>
      </div>
    </Panel>
  );
}
