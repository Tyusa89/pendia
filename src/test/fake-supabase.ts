/* eslint-disable @typescript-eslint/no-explicit-any */
// A small in-memory stand-in for the Supabase client, with the row-level rules the real `shift` and `member` tables
// have: reads follow family membership, writes are organizer-only, a refused UPDATE/DELETE silently matches no rows
// (as in Postgres), a refused INSERT errors, assignees must be in the same family, and end > start. Fictional data only.
type Row = any;

export const fake = {
  me: { familyId: "fam-a", role: "organizer" as "organizer" | "member" },
  tables: { shift: [] as Row[], member: [] as Row[] },
  writes: [] as string[], // every write attempted, so tests can prove invalid input never reached the database
  reset() {
    this.me = { familyId: "fam-a", role: "organizer" };
    this.tables.shift = [];
    this.tables.member = [
      { id: "m-ana", family_id: "fam-a", name: "Ana" },
      { id: "m-ben", family_id: "fam-a", name: "Ben" },
      { id: "m-zed", family_id: "fam-b", name: "Zed" },
    ];
    this.writes = [];
  },
};
fake.reset();

let seq = 0;
const visible = (_table: string, r: Row) => r["family_id"] === fake.me.familyId;
const canWrite = (r: Row) => fake.me.role === "organizer" && r["family_id"] === fake.me.familyId;

class Q implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: any;
  private orderBy: string | null = null;
  private wantRows = true;
  private mode: "many" | "single" | "maybe" = "many";
  constructor(private table: "shift" | "member") {}
  select() {
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: any) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  is(c: string, v: any) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  lt(c: string, v: any) {
    this.filters.push((r) => Date.parse(r[c]) < Date.parse(v));
    return this;
  }
  gt(c: string, v: any) {
    this.filters.push((r) => Date.parse(r[c]) > Date.parse(v));
    return this;
  }
  gte(c: string, v: any) {
    this.filters.push((r) => Date.parse(r[c]) >= Date.parse(v));
    return this;
  }
  order(c: string) {
    this.orderBy = c;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  then<T1, T2>(a?: any, b?: any): Promise<T1 | T2> {
    return Promise.resolve(this.run()).then(a, b);
  }

  private shape(rows: Row[]) {
    if (this.mode === "single")
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "no rows" } };
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
  private run() {
    const t = fake.tables[this.table];
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === "select") {
      let rows = t.filter((r) => visible(this.table, r) && match(r));
      if (this.orderBy)
        rows = [...rows].sort((a, b) =>
          String(a[this.orderBy!]).localeCompare(String(b[this.orderBy!])),
        );
      return this.shape(rows.map((r) => ({ ...r })));
    }
    fake.writes.push(`${this.op} ${this.table}`);
    if (this.op === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({
        id: `s-${++seq}`,
        created_at: "2026-10-21T00:00:00Z",
        status: "open",
        assigned_member_id: null,
        ...p,
      }));
      for (const r of rows) {
        if (!canWrite(r))
          return {
            data: null,
            error: { message: 'new row violates row-level security policy for table "shift"' },
          };
        const err = this.check(r);
        if (err) return { data: null, error: { message: err } };
      }
      t.push(...rows);
      return this.shape(rows.map((r) => ({ ...r })));
    }
    const targets = t.filter((r) => visible(this.table, r) && canWrite(r) && match(r));
    if (this.op === "update") {
      for (const r of targets) {
        const next = { ...r, ...this.payload };
        const err = this.check(next);
        if (err) return { data: null, error: { message: err } };
      }
      for (const r of targets) Object.assign(r, this.payload);
      return this.shape(targets.map((r) => ({ ...r })));
    }
    for (const r of targets) t.splice(t.indexOf(r), 1);
    return this.shape(targets.map((r) => ({ ...r })));
  }
  private check(r: Row): string | null {
    if (this.table !== "shift") return null;
    if (!(Date.parse(r.end) > Date.parse(r.start)))
      return 'new row violates check constraint "shift_end_after_start"';
    if (!["open", "claimed", "swap"].includes(r.status))
      return 'new row violates check constraint "shift_status_check"';
    if (r.assigned_member_id) {
      const m = fake.tables.member.find((x) => x.id === r.assigned_member_id);
      if (!m || m.family_id !== r.family_id)
        return "cross-family reference: shift.assigned_member_id -> member";
    }
    return null;
  }
}

export const supabase = { from: (table: "shift" | "member") => new Q(table) };
