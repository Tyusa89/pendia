import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { useMembers } from "@/hooks/use-family";
import { mondayOf } from "@/lib/week";
import { shiftService, type Member, type Shift } from "@/services";

export const Route = createFileRoute("/_authenticated/coverage")({
  head: () => ({
    meta: [
      { title: "Coverage — Pendia" },
      { name: "description", content: "Who is with your loved one this week." },
    ],
  }),
  component: () => <WithFamily>{({ me }) => <Coverage me={me} />}</WithFamily>,
});

const blocks = [
  { label: "Morning", short: "Morn", hint: "8a–2p", hour: 8 },
  { label: "Afternoon", short: "Aft", hint: "2p–8p", hour: 14 },
  { label: "Overnight", short: "Night", hint: "8p–8a", hour: 20 },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Row({
  label,
  short,
  hint,
  children,
}: {
  label: string;
  short: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="flex flex-col justify-center text-[0.8235rem] font-bold leading-tight">
        <span className="md:hidden">{short}</span>
        <span className="hidden md:inline">{label}</span>
        <span className="font-medium text-muted-foreground">{hint}</span>
      </span>
      {children}
    </>
  );
}

function Coverage({ me }: { me: Member }) {
  const qc = useQueryClient();
  // Demo data lives in the week of Oct 19 2026; default to the current week.
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 7);
  const key = ["shifts", me.family_id, weekStart.toISOString()];
  const { data: shifts = [] } = useQuery({
    queryKey: key,
    queryFn: () => shiftService.listRange(me.family_id, weekStart.toISOString(), end.toISOString()),
  });
  const { data: members = [] } = useMembers(me.family_id);
  const claim = useMutation({
    mutationFn: (id: string) => shiftService.claim(id, me.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("You're covering it — thank you");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const find = (day: Date, hour: number): Shift | undefined =>
    shifts.find((s) => {
      const st = new Date(s.start);
      return st.getUTCDate() === day.getUTCDate() && st.getUTCHours() === hour;
    });
  const open = shifts.filter((s) => !s.assigned_member_id).length;
  const shift = (n: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + n * 7);
    setWeekStart(d);
  };

  return (
    <>
      <PageTitle
        title="Coverage"
        subtitle={
          open ? `${open} block${open > 1 ? "s" : ""} still need someone` : "Every block is covered"
        }
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button size="icon" variant="ghost" onClick={() => shift(-1)} aria-label="Previous week">
          <ChevronLeft />
        </Button>
        <p className="text-center font-semibold">
          Week of{" "}
          {weekStart.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>
        <Button size="icon" variant="ghost" onClick={() => shift(1)} aria-label="Next week">
          <ChevronRight />
        </Button>
      </div>
      <section
        aria-label="This week"
        className="space-y-4 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card"
      >
        <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-1 md:grid-cols-[5rem_repeat(7,minmax(0,1fr))] md:gap-1.5">
          <span />
          {days.map((d) => (
            <span
              key={d.toISOString()}
              className="flex flex-col items-center justify-center rounded-lg py-1 text-[0.8235rem] font-bold leading-tight"
            >
              {d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
              <span className="font-medium text-muted-foreground">{d.getUTCDate()}</span>
            </span>
          ))}
          {blocks.map((b) => (
            <Row key={b.hour} label={b.label} short={b.short} hint={b.hint}>
              {days.map((d) => {
                const s = find(d, b.hour);
                const key = d.toISOString();
                if (!s)
                  return (
                    <span
                      key={key}
                      className="min-h-12 rounded-lg bg-muted md:min-h-14"
                      aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })} ${b.label}, no block`}
                    />
                  );
                const who = members.find((m) => m.id === s.assigned_member_id);
                const first = who?.name.split(" ")[0] ?? "";
                const dayName = d.toLocaleDateString(undefined, {
                  weekday: "long",
                  timeZone: "UTC",
                });
                if (!who)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => claim.mutate(s.id)}
                      disabled={claim.isPending}
                      aria-label={`Open: ${dayName} ${b.label}. Tap to cover it`}
                      className="flex min-h-12 min-w-0 cursor-pointer items-center justify-center rounded-lg max-md:pointer-events-none border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned p-0.5 text-[0.8235rem] font-bold leading-tight text-unassigned-foreground md:min-h-14 md:text-[0.9412rem]"
                    >
                      <span aria-hidden className="md:hidden">
                        +
                      </span>
                      <span aria-hidden className="hidden md:inline">
                        Open
                      </span>
                    </button>
                  );
                const mine = who.id === me.id;
                return (
                  <span
                    key={key}
                    title={who.name}
                    aria-label={`${dayName} ${b.label}: ${mine ? "you" : who.name}`}
                    className={`flex min-h-12 min-w-0 items-center justify-center overflow-hidden rounded-lg p-0.5 text-center text-[0.8235rem] font-bold leading-tight md:min-h-14 md:text-[0.9412rem] ${mine ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
                  >
                    <span aria-hidden className="md:hidden">
                      {mine ? "You" : initials(who.name)}
                    </span>
                    <span aria-hidden className="hidden truncate md:inline">
                      {mine ? "You" : first}
                    </span>
                  </span>
                );
              })}
            </Row>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9412rem] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="size-3.5 rounded bg-primary" />
            You
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3.5 rounded bg-secondary" />
            Family
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3.5 rounded border-[1.5px] border-dashed border-unassigned-foreground/60 bg-unassigned" />
            Open
          </li>
        </ul>
      </section>
      {open > 0 && (
        <section
          aria-label="Still open this week"
          className="mt-4 space-y-2 rounded-[1.25rem] bg-card p-[1.125rem] shadow-card"
        >
          <h2 className="font-sans text-base font-bold tracking-normal">Still open this week</h2>
          {shifts
            .filter((s) => !s.assigned_member_id)
            .map((s) => {
              const st = new Date(s.start);
              const b = blocks.find((x) => x.hour === st.getUTCHours());
              const label = `${st.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })} · ${(b?.label ?? "").toLowerCase()}`;
              return (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <p className="min-w-0">{label}</p>
                  <Button
                    variant="outline"
                    disabled={claim.isPending}
                    onClick={() => claim.mutate(s.id)}
                    aria-label={`Cover ${label}`}
                  >
                    Cover it
                  </Button>
                </div>
              );
            })}
        </section>
      )}
      {shifts.length === 0 && (
        <p className="mt-4 text-center text-muted-foreground">
          No blocks scheduled this week. The demo week is Oct 19.
        </p>
      )}
    </>
  );
}
