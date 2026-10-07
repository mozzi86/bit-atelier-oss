// personalEntitaeten.js — the ONE source for the "personal" storage class
// (Plan 80-02, D-P80-A). Every rule that keeps HR data out of the four leaks
// found in 80-RESEARCH (.bitproj export, snapshot ring, cloud `records`
// table, supabase-import) reads from the constants and helpers below —
// demoIdb.js, personalDb.js, bitApi.js, routes.js, personalRouter.js and
// supabase-import.mjs all import from here instead of repeating the list.
//
// Pure and loadable under plain node (no `import.meta.env`, no browser API):
// scripts/supabase-import.mjs and every unit test import it directly.
//
// In:  nothing (constants only).
// Out: the entity/store name rules, the field blacklist (E-14) and the
//      onboarding/offboarding checklist keys (80-RESEARCH § Datenmodell).

/**
 * The nine HR entities. Every new HR entity (including the 79 `Fahrt` link,
 * should that ever be decided) is added HERE FIRST — nowhere else applies the
 * lock. Frozen so a accidental `.push()` cannot silently open a tenth entity.
 */
export const PERSONAL_ENTITAETEN = Object.freeze([
  'Mitarbeiter',
  'Arbeitsvertrag',
  'Gehaltsaenderung',
  'Stelle',
  'Bewerbung',
  'Personalvorgang',
  'Personaldokument',
  'Fristquittung',
  'Loeschprotokoll',
]);

/** IndexedDB store name prefix for every personal collection (precedent: SCHNAPP_STORE in demoIdb.js). */
export const PERSONAL_STORE_PRAEFIX = 'personal.';
/** The tenth store: file payloads (Personaldokument's `datei_ref` points here), never a project entity. */
export const PERSONAL_DATEIEN_STORE = 'personal.dateien';

/**
 * @param {string} entitaet one of PERSONAL_ENTITAETEN
 * @returns {string} the IndexedDB store name, e.g. 'personal.Mitarbeiter'
 */
export function personalStoreName(entitaet) {
  return PERSONAL_STORE_PRAEFIX + entitaet;
}

/**
 * @param {string} name entity name as used by bitApi.entities/.personal
 * @returns {boolean} true for one of the nine HR entities
 */
export function istPersonalEntitaet(name) {
  return PERSONAL_ENTITAETEN.includes(/** @type {any} */ (name));
}

/**
 * @param {string} storeName IndexedDB object store name
 * @returns {boolean} true for `personal.dateien` or `personal.<Entität>` — the
 *   rule demoIdb.js's `entities()` applies to hide HR stores from
 *   demoDbAuslesen/-Ersetzen (export, import, reset, snapshot ring).
 */
export function istPersonalStore(storeName) {
  return typeof storeName === 'string' && storeName.startsWith(PERSONAL_STORE_PRAEFIX);
}

/** Plain-text refusal shown wherever HR data is requested on the cloud path (E-03). */
export const PERSONAL_NUR_LOKAL = 'Personaldaten bleiben lokal – in der Cloud-Fassung nicht verfügbar.';

/**
 * The decision table bitApi.js mirrors inline (D-P80-A #2): a compile-time
 * `DATENQUELLE === 'supabase'` guard must sit before every dynamic import in
 * bitApi.js so supabase-js/personalDb never enter the wrong bundle — calling a
 * function first (even this one) would defeat that tree-shaking rule, so
 * bitApi.js spells the same three cases out itself and this function only
 * documents/tests the rule.
 * @param {'supabase'|'serverlos'|'express'} datenquelle
 * @returns {'gesperrt'|'serverlos'|'express'}
 */
export function personalWeg(datenquelle) {
  if (datenquelle === 'supabase') return 'gesperrt';
  if (datenquelle === 'serverlos') return 'serverlos';
  return 'express';
}

/**
 * Fields E-14 forbids anywhere in the personal storage class (Art. 5 Abs. 1
 * lit. c DSGVO — data minimisation; Art. 9 — special categories; RL
 * 2023/970 — no salary history in hiring). Compared with keys lower-cased, so
 * `Schwerbehinderung`/`SCHWERBEHINDERUNG` are caught too (projektneutral.test.js,
 * personalSeed.test.js). `schwerbehinderung` bars the MERKMAL itself, not only
 * `..._grund`/`grad_der_behinderung` — E-14 forbids recording the fact of a
 * disability at all, not just its degree or reason; `zusatzurlaub_tage` on the
 * contract stays allowed because it carries no reason.
 */
export const VERBOTENE_FELDER = Object.freeze([
  'steuer_id', 'steuerid', 'sv_nummer', 'svnr', 'iban', 'bic',
  'krankenkasse', 'konfession', 'religion', 'kirchensteuer',
  'diagnose', 'krankheit', 'schwerbehinderung', 'schwerbehinderung_grund',
  'grad_der_behinderung', 'gdb', 'gewerkschaft', 'bisheriges_gehalt',
]);

/**
 * Onboarding checklist keys (80-RESEARCH § Datenmodell). 13 apply to every
 * hire, 2 only to chamber-registered staff (ByAK etc.), 1 only to
 * minijob/werkstudent/Praktikum — 16 in total. `Personalvorgang.schritte[]`
 * and the personal seed both draw from this ONE list.
 */
export const EINTRITT_SCHLUESSEL = Object.freeze([
  // immer (13)
  'vertrag_unterschrieben', 'nachweis_nachwg', 'personalfragebogen_lohnbuero',
  'sv_anmeldung', 'elstam', 'vertraulichkeit', 'unterweisung_arbeitsschutz',
  'vorsorge_bildschirm', 'arbeitsmittel', 'konten_lizenzen', 'einarbeitung',
  'projektzuordnung', 'foto_einwilligung',
  // nur Kammer (2)
  'rv_befreiung', 'kammer_haftpflicht',
  // nur Minijob/Werkstudent/Praktikum (1)
  'nachweis_beschaeftigungsart',
]);

/** Offboarding checklist keys (80-RESEARCH § Datenmodell). */
export const AUSTRITT_SCHLUESSEL = Object.freeze([
  'kuendigung_schriftform', 'hinweis_arbeitsuchend', 'resturlaub_abgeltung',
  'zeugnis', 'arbeitsbescheinigung', 'rueckgabe_konten', 'loeschfristen_starten',
]);

/**
 * @typedef {{
 *   id: string, personalnummer: string, vorname: string, nachname: string,
 *   art: 'angestellt'|'minijob'|'midijob'|'werkstudent'|'praktikum_pflicht'|'praktikum_freiwillig'|'azubi'|'gf_gmbh'|'inhaber'|'gesellschafter'|'frei',
 *   status: 'onboarding'|'aktiv'|'ruhend'|'ausgeschieden'|'gesperrt',
 *   funktion: string, eintritt: string, austritt: string|null,
 *   dienstlich: {email: string, telefon: string},
 *   privat: {adresse?: string, telefon?: string, email?: string, notfallkontakt?: string}, // [S]
 *   kammer?: {kammer: string, fachrichtung: string, mitgliedsnr: string, eingetragen_seit: string, bauvorlageberechtigt: boolean, fortbildung: object[]},
 *   versorgungswerk?: object,
 *   qualifikationen: Array<{art: string, bezeichnung: string, erworben: string, gueltig_bis?: string}>,
 *   projekt_zuordnungen: Array<{project_id: string, funktion: string, anteil_prozent: number, von: string, bis?: string}>,
 *   gesellschafter_id: string|null,
 *   kontakt_id: string|null,
 *   an_lohnbuero_uebermittelt_am: string|null,
 *   sperre?: object, notizen?: string
 * }} Mitarbeiter Verboten: VERBOTENE_FELDER (Steuer-ID, SV-Nummer, IBAN, Krankenkasse, Konfession, Krankheit, Schwerbehinderung, Gewerkschaft — E-14)
 */

/**
 * @typedef {{
 *   id: string, mitarbeiter_id: string, vertragsart: string, sachgrund: string|null,
 *   status: 'entwurf'|'unterschrieben'|'gekuendigt'|'beendet'|'ersetzt',
 *   beginn: string, ende: string|null, probezeit_monate: number,
 *   wochenstunden: number, arbeitstage_woche: number,
 *   urlaub_tage_jahr: number, zusatzurlaub_tage: number, // Tage/Jahr, ohne Grund (E-14/Art. 9)
 *   kuendigung: object, verlaengerungen: object[],
 *   unterschrieben_am: string|null, schriftform_vor_beginn: boolean,
 *   nachweis_ausgehaendigt_am: string|null, beendigung: object,
 *   ersetzt_vertrag_id: string|null
 * }} Arbeitsvertrag "aktiv" wird abgeleitet, nicht gespeichert
 */

/**
 * @typedef {{
 *   id: string, arbeitsvertrag_id: string, mitarbeiter_id: string,
 *   gueltig_ab: string, art: string, brutto_eur: number, // [S] Euro/Monat (Werkstudent: Euro/Stunde)
 *   zusatz: object[], // [S]
 *   grund: string, naechste_pruefung: string|null
 * }} Gehaltsaenderung nur anhängend, nie überschrieben
 */

/**
 * @typedef {{
 *   id: string, titel: string, status: string, beschaeftigungsart: string,
 *   wochenstunden: number, befristet: boolean, beginn_ab: string,
 *   aufgaben: string, anforderungen: string[],
 *   gehaltsspanne: {von_eur: number, bis_eur: number, einheit: 'Monat'|'Stunde'}
 * }} Stelle wird nie selbst veröffentlicht (keine externe Kommunikation aus der App)
 */

/**
 * @typedef {{
 *   id: string, stelle_id: string, vorname: string, nachname: string,
 *   kontakt: object, // [S]
 *   eingang_am: string, quelle: string, stufe: string, stufen_verlauf: object[],
 *   bewertung: object[], // [S]
 *   gespraeche: object[], // [S]
 *   gehaltswunsch_eur: number|null, verfuegbar_ab: string|null,
 *   datenschutzhinweis_am: string|null,
 *   entscheidung: object, talentpool: {eingewilligt_am: string|null, text_version: string|null, bis: string|null, widerrufen_am: string|null},
 *   uebernommen_mitarbeiter_id: string|null
 * }} Bewerbung eine Zeile je Person und Stelle; KEIN bisheriges Gehalt (RL 2023/970)
 */

/**
 * @typedef {{
 *   id: string, art: 'eintritt'|'austritt', mitarbeiter_id: string,
 *   bewerbung_id: string|null, arbeitsvertrag_id: string|null,
 *   stichtag: string, status: string,
 *   schritte: Array<{schluessel: string, erledigt_am: string|null}>,
 *   ausstattung: object[]
 * }} Personalvorgang schritte = Kopie der Eintritts-/Austritts-Vorlage (EINTRITT_SCHLUESSEL/AUSTRITT_SCHLUESSEL)
 */

/**
 * @typedef {{
 *   id: string, mitarbeiter_id: string|null, bewerbung_id: string|null,
 *   kategorie: string, name: string, mime: string, groesse_bytes: number,
 *   datei_ref: string
 * }} Personaldokument genau eines von mitarbeiter_id/bewerbung_id; der Inhalt liegt in personal.dateien, nie `data` hier
 */

/**
 * @typedef {{id: string, schluessel: string, quittiert_am: string}} Fristquittung Fristen selbst werden abgeleitet, nicht gespeichert
 */

/**
 * @typedef {{id: string, am: string, entitaet: string, datensatz_id: string, anlass: string, umfang: object}} Loeschprotokoll OHNE Namen (D-P80-G)
 */
