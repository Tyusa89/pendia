import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileUp, Plus } from "lucide-react";
import { AppointmentFlags } from "@/components/AppointmentFlags";
import { Empty } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  classify,
  findOverlaps,
  sortPast,
  sortUpcoming,
  type Appointment,
} from "@/lib/appointments";
import { formatInZone } from "@/lib/zoned-time";
import { visitService } from "@/services";

export function whenLabel(a: Appointment, timeZone: string): string {
  if (!a.scheduled_start)
    return new Date(`${a.date}T12:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    });
  return formatInZone(a.scheduled_start, timeZone, {
    weekday: "short",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Card({
  a,
  timeZone,
  overlapCount,
  compact = false,
}: {
  a: Appointment;
  timeZone: string;
  overlapCount: number;
  compact?: boolean;
}) {
  return (
    <li>
      <Link
        to="/visits/$id"
        params={{ id: a.id }}
        className="block h-full rounded-[1.25rem] bg-card p-[1.125rem] shadow-card focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className={`grid items-start gap-3 ${compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]"}`}>
          {!compact && (
          <span aria-hidden className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span className="text-[0.7059rem] font-bold uppercase">{new Date(`${a.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
            <span className="font-display text-2xl font-semibold">{Number(a.date.slice(8))}</span>
          </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              {whenLabel(a, timeZone)}
            </p>
            <p className={`mt-1 font-semibold ${compact ? "text-base" : "text-xl"}`}>
              {a.provider_name?.trim() ? (
                a.provider_name
              ) : (
                <span className="font-normal italic text-muted-foreground">Provider not set</span>
              )}
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

export function AppointmentList({
  familyId,
  timeZone,
  canWrite,
  compact = false,
}: {
  familyId: string;
  timeZone: string;
  canWrite: boolean;
  compact?: boolean;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["visits", familyId],
    queryFn: () => visitService.list(familyId),
  });
  const { views, overlaps } = useMemo(() => {
    const now = new Date();
    const groups: Record<"upcoming" | "past" | "archived", Appointment[]> = {
      upcoming: [],
      past: [],
      archived: [],
    };
    for (const a of data) groups[classify(a, now, timeZone)].push(a);
    return {
      views: {
        upcoming: sortUpcoming(groups.upcoming),
        past: sortPast(groups.past),
        archived: sortPast(groups.archived),
      },
      overlaps: findOverlaps(data),
    };
  }, [data, timeZone]);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  const list = (items: Appointment[], empty: string) =>
    items.length === 0 ? (
      <Empty>{empty}</Empty>
    ) : (
      <ul className={`grid gap-3 ${compact ? "" : "md:grid-cols-2 min-[1800px]:grid-cols-3"}`}>
        {items.map((a) => (
          <Card
            key={a.id}
            a={a}
            timeZone={timeZone}
            overlapCount={overlaps.get(a.id)?.length ?? 0}
            compact={compact}
          />
        ))}
      </ul>
    );

  return (
    <>
      {canWrite && (
        <Button asChild variant="outline" className={`mb-5 ${compact ? "w-full" : ""}`}>
          <Link to="/visits/new">
            <Plus /> New appointment
          </Link>
        </Button>
      )}
      {canWrite && (
        <Button asChild variant="outline" className={`mb-5 sm:ml-2 ${compact ? "w-full" : ""}`}>
          <Link to="/visits/upload">
            <FileUp /> From a document
          </Link>
        </Button>
      )}
      <Tabs defaultValue="upcoming">
        <TabsList className="mb-4 grid h-auto w-full grid-cols-3">
          <TabsTrigger
            value="upcoming"
            className="px-1 text-[0.9412rem] leading-tight whitespace-normal"
          >
            Upcoming ({views.upcoming.length})
          </TabsTrigger>
          <TabsTrigger
            value="past"
            className="px-1 text-[0.9412rem] leading-tight whitespace-normal"
          >
            Past ({views.past.length})
          </TabsTrigger>
          <TabsTrigger
            value="archived"
            className="px-1 text-[0.9412rem] leading-tight whitespace-normal"
          >
            Archived ({views.archived.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">
          {list(
            views.upcoming,
            canWrite
              ? "No upcoming appointments. Add one with the button above."
              : "No upcoming appointments.",
          )}
        </TabsContent>
        <TabsContent value="past">{list(views.past, "No past visits yet.")}</TabsContent>
        <TabsContent value="archived">{list(views.archived, "Nothing archived.")}</TabsContent>
      </Tabs>
    </>
  );
}
