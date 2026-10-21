import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { AppointmentFlags } from "@/components/AppointmentFlags";
import { Empty } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { classify, findOverlaps, sortPast, sortUpcoming, type Appointment } from "@/lib/appointments";
import { formatInZone } from "@/lib/zoned-time";
import { visitService } from "@/services";

export function whenLabel(a: Appointment, timeZone: string): string {
  if (!a.scheduled_start) return new Date(`${a.date}T12:00`).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
  return formatInZone(a.scheduled_start, timeZone, { weekday: "short", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Card({ a, timeZone, overlapCount }: { a: Appointment; timeZone: string; overlapCount: number }) {
  return (
    <li>
      <Link to="/visits/$id" params={{ id: a.id }} className="block rounded-2xl border bg-card p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{whenLabel(a, timeZone)}</p>
            <p className="mt-1 text-xl font-semibold">
              {a.provider_name?.trim() ? a.provider_name : <span className="font-normal italic text-muted-foreground">Provider not set</span>}
            </p>
            {a.office_name?.trim() && <p className="text-muted-foreground">{a.office_name}</p>}
            {a.reason?.trim() && <p className="mt-1">{a.reason}</p>}
            {a.summary && <p className="mt-1 line-clamp-2 text-muted-foreground">{a.summary}</p>}
          </div>
          <ChevronRight className="mt-1 size-6 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <div className="mt-3">
          <AppointmentFlags appointment={a} overlapCount={overlapCount} />
        </div>
      </Link>
    </li>
  );
}

export function AppointmentList({ familyId, timeZone, canWrite }: { familyId: string; timeZone: string; canWrite: boolean }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["visits", familyId], queryFn: () => visitService.list(familyId) });
  const { views, overlaps } = useMemo(() => {
    const now = new Date();
    const groups: Record<"upcoming" | "past" | "archived", Appointment[]> = { upcoming: [], past: [], archived: [] };
    for (const a of data) groups[classify(a, now, timeZone)].push(a);
    return {
      views: { upcoming: sortUpcoming(groups.upcoming), past: sortPast(groups.past), archived: sortPast(groups.archived) },
      overlaps: findOverlaps(data),
    };
  }, [data, timeZone]);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  const list = (items: Appointment[], empty: string) =>
    items.length === 0 ? (
      <Empty>{empty}</Empty>
    ) : (
      <ul className="space-y-3">
        {items.map((a) => (
          <Card key={a.id} a={a} timeZone={timeZone} overlapCount={overlaps.get(a.id)?.length ?? 0} />
        ))}
      </ul>
    );

  return (
    <>
      {canWrite && (
        <Button asChild size="lg" className="mb-5 h-14 w-full">
          <Link to="/visits/new">
            <Plus /> New appointment
          </Link>
        </Button>
      )}
      <Tabs defaultValue="upcoming">
        <TabsList className="mb-4 grid w-full grid-cols-3">
          <TabsTrigger value="upcoming">Upcoming ({views.upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({views.past.length})</TabsTrigger>
          <TabsTrigger value="archived">Archived ({views.archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">{list(views.upcoming, canWrite ? "No upcoming appointments. Add one with the button above." : "No upcoming appointments.")}</TabsContent>
        <TabsContent value="past">{list(views.past, "No past visits yet.")}</TabsContent>
        <TabsContent value="archived">{list(views.archived, "Nothing archived.")}</TabsContent>
      </Tabs>
    </>
  );
}
