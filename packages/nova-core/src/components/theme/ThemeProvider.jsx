import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { aufgeloestesTheme, normalisiereTheme } from "@core/lib/themeWahl";

/**
 * Schlanker, dependency-freier Theme-Provider (Hell/Dunkel/System, 80-03: D-P80-11,
 * E-06). Schaltet die `dark`-Klasse am <html> (Tailwind darkMode: ["class"]) nach
 * dem AUFGELÖSTEN Theme und persistiert die ROHE Wahl (auch "system") unter
 * "nc-theme" — derselbe Schlüssel wie vorher (80-01-Ära "light"/"dark"), sodass ein
 * bereits gespeicherter Wert unverändert weiter lädt. Bewusst ohne next-themes, da
 * dieses unter Vite eine zweite React-Kopie zieht ("Invalid hook call").
 */
const STORAGE_KEY = "nc-theme";

/**
 * @typedef {{
 *   theme: "light"|"dark"|"system",
 *   resolvedTheme: "light"|"dark",
 *   setTheme: (wert: "light"|"dark"|"system") => void,
 *   toggle: () => void,
 * }} ThemeKontext
 */
/** @type {React.Context<ThemeKontext>} */
const ThemeContext = createContext(
  /** @type {ThemeKontext} */ ({ theme: "system", resolvedTheme: "light", setTheme: () => {}, toggle: () => {} }),
);

/** @returns {"light"|"dark"|"system"} the stored value, or "system" when nothing is stored yet. */
function liesGespeichertesTheme() {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? "system" : normalisiereTheme(stored);
  } catch (e) { return "system"; }
}

/** @returns {boolean} current OS preference (NB-03: matchMedia can be missing/throw). */
function liesOsPraeferenz() {
  try { return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  catch (e) { return false; }
}

export default function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(liesGespeichertesTheme);
  const [osDunkel, setOsDunkel] = useState(liesOsPraeferenz);

  // Follows the OS preference live while theme === "system" — a laptop switching
  // to night mode at sunset must not need a reload.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    let abfrage;
    try { abfrage = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { return undefined; }
    const beiWechsel = (e) => setOsDunkel(e.matches);
    abfrage.addEventListener ? abfrage.addEventListener("change", beiWechsel) : abfrage.addListener(beiWechsel);
    return () => {
      abfrage.removeEventListener ? abfrage.removeEventListener("change", beiWechsel) : abfrage.removeListener(beiWechsel);
    };
  }, []);

  const resolvedTheme = aufgeloestesTheme(theme, osDunkel);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore: private mode / blocked storage (NB-03) */ }
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((t) => setThemeState(normalisiereTheme(t)), []);
  // Toggle sets the OPPOSITE of the currently resolved theme, explicitly
  // (never back to "system" — a deliberate light/dark choice by the header switch).
  const toggle = useCallback(
    () => setThemeState((t) => (aufgeloestesTheme(t, liesOsPraeferenz()) === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
