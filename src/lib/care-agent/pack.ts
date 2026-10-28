// Care Agent: the context pack. Pure: it receives rows ALREADY READ under the caller's own session (RLS) and turns them into the
// bounded, privacy-filtered text the model sees. It never reads, writes or logs anything.
//
// Privacy is decided HERE and at query time, before an item enters the pack object, the rendered prompt, a citation label or the
// returned sources. Restricted text is never "included and instructed away".
//   * visits false    -> no visit, visit follow-up or medication-change items
//   * meds false      -> no medication, dose-report or medication-change items
//   * schedule false  -> no shift, gap, task, watch-item or handoff items
//   * Amendment A (handoffs): schedule false -> none; schedule true + meds false -> id, generic label, time and `ate` ONLY
//     (meds_taken, note, unusual and watch_answers are never selected, never read here, never rendered); both -> all fields.
//   * Q1 (free text): for a member without medication visibility, visit notes/summary/reason and task, follow-up and watch text
//     are screened against the family's medication names; a matching value is withheld WHOLE. If the name set cannot be
//     established (it never can be under a med-blind caller's own RLS session) EVERY such value is withheld (fail closed).
//   * Never in any pack: transcripts, audio paths/URLs/MIME, consent data, speaker maps, phone numbers, handoff recording metadata.
import type { DoseOccurrence } from "@/lib/dose-administration";
import { AGENT_LIMITS, PACK_ID_PATTERN, TRUNCATION_MARKER, type Language } from "./contract";

export interface PackAccess {
  visits: boolean;
  meds: boolean;
  schedule: boolean;
}

export type PackItemType =
  "recipient" | "visit" | "medchange" | "med" | "dose" | "handoff" | "shift" | "task" | "watch";

export interface PackItem {
  id: string;
  type: PackItemType;
  /** Sanitised, generic label: built only from structured values, so it can never carry restricted text. */
  label: string;
  body: string;
  /** True when something was withheld from this item for this member. */
  withheld: boolean;
}

// ---- rows as SELECTED (explicit column lists; see care-agent-source) -------------------------------------------------------------
export interface RecipientRow {
  id: string;
  name: string;
}
export interface MemberNameRow {
  id: string;
  name: string;
}
export interface VisitRow {
  id: string;
  status: string;
  confirmation_status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  provider_name: string | null;
  office_name: string | null;
  reason: string | null;
  notes: string | null;
  summary: string | null;
}
export interface MedChangeRow {
  id: string;
  visit_id: string | null;
  medication: string;
  before: string | null;
  after: string | null;
  confirmed_at: string | null;
  unclear: boolean;
}
export interface TaskRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  owner_member_id: string | null;
  source_visit_id: string | null;
}
export interface WatchRow {
  id: string;
  text: string;
  status: string;
  ends_on: string | null;
  source_visit_id: string | null;
}
export interface MedicationRow {
  id: string;
  name: string;
  dose: string | null;
  schedule: string | null;
  status: string;
}
/** Metadata tier: this is the ONLY handoff shape a medication-blind member's query returns. */
export interface HandoffMetaRow {
  id: string;
  created_at: string;
  author_member_id: string | null;
  ate: boolean | null;
}
export interface HandoffFullRow extends HandoffMetaRow {
  meds_taken: boolean | null;
  note: string | null;
  unusual: string | null;
  watch_answers: unknown;
}
export interface ShiftRow {
  id: string;
  start: string;
  end: string;
  assigned_member_id: string | null;
  status: string;
}

export interface PackRows {
  recipient: RecipientRow | null;
  members: MemberNameRow[];
  visits: VisitRow[];
  medChanges: MedChangeRow[];
  followUpTasks: TaskRow[];
  followUpWatch: WatchRow[];
  medications: MedicationRow[];
  doses: DoseOccurrence[];
  handoffs: Array<HandoffMetaRow | HandoffFullRow>;
  shifts: ShiftRow[];
  tasks: TaskRow[];
  watch: WatchRow[];
  /** Medication names for the Q1 screen. null/empty = could not be established. Never placed in the pack. */
  medNames: string[] | null;
}

export interface ContextPack {
  now: string;
  timezone: string;
  language: Language;
  access: PackAccess;
  notes: string[];
  items: PackItem[];
  omitted: { watch: boolean; tasks: boolean; doses: boolean };
  /** The text placed between the PACK fences. */
  rendered: string;
  byId: Map<string, PackItem>;
}

export type PackResult = { ok: true; pack: ContextPack } | { ok: false; code: "context_too_large" };

// ---- fixed lines -----------------------------------------------------------------------------------------------------------------

/** Verbatim from the Consolidated Execution Brief, Amendment A. */
export const WITHHELD_HANDOFF_LINE =
  "Handoff details: free-text and medication-related handoff fields are withheld from this member because they may contain medication information outside this member's visibility.";
export const WITHHELD_FREE_TEXT_LINE =
  "Free-text details: visit, task, follow-up and watch-item text that may contain medication information is withheld from this member; only structured details are shown for those items.";
const NOTE_ORIGIN =
  "All records below were entered or reported by family caregivers. None are imported from a medical provider.";
const NOTE_DOSE_STATUS =
  "Dose status values are caregiver reports: Given, Not given (with a reason when recorded), or Not confirmed. Not confirmed means no one has reported the dose; it does NOT mean the dose was missed or skipped.";
const NOTE_WINDOWS =
  "Coverage of this pack: dose reports from the last 48 hours only; the 3 most recent handoffs only; shifts, tasks and watch items for the next 7 days only; only the next upcoming visit and the most recent completed visit. Do not generalize beyond these windows (no 'ever', 'always' or 'no history').";
const NOTE_ABSENT =
  "Only the records listed below exist for this question. Anything not listed is not in the records this assistant can access.";
const NOTE_GAPS =
  "Coverage gaps are not computed: no required-coverage hours are available. Shifts with no assigned person are marked 'unassigned'.";
const NOTE_OMITTED =
  "Some lower-priority items (watch items, tasks or older dose reports) were omitted to fit; an item's absence below does not mean it does not exist.";
export const NOT_VISIBLE_LINES = {
  meds: "Medications, dose reports and medication changes: not visible to this member.",
  visits: "Visits, visit follow-ups and medication changes: not visible to this member.",
  schedule: "Shifts, coverage, tasks, watch items and handoffs: not visible to this member.",
} as const;

// ---- text helpers ----------------------------------------------------------------------------------------------------------------

/** One line, no control characters, no fence tokens. */
export function cleanText(s: string): string {
  return s
    .replace(/\p{Cc}+/gu, " ")
    .replace(/<<<|>>>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cap at `max`; the only truncation allowed is at a word boundary and it ends with the explicit marker. */
export function capItem(text: string, max: number = AGENT_LIMITS.itemMaxChars): string {
  if (text.length <= max) return text;
  const room = max - TRUNCATION_MARKER.length - 1;
  let cut = text.slice(0, room);
  const space = cut.lastIndexOf(" ");
  cut = space > 0 ? cut.slice(0, space) : cut;
  return `${cut.trimEnd()} ${TRUNCATION_MARKER}`;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP_TOKENS = new Set([
  "oral",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "daily",
  "once",
  "twice",
  "with",
  "and",
  "the",
]);

/** Case-insensitive: does the text contain any medication name (whole name, or a distinctive word of it)? */
export function containsMedicationName(text: string, names: string[]): boolean {
  const t = fold(text);
  for (const raw of names) {
    const name = fold(raw).trim();
    if (name.length < 3) continue;
    if (t.includes(name)) return true;
    for (const tok of name.split(/[\s/,()-]+/))
      if (tok.length >= 4 && !STOP_TOKENS.has(tok) && !/^\d/.test(tok) && t.includes(tok))
        return true;
  }
  return false;
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

function makeFormatters(timezone: string, language: Language) {
  const locale = language === "es" ? "es-US" : "en-US";
  const dt = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const d = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const dUtc = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return {
    time: (iso: string) => dt.format(new Date(iso)),
    day: (iso: string) => d.format(new Date(iso)),
    dateOnly: (ymd: string) => dUtc.format(new Date(`${ymd}T12:00:00Z`)),
  };
}

const NOT_GIVEN_LABEL: Record<string, string> = {
  refused: "refused",
  unwell: "unwell",
  unavailable: "medication unavailable",
  skipped_on_purpose: "skipped on purpose",
  other: "other reason",
};

const ymdInZone = (instant: Date, timezone: string): string => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return p;
};

// ---- the builder -----------------------------------------------------------------------------------------------------------------

export function buildContextPack(input: {
  now: Date;
  timezone: string;
  language: Language;
  access: PackAccess;
  rows: PackRows;
}): PackResult {
  const { now, timezone, language, access, rows } = input;
  const f = makeFormatters(timezone, language);
  const nowMs = now.getTime();
  const nameOf = new Map(rows.members.map((m) => [m.id, firstName(m.name)]));
  const memberFirst = (id: string | null) => (id ? nameOf.get(id) || "" : "");

  // Q1: free text for a member who cannot see medications.
  const medNames = (rows.medNames ?? []).filter((n) => n && n.trim() !== "");
  const canScreen = medNames.length > 0;
  let anyFreeTextWithheld = false;
  const free = (value: string | null | undefined): { text: string | null; withheld: boolean } => {
    const v = value == null ? "" : cleanText(value);
    if (v === "") return { text: null, withheld: false };
    if (access.meds) return { text: v, withheld: false };
    if (!canScreen || containsMedicationName(v, medNames)) {
      anyFreeTextWithheld = true;
      return { text: null, withheld: true };
    }
    return { text: v, withheld: false };
  };
  const q = (label: string, r: { text: string | null; withheld: boolean }) =>
    r.text ? `${label}: "${r.text}"` : r.withheld ? `${label}: [details withheld]` : "";
  const join = (parts: string[]) => parts.filter(Boolean).join("; ");

  const items: PackItem[] = [];
  const push = (it: PackItem) => {
    if (!PACK_ID_PATTERN.test(it.id)) return; // an id that does not match the typed pattern can never be cited
    items.push({ ...it, body: capItem(cleanText(it.body)), label: cleanText(it.label) });
  };

  if (rows.recipient)
    push({
      id: `recipient:${rows.recipient.id}`,
      type: "recipient",
      label: "Care recipient",
      body: `Care recipient: ${cleanText(rows.recipient.name)}`,
      withheld: false,
    });

  // ---- visits (visits gate) ----
  const visitIds = new Set<string>();
  if (access.visits) {
    const withTime = rows.visits.filter((v) => v.scheduled_start);
    const upcoming = withTime
      .filter((v) => v.status === "scheduled" && Date.parse(v.scheduled_start!) >= nowMs)
      .sort((a, b) => Date.parse(a.scheduled_start!) - Date.parse(b.scheduled_start!))[0];
    const recent = withTime
      .filter((v) => v.status === "completed")
      .sort((a, b) => Date.parse(b.scheduled_start!) - Date.parse(a.scheduled_start!))[0];
    for (const v of [upcoming, recent]) {
      if (!v) continue;
      visitIds.add(v.id);
      const reason = free(v.reason);
      const notes = free(v.notes);
      const summary = free(v.summary);
      const who = cleanText(v.provider_name ?? "") || cleanText(v.office_name ?? "") || "visit";
      push({
        id: `visit:${v.id}`,
        type: "visit",
        label: `Visit — ${who}, ${f.time(v.scheduled_start!)}`,
        body: join([
          `Visit ${v.status}`,
          `confirmation: ${v.confirmation_status}`,
          `time: ${f.time(v.scheduled_start!)}`,
          v.provider_name ? `provider: ${cleanText(v.provider_name)}` : "",
          v.office_name ? `office: ${cleanText(v.office_name)}` : "",
          q("reason", reason),
          q("notes", notes),
          q("summary", summary),
        ]),
        withheld: reason.withheld || notes.withheld || summary.withheld,
      });
    }
  }
  const visitCount = items.filter((i) => i.type === "visit").length;

  // ---- visit-associated: confirmed medication changes (visits AND meds), follow-ups (visits gate) — combined cap 8 ----
  const assoc: PackItem[] = [];
  if (access.visits && access.meds)
    for (const m of rows.medChanges
      .filter((m) => m.visit_id && visitIds.has(m.visit_id) && m.confirmed_at && !m.unclear)
      .sort((a, b) => Date.parse(b.confirmed_at!) - Date.parse(a.confirmed_at!)))
      assoc.push({
        id: `medchange:${m.id}`,
        type: "medchange",
        label: `Medication change — ${cleanText(m.medication)}, ${f.day(m.confirmed_at!)}`,
        body: `Medication change confirmed by a family member on ${f.time(m.confirmed_at!)}: ${cleanText(m.medication)}${m.before ? ` from "${cleanText(m.before)}"` : ""}${m.after ? ` to "${cleanText(m.after)}"` : ""}`,
        withheld: false,
      });
  if (access.visits) {
    for (const t of rows.followUpTasks.filter(
      (t) => t.source_visit_id && visitIds.has(t.source_visit_id) && t.status === "open",
    )) {
      const title = free(t.title);
      assoc.push({
        id: `task:${t.id}`,
        type: "task",
        label: `Visit follow-up — ${t.due_date ? `due ${f.dateOnly(t.due_date)}` : "no due date"}`,
        body: join([
          `Visit follow-up task (open)`,
          `owner: ${memberFirst(t.owner_member_id) || "unassigned"}`,
          `due: ${t.due_date ? f.dateOnly(t.due_date) : "none"}`,
          q("text", title),
        ]),
        withheld: title.withheld,
      });
    }
    for (const w of rows.followUpWatch.filter(
      (w) => w.source_visit_id && visitIds.has(w.source_visit_id) && w.status === "active",
    )) {
      const text = free(w.text);
      assoc.push({
        id: `watch:${w.id}`,
        type: "watch",
        label: `Visit follow-up watch item${w.ends_on ? ` until ${f.dateOnly(w.ends_on)}` : ""}`,
        body: join([
          `Visit follow-up watch item (active)`,
          w.ends_on ? `until: ${f.dateOnly(w.ends_on)}` : "",
          q("text", text),
        ]),
        withheld: text.withheld,
      });
    }
  }
  assoc.slice(0, AGENT_LIMITS.visitAssociatedMax).forEach(push);

  // ---- medications and dose reports (meds gate) — combined cap 12 ----
  if (access.meds) {
    const meds = rows.medications
      .filter((m) => m.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name));
    let used = 0;
    for (const m of meds) {
      if (used >= AGENT_LIMITS.medicationSectionMax) break;
      push({
        id: `med:${m.id}`,
        type: "med",
        label: `Medication — ${cleanText(m.name)}`,
        body: join([
          `Active medication ${cleanText(m.name)}`,
          m.dose ? `dose: ${cleanText(m.dose)}` : "",
          m.schedule ? `schedule: ${cleanText(m.schedule)}` : "",
        ]),
        withheld: false,
      });
      used++;
    }
    const since = nowMs - AGENT_LIMITS.doseWindowHours * 3_600_000;
    const doses = rows.doses
      .filter(
        (d) =>
          d.scheduled_at &&
          d.time_state !== "skipped" &&
          Date.parse(d.scheduled_at) >= since &&
          Date.parse(d.scheduled_at) <= nowMs,
      )
      .sort((a, b) => Date.parse(b.scheduled_at!) - Date.parse(a.scheduled_at!));
    for (const d of doses) {
      if (used >= AGENT_LIMITS.medicationSectionMax) break;
      const when = f.time(d.scheduled_at!);
      const status =
        d.status === "given"
          ? `Given (reported${d.reported_by_name ? ` by ${firstName(d.reported_by_name)}` : ""}${d.reported_at ? ` at ${f.time(d.reported_at)}` : ""})`
          : d.status === "not_given"
            ? `Not given (reported${d.reported_by_name ? ` by ${firstName(d.reported_by_name)}` : ""}${d.reported_at ? ` at ${f.time(d.reported_at)}` : ""}${d.not_given_reason ? `; reason: ${NOT_GIVEN_LABEL[d.not_given_reason] ?? "other reason"}` : ""})`
            : "Not confirmed (no one has reported this dose)";
      push({
        id: `dose:${d.schedule_id}:${d.local_date}`,
        type: "dose",
        label: `Dose report — ${cleanText(d.medication_name)}, ${when}`,
        body: join([
          `Dose of ${cleanText(d.medication_name)}${d.dose_text ? ` ${cleanText(d.dose_text)}` : ""} scheduled ${when}`,
          `status: ${status}`,
          d.reports_differ ? "reports differ" : "",
        ]),
        withheld: false,
      });
      used++;
    }
  }

  // ---- handoffs (schedule gate; Amendment A tiers) ----
  if (access.schedule) {
    const recent = [...rows.handoffs]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, AGENT_LIMITS.handoffsMax);
    for (const h of recent) {
      const who = memberFirst(h.author_member_id) || "a family member";
      const when = f.time(h.created_at);
      const ate = h.ate === true ? "ate" : h.ate === false ? "did not eat" : "not recorded";
      if (!access.meds) {
        // METADATA TIER. Only id, created_at, author and `ate` are read. Nothing else on the row is touched.
        push({
          id: `handoff:${h.id}`,
          type: "handoff",
          label: `Handoff — ${who}, ${when}`,
          body: `Handoff at ${when} by ${who}. Ate: ${ate}.`,
          withheld: true,
        });
      } else {
        const full = h as HandoffFullRow;
        const note = free(full.note);
        const unusual = free(full.unusual);
        const answers =
          full.watch_answers &&
          typeof full.watch_answers === "object" &&
          !Array.isArray(full.watch_answers)
            ? Object.entries(full.watch_answers as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .slice(0, 5)
                .map(
                  ([k, v]) =>
                    `${cleanText(k).slice(0, 80)}: ${cleanText(v as string).slice(0, 80)}`,
                )
                .join("; ")
            : "";
        push({
          id: `handoff:${h.id}`,
          type: "handoff",
          label: `Handoff — ${who}, ${when}`,
          body: join([
            `Handoff at ${when} by ${who}`,
            `ate: ${ate}`,
            `meds taken (caregiver answer): ${full.meds_taken === true ? "yes" : full.meds_taken === false ? "no" : "not recorded"}`,
            q("note", note),
            q("unusual", unusual),
            answers ? `watch answers: ${answers}` : "",
          ]),
          withheld: false,
        });
      }
    }
  }

  // ---- coordination (schedule gate) — combined cap 8: shifts, then tasks, then watch items ----
  if (access.schedule) {
    const horizon = nowMs + AGENT_LIMITS.coordinationDays * 86_400_000;
    const today = ymdInZone(now, timezone);
    const coord: PackItem[] = [];
    for (const s of rows.shifts
      .filter((s) => Date.parse(s.end) > nowMs && Date.parse(s.start) < horizon)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)))
      coord.push({
        id: `shift:${s.id}`,
        type: "shift",
        label: `Shift — ${memberFirst(s.assigned_member_id) || "unassigned"}, ${f.day(s.start)}`,
        body: `Shift ${f.time(s.start)} to ${f.time(s.end)}; assigned: ${memberFirst(s.assigned_member_id) || "unassigned"}; status: ${s.status}`,
        withheld: false,
      });
    for (const t of rows.tasks.filter((t) => !t.source_visit_id && t.status === "open")) {
      const title = free(t.title);
      coord.push({
        id: `task:${t.id}`,
        type: "task",
        label: `Task — ${t.due_date ? `due ${f.dateOnly(t.due_date)}` : "no due date"}`,
        body: join([
          `Task (open)`,
          `owner: ${memberFirst(t.owner_member_id) || "unassigned"}`,
          `due: ${t.due_date ? f.dateOnly(t.due_date) : "none"}`,
          q("text", title),
        ]),
        withheld: title.withheld,
      });
    }
    for (const w of rows.watch.filter(
      (w) => !w.source_visit_id && w.status === "active" && (!w.ends_on || w.ends_on >= today),
    )) {
      const text = free(w.text);
      coord.push({
        id: `watch:${w.id}`,
        type: "watch",
        label: `Watch item${w.ends_on ? ` until ${f.dateOnly(w.ends_on)}` : ""}`,
        body: join([
          `Watch item (active)`,
          w.ends_on ? `until: ${f.dateOnly(w.ends_on)}` : "",
          q("text", text),
        ]),
        withheld: text.withheld,
      });
    }
    coord.slice(0, AGENT_LIMITS.coordinationMax).forEach(push);
  }

  // ---- notes (visibility and withheld lines are NEVER dropped) ----
  const notes: string[] = [NOTE_ORIGIN, NOTE_DOSE_STATUS, NOTE_WINDOWS, NOTE_ABSENT];
  if (!access.meds) notes.push(NOT_VISIBLE_LINES.meds);
  if (!access.visits) notes.push(NOT_VISIBLE_LINES.visits);
  if (!access.schedule) notes.push(NOT_VISIBLE_LINES.schedule);
  if (access.schedule && !access.meds) notes.push(WITHHELD_HANDOFF_LINE);
  if (!access.meds && (anyFreeTextWithheld || !canScreen)) notes.push(WITHHELD_FREE_TEXT_LINE);
  if (access.schedule) notes.push(NOTE_GAPS);
  void visitCount;

  // ---- render and enforce the ceiling: omit watch items, then tasks, then older dose reports. Nothing else is cut. ----
  const omitted = { watch: false, tasks: false, doses: false };
  const render = (): string => {
    const head = `CONTEXT\nTime zone: ${timezone}. Now: ${f.time(now.toISOString())}.\nNOTES\n${[...notes, ...(omitted.watch || omitted.tasks || omitted.doses ? [NOTE_OMITTED] : [])].map((n) => `- ${n}`).join("\n")}\nRECORDS`;
    return `${head}\n${items.length ? items.map((i) => `${i.id} | ${i.label} | ${i.body}`).join("\n") : "(none)"}`;
  };
  let rendered = render();
  const dropLast = (type: PackItemType): boolean => {
    for (let i = items.length - 1; i >= 0; i--)
      if (items[i]!.type === type) {
        items.splice(i, 1);
        return true;
      }
    return false;
  };
  const dropOldestDose = (): boolean => {
    for (let i = items.length - 1; i >= 0; i--)
      if (items[i]!.type === "dose") {
        items.splice(i, 1);
        return true;
      }
    return false; // doses are ordered newest first, so the last one is the oldest
  };
  while (rendered.length > AGENT_LIMITS.packMaxChars) {
    if (dropLast("watch")) omitted.watch = true;
    else if (dropLast("task")) omitted.tasks = true;
    else if (dropOldestDose()) omitted.doses = true;
    else return { ok: false, code: "context_too_large" };
    rendered = render();
  }

  return {
    ok: true,
    pack: {
      now: now.toISOString(),
      timezone,
      language,
      access,
      notes,
      items,
      omitted,
      rendered,
      byId: new Map(items.map((i) => [i.id, i])),
    },
  };
}
