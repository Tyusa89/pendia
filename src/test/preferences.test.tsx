import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider, usePreferences } from "@/components/PreferencesProvider";
import { defaultPreferences, parsePreferences, preferencesKey } from "@/lib/preferences";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Controls() {
  const { preferences, update } = usePreferences();
  return <><button onClick={() => update({ highContrast: true, reduceMotion: true, largeButtons: true, textSize: "large", language: "es" })}>Apply preferences</button><output>{JSON.stringify(preferences)}</output></>;
}

describe("display preferences", () => {
  it("recovers safely from corrupt saved preferences", () => {
    expect(parsePreferences("not json")).toEqual(defaultPreferences);
    expect(parsePreferences('{"highContrast":"true","textSize":"huge"}')).toEqual(defaultPreferences);
  });
  it("persists choices and restores them after remounting", async () => {
    const first = render(<PreferencesProvider><Controls /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Apply preferences" }));
    await waitFor(() => expect(parsePreferences(localStorage.getItem(preferencesKey))).toEqual({ language: "es", textSize: "large", highContrast: true, reduceMotion: true, largeButtons: true }));
    first.unmount();
    render(<PreferencesProvider><Controls /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain('"language":"es"'));
    expect(document.documentElement.dataset["reduceMotion"]).toBe("true");
    expect(document.documentElement.dataset["highContrast"]).toBe("true");
    expect(document.documentElement.dataset["largeButtons"]).toBe("true");
    expect(document.documentElement.dataset["textSize"]).toBe("large");
  });
});