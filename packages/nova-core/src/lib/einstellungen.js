// Setting core (80-01, D-P80-B). The Setting entity is a key/value store without a
// uniqueness constraint: two letterhead editors each created a row of their own and
// three readers took rows[0] (FINDINGS-BACKLOG-17). This module turns it into "one
// row per key" — pick the newest row, plan an upsert, report duplicates.
//
// It never deletes a duplicate. Which of two rows holds the value the user meant is
// not decidable here, so a silent clean-up could throw away the right one; the count
// is shown in Einstellungen › System instead.
//
// In:  Setting rows as the data layer returns them ({id, key, value, created_date?,
//      updated_date?}). Out: EBENEN, EINSTELLUNG_EREIGNIS, neuesteZeile, upsertPlan,
//      doppelteSchluessel. Pure and import-free: loads under node and in every package.

/**
 * Where a setting lives, from the narrowest to the widest scope:
 * - `geraet`:  this browser only (localStorage: language, theme, dismissed hints).
 * - `buero`:   a Setting row shared by the whole office (letterhead, rule values).
 * - `projekt`: a field on the Project record (applies to one project).
 * - `build`:   a compile-time constant of the build (DATENQUELLE, SERVERLOS) — read-only.
 * @type {ReadonlyArray<'geraet'|'buero'|'projekt'|'build'>}
 */
export const EBENEN = Object.freeze(["geraet", "buero", "projekt", "build"]);

/**
 * Window event fired after a Setting row was written or removed through this core.
 * `event.detail` is `{key}` (the Setting key), so a listener reloads only its own key.
 * @type {string}
 */
export const EINSTELLUNG_EREIGNIS = "einstellung:geaendert";

/**
 * Timestamp a row is ranked by: updated_date, else created_date, else "".
 * ISO strings of one data path compare correctly as strings.
 * @param {any} zeile
 * @returns {string}
 */
function zeitVon(zeile) {
  return String(zeile?.updated_date || zeile?.created_date || "");
}

/**
 * The newest of several rows of ONE key: the latest `updated_date` wins (fallback
 * `created_date`); on a tie the row that comes first in the input stays.
 * @param {ReadonlyArray<any>|null|undefined} rows rows of one key (non-objects are ignored)
 * @returns {{zeile: any, doppelt: number}} `zeile` null for no row; `doppelt` = number of
 *   rows when there is more than one, else 0
 */
export function neuesteZeile(rows) {
  const liste = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  let zeile = null;
  for (const r of liste) if (!zeile || zeitVon(r) > zeitVon(zeile)) zeile = r;
  return { zeile, doppelt: liste.length > 1 ? liste.length : 0 };
}

/**
 * What a write of `key` has to do: update the newest row of that key, or create one.
 * @param {ReadonlyArray<any>|null|undefined} rows Setting rows (any keys; filtered here)
 * @param {string} key Setting key, e.g. "briefkopf" or "regel:personal.mindestlohn"
 * @returns {{aktion: 'create'|'update', id: string|null, doppelt: number}}
 */
export function upsertPlan(rows, key) {
  const eigene = (Array.isArray(rows) ? rows : []).filter((r) => r && r.key === key);
  const { zeile, doppelt } = neuesteZeile(eigene);
  return zeile ? { aktion: "update", id: zeile.id ?? null, doppelt } : { aktion: "create", id: null, doppelt: 0 };
}

/**
 * Keys that exist in more than one row, for the read-only report in Einstellungen › System.
 * @param {ReadonlyArray<any>|null|undefined} rows all Setting rows
 * @returns {Array<{key: string, anzahl: number}>} sorted by key; empty when every key is unique
 */
export function doppelteSchluessel(rows) {
  /** @type {Map<string, number>} */
  const zaehler = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.key !== "string") continue;
    zaehler.set(r.key, (zaehler.get(r.key) || 0) + 1);
  }
  return [...zaehler].filter(([, n]) => n > 1).map(([key, anzahl]) => ({ key, anzahl })).sort((a, b) => a.key.localeCompare(b.key));
}
