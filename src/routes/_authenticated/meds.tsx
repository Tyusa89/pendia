import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, PageTitle, Panel, WithFamily } from "@/components/AppShell";
import { MedicationDay } from "@/components/medication-day/MedicationDay";
import { ScheduleEditor } from "@/components/medication-day/ScheduleEditor";
import { WEEKDAY_LABEL, describeSchedule, validateScheduleInput } from "@/lib/dose-administration";
import { buildInputs, saveSchedules } from "@/lib/med-schedule-save";
import { dateInZone } from "@/lib/zoned-time";
import { doseService, medicationService } from "@/services";

export const Route = createFileRoute("/_authenticated/meds")({
  head: () => ({
    meta: [
      { title: "Medications — Pendia" },
      { name: "description", content: "The shared current medication list." },
      { property: "og:title", content: "Medications — Pendia" },
      { property: "og:description", content: "The shared current medication list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <WithFamily>
      {({ family, me }) => <Meds familyId={family.id} timeZone={family.timezone} me={me} />}
    </WithFamily>
  ),
});

const statusStyle: Record<string, string> = {
  active: "bg-success text-success-foreground",
  paused: "bg-warning text-warning-foreground",
  stopped: "bg-muted text-muted-foreground",
};

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function Meds({
  familyId,
  timeZone,
  me,
}: {
  familyId: string;
  timeZone: string;
  me: { id: string; role: string; can_see_meds: boolean };
}) {
  const qc = useQueryClient();
  const isOrganizer = me.role === "organizer";
  const today = dateInZone(new Date(), timeZone);
  const { data = [] } = useQuery({
    queryKey: ["meds", familyId],
    queryFn: () => medicationService.list(familyId),
  });
  const schedKey = ["dose-schedules", familyId] as const;
  const schedules = useQuery({
    queryKey: schedKey,
    queryFn: () => doseService.listSchedules(familyId),
    enabled: isOrganizer || me.can_see_meds,
    retry: false,
  });

  const [adding, setAdding] = useState(false);
  const emptyForm = { name: "", dose: "", schedule: "" };
  const [f, setF] = useState(emptyForm);
  const [times, setTimes] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [starts, setStarts] = useState(today);
  // set once the medication row exists, so a retry only redoes the dose times
  const [savedMed, setSavedMed] = useState<{ id: string; name: string } | null>(null);
  const [partial, setPartial] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const cleanTimes = times.filter((t) => t.trim());
  const timeProblems = cleanTimes.length
    ? validateScheduleInput({
        medication_id: "x",
        local_time: cleanTimes[0] ?? "",
        days_of_week: days,
        starts_on: starts,
        ends_on: null,
      })
    : {};

  const reset = () => {
    setF(emptyForm);
    setTimes([]);
    setDays(ALL_DAYS);
    setStarts(today);
    setSavedMed(null);
    setPartial(false);
    setAdding(false);
  };

  const refetchAll = async () => {
    await Promise.all([
      qc.refetchQueries({ queryKey: ["meds", familyId] }),
      qc.refetchQueries({ queryKey: schedKey }),
    ]);
    qc.invalidateQueries({ queryKey: ["dose-occurrences", familyId] });
  };

  const saveTimes = (medId: string) =>
    saveSchedules(buildInputs(medId, cleanTimes, days, starts), {
      list: () => doseService.listSchedules(familyId),
      add: (i) => doseService.addSchedule(familyId, i),
    });

  const save = useMutation({
    mutationFn: async () => {
      let med = savedMed;
      if (!med) {
        const row = await medicationService.add({ ...f, family_id: familyId });
        med = { id: row.id, name: row.name };
        setSavedMed(med);
      }
      if (cleanTimes.length) {
        try {
          await saveTimes(med.id);
        } catch {
          await refetchAll();
          return { med, timesSaved: false };
        }
      }
      await refetchAll();
      // confirm from freshly read data before saying it worked
      const meds = qc.getQueryData<{ id: string }[]>(["meds", familyId]) ?? [];
      if (!meds.some((m) => m.id === med.id)) throw new Error("The medication could not be confirmed.");
      return { med, timesSaved: true };
    },
    onSuccess: ({ med, timesSaved }) => {
      if (!timesSaved) {
        setPartial(true);
        return;
      }
      toast.success(
        cleanTimes.length ? `${med.name} and its dose times were saved.` : `${med.name} was saved.`,
      );
      reset();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const schedMutation = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refetchAll(),
    onError: (e) => toast.error((e as Error).message),
  });

  const activeSchedules = (medId: string) =>
    (schedules.data ?? [])
      .filter((s) => s.medication_id === medId && (!s.ends_on || s.ends_on >= today))
      .sort((a, b) => a.local_time.localeCompare(b.local_time));

  const canSave =
    !!f.name.trim() &&
    !save.isPending &&
    (cleanTimes.length === 0 || Object.keys(timeProblems).length === 0);

  return (
    <>
      <PageTitle
        title="Medications"
        subtitle="What she's taking right now."
        action={
          isOrganizer ? (
            <Button variant="outline" onClick={() => (adding ? reset() : setAdding(true))}>
              {adding ? "Cancel" : "Add medication"}
            </Button>
          ) : undefined
        }
      />
      {adding && isOrganizer && (
        <Panel className="mb-5 max-w-4xl space-y-4" aria-label="Add medication">
          <div className="space-y-1">
            <Label htmlFor="med-name">Medication name</Label>
            <Input
              id="med-name"
              value={f.name}
              disabled={!!savedMed}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="med-dose">Dose</Label>
              <Input
                id="med-dose"
                placeholder="e.g. 10 mg"
                value={f.dose}
                disabled={!!savedMed}
                onChange={(e) => setF({ ...f, dose: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="med-instr">Instructions (optional)</Label>
              <Input
                id="med-instr"
                placeholder="e.g. with breakfast"
                value={f.schedule}
                disabled={!!savedMed}
                onChange={(e) => setF({ ...f, schedule: e.target.value })}
              />
            </div>
          </div>

          <fieldset className="space-y-3 border-t border-border pt-3">
            <legend className="font-semibold">Dose times (optional)</legend>
            <p className="text-muted-foreground">
              Add the times it's due. Family members will be asked to report each one.
            </p>
            {times.map((t, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`new-time-${idx}`}>Time {idx + 1}</Label>
                  <Input
                    id={`new-time-${idx}`}
                    type="time"
                    value={t}
                    onChange={(e) => setTimes(times.map((x, j) => (j === idx ? e.target.value : x)))}
                  />
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Remove time ${idx + 1}`}
                  onClick={() => setTimes(times.filter((_, j) => j !== idx))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setTimes([...times, times.length ? "20:00" : "08:00"])}
            >
              Add a dose time
            </Button>
            {cleanTimes.length > 0 && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="new-start">Start date</Label>
                  <Input
                    id="new-start"
                    type="date"
                    value={starts}
                    onChange={(e) => setStarts(e.target.value)}
                  />
                  {timeProblems.starts_on && (
                    <p className="text-destructive">{timeProblems.starts_on}</p>
                  )}
                </div>
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1 font-semibold">Repeat on</legend>
                  {ALL_DAYS.map((d) => (
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
                {timeProblems.days_of_week && (
                  <p className="text-destructive">{timeProblems.days_of_week}</p>
                )}
              </>
            )}
          </fieldset>

          {partial ? (
            <div role="alert" className="space-y-3 rounded-md bg-muted p-3">
              <p className="font-semibold">Medication saved, but dose times were not saved.</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Retrying…" : "Retry dose times"}
                </Button>
                <Button variant="outline" disabled={save.isPending} onClick={reset}>
                  Continue without dose times
                </Button>
              </div>
            </div>
          ) : (
            <Button className="w-full" disabled={!canSave} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save medication & schedule"}
            </Button>
          )}
        </Panel>
      )}
      <MedicationDay familyId={familyId} timeZone={timeZone} me={me} />
      {data.length === 0 ? (
        <Empty>No medications listed.</Empty>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 min-[1800px]:grid-cols-3">
          {data.map((m) => {
            const mine = activeSchedules(m.id);
            return (
              <Panel key={m.id} className="space-y-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-xl font-semibold">
                      {m.name} <span className="font-normal text-muted-foreground">{m.dose}</span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[0.8235rem] font-bold capitalize ${statusStyle[m.status]}`}
                  >
                    {m.status}
                  </span>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="font-semibold">Dose times</p>
                  {mine.length ? (
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {mine.map((s) => (
                        <li key={s.id}>
                          {describeSchedule(s)}
                          {s.ends_on ? ` · ends ${s.ends_on}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">No dose times set</p>
                  )}
                  {m.schedule && (
                    <p className="mt-2 text-muted-foreground">
                      <span className="font-semibold text-foreground">Instructions:</span>{" "}
                      {m.schedule}
                    </p>
                  )}
                </div>
                {isOrganizer && !schedules.isError && (
                  <Button
                    variant="outline"
                    aria-expanded={editing === m.id}
                    onClick={() => setEditing(editing === m.id ? null : m.id)}
                  >
                    {editing === m.id ? "Done" : mine.length ? "Edit dose times" : "Add dose times"}
                  </Button>
                )}
                {editing === m.id && (
                  <ScheduleEditor
                    fixedMedicationId={m.id}
                    medications={[{ id: m.id, name: m.name }]}
                    schedules={(schedules.data ?? []).filter((s) => s.medication_id === m.id)}
                    today={today}
                    busy={schedMutation.isPending}
                    error={schedMutation.error ? (schedMutation.error as Error).message : null}
                    onAdd={(i) => schedMutation.mutate(() => doseService.addSchedule(familyId, i))}
                    onEnd={(id) => schedMutation.mutate(() => doseService.endSchedule(id, today))}
                    onDelete={(id) => schedMutation.mutate(() => doseService.deleteSchedule(id))}
                  />
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
