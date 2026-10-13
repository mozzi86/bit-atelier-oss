// Placeholder catalogue of the correspondence (phase 82, 82-05): which paths a
// letter type may use and which phase delivers them. The template editor shows
// the catalogue of a letter type and marks unknown placeholders red; the unit
// test checks every shipped template against it.
//
// Groups (phase that fills the context):
//   buero.*        letterhead of the office settings (80-03, useBriefkopf)
//   empfaenger.*   snapshot of the address book contact (82, copied into the letter)
//   projekt.*      project record (82)
//   datum, unser_zeichen, ihr_zeichen   letter fields (82)
//   postbuch.*     incoming mail the letter answers (82)
//   rechnung.*, mahnung.*   invoice and dunning run (79)
//   angebot.*, vertrag.*, honorarnachtrag.*   fee chain (81)
//   protokoll.*, tabelle:tops   protocol letter with distribution list (82)
//   behinderung.*  hindrance period and diary text from the site diary (88-02)
//
// Pure, import-free. Out: KATALOG_GRUPPEN, KATALOG, katalogFuer, erlaubt.

/**
 * Paths per group with label (German, i18n key of the help panel) and the phase that delivers them.
 * @type {Readonly<Record<string, Readonly<{phase: string, pfade: ReadonlyArray<Readonly<{pfad: string, label: string}>>}>>>}
 */
export const KATALOG_GRUPPEN = Object.freeze({
  buero: Object.freeze({ phase: "80", pfade: Object.freeze([
    Object.freeze({ pfad: "buero.name", label: "Name des Büros" }),
    Object.freeze({ pfad: "buero.zusatz", label: "Zusatz des Büros" }),
    Object.freeze({ pfad: "buero.anschrift", label: "Anschrift des Büros" }),
    Object.freeze({ pfad: "buero.kontakt", label: "Kontakt des Büros" }),
  ]) }),
  empfaenger: Object.freeze({ phase: "82", pfade: Object.freeze([
    Object.freeze({ pfad: "empfaenger.anrede", label: "Anrede" }),
    Object.freeze({ pfad: "empfaenger.name", label: "Name" }),
    Object.freeze({ pfad: "empfaenger.firma", label: "Firma" }),
    Object.freeze({ pfad: "empfaenger.abteilung", label: "Abteilung" }),
    Object.freeze({ pfad: "empfaenger.strasse", label: "Straße" }),
    Object.freeze({ pfad: "empfaenger.plz", label: "PLZ" }),
    Object.freeze({ pfad: "empfaenger.ort", label: "Ort" }),
  ]) }),
  projekt: Object.freeze({ phase: "82", pfade: Object.freeze([
    Object.freeze({ pfad: "projekt.name", label: "Projektname" }),
    Object.freeze({ pfad: "projekt.nummer", label: "Projektnummer" }),
    Object.freeze({ pfad: "projekt.adresse", label: "Projektadresse" }),
  ]) }),
  brief: Object.freeze({ phase: "82", pfade: Object.freeze([
    Object.freeze({ pfad: "datum", label: "Datum" }),
    Object.freeze({ pfad: "unser_zeichen", label: "Unser Zeichen" }),
    Object.freeze({ pfad: "ihr_zeichen", label: "Ihr Zeichen" }),
  ]) }),
  postbuch: Object.freeze({ phase: "82", pfade: Object.freeze([
    Object.freeze({ pfad: "postbuch.nummer", label: "Postbuchnummer" }),
    Object.freeze({ pfad: "postbuch.datum", label: "Datum des Eingangs" }),
    Object.freeze({ pfad: "postbuch.betreff", label: "Betreff des Eingangs" }),
    Object.freeze({ pfad: "postbuch.ihr_zeichen", label: "Zeichen des Absenders" }),
  ]) }),
  rechnung: Object.freeze({ phase: "79", pfade: Object.freeze([
    Object.freeze({ pfad: "rechnung.nummer", label: "Rechnungsnummer" }),
    Object.freeze({ pfad: "rechnung.datum", label: "Rechnungsdatum" }),
    Object.freeze({ pfad: "rechnung.offen", label: "Offener Betrag" }),
  ]) }),
  mahnung: Object.freeze({ phase: "79", pfade: Object.freeze([
    Object.freeze({ pfad: "mahnung.stufe", label: "Mahnstufe" }),
    Object.freeze({ pfad: "mahnung.frist", label: "Zahlungsfrist" }),
    Object.freeze({ pfad: "mahnung.zinsen", label: "Verzugszinsen" }),
    Object.freeze({ pfad: "mahnung.pauschale", label: "Pauschale" }),
    Object.freeze({ pfad: "mahnung.summe", label: "Summe" }),
  ]) }),
  angebot: Object.freeze({ phase: "81", pfade: Object.freeze([
    Object.freeze({ pfad: "angebot.nummer", label: "Angebotsnummer" }),
    Object.freeze({ pfad: "angebot.datum", label: "Angebotsdatum" }),
    Object.freeze({ pfad: "angebot.gueltig_bis", label: "Gültig bis" }),
    Object.freeze({ pfad: "angebot.netto", label: "Honorar netto" }),
    Object.freeze({ pfad: "angebot.brutto", label: "Honorar brutto" }),
  ]) }),
  vertrag: Object.freeze({ phase: "81", pfade: Object.freeze([
    Object.freeze({ pfad: "vertrag.nummer", label: "Vertragsnummer" }),
    Object.freeze({ pfad: "vertrag.datum", label: "Vertragsdatum" }),
  ]) }),
  honorarnachtrag: Object.freeze({ phase: "81", pfade: Object.freeze([
    Object.freeze({ pfad: "honorarnachtrag.nr", label: "Nachtragsnummer" }),
    Object.freeze({ pfad: "honorarnachtrag.titel", label: "Titel des Nachtrags" }),
    Object.freeze({ pfad: "honorarnachtrag.betrag", label: "Betrag des Nachtrags" }),
  ]) }),
  protokoll: Object.freeze({ phase: "82", pfade: Object.freeze([
    Object.freeze({ pfad: "protokoll.titel", label: "Titel des Protokolls" }),
    Object.freeze({ pfad: "protokoll.datum", label: "Datum der Besprechung" }),
    Object.freeze({ pfad: "protokoll.ort", label: "Ort der Besprechung" }),
    Object.freeze({ pfad: "tabelle:tops", label: "Tabelle der Tagesordnungspunkte" }),
  ]) }),
  behinderung: Object.freeze({ phase: "88", pfade: Object.freeze([
    Object.freeze({ pfad: "behinderung.zeitraum", label: "Zeitraum der Behinderung" }),
    Object.freeze({ pfad: "behinderung.tage", label: "Anzahl der Behinderungstage" }),
    Object.freeze({ pfad: "behinderung.text", label: "Behinderung laut Bautagebuch" }),
  ]) }),
});

/** Groups every letter type may use. */
const ALLGEMEIN = Object.freeze(["buero", "empfaenger", "projekt", "brief"]);

/**
 * Groups per letter type (keys of vorlagen.alleVorlagen()).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const KATALOG = Object.freeze({
  brief: ALLGEMEIN,
  antwort: Object.freeze([...ALLGEMEIN, "postbuch"]),
  anschreiben_honorarangebot: Object.freeze([...ALLGEMEIN, "angebot"]),
  protokoll: Object.freeze([...ALLGEMEIN, "protokoll"]),
  behinderungsanzeige: Object.freeze([...ALLGEMEIN, "behinderung"]),
  behinderung_bauherr: Object.freeze([...ALLGEMEIN, "behinderung"]),
  mahnung: Object.freeze([...ALLGEMEIN, "rechnung", "mahnung"]),
  honorarangebot: Object.freeze([...ALLGEMEIN, "angebot"]),
  auftragsbestaetigung: Object.freeze([...ALLGEMEIN, "vertrag", "angebot"]),
  honorarnachtrag: Object.freeze([...ALLGEMEIN, "vertrag", "honorarnachtrag"]),
});

/**
 * The catalogue of a letter type: its groups with phase and paths (unknown type → general groups).
 * @param {string} art
 * @returns {Array<{gruppe: string, phase: string, pfade: ReadonlyArray<{pfad: string, label: string}>}>}
 */
export function katalogFuer(art) {
  const gruppen = Object.prototype.hasOwnProperty.call(KATALOG, art) ? KATALOG[art] : ALLGEMEIN;
  return gruppen.map((g) => ({ gruppe: g, phase: KATALOG_GRUPPEN[g].phase, pfade: KATALOG_GRUPPEN[g].pfade }));
}

/**
 * Whether a letter type may use a path.
 * @param {string} art
 * @param {string} pfad e.g. 'postbuch.betreff' or 'tabelle:tops'
 * @returns {boolean}
 */
export function erlaubt(art, pfad) {
  return katalogFuer(art).some((g) => g.pfade.some((p) => p.pfad === pfad));
}
