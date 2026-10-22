import { useEffect, useState } from "react";

/** True when the person's device asks for less motion. Read in the browser only; the demo then shows things at once. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Either the device setting or Pendia's own Preferences switch (a data attribute the signed-in shell sets).
    const read = () => q.matches || document.documentElement.dataset["reduceMotion"] === "true";
    setReduced(read());
    const on = () => setReduced(read());
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
