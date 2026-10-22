// The public /demo page must be as clean as the demo itself: no database client, service layer or family-data hook anywhere
// in what it imports, and rendering it touches none of them. (The app root separately listens for sign-in changes, which is
// inert for a visitor with no session; see the PR notes.)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { touched, spy } = vi.hoisted(() => {
  const names: string[] = [];
  return {
    touched: { names },
    spy: (name: string) => () => {
      names.push(name);
      throw new Error(`${name} must not be used by Demo Mode`);
    },
  };
});
vi.mock("@/integrations/supabase/client", spy("supabase client"));
vi.mock("@/services", spy("services"));
vi.mock("@/hooks/use-family", spy("use-family"));
vi.mock("@/components/AppShell", spy("AppShell"));

import { Route as PublicRoute } from "@/routes/demo";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("public /demo route", () => {
  it("renders the same demo with its banner, and touches no data layer", async () => {
    const Page = PublicRoute.options.component as React.ComponentType;
    render(<Page />);
    expect(screen.getByRole("note", { name: "Demo mode notice" })).toHaveTextContent(
      /DEMO MODE.*Prerecorded synthetic data.*No live Meta AI/s,
    );
    expect(
      screen.getByRole("button", { name: /Start a simulated doctor visit/ }),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start a simulated doctor visit/ }));
    });
    expect(touched.names).toEqual([]);
  });
  it("is a demo surface, not a product page: noindex, no sign-in wall, no family data", () => {
    const meta = (PublicRoute.options.head as () => { meta: Array<Record<string, string>> })().meta;
    expect(meta.find((m) => m["name"] === "robots")?.["content"]).toMatch(/noindex/);
    expect(PublicRoute.options.beforeLoad).toBeUndefined();
  });
});

describe("import graph", () => {
  const root = process.cwd();
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/")
      ? join(root, "src", spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(from), spec)
        : null;
    if (!base) return null;
    for (const c of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ])
      if (existsSync(c) && /\.tsx?$/.test(c)) return c;
    return null;
  };
  function graph(entries: string[]): { files: Set<string>; externals: Set<string> } {
    const files = new Set<string>();
    const externals = new Set<string>();
    const queue = entries.map((e) => join(root, e));
    while (queue.length) {
      const f = queue.pop()!;
      if (files.has(f)) continue;
      files.add(f);
      for (const m of readFileSync(f, "utf8").matchAll(
        /(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g,
      )) {
        const spec = (m[1] ?? m[2])!;
        const r = resolveImport(f, spec);
        if (r) queue.push(r);
        else externals.add(spec);
      }
    }
    return { files, externals };
  }
  const entries = ["src/routes/demo.tsx", "src/routes/_authenticated/visits.demo.tsx"];

  it("reaches no Supabase client, service layer, family hook or app shell", () => {
    const { files, externals } = graph(entries);
    const rel = [...files].map((f) => f.slice(root.length + 1));
    expect(rel.length).toBeGreaterThan(10);
    for (const f of rel)
      expect(f, f).not.toMatch(
        /integrations\/supabase|src\/services|hooks\/use-family|components\/AppShell|DesktopNavigation|PreferencesProvider/,
      );
    for (const e of externals) expect(e, e).not.toMatch(/supabase|twilio|openai|anthropic/i);
  });
  it("no file in the demo's graph reads the Meta key or an environment variable", () => {
    const { files } = graph(entries);
    for (const f of files)
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /META_API_KEY|process\.env|import\.meta\.env|api\.meta\.ai/,
      );
  });
});
