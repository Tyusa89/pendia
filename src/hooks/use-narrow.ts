import { useEffect, useState } from "react";

const QUERY = "(max-width: 767.98px)";

/** True under 768px (the phone layout). Defaults to the wide layout where matchMedia does not exist (tests). */
export function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const on = () => setNarrow(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, []);
  return narrow;
}
