// personalLink.js — URL-Vertrag von /People, nur opake IDs (Plan 80-04, Task 4,
// DS-07). Muster: packages/nova-ifc-viewer/src/lib/ticketLink.js (72-13).
//
// DS-07: Namen gehören nie in URL oder Hash, weil Browserverlauf und
// Geräte-Synchronisation sie dauerhaft behalten — anders als ein Titel oder ein
// Formularfeld, das der Nutzer wieder löschen kann. lesePersonalLink() verwirft
// deshalb jede ID, die nicht auf das opake Muster passt, und akzeptiert `neu`
// nur als exakt '1'.
//
// In:  URLSearchParams-ähnliche Objekte oder Query-Strings, Teilobjekte.
// Out: PERSONAL_PARAMETER, lesePersonalLink, bauePersonalLink, entfernePersonalParameter.

/** Parameter von /People in fester Reihenfolge (bauePersonalLink hält sie ein). */
export const PERSONAL_PARAMETER = Object.freeze(["tab", "mitarbeiter", "vertrag", "bewerbung", "stelle", "vorgang", "neu"]);

/** Muster einer opaken ID: 4–40 Zeichen aus A–Z, a–z, 0–9, "_", "-" — nie ein Name mit Leer- oder Sonderzeichen. */
const ID_MUSTER = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * Trimmt und begrenzt einen Query-Wert; `null`/`undefined`/leer → null.
 * @param {unknown} v
 * @returns {string|null}
 */
function text(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

/**
 * @param {unknown} v
 * @returns {string|null} nur wenn `v` dem opaken ID-Muster entspricht
 */
function opakeId(v) {
  const t = text(v);
  return t && ID_MUSTER.test(t) ? t : null;
}

/**
 * Liest die Parameter der aktuellen /People-URL. Ein fehlender oder
 * ungültiger Wert (kein Treffer auf ID_MUSTER — insbesondere ein Name mit
 * Leerzeichen wie "Erika Muster", oder `neu` ohne den exakten Rohwert `'1'`)
 * fehlt im Ergebnis ganz (liest sich als `undefined`), statt mit `null`
 * durchgereicht zu werden — ein Aufrufer prüft so `if (teile.mitarbeiter)`
 * ohne zwischen "fehlt" und "ungültig" unterscheiden zu müssen.
 * @param {URLSearchParams|string|null|undefined} searchParams URLSearchParams
 *   (z. B. aus useSearchParams) oder ein Query-String mit oder ohne führendes "?"
 * @returns {{tab?: string, mitarbeiter?: string, vertrag?: string,
 *   bewerbung?: string, stelle?: string, vorgang?: string, neu?: true}}
 */
export function lesePersonalLink(searchParams) {
  let p = null;
  if (typeof searchParams === "string") p = new URLSearchParams(searchParams);
  else if (searchParams && typeof searchParams.get === "function") p = searchParams;
  if (!p) return {};
  /** @type {{tab?: string, mitarbeiter?: string, vertrag?: string, bewerbung?: string, stelle?: string, vorgang?: string, neu?: true}} */
  const ausgabe = {};
  const tab = text(p.get("tab")); // Reiter-Schlüssel sind kurze feste Worte, kein ID-Muster nötig
  if (tab) ausgabe.tab = tab;
  for (const feld of /** @type {const} */ (["mitarbeiter", "vertrag", "bewerbung", "stelle", "vorgang"])) {
    const id = opakeId(p.get(feld));
    if (id) ausgabe[feld] = id;
  }
  if (p.get("neu") === "1") ausgabe.neu = true;
  return ausgabe;
}

/**
 * Baut die Query in der festen Reihenfolge von PERSONAL_PARAMETER. Leere/
 * undefinierte Werte werden ausgelassen, damit der Link kurz bleibt und
 * gleiche Eingaben gleiche Links ergeben.
 * @param {{tab?: string, mitarbeiter?: string, vertrag?: string, bewerbung?: string,
 *   stelle?: string, vorgang?: string, neu?: boolean|string}} teile
 * @returns {string} z. B. '?tab=staff&mitarbeiter=abc123', '' wenn nichts übrig bleibt
 */
export function bauePersonalLink(teile = {}) {
  const t = teile || {};
  /** @type {Array<[string, string]>} */
  const paare = [];
  for (const key of PERSONAL_PARAMETER) {
    if (key === "neu") {
      if (t.neu === true || t.neu === "1") paare.push(["neu", "1"]);
      continue;
    }
    const wert = text(t[key]);
    if (wert) paare.push([key, wert]);
  }
  if (!paare.length) return "";
  return `?${paare.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/**
 * Kopie der Query ohne die genannten Parameter (z. B. nach dem Schließen
 * eines Formulars). Der Eingabewert bleibt unverändert.
 * @param {URLSearchParams|string} searchParams
 * @param {readonly string[]} namen
 * @returns {URLSearchParams} neue Instanz
 */
export function entfernePersonalParameter(searchParams, namen) {
  const kopie = new URLSearchParams(searchParams);
  for (const n of namen || []) kopie.delete(n);
  return kopie;
}
