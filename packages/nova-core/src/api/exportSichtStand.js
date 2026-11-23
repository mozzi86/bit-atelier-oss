// exportSichtStand.js — the registered state behind api/exportSicht.js (wave 1, W1-BUERO-F1).
//
// Split out so ZugriffContext (entry chunk, at its size budget) imports only these few lines; the rules
// that read the state (exportSicht.js) load with the export code.
//
// In:  setzeExportSicht(zugriff, rechner). Out: exportSichtStand(), exportSichtZugriff(), EXPORT_LADEFEHLER.
// No imports.

/** @type {{zugriff?: any, rechner?: any}} the module starts "not loaded" (zugriff undefined) */
let zustand = {};

/**
 * Registers the access of the active role and the app's area calculator (ZugriffProvider).
 * @param {any} zugriff undefined = not loaded yet (every export is refused); EXPORT_LADEFEHLER (false) = the
 *   load failed without data (refused, except the emergency backup); null = no restriction at all
 *   (no rights system, e.g. unit tests); otherwise a Zugriff of rechte.js ({rolle, projektIds, …})
 * @param {any} rechner (zugriff) => (a promise of) {bereiche, ohne, ohneSettingKeys, ohneDokumentBereiche},
 *   the office areas the access may not export (src/lib/zugriffLader.js); null = none registered
 * @returns {void}
 */
export function setzeExportSicht(zugriff, rechner) {
  zustand = { zugriff, rechner };
}

/**
 * The registered state (read by exportSicht.js).
 * @returns {{zugriff?: any, rechner?: any}}
 */
export function exportSichtStand() {
  return zustand;
}

/**
 * R-BUERO-2: marker for "loading the rights failed and there is no earlier answer". Ordinary exports are
 * refused with their own message; only the error card's emergency backup may write (exportSicht.js).
 * `false` (not a string) only because this file sits in the entry chunk at its size budget.
 */
export const EXPORT_LADEFEHLER = false;

/**
 * What the ZugriffProvider registers for exports (pure, so the decision is testable without React).
 * Positional parameters keep the entry chunk small.
 * @param {any} wert fixed access of the provider (props.wert), if any
 * @param {any} lade the loader (props.lade), if any
 * @param {any} daten the last loaded data, null before the first success
 * @param {string|null} ladeFehler the last load error, null when the last load succeeded
 * @param {any} aktiv the access in use (wert, computed, or the owner fallback)
 * @returns {any} undefined = still loading (refuse), EXPORT_LADEFEHLER = load failed without data, else `aktiv`
 */
export function exportSichtZugriff(wert, lade, daten, ladeFehler, aktiv) {
  return wert || !lade || daten ? aktiv : ladeFehler ? EXPORT_LADEFEHLER : undefined;
}
