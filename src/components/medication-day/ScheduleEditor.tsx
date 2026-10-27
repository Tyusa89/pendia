// Organizer-only: fixed time of day + weekdays. No tapering, as-needed or interval schedules in this version.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/AppShell";
import {
  WEEKDAY_LABEL,
  describeSchedule,
  validateScheduleInput,
  type ScheduleInput,
} from "@/lib/dose-administration";

export interface ScheduleItem {
  id: string;
  medication_id: string;
  local_time: string;
  days_of_week: number[];
  starts_on: string;
  ends_on: string | null;
}

export function ScheduleEditor({
  medications,
  schedules,
  today,
  busy,
  error,
  onAdd,
  onEnd,
  onDelete,
}: {
  medications: { id: string; name: string }[];
  schedules: ScheduleItem[];
  today: string;
  busy: boolean;
  error: string | null;
  onAdd: (i: ScheduleInput) => void;
  onEnd: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [medId, setMedId] = useState("");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [starts, setStarts] = useState(today);
  const input: ScheduleInput = {
    medication_id: medId,
    local_time: time,
    days_of_week: days,
    starts_on: starts,
    ends_on: null,
  };
  const problems = validateScheduleInput(input);
  const name = (id: string) => medications.find((m) => m.id === id)?.name ?? "Medication";
  return (
    <Panel className="space-y-4" aria-label="Dose times">
      <h2 className="text-xl font-semibold">Dose times</h2>
      <p className="text-muted-foreground">
        Set the times each medication is due. Pendia shows each one on its day and asks family
        members to report it. The "When" text on a medication is only a note and does not create
        dose times.
      </p>
      {schedules.length > 0 && (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3"
            >
              <span>
                <span className="font-semibold">{name(s.medication_id)}</span> ·{" "}
                {describeSchedule(s)}
                {s.ends_on ? ` · ends ${s.ends_on}` : ""}
              </span>
              <span className="flex gap-2">
                {!s.ends_on && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onEnd(s.id)}>
                    End today
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(s.id)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 border-t border-border pt-3">
        <div className="space-y-1">
          <Label htmlFor="sched-med">Medication</Label>
          <select
            id="sched-med"
            className="h-12 w-full rounded-md border border-input bg-background px-3"
            value={medId}
            onChange={(e) => setMedId(e.target.value)}
          >
            <option value="">Choose…</option>
            {medications.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sched-time">Time</Label>
            <Input
              id="sched-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            {problems.local_time && <p className="text-destructive">{problems.local_time}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="sched-start">Starts</Label>
            <Input
              id="sched-start"
              type="date"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
            {problems.starts_on && <p className="text-destructive">{problems.starts_on}</p>}
          </div>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 font-semibold">Days</legend>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label
              key={d}
              className="flex min-h-11 min-w-14 items-center justify-center gap-2 rounded-md border border-input px-3"
            >
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={(e) =>
                  setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))
                }
              />
              {WEEKDAY_LABEL[d]}
            </label>
          ))}
        </fieldset>
        {problems.days_of_week && <p className="text-destructive">{problems.days_of_week}</p>}
        {error && (
          <p role="alert" className="font-medium text-destructive">
            {error}
          </p>
        )}
        <Button
          className="w-full"
          disabled={busy || !medId || Object.keys(problems).length > 0}
          onClick={() => onAdd(input)}
        >
          Add dose time
        </Button>
      </div>
    </Panel>
  );
}
