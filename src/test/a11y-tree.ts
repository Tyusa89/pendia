// Serialises the DOM as a class-free "accessible tree": element kind, role, accessible name, text and the attributes that matter to
// assistive technology and behaviour. Classes, styles and ids are deliberately left out, so a pure restyle (new tokens, new shared
// components) cannot change the output, while any structural, textual, role or state change does.
import { computeAccessibleName } from "dom-accessibility-api";

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const KEEP_ATTRS = [
  "type",
  "disabled",
  "checked",
  "required",
  "readonly",
  "role",
  "aria-live",
  "aria-invalid",
  "aria-required",
  "aria-expanded",
  "aria-pressed",
  "aria-current",
  "data-testid",
  "target",
  "rel",
  "download",
  "accept",
  "multiple",
] as const;
const BLOCKISH = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "UL",
  "OL",
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "LABEL",
  "FORM",
  "SECTION",
  "ARTICLE",
  "NAV",
  "MAIN",
  "HEADER",
  "FOOTER",
  "IMG",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "FIELDSET",
  "LEGEND",
  "OUTPUT",
]);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function describe(el: Element): string | null {
  if (SKIP.has(el.tagName)) return null;
  if (el.getAttribute("aria-hidden") === "true") return null;
  const tag = el.tagName.toLowerCase();
  const interesting =
    BLOCKISH.has(el.tagName) ||
    el.hasAttribute("role") ||
    el.hasAttribute("aria-live") ||
    el.hasAttribute("data-testid");
  if (!interesting) return "";
  const attrs = KEEP_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => {
    const v = el.getAttribute(a);
    return v === "" || v === a ? a : `${a}=${v}`;
  });
  if (el.tagName === "A" && el.hasAttribute("href")) attrs.push("href");
  if (el.tagName === "IMG") attrs.push(`alt=${el.getAttribute("alt") ?? ""}`);
  if (el.tagName === "INPUT" && !["file", "password"].includes((el as HTMLInputElement).type)) {
    const v = (el as HTMLInputElement).value;
    if (v) attrs.push(`value=${v}`);
  }
  if (el.tagName === "TEXTAREA" && (el as HTMLTextAreaElement).value)
    attrs.push(`value=${(el as HTMLTextAreaElement).value}`);
  let name = "";
  if (
    ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "IMG"].includes(el.tagName) ||
    el.hasAttribute("role")
  ) {
    try {
      name = clean(computeAccessibleName(el));
    } catch {
      name = "";
    }
  }
  return `${tag}${name ? ` "${name}"` : ""}${attrs.length ? ` [${attrs.join(" ")}]` : ""}`;
}

export function a11yTree(root: Element): string {
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = clean(node.textContent ?? "");
      if (t) lines.push(`${"  ".repeat(depth)}text "${t}"`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const d = describe(el);
    if (d === null) return;
    const interactiveLeaf = ["BUTTON", "A", "LABEL", "OPTION"].includes(el.tagName);
    if (d !== "") lines.push(`${"  ".repeat(depth)}${d}`);
    if (interactiveLeaf) return; // the accessible name already carries the text; avoid duplicating it
    for (const child of Array.from(el.childNodes)) walk(child, d === "" ? depth : depth + 1);
  };
  for (const child of Array.from(root.childNodes)) walk(child, 0);
  return lines.join("\n") + "\n";
}
