// arbeitsfokus.js — "What are you here for?" (72-20, register no. 133): a work focus
// that shows 5–6 fitting sidebar entries on top; every other module stays one click
// away under "Alle Module". The focus is NOT a permission (that is 82-02's role):
// it only shows and hides, and an entry the role may not read stays hidden in the
// focus too (the caller passes the already filtered groups).
//
// The deep-link parameter is `rolle` (register no. 133) although the UI calls it
// "Arbeitsfokus" — so it is never mixed up with the roles of the rights model.
//
// In:  URL search, nav groups (filtered by navSichtbar). Out: FOKUS, FOKUS_SCHLUESSEL,
//      fokusGueltig, fokusAusUrl, fokusEintraege.

/** localStorage key (registered in browserSpeicher.js). */
export const FOKUS_SCHLUESSEL = "bit-atelier-fokus";

/**
 * The focus values with their entries (nav URLs, in display order). [ASSUMED] cut —
 * the office's daily routines decide; 'alle' is today's sidebar.
 * @type {ReadonlyArray<Readonly<{key: string, label: string, urls: ReadonlyArray<string>}>>} label: German i18n key
 */
export const FOKUS = Object.freeze([
  Object.freeze({ key: "alle", label: "Alle Module", urls: Object.freeze([]) }),
  Object.freeze({ key: "entwurf", label: "Entwurf", urls: Object.freeze(["/Dashboard", "/RealEstateFeasibility", "/ComplexDesigner", "/ModelCheck", "/BimViewer"]) }),
  Object.freeze({ key: "ausschreibung", label: "Ausschreibung & Vergabe", urls: Object.freeze(["/Dashboard", "/AVA", "/Finance", "/Reports", "/Deadlines"]) }),
  Object.freeze({ key: "bauleitung", label: "Bauleitung", urls: Object.freeze(["/Dashboard", "/Werkplanung", "/BimViewer", "/Reports", "/Deadlines"]) }),
  Object.freeze({ key: "buero", label: "Büro", urls: Object.freeze(["/Dashboard", "/Deadlines", "/TimeTracking", "/Accounting", "/Correspondence", "/Absences"]) }),
]);

/**
 * A known focus key or 'alle'.
 * @param {unknown} wert
 * @returns {string}
 */
export function fokusGueltig(wert) {
  return FOKUS.some((f) => f.key === wert) ? /** @type {string} */ (wert) : "alle";
}

/**
 * The focus a link carries (`?rolle=`), or null when the link carries none.
 * An unknown value counts as 'alle'.
 * @param {string|URLSearchParams} suche location.search or its params
 * @returns {string|null}
 */
export function fokusAusUrl(suche) {
  const p = typeof suche === "string" ? new URLSearchParams(suche) : suche;
  const wert = p?.get("rolle");
  return wert === null || wert === undefined ? null : fokusGueltig(wert);
}

/**
 * The entries of a focus, in the focus' order, taken from the visible groups
 * (so the rights filter of the caller still holds). Collapsible groups (Labor)
 * never feed a focus. 'alle' → null (show the groups as they are).
 * @template {{url: string}} E
 * @param {ReadonlyArray<{items: ReadonlyArray<E>, collapsible?: boolean}>} gruppen
 * @param {string} fokus
 * @returns {E[]|null}
 */
export function fokusEintraege(gruppen, fokus) {
  const f = FOKUS.find((x) => x.key === fokus);
  if (!f || f.key === "alle") return null;
  const nachUrl = new Map((gruppen || []).filter((g) => !g.collapsible).flatMap((g) => g.items).map((i) => [i.url, i]));
  return f.urls.map((u) => nachUrl.get(u)).filter((i) => i !== undefined);
}
