// Registry of every browser-storage key the app actually uses (Plan 80-05,
// EINST-04, 57-06 finding G-4): one list, guarded by a test that scans the
// source tree, so the cookie policy (rechtstexte.jsx) and the Datenschutz
// settings area can never drift from the code again the way the old hand-kept
// table in rechtstexte.jsx already had ("bit-atelier-rundgang" and
// "bit-atelier-sicherung-spaeter" were both missing from it, see the plan's
// truth statement).
//
// In:  nothing (pure data + pure readers). Out: BROWSER_SCHLUESSEL and three
// small helpers used by rechtstexte.jsx (CookieRichtlinieText), the
// Datenschutz settings area (a full table + "delete only what is deletable")
// and browserSpeicher.test.js (the guard itself).

/**
 * One browser-storage entry.
 * @typedef {object} BrowserSchluessel
 * @property {string|null} schluessel storage key, or null for the two rows
 *   that name a whole storage mechanism instead of one key (IndexedDB, the
 *   service worker's Cache Storage)
 * @property {"localStorage"|"sessionStorage"|"IndexedDB"|"Cache Storage"} speicher
 * @property {string} zweck German purpose text, shown via t()
 * @property {"notwendig"|"Einwilligung"} kategorie § 25 TDDDG basis — "notwendig"
 *   needs no consent (Abs. 2 Nr. 2), "Einwilligung" is opt-in only (Abs. 1)
 * @property {string} fassung which build(s) carry this entry (German source text)
 * @property {boolean} loeschbar true when "Lokale Einstellungen löschen"
 *   (DatenschutzBereich) may remove it without breaking the app for the visitor
 * @property {boolean} inRichtlinie true when the row belongs in the public
 *   cookie policy (CookieRichtlinieText) — every entry here does today, but the
 *   field stays explicit so a future device-only debug key does not have to
 * @property {boolean} [geraetecache] true for the narrower "Gerätespeicher
 *   leeren" action (DatenBereich, 80-05 Task 4): device-only viewer caches, as
 *   opposed to "Lokale Einstellungen löschen" (DatenschutzBereich), which
 *   clears every `loeschbar` row
 */

// The registry data lives in this intermediate array, typed directly (not the
// exported `const` below): tsc only applies an array literal's element types
// top-down from a declaration it annotates DIRECTLY (the usual
// `const x: T[] = [...]` pattern) — annotating the RESULT of
// Object.freeze(...) instead checks the literal bottom-up and widens every
// string field to plain `string`, which then fails against BrowserSchluessel's
// narrower unions (speicher, kategorie).
/** @type {BrowserSchluessel[]} */
const EINTRAEGE = [
  { schluessel: 'lang', speicher: 'localStorage', zweck: 'Gewählte Oberflächensprache', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: false },
  { schluessel: 'nc-theme', speicher: 'localStorage', zweck: 'Hell/Dunkel-Darstellung', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: false },
  { schluessel: 'sidebar:collapsed', speicher: 'localStorage', zweck: 'Zustand der Seitenleiste', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: false },
  { schluessel: 'currentProjectId', speicher: 'localStorage', zweck: 'Kennung des zuletzt geöffneten Projekts', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: false },
  { schluessel: 'nc-bim-favs', speicher: 'localStorage', zweck: 'Favoriten im Gebäudemodell', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: true },
  { schluessel: 'bit-atelier.ifc.autoload.v1', speicher: 'localStorage', zweck: 'Einstellung „IFC automatisch laden“ (Dateiname)', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: true },
  // Drawing content is the visitor's own work, not a device setting — deleting
  // it silently alongside a theme/language reset would be a data loss, not a cleanup.
  { schluessel: 'bit-sketch-demo-v1', speicher: 'localStorage', zweck: 'Zeichnung des Skizzen-Studios', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: false, inRichtlinie: true, geraetecache: false },
  // New in 80-01 (People.jsx): dismissible notice, same "device setting" shape
  // as the others in this group, so it is safe to bulk-delete.
  { schluessel: 'bit-atelier-personal-hinweis', speicher: 'localStorage', zweck: 'Geschlossener Datenschutzhinweis auf der Personal-Seite', kategorie: 'notwendig', fassung: 'alle Fassungen', loeschbar: true, inRichtlinie: true, geraetecache: false },
  // 83-02: the six demo keys (terms gate, display name, header strip, usage-log
  // consent and log, tour progress) went with the online demo. The legacy
  // database blob stays: demoDb.js still reads it once to migrate it.
  { schluessel: 'bit-atelier-demo-db-v1', speicher: 'localStorage', zweck: 'Altbestand der Browser-Datenbank vor der Umstellung auf IndexedDB; wird nur noch gelesen und migriert', kategorie: 'notwendig', fassung: 'lokale Fassung', loeschbar: false, inRichtlinie: true, geraetecache: false },
  { schluessel: 'sb-…-auth-token', speicher: 'localStorage', zweck: 'Anmeldesitzung (Supabase); bis zur Abmeldung', kategorie: 'notwendig', fassung: 'Cloud-Betrieb', loeschbar: false, inRichtlinie: true, geraetecache: false },
  // New: the header's own "save later" snooze (src/demo/SpeicherStatus.jsx) —
  // session-only by design, so it stays out of the deletable set too (it is
  // gone with the tab already).
  { schluessel: 'bit-atelier-sicherung-spaeter', speicher: 'sessionStorage', zweck: 'Sicherungs-Hinweis für diese Sitzung ausgeblendet', kategorie: 'notwendig', fassung: 'lokale Fassung', loeschbar: false, inRichtlinie: true, geraetecache: false },
  { schluessel: 'kitool.verlauf.v1', speicher: 'sessionStorage', zweck: 'Chatverlauf des KI-Assistenten (max. 200 Nachrichten); endet mit dem Tab', kategorie: 'notwendig', fassung: 'lokale Fassung mit Harness', loeschbar: false, inRichtlinie: true, geraetecache: false },
  { schluessel: null, speicher: 'IndexedDB', zweck: 'Sämtliche Projekt- und Eingabedaten der lokalen Fassung', kategorie: 'notwendig', fassung: 'lokale Fassung', loeschbar: false, inRichtlinie: true, geraetecache: false },
  { schluessel: null, speicher: 'Cache Storage', zweck: 'Anwendungsdateien für den Offline-Betrieb', kategorie: 'notwendig', fassung: 'lokale Fassung', loeschbar: false, inRichtlinie: true, geraetecache: false },
];

/**
 * Every key this app writes to a browser storage, in the same order the cookie
 * policy has shown since 57-06, with the "save later" snooze 80-05 added (the
 * demo keys were removed in 83-02). Grep stand 27.09.2026
 * (see 80-05-PLAN.md read_first); a key introduced later — by this lane or Spur B
 * — belongs here first (browserSpeicher.test.js fails the build otherwise).
 * @type {ReadonlyArray<Readonly<BrowserSchluessel>>}
 */
export const BROWSER_SCHLUESSEL = Object.freeze(EINTRAEGE.map((e) => Object.freeze(e)));

/**
 * Registry keys that are actually present in a given storage object. Read
 * access goes through try/catch: a blocked storage (private window, denied
 * permission) must read as "nothing is set", not throw.
 * @param {{getItem: (key: string) => (string|null)}|null|undefined} speicher
 *   window.localStorage or window.sessionStorage (or a stub in tests)
 * @returns {string[]} present keys, registry order
 */
export function vorhandeneSchluessel(speicher) {
  const gefunden = [];
  if (!speicher) return gefunden;
  for (const eintrag of BROWSER_SCHLUESSEL) {
    if (!eintrag.schluessel) continue; // IndexedDB/Cache Storage rows have no single key to probe
    try {
      if (speicher.getItem(eintrag.schluessel) != null) gefunden.push(eintrag.schluessel);
    } catch {
      /* blocked storage: this key counts as absent, not as an error */
    }
  }
  return gefunden;
}

/**
 * Keys "Lokale Einstellungen löschen" (DatenschutzBereich) is allowed to
 * remove — device settings only, never anything that would re-trigger a gate
 * (the AGB/user keys), lose the visitor's own drawing, or half-delete a
 * consent record the withdrawal flow already owns.
 * @returns {string[]} registry order
 */
export function loeschbareSchluessel() {
  return BROWSER_SCHLUESSEL.filter((e) => e.loeschbar && e.schluessel).map((e) => e.schluessel);
}

/**
 * Rows the public cookie policy (CookieRichtlinieText) shows, in registry
 * order. Every entry qualifies today; the filter stays so a future
 * device-only debug key can opt out explicitly instead of by omission.
 * @returns {ReadonlyArray<Readonly<BrowserSchluessel>>}
 */
export function richtlinienZeilen() {
  return BROWSER_SCHLUESSEL.filter((e) => e.inRichtlinie);
}

/**
 * Keys "Gerätespeicher leeren" (DatenBereich) clears: device-only viewer
 * caches (IFC autoload, BIM favourites) — a narrower, browsing-focused action
 * than "Lokale Einstellungen löschen" (DatenschutzBereich), which clears every
 * `loeschbar` row including language/theme/sidebar state.
 * @returns {string[]} registry order
 */
export function geraetespeicherSchluessel() {
  return BROWSER_SCHLUESSEL.filter((e) => e.geraetecache && e.schluessel).map((e) => e.schluessel);
}
