export type Preferences = {
  language: "en" | "es" | null;
  textSize: "standard" | "large";
  highContrast: boolean;
  reduceMotion: boolean;
  largeButtons: boolean;
};

export const defaultPreferences: Preferences = {
  language: null,
  textSize: "standard",
  highContrast: false,
  reduceMotion: false,
  largeButtons: false,
};

export const preferencesKey = "pendia-display-preferences";

export function parsePreferences(raw: string | null): Preferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return { ...defaultPreferences };
    const p = value as Record<string, unknown>;
    return {
      language: p.language === "en" || p.language === "es" ? p.language : null,
      textSize: p.textSize === "large" ? "large" : "standard",
      highContrast: p.highContrast === true,
      reduceMotion: p.reduceMotion === true,
      largeButtons: p.largeButtons === true,
    };
  } catch {
    return { ...defaultPreferences };
  }
}