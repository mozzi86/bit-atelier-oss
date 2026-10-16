// Remembers the fee calculator's hand-over (94-03, B-ABN-05). "Als
// Honorarangebot übernehmen" passes the calculator's fields to the offer
// wizard once, in the router state; closing the wizard (e.g. to create the
// missing project first) lost them, and "Neues Angebot" opened it empty.
// The hand-over now stays in sessionStorage until an offer has been created.
//
// sessionStorage is a per-tab convenience: blocked storage simply means the
// old behaviour (the wizard opens without the hand-over).
//
// In:  the hand-over object (fields of a Honorarangebot). Out: merke/lies/vergiss.

const SCHLUESSEL = "bit-honorar-vorschlag";

/**
 * Stores the hand-over for later openings of the wizard in this tab.
 * @param {Record<string, any>|null|undefined} vorschlag
 * @param {Storage|undefined} [speicher] defaults to window.sessionStorage
 * @returns {void}
 */
export function merkeVorschlag(vorschlag, speicher = globalThis.sessionStorage) {
  if (!vorschlag || typeof vorschlag !== "object") return;
  try { speicher?.setItem(SCHLUESSEL, JSON.stringify(vorschlag)); } catch { /* storage blocked: no memory */ }
}

/**
 * The remembered hand-over, or null.
 * @param {Storage|undefined} [speicher] defaults to window.sessionStorage
 * @returns {Record<string, any>|null}
 */
export function liesVorschlag(speicher = globalThis.sessionStorage) {
  try {
    const roh = speicher?.getItem(SCHLUESSEL);
    const wert = roh ? JSON.parse(roh) : null;
    return wert && typeof wert === "object" ? wert : null;
  } catch {
    return null;
  }
}

/**
 * Forgets the hand-over (after an offer was created from it).
 * @param {Storage|undefined} [speicher] defaults to window.sessionStorage
 * @returns {void}
 */
export function vergissVorschlag(speicher = globalThis.sessionStorage) {
  try { speicher?.removeItem(SCHLUESSEL); } catch { /* storage blocked */ }
}
