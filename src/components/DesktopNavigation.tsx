import { Link } from "@tanstack/react-router";
import { CalendarDays, ClipboardCheck, Home, Mail, MessageCircle, PanelLeftClose, PanelLeftOpen, Pill, SlidersHorizontal, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const destinations = [
  { to: "/family", label: "Dashboard", icon: Home },
  { to: "/visits", label: "Visits", icon: Stethoscope },
  { to: "/meds", label: "Meds", icon: Pill },
  { to: "/coverage", label: "Coverage", icon: CalendarDays },
  { to: "/handoffs", label: "Handoffs", icon: ClipboardCheck },
  { to: "/digest", label: "Digest", icon: Mail },
] as const;

export function DesktopNavigation({ collapsed, onToggle, familyName }: {
  collapsed: boolean; onToggle: () => void; familyName?: string;
}) {
  return <TooltipProvider delayDuration={200}>
    <aside className="desktop-navigation fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card lg:flex" aria-label="Desktop sidebar">
      <div className="flex min-h-20 items-center justify-between gap-1 border-b border-border px-3">
        {!collapsed && <Link to="/family" className="min-w-0 px-2 font-display text-2xl font-semibold text-primary">Pendia</Link>}
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} aria-controls="desktop-destinations" onClick={onToggle}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </TooltipTrigger><TooltipContent side="right">{collapsed ? "Expand navigation" : "Collapse navigation"}</TooltipContent></Tooltip>
      </div>
      {!collapsed && familyName && <p className="break-words px-5 pb-1 pt-6 text-sm font-semibold text-muted-foreground">{familyName}</p>}
      <nav id="desktop-destinations" aria-label="Desktop main" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {destinations.map(({ to, label, icon: Icon }) => <Tooltip key={to}><TooltipTrigger asChild>
          <Button asChild variant="ghost" className={`h-auto min-h-12 w-full rounded-lg ${collapsed ? "px-0" : "justify-start px-3"}`}>
            <Link to={to} aria-label={label} className="text-muted-foreground" activeProps={{ className: "bg-primary/10 text-primary font-bold", "aria-current": "page" }}>
              <Icon className="size-5 shrink-0" aria-hidden />{!collapsed && <span className="min-w-0 break-words">{label}</span>}
            </Link>
          </Button>
        </TooltipTrigger>{collapsed && <TooltipContent side="right">{label}</TooltipContent>}</Tooltip>)}
      </nav>
      <div className="space-y-1 border-t border-border px-3 py-4">
        {[{ to: "/ask", label: "Ask Pendia", icon: MessageCircle }, { to: "/preferences", label: "Preferences & Accessibility", icon: SlidersHorizontal }].map(({ to, label, icon: Icon }) => <Tooltip key={to}><TooltipTrigger asChild>
          <Button asChild variant="ghost" className={`h-auto min-h-12 w-full rounded-lg ${collapsed ? "px-0" : "justify-start px-3"}`}>
            <Link to={to} aria-label={label} activeProps={{ className: "bg-accent text-accent-foreground", "aria-current": "page" }}><Icon className="shrink-0" aria-hidden />{!collapsed && <span className="min-w-0 whitespace-normal text-left text-sm">{label}</span>}</Link>
          </Button>
        </TooltipTrigger>{collapsed && <TooltipContent side="right">{label}</TooltipContent>}</Tooltip>)}
      </div>
    </aside>
  </TooltipProvider>;
}