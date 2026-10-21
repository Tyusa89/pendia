import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageTitle, WithFamily } from "@/components/AppShell";
import { useMembers } from "@/hooks/use-family";
import { shiftService, type Member, type Shift } from "@/services";

export const Route = createFileRoute("/_authenticated/coverage")({
  head: () => ({ meta: [{ title: "Coverage — Pendia" }, { name: "description", content: "Who is with your loved one this week." }] }),
  component: () => <WithFamily>{({ me }) => <Coverage me={me} />}</WithFamily>,
});

const blocks = [
  { label: "Morning", hint: "8a–2p", hour: 8 },
  { label: "Afternoon", hint: "2p–8p", hour: 14 },
  { label: "Overnight", hint: "8p–8a", hour: 20 },
];

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

function Coverage({ me }: { me: Member }) {
  const qc = useQueryClient();
  // Demo data lives in the week of Oct 19 2026; default to the current week.
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const end = new Date(weekStart); end.setUTCDate(end.getUTCDate() + 7);
  const key = ["shifts", me.family_id, weekStart.toISOString()];
  const { data: shifts = [] } = useQuery({ queryKey: key, queryFn: () => shiftService.listRange(me.family_id, weekStart.toISOString(), end.toISOString()) });
  const { data: members = [] } = useMembers(me.family_id);
  const claim = useMutation({
    mutationFn: (id: string) => shiftService.claim(id, me.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("You're covering it — thank you"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i); return d; });
  const find = (day: Date, hour: number): Shift | undefined =>
    shifts.find((s) => { const st = new Date(s.start); return st.getUTCDate() === day.getUTCDate() && st.getUTCHours() === hour; });
  const open = shifts.filter((s) => !s.assigned_member_id).length;
  const shift = (n: number) => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + n * 7); setWeekStart(d); };

  return (
    <>
      <PageTitle title="Coverage" subtitle={open ? `${open} block${open > 1 ? "s" : ""} still need someone` : "Every block is covered"} />
      <div className="mb-4 flex items-center justify-between">
        <Button size="icon" variant="ghost" onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft /></Button>
        <p className="font-semibold">Week of {weekStart.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}</p>
        <Button size="icon" variant="ghost" onClick={() => shift(1)} aria-label="Next week"><ChevronRight /></Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2" />
              {days.map((d) => (
                <th key={d.toISOString()} className="p-2 text-center font-semibold">
                  {d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
                  <div className="text-xs font-normal text-muted-foreground">{d.getUTCDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.hour} className="border-t">
                <th className="p-2 text-left align-top font-semibold">{b.label}<div className="text-xs font-normal text-muted-foreground">{b.hint}</div></th>
                {days.map((d) => {
                  const s = find(d, b.hour);
                  if (!s) return <td key={d.toISOString()} className="p-1"><div className="h-16 rounded-lg bg-muted" /></td>;
                  const who = members.find((m) => m.id === s.assigned_member_id);
                  return (
                    <td key={d.toISOString()} className="p-1">
                      {who ? (
                        <div className={`flex h-16 items-center justify-center rounded-lg p-1 text-center font-semibold ${who.id === me.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                          {who.name.split(" ")[0]}
                        </div>
                      ) : (
                        <button onClick={() => claim.mutate(s.id)} className="flex h-16 w-full flex-col items-center justify-center rounded-lg border-2 border-unassigned-foreground/40 bg-unassigned font-bold text-unassigned-foreground">
                          Open<span className="text-xs font-medium">Tap to cover</span>
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shifts.length === 0 && <p className="mt-4 text-center text-muted-foreground">No blocks scheduled this week. The demo week is Oct 19.</p>}
    </>
  );
}
