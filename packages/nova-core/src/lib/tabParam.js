// tabParam.js — resolves a `?tab=` URL value to a valid tab key (72-15, N-16).
//
// Why: tabbed pages (AVA first, later the AI centre) keep their active tab in the
// URL, so a link, a reload and the browser's Back button land on the same tab.
// The resolution rule lives here, pure and testable under Node; the React side
// (reading and writing the URL) is useTabParam.js. Same rule as aufloesen() in
// packages/nova-designer/src/config/designerNavigation.js: alias first, then
// validity, anything else falls back to the default.
//
// In:  the raw URL value, the allowed keys, the default key, an optional alias map.
// Out: always an allowed key or the default; a query string with `tab` set and
//      every other parameter (?beispiel, ?ticket …) kept.

/** Name of the query parameter that carries the active tab. */
export const TAB_PARAMETER = "tab";

/**
 * Own-key lookup: a raw URL value such as "constructor" must not resolve to an
 * Object.prototype member of the alias map.
 * @param {Record<string, string>} alias
 * @param {string} schluessel
 * @returns {string|undefined}
 */
function eigenerAlias(alias, schluessel) {
  return alias && Object.prototype.hasOwnProperty.call(alias, schluessel) ? alias[schluessel] : undefined;
}

/**
 * Resolves a raw `?tab=` value to one of the allowed tab keys.
 * Order: exact key → exact alias → key ignoring case → alias ignoring case →
 * default. Surrounding whitespace is ignored. An alias that points to a key
 * outside `erlaubt` counts as unknown.
 * @param {unknown} wert raw URL value (string, null when the parameter is missing)
 * @param {ReadonlyArray<string>} erlaubt allowed tab keys, e.g. ["lv", "control"]
 * @param {string} standard key returned for a missing, empty or unknown value
 * @param {Record<string, string>} [alias] alternative names → tab key, e.g. { kostenkontrolle: "control" }
 * @returns {string} a key from `erlaubt`, or `standard`
 */
export function waehleTab(wert, erlaubt, standard, alias = {}) {
  const liste = Array.isArray(erlaubt) ? erlaubt : [];
  if (typeof wert !== "string") return standard;
  const roh = wert.trim();
  if (!roh) return standard;
  const gueltig = (k) => typeof k === "string" && liste.includes(k);

  if (gueltig(roh)) return roh;
  const direkt = eigenerAlias(alias, roh);
  if (gueltig(direkt)) return direkt;

  const klein = roh.toLowerCase();
  const ohneFall = liste.find((k) => k.toLowerCase() === klein);
  if (ohneFall) return ohneFall;
  const aliasSchluessel = Object.keys(alias || {}).find((k) => k.toLowerCase() === klein);
  const ueberAlias = aliasSchluessel ? eigenerAlias(alias, aliasSchluessel) : undefined;
  if (gueltig(ueberAlias)) return ueberAlias;

  return standard;
}

/**
 * Copy of the query parameters with `tab` set; every other parameter is kept.
 * @param {URLSearchParams|string|null|undefined} params current parameters (a query
 *   string may carry a leading "?")
 * @param {string} tab tab key to write
 * @returns {URLSearchParams} new object, the input is not changed
 */
export function mitTabParameter(params, tab) {
  const neu = new URLSearchParams(params == null ? "" : params);
  neu.set(TAB_PARAMETER, tab);
  return neu;
}
