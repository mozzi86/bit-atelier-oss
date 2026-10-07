// fehlerbericht.js — plain-text error report for the route error boundary (70-07).
//
// In:  an Error (or anything thrown), the route path, a timestamp.
// Out: istLadefehler() tells a missing/unloadable chunk from a program error;
//      fehlerBerichtText() builds the text the user can copy into a mail.
//
// Pure, no imports, no network: nothing is sent anywhere (privacy line of the
// product — register no. 76 explicitly keeps reporting in the user's hands).
// The report carries no project data: message, route, time and a few stack lines.

/** Maximum stack lines in the report — enough to locate the module, not a dump. */
export const STACK_ZEILEN = 8;

// Browser wording for a dynamic import that cannot be fetched (after a deploy
// the old hashed chunk is gone). Chromium, WebKit and Firefox respectively; the
// last one is Vite's own preload helper when a chunk's CSS cannot be loaded
// (offline, or the CSS hash changed with a deploy).
const LADEFEHLER_RX = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Unable to preload CSS/i;

/**
 * True when the error means "the code for this page could not be loaded" —
 * then reloading (fresh index + chunk names) is the first remedy, not a bug report.
 * @param {unknown} fehler thrown value
 * @returns {boolean}
 */
export function istLadefehler(fehler) {
  if (!fehler) return false;
  const name = typeof fehler === "object" && fehler && "name" in fehler ? String(/** @type {any} */ (fehler).name) : "";
  if (name === "ChunkLoadError") return true;
  return LADEFEHLER_RX.test(meldungVon(fehler));
}

/**
 * Message of any thrown value (Error, string, object) — never throws itself.
 * @param {unknown} fehler
 * @returns {string}
 */
export function meldungVon(fehler) {
  if (fehler == null) return "Unbekannter Fehler";
  if (typeof fehler === "string") return fehler;
  if (typeof fehler === "object" && "message" in fehler && /** @type {any} */ (fehler).message) {
    return String(/** @type {any} */ (fehler).message);
  }
  try { return String(fehler); } catch { return "Unbekannter Fehler"; }
}

/**
 * Plain-text report, German labels (the office's working language; the text is
 * meant for the developer, the UI around it is translated).
 * @param {{fehler: unknown, pfad?: string, zeit?: Date, version?: string}} p
 * @returns {string}
 */
export function fehlerBerichtText({ fehler, pfad = "", zeit = new Date(), version = "" }) {
  const stackRoh = fehler && typeof fehler === "object" && "stack" in fehler ? String(/** @type {any} */ (fehler).stack || "") : "";
  const stack = stackRoh.split("\n").map((z) => z.trimEnd()).filter(Boolean).slice(0, STACK_ZEILEN);
  const zeilen = [
    "BIT-Atelier — Fehlerbericht",
    `Zeit: ${zeit.toISOString()}`,
    `Seite: ${pfad || "—"}`,
    `Art: ${istLadefehler(fehler) ? "Modul konnte nicht geladen werden" : "Programmfehler"}`,
    `Meldung: ${meldungVon(fehler)}`,
  ];
  if (version) zeilen.push(`Version: ${version}`);
  if (stack.length) zeilen.push("", "Stack:", ...stack);
  return zeilen.join("\n");
}
