// Area registry of /Settings "Einstellungen" (80-01, E-01, KRITIK-05): the ONE place
// of all app settings, as nine `?tab=` areas with English keys and German aliases.
// The page, the command palette ("Einstellung: …") and "Weiter mit" read this table.
//
// Visibility is a function OUTSIDE the table (SICHTBARKEIT), so the literal stays
// plain data the i18n guard can read (`titel`, `beschreibung`). Whether an area is
// built yet is not decided here: each area file exports `BEREIT`
// (src/components/settings/index.js), and the page shows only visible ∩ ready.
//
// In:  the rule registry (for the visibility of "Regelwerke").
// Out: EINSTELLUNGS_BEREICHE, EINSTELLUNGS_REITER, EINSTELLUNGS_ALIAS,
//      sichtbareBereiche(kontext), paletteEintraege(kontext).

import { sichtbareRegelwerke } from "./regelwerke.js";

/**
 * Context the areas depend on.
 * @typedef {{datenquelle?: string, personalZugang?: string}} EinstellungsKontext
 *   datenquelle: 'serverlos' | 'express' | 'supabase'; personalZugang: result of personalZugang()
 */

/**
 * The nine areas in display order: key (URL), title and description (German source
 * for t()), search words for the palette, German aliases. Frozen below.
 * @type {Array<{key: string, titel: string, beschreibung: string, stichworte: string, alias: string[]}>}
 */
const EINSTELLUNGS_BEREICHE = [
  { key: "office", titel: "Büro & Briefkopf", beschreibung: "Büroname, Adresse und Kontakt im Kopf aller Berichte", stichworte: "Büroname, Briefkopf, Adresse, Kontakt, Untertitel, Logo", alias: ["buero", "briefkopf"] },
  { key: "display", titel: "Darstellung & Sprache", beschreibung: "Hell, dunkel oder wie das System; Deutsch oder Englisch", stichworte: "Theme, Dunkelmodus, Hell, Sprache, Englisch, Deutsch", alias: ["darstellung", "theme", "sprache"] },
  { key: "data", titel: "Daten & Sicherung", beschreibung: "Projektdatei sichern und laden, Schnappschüsse und Zurücksetzen", stichworte: "Sicherung, Backup, Projektdatei, bitproj, Import, Export, Schnappschuss, Zurücksetzen", alias: ["daten", "sicherung"] },
  { key: "privacy", titel: "Datenschutz & Browserdaten", beschreibung: "Was dieser Browser speichert und welche Einwilligungen gelten", stichworte: "Cookies, Browserdaten, Einwilligung, Nutzungsprotokoll, Widerruf", alias: ["datenschutz", "cookies"] },
  { key: "ai", titel: "KI-Verbindungen", beschreibung: "Sprachmodelle und Zugänge der KI-Zentrale", stichworte: "KI, Sprachmodell, LLM, Modell, Verbindung, Schlüssel", alias: ["ki", "verbindungen", "connections"] },
  { key: "catalogs", titel: "Kataloge & Bürostandards", beschreibung: "Mengenregeln und Kataloge der Ausschreibung", stichworte: "Katalog, Mengenregeln, Bürostandard, AVA, Ausschreibung", alias: ["kataloge", "mengenregeln"] },
  { key: "rules", titel: "Regelwerke", beschreibung: "Gesetzliche Werte und Bürowerte mit Quelle und gültig ab", stichworte: "Mindestlohn, Urlaub, Probezeit, Aufbewahrung, Löschfrist, Zahlungsziel, Umsatzsteuer, Kilometer, Rechtsform, Gemeinkosten", alias: ["regeln", "regelwerke", "saetze", "fristen", "buchhaltung"] },
  { key: "templates", titel: "Personal-Vorlagen", beschreibung: "Checklisten für Einstellung und Austritt", stichworte: "Vorlage, Checkliste, Eintritt, Austritt, Personal", alias: ["vorlagen", "personal"] },
  { key: "system", titel: "System & Info", beschreibung: "Build, Datenquelle, Rolle und Speicherzustand — nur lesen", stichworte: "Version, Build, Datenquelle, Rolle, Tastenkürzel, Dubletten, Info", alias: ["info"] },
];
for (const b of EINSTELLUNGS_BEREICHE) { Object.freeze(b.alias); Object.freeze(b); }
Object.freeze(EINSTELLUNGS_BEREICHE);
export { EINSTELLUNGS_BEREICHE };

/**
 * Visibility per area key; an area without an entry is always visible.
 * - rules: at least one rule book is visible (in the cloud none is, E-03).
 * - templates: HR templates only with personnel access (DS-12).
 * @type {Readonly<Record<string, (k: EinstellungsKontext) => boolean>>}
 */
const SICHTBARKEIT = Object.freeze({
  rules: (k) => sichtbareRegelwerke(k).length > 0,
  templates: (k) => k.personalZugang === "erlaubt",
});

/** Area keys in display order (module constant, as useTabParam requires). */
export const EINSTELLUNGS_REITER = Object.freeze(EINSTELLUNGS_BEREICHE.map((b) => b.key));

/** German alias → area key (e.g. { regeln: "rules" }). */
export const EINSTELLUNGS_ALIAS = Object.freeze(Object.fromEntries(EINSTELLUNGS_BEREICHE.flatMap((b) => b.alias.map((a) => [a, b.key]))));

/**
 * Areas visible in a context, in display order.
 * @param {EinstellungsKontext} kontext
 * @returns {Array<{key: string, titel: string, beschreibung: string, stichworte: string, alias: ReadonlyArray<string>}>}
 */
export function sichtbareBereiche(kontext) {
  const k = kontext || {};
  return EINSTELLUNGS_BEREICHE.filter((b) => (SICHTBARKEIT[b.key] ? SICHTBARKEIT[b.key](k) : true));
}

/**
 * Command palette entries "Einstellung: <Titel>" for the visible areas.
 * @param {EinstellungsKontext} kontext
 * @returns {Array<{key: string, titel: string, beschreibung: string, stichworte: string, ziel: string}>}
 *   titel/beschreibung untranslated; ziel e.g. "/Settings?tab=system"
 */
export function paletteEintraege(kontext) {
  return sichtbareBereiche(kontext).map((b) => ({
    key: b.key, titel: b.titel, beschreibung: b.beschreibung, stichworte: b.stichworte, ziel: `/Settings?tab=${b.key}`,
  }));
}
