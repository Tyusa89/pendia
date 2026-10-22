import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, LogOut } from "lucide-react";
import { PageTitle, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePreferences } from "@/components/PreferencesProvider";
import { useFamily } from "@/hooks/use-family";

export const Route = createFileRoute("/_authenticated/preferences")({
  head: () => ({ meta: [
    { title: "Preferences & Accessibility — Pendia" },
    { name: "description", content: "Choose Pendia's text size, language, contrast, motion and button sizes." },
    { property: "og:title", content: "Preferences & Accessibility — Pendia" },
    { property: "og:description", content: "Choose Pendia's text size, language, contrast, motion and button sizes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: PreferencesPage,
});

function Setting({ title, description, checked = false, disabled = false, onChange }: {
  title: string; description?: string; checked?: boolean; disabled?: boolean; onChange?: (value: boolean) => void;
}) {
  return <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0">
    <div className="min-w-0"><p className="font-semibold">{title}</p>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
    <Switch aria-label={title} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </div>;
}

function PreferencesPage() {
  const { preferences: p, update, storageAvailable } = usePreferences();
  const { data } = useFamily();
  const language = p.language ?? (data?.me.language === "es" ? "es" : "en");
  return <>
    <Button asChild variant="link" className="mb-3 px-0"><Link to="/family"><ArrowLeft /> Family</Link></Button>
    <PageTitle title="Preferences & Accessibility" subtitle="Your display choices on this device" />
    {!storageAvailable && <p role="status" className="mb-4 text-destructive">Your browser cannot save preferences. Choices will reset when you reload.</p>}
    <div className="space-y-4">
      <Panel aria-label="AI assistance">
        <h2 className="font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">AI assistance</h2>
        <Setting title="Ask Pendia assistant" description="Not connected" disabled />
        <div className="mt-3 flex gap-3 rounded-xl bg-secondary p-4 text-secondary-foreground"><Check className="size-5 shrink-0" aria-hidden /><p>Your medications, visits, coverage, handoffs and digest remain available without an assistant.</p></div>
      </Panel>
      <Panel aria-label="Language">
        <h2 className="mb-3 font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">Digest language</h2>
        <div role="group" aria-label="Digest language" className="flex gap-1 rounded-xl bg-muted p-1">
          {(["en", "es"] as const).map((l) => <Button key={l} variant={language === l ? "outline" : "ghost"} aria-pressed={language === l} onClick={() => update({ language: l })} className="flex-1 px-2">{l === "en" ? "English" : "Español"}</Button>)}
      </Panel>
      <Panel aria-label="Text size">
        <h2 className="mb-3 font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">Text size</h2>
        <div role="group" aria-label="Text size" className="flex gap-1 rounded-xl bg-muted p-1">
          {(["standard", "large"] as const).map((size) => <Button key={size} variant={p.textSize === size ? "outline" : "ghost"} aria-pressed={p.textSize === size} onClick={() => update({ textSize: size })} className="flex-1 px-2">{size === "standard" ? "Standard" : "Large"}</Button>)}
        </div>
      </Panel>
      <Panel aria-label="Accessibility">
        <h2 className="font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">Accessibility</h2>
        <Setting title="Higher contrast" description="Darker text and borders" checked={p.highContrast} onChange={(highContrast) => update({ highContrast })} />
        <Setting title="Reduce motion" description="No animations" checked={p.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} />
        <Setting title="Extra-large buttons" description="Bigger tap targets" checked={p.largeButtons} onChange={(largeButtons) => update({ largeButtons })} />
      </Panel>
      <Panel aria-label="Notifications">
        <h2 className="font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">Notifications</h2>
        <Setting title="Medication reminders" description="Not connected" disabled />
        <Setting title="Missed doses" description="Not connected" disabled />
        <Setting title="Coverage gaps" description="Not connected" disabled />
        <Setting title="Daily digest" description="Not connected" disabled />
        <Setting title="Visit reminders" description="Not connected" disabled />
      </Panel>
      <Panel aria-label="Privacy & recordings">
        <h2 className="mb-3 font-sans text-sm font-bold uppercase tracking-wide text-muted-foreground">Privacy & recordings</h2>
        <p className="text-muted-foreground">Manage each saved recording from its visit or handoff.</p>
        <div className="mt-4 flex flex-wrap gap-3"><Button asChild variant="outline"><Link to="/visits">Visits</Link></Button><Button asChild variant="outline"><Link to="/handoffs">Handoffs</Link></Button></div>
      </Panel>
    </div>
  </>;
}