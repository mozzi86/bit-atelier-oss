// Theme selection core (80-03, D-P80-11/E-06): the third value "system" next to
// the existing "light"/"dark" ThemeProvider already stored — pure so both the
// provider (browser state) and DarstellungBereich (the settings radio group) build
// on the very same rule, and so it is testable without a DOM.
//
// In:  a raw stored/typed value, plus (for aufgeloestesTheme) whether the OS
//      currently prefers dark (matchMedia result). Out: THEME_WERTE,
//      normalisiereTheme, aufgeloestesTheme.

/** The three values a theme choice can take, in the order the radio group shows them.
 * @type {ReadonlyArray<"light"|"dark"|"system">} */
export const THEME_WERTE = Object.freeze(["light", "dark", "system"]);

/**
 * A valid theme value, or the safe default "light" for anything else (including
 * undefined/null — an empty localStorage read, an unknown stored string).
 * @param {unknown} wert
 * @returns {"light"|"dark"|"system"}
 */
export function normalisiereTheme(wert) {
  return THEME_WERTE.includes(/** @type {any} */ (wert)) ? /** @type {any} */ (wert) : "light";
}

/**
 * The actually rendered theme: "system" resolves through the OS preference,
 * "light"/"dark" (and anything else, defensively) stay themselves.
 * @param {unknown} wert a theme value (not necessarily normalised)
 * @param {boolean} prefersDark result of matchMedia('(prefers-color-scheme: dark)').matches
 * @returns {"light"|"dark"}
 */
export function aufgeloestesTheme(wert, prefersDark) {
  const w = normalisiereTheme(wert);
  if (w === "system") return prefersDark ? "dark" : "light";
  return w;
}
