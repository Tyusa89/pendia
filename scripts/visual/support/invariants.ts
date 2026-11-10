import type { Page } from "@playwright/test";
import { createRequire } from "node:module";

export interface LayoutFacts {
  overflowX: number;
  mains: number;
  navs: number;
  skipLink: boolean;
  judgeBanner: boolean;
  medicalNote: boolean;
  /** Visible links/buttons/inputs shorter than 44px (inline text links are excluded). */
  smallTargets: string[];
  /** Elements whose text is cut off without an ellipsis. */
  clipped: string[];
  prefs: {
    textSize: string | undefined;
    highContrast: string | undefined;
    reduceMotion: string | undefined;
    largeButtons: string | undefined;
  };
  rootFontSize: number;
}

/** Runs entirely inside the page; shell-agnostic so it stays valid when the shell changes. */
export async function collectLayout(page: Page): Promise<LayoutFacts> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const label = (e: Element) =>
      `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}`;
    const targets = [
      ...document.querySelectorAll(
        "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=switch]",
      ),
    ].filter(
      (e) =>
        visible(e) && !e.closest(".sr-only") && !(e as HTMLElement).classList.contains("sr-only"),
    );
    const small = targets.filter((e) => {
      const cs = getComputedStyle(e);
      if (cs.display === "inline" && e.tagName === "A") return false; // inline text link inside a sentence
      return e.getBoundingClientRect().height < 43.5;
    });
    const clipped = [...document.querySelectorAll("body *")].filter((e) => {
      if (!visible(e) || !e.textContent?.trim()) return false;
      const cs = getComputedStyle(e);
      const hides = ["hidden", "clip"].includes(cs.overflowX);
      return (
        hides &&
        cs.textOverflow !== "ellipsis" &&
        e.scrollWidth > e.clientWidth + 1 &&
        e.children.length === 0
      );
    });
    const text = document.body.textContent ?? "";
    return {
      overflowX: de.scrollWidth - de.clientWidth,
      mains: document.querySelectorAll("main").length,
      navs: [...document.querySelectorAll("nav")].filter(visible).length,
      skipLink: !!document.querySelector('a[href="#care-content"]'),
      judgeBanner: text.includes(
        "Fictional hackathon demo · Read-only · No real patient information",
      ),
      medicalNote: text.includes("Not medical advice. Check with your doctor or pharmacist."),
      smallTargets: small.map(label),
      clipped: clipped.map(label),
      prefs: {
        textSize: de.dataset["textSize"],
        highContrast: de.dataset["highContrast"],
        reduceMotion: de.dataset["reduceMotion"],
        largeButtons: de.dataset["largeButtons"],
      },
      rootFontSize: parseFloat(getComputedStyle(de).fontSize),
    };
  });
}

export type AxeCounts = Record<string, number>;

const require_ = createRequire(import.meta.url);
const AXE_PATH = require_.resolve("axe-core/axe.min.js");

/** WCAG 2.0/2.1 A and AA violations as {ruleId: nodeCount}. */
export async function axeCounts(page: Page): Promise<AxeCounts> {
  // The dev server may re-optimise a dependency the first time a route is visited and reload the page once; retry across that.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState("networkidle");
      await page.addScriptTag({ path: AXE_PATH });
      return await runAxe(page);
    } catch (e) {
      if (attempt >= 3 || !String(e).includes("Execution context was destroyed")) throw e;
    }
  }
}

async function runAxe(page: Page): Promise<AxeCounts> {
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Document,
            o: unknown,
          ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    const res = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    const out: Record<string, number> = {};
    for (const v of res.violations) out[v.id] = v.nodes.length;
    return out;
  });
}

/** Waits for loading skeletons to finish; page content in Judge Demo mode comes from local fixtures. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(350);
}
