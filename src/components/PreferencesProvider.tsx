import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { defaultPreferences, parsePreferences, preferencesKey, type Preferences } from "@/lib/preferences";

const PreferencesContext = createContext({
  preferences: defaultPreferences,
  update: (_patch: Partial<Preferences>) => {},
  storageAvailable: true,
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    try { setPreferences(parsePreferences(localStorage.getItem(preferencesKey))); }
    catch { setStorageAvailable(false); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.textSize = preferences.textSize;
    root.dataset.highContrast = String(preferences.highContrast);
    root.dataset.reduceMotion = String(preferences.reduceMotion);
    root.dataset.largeButtons = String(preferences.largeButtons);
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); }
    catch { setStorageAvailable(false); }
    return () => {
      delete root.dataset.textSize;
      delete root.dataset.highContrast;
      delete root.dataset.reduceMotion;
      delete root.dataset.largeButtons;
    };
  }, [preferences, ready]);
  return (
    <PreferencesContext.Provider value={{ preferences, storageAvailable, update: (patch) => setPreferences((p) => ({ ...p, ...patch })) }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export const usePreferences = () => useContext(PreferencesContext);