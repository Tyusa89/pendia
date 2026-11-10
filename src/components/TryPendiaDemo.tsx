import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authService } from "@/services";

export function TryPendiaDemo({ variant, className }: { variant?: "link"; className?: string } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function enter() {
    setBusy(true); setError("");
    try {
      await qc.cancelQueries(); qc.clear();
      await authService.startDemo();
      await navigate({ to: "/family" });
    } catch { setError("The demo couldn't start. Please try again."); }
    finally { setBusy(false); }
  }
  return <div>
    <Button size={variant === "link" ? "default" : "lg"} variant={variant} className={className ?? "w-full"} disabled={busy} onClick={enter}>{busy ? "Opening demo…" : "Try Pendia Demo"}<ArrowRight aria-hidden /></Button>
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </div>;
}