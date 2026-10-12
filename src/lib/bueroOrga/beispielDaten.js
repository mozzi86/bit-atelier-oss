// Sample data of phase 82 (deadlines, absences, correspondence, rights) for the
// Express development database (server/seed.js) and the unit tests — built on
// the 79/80/81 samples. Since 83-02 there is no browser demo, so nothing seeds
// a browser (no useBueroOrgaSaat): this module is developer data and test fixture.
//
// Every date hangs on W = Monday of the week of `heute` (no constant with a
// year): on the reference day Mon 28.09.2026 the records carry exactly the
// dates of 82-RESEARCH § Saat, e.g.
//   aw-1 = Mon W−7 … Fri W−6 = 10.–21.08.2026   (M1, the window 81 keeps free)
//   aw-2 = Mon/Tue W−2      = 14.–15.09.2026   (M3, the window 81 keeps free)
//   te-2 = Tue W, weekly to Tue W+11 = 29.09.–15.12.2026 (12 occurrences)
//   pb-1 reply deadline     = Fri W  = 02.10.2026
// Deterministic: the same `heute` and input give the same records (ids as in
// the research table, every record `beispiel: true`). Only invented names.
//
// Persons: M1 = the owner (first active `art:'inhaber'` of the 80 sample, else
// the virtual "inhaber" of 81, E-17), M2 = first active employee, M3 = the next
// active person (80 sample: P-001, P-003, P-004 — the same choice as the 81
// sample). Without M2/M3 their records are left out. Absences are personnel
// data: the caller writes them through the personnel adapter, never into db.json.
//
// In:  heute 'YYYY-MM-DD'; {personal: {Mitarbeiter}|null, kontakte?: [{id, name}]}.
// Out: records per entity plus patches (assignments, contact addresses) that the
//      caller applies only to EMPTY fields.
//
// Relative imports only: server/seed.js loads this file without the alias hook.

import { plusJahre, plusTage, wochentag } from "../../../packages/nova-core/src/lib/kalender/datum.js";

const bsp = Object.freeze({ beispiel: true });

/**
 * Monday of the week of a day.
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {string}
 */
function montagVon(heute) {
  const wt = /** @type {number} */ (wochentag(heute));
  return /** @type {string} */ (plusTage(heute, -((wt === 0 ? 7 : wt) - 1)));
}

/**
 * The three sample persons (same choice as the 81 sample).
 * @param {{Mitarbeiter?: any[]}|null|undefined} personal
 * @returns {{m1: string, m2: string|null, m3: string|null}}
 */
export function personenBueroOrga(personal) {
  const aktiv = (personal?.Mitarbeiter || []).filter((m) => m && m.status === "aktiv");
  const inhaber = aktiv.find((m) => m.art === "inhaber");
  const m2 = aktiv.find((m) => m.art === "angestellt");
  const m3 = aktiv.find((m) => m !== inhaber && m !== m2 && m.art !== "inhaber" && m.art !== "gesellschafter");
  return { m1: inhaber ? inhaber.id : "inhaber", m2: m2 ? m2.id : null, m3: m3 ? m3.id : null };
}

/**
 * Sample records of phase 82 relative to `heute`.
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{personal?: {Mitarbeiter?: any[]}|null, kontakte?: ReadonlyArray<{id: string, name?: string}>}} [quellen]
 * @returns {{
 *   Nutzer: any[], Termin: any[], Terminquittung: any[], Abnahme: any[], Abwesenheit: any[],
 *   Postbucheintrag: any[], Schreiben: any[], Briefvorlage: any[],
 *   zuordnungen: Array<{mitarbeiter_id: string, projekt_zuordnungen: any[]}>,
 *   kontaktAnschriften: Record<string, {address: string, zip: string, city: string}>,
 *   marker: {key: string, value: Record<string, any>},
 * }}
 */
export function beispielDatensaetzeBueroOrga(heute, { personal = null, kontakte = [] } = {}) {
  if (typeof heute !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(heute)) throw new Error(`Beispieldaten Fristen & Schriftverkehr: ungültiges Datum „${heute}“.`);
  const W = montagVon(heute);
  const tag = (/** @type {number} */ n) => /** @type {string} */ (plusTage(W, n));
  const { m1, m2, m3 } = personenBueroOrga(personal);
  const name = (/** @type {string} */ id, /** @type {string} */ ersatz) => kontakte.find((k) => k?.id === id)?.name || ersatz;

  const Nutzer = [
    { id: "nu-1", name: "Inhaberin Beispiel", kuerzel: "IB", email: "inhaberin@example.org", aktiv: true, rolle: "inhaber", mitarbeiter_id: m1, ...bsp },
    { id: "nu-2", name: "Projektleitung Beispiel", kuerzel: "PB", email: "projektleitung@example.org", aktiv: true, rolle: "projektleitung", mitarbeiter_id: m2, ...bsp },
    { id: "nu-3", name: "Mitarbeit Beispiel", kuerzel: "MB", email: "mitarbeit@example.org", aktiv: true, rolle: "mitarbeiter", mitarbeiter_id: m3, ...bsp },
    { id: "nu-4", name: "Buchhaltung Beispiel", kuerzel: "BB", email: "buchhaltung@example.org", aktiv: true, rolle: "buchhaltung", mitarbeiter_id: null, ...bsp },
  ];

  const Termin = [
    { id: "te-1", titel: "Baustellenbegehung mit Bauherr", art: "termin", terminart: "begehung", datum: tag(0), zeit: "14:00", dauer_min: 90, project_id: "proj-1", notiz: "", ...bsp },
    { id: "te-2", titel: "Jour fixe Baustelle", art: "termin", terminart: "jour_fixe", datum: tag(1), zeit: "10:00", dauer_min: 60, project_id: "proj-1",
      wiederholung: { rhythmus: "woechentlich", bis: tag(78) }, notiz: "", ...bsp },
    { id: "te-3", titel: "Bauantrag einreichen", art: "frist", terminart: "baugenehmigung", datum: tag(17), project_id: "proj-2", notiz: "", ...bsp },
  ];

  // Acceptances on proj-4: the building shell 4 years before Wed W+2 (VOB/B, 4 years
  // → warranty ends on Wed W+2, inspection 3 months earlier); the architect's own work
  // accepted in part (§ 650s BGB) one year before Tue W+11 → liability 5 years.
  const Abnahme = [
    { id: "ab-1", project_id: "proj-4", gewerk: "Rohbau", datum: plusJahre(tag(16), -4), regel: "vob", kategorie: "bauwerk", jahre: null,
      wartungsvertrag: false, teilabnahme: false, eigene_leistung: false, sicherheit_art: "buergschaft", sicherheit_rueckgabe_am: plusJahre(tag(23), -2), ...bsp },
    { id: "ab-2", project_id: "proj-4", gewerk: "Architektenleistung LPH 1–8", datum: plusJahre(tag(78), -1), regel: "bgb", kategorie: "bauwerk", jahre: null,
      wartungsvertrag: false, teilabnahme: true, eigene_leistung: true, sicherheit_art: "keine", sicherheit_rueckgabe_am: null, ...bsp },
  ];

  /** @type {any[]} */
  const Abwesenheit = [
    { id: "aw-1", mitarbeiter_id: m1, art: "urlaub", von: tag(-49), bis: tag(-38), status: "genehmigt", vertretung_id: null, entschieden_von: "nu-1", entschieden_am: tag(-70), ...bsp },
  ];
  if (m3) Abwesenheit.push({ id: "aw-2", mitarbeiter_id: m3, art: "krank", von: tag(-14), bis: tag(-13), status: "genehmigt", vertretung_id: null, entschieden_von: "nu-1", entschieden_am: tag(-14), ...bsp });
  if (m2) Abwesenheit.push({ id: "aw-3", mitarbeiter_id: m2, art: "urlaub", von: tag(7), bis: tag(11), status: "genehmigt", vertretung_id: m1, entschieden_von: "nu-1", entschieden_am: tag(-20), ...bsp });
  // aw-4 overlaps aw-3 with M2 as the stand-in — the conflict 82-04 shows.
  if (m3) Abwesenheit.push({ id: "aw-4", mitarbeiter_id: m3, art: "urlaub", von: tag(9), bis: tag(18), status: "beantragt", vertretung_id: m2, entschieden_von: null, entschieden_am: null, ...bsp });
  Abwesenheit.push({ id: "aw-5", mitarbeiter_id: m1, art: "fortbildung", von: tag(24), bis: tag(24), status: "genehmigt", vertretung_id: null, entschieden_von: "nu-1", entschieden_am: tag(-5), notiz: "Brandschutzseminar", ...bsp });

  const jahr = (/** @type {string} */ d) => d.slice(0, 4);
  const Postbucheintrag = [
    { id: "pb-1", richtung: "eingang", nummer: `PE-${jahr(tag(-7))}-0001`, datum: tag(-7), partner_contact_id: "c-3", partner_name: name("c-3", "Kontakt Beispiel"), project_id: "proj-1",
      betreff: "Rückfrage Bemusterung Fassade", kanal: "email", ihr_zeichen: "", unser_zeichen: "", document_id: null, schreiben_id: null, frist: tag(4), erledigt_am: null,
      zustaendig: "nu-2", bereich: "projekt", notiz: "", ...bsp },
    { id: "pb-2", richtung: "eingang", nummer: `PE-${jahr(tag(-4))}-0002`, datum: tag(-4), partner_contact_id: "c-2", partner_name: name("c-2", "Kontakt Beispiel"), project_id: "proj-3",
      betreff: "Nachweis GEG Entwurf", kanal: "brief", ihr_zeichen: "", unser_zeichen: "", document_id: null, schreiben_id: null, frist: null, erledigt_am: tag(-3),
      zustaendig: "nu-1", bereich: "projekt", notiz: "", ...bsp },
    { id: "pb-3", richtung: "ausgang", nummer: `PA-${jahr(tag(-3))}-0001`, datum: tag(-3), partner_contact_id: "c-4", partner_name: name("c-4", "Firma Beispiel"), project_id: "proj-1",
      betreff: "Terminbestätigung Bodenplatte", kanal: "brief", ihr_zeichen: "", unser_zeichen: "", document_id: null, schreiben_id: "sc-1", frist: null, erledigt_am: null,
      zustaendig: "nu-1", bereich: "projekt", notiz: "", ...bsp },
  ];

  const Schreiben = [
    { id: "sc-1", project_id: "proj-1", vorlage_key: "frei", vorlage_version: 1, layout_version: 1, art: "frei",
      empfaenger: { contact_id: "c-4", anrede: "", titel: "", name: "", firma: name("c-4", "Firma Beispiel"), abteilung: "", strasse: "Musterweg 4", plz: "90000", ort: "Musterstadt", land: "" },
      ihr_zeichen: "", unser_zeichen: "", betreff: "Terminbestätigung Bodenplatte",
      text: "Sehr geehrte Damen und Herren,\n\nwir bestätigen den Betoniertermin der Bodenplatte wie besprochen.\n\nMit freundlichen Grüßen",
      felder: {}, bezug: null, anlagen: [], status: "versendet", festgeschrieben_am: tag(-3), versendet_am: tag(-3), versandweg: "brief",
      pdf_sha256: null, document_id: null, postbuch_id: "pb-3", bereich: "projekt", ...bsp },
  ];

  /** @type {Array<{mitarbeiter_id: string, projekt_zuordnungen: any[]}>} */
  const zuordnungen = [];
  if (m2) zuordnungen.push({ mitarbeiter_id: m2, projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Projektleitung", anteil_prozent: 60, von: null, bis: null }, { project_id: "proj-2", funktion: "Projektleitung", anteil_prozent: 40, von: null, bis: null }] });
  if (m3) zuordnungen.push({ mitarbeiter_id: m3, projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Mitarbeit", anteil_prozent: 50, von: null, bis: null }, { project_id: "proj-2", funktion: "Mitarbeit", anteil_prozent: 50, von: null, bis: null }] });
  if (m1 !== "inhaber") zuordnungen.push({ mitarbeiter_id: m1, projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Mitarbeit", anteil_prozent: 20, von: null, bis: null }, { project_id: "proj-3", funktion: "Projektleitung", anteil_prozent: 30, von: null, bis: null }] });

  return {
    Nutzer,
    Termin,
    Terminquittung: [],
    Abnahme,
    Abwesenheit,
    Postbucheintrag,
    Schreiben,
    Briefvorlage: [],
    zuordnungen,
    // Invented addresses, applied only where a contact has none (79/80/81 never set them).
    kontaktAnschriften: {
      "c-2": { address: "Beispielweg 2", zip: "90000", city: "Musterstadt" },
      "c-3": { address: "Am Werk 3", zip: "90001", city: "Musterstadt" },
      "c-4": { address: "Musterweg 4", zip: "90000", city: "Musterstadt" },
    },
    marker: { key: "buero_orga", value: { beispiel: true, stand: heute } },
  };
}
