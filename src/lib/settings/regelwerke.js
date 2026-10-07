// Registry of the rule books (80-01, E-16): the ONE docking point for legal and
// office values of phases 79, 80 and 81. "Einstellungen › Regelwerke" (80-07) shows
// every visible group, useRegelWerte reads them, nothing else keeps a second list.
//
// Groups:
// - `buchhaltung` (79): alsRegeln() — 60 rules — adapted by
//   angepassteBuchhaltungsRegeln (choices for legal form, VAT period, taxation and
//   chart of accounts; mahnstufen and beleg_max_bytes read-only). Stored as fields of
//   the row Setting{key:"buchhaltung"} that 79 reads; 79's wirksameEinstellungen
//   decides what is accepted (an unknown legal form falls back to
//   "einzelunternehmen"). Hidden in the cloud build: accounting is locked there
//   until phase 74 (E-03).
// - `personal` (80): HR_REGELN, one Setting row "regel:<id>" per override with
//   "gültig ab" (E-16), only with personnel access (DS-12).
//
// Docking point for phase 81 (E-16: overhead, employer share, productivity … "alles
// einstellbar, mit Quelle und gültig ab") — one line in REGELWERKE, e.g.
//   { gruppe: "zeit_honorar", titel: "Zeit & Honorar", regeln: ZEIT_HONORAR_REGELN,
//     speicher: { art: "zeilen" }, sichtbar: (k) => k.datenquelle !== "supabase" },
// with `zeit_honorar.ag_anteil` as the only source of the employer share.
//
// In:  the 79 accounting settings, the HR rule book. Out: REGELWERKE, RECHTSFORM_LABEL,
//      angepassteBuchhaltungsRegeln, sichtbareRegelwerke, regelNachId.
//      Loads under node (the i18n guard imports it); storage loads only on demand.

import { SETTING_KEY } from "../accounting/datenmodell.js";
import { alsRegeln } from "../accounting/einstellungen.js";
import { RECHTSFORMEN } from "../accounting/rechtsform.js";
import { HR_REGELN } from "../people/hrRegeln.js";

/**
 * Context the visibility of a group depends on.
 * @typedef {{datenquelle?: string, personalZugang?: string}} RegelKontext
 */

/**
 * Display text per legal-form key — literally the texts of rechtsformText() in the
 * 79 settings dialog (EN in i18nTeile/buchhaltung-fundament.js).
 * @type {Readonly<Record<string, string>>}
 */
export const RECHTSFORM_LABEL = Object.freeze({
  einzelunternehmen: "Einzelunternehmen (Freiberufler)",
  gbr: "GbR",
  partg: "PartG",
  gmbh: "GmbH",
  ug: "UG (haftungsbeschränkt)",
});

/**
 * Choices of the accounting rules that 79 publishes as `typ:'text'`. The value lists
 * are the whitelist of wirksameEinstellungen (src/lib/accounting/einstellungen.js);
 * tests/unit/hrRegeln.test.js keeps both equal. Labels as in UmsatzsteuerReiter.jsx
 * and the 79 dialog (SKR: label = value).
 * @type {Readonly<Record<string, ReadonlyArray<{wert: string, label: string}>>>}
 */
const AUSWAHL = Object.freeze({
  "buchhaltung.rechtsform": RECHTSFORMEN.map((wert) => ({ wert, label: RECHTSFORM_LABEL[wert] })),
  "buchhaltung.ust_zeitraum": [
    { wert: "monat", label: "monatlich" },
    { wert: "quartal", label: "vierteljährlich" },
    { wert: "jahr", label: "keine (nur Jahreserklärung)" },
  ],
  "buchhaltung.versteuerung": [
    { wert: "ist", label: "Ist (nach Zahlungseingang)" },
    { wert: "soll", label: "Soll (nach Rechnungsdatum)" },
  ],
  "buchhaltung.kontenrahmen": [
    { wert: "SKR03", label: "SKR03" },
    { wert: "SKR04", label: "SKR04" },
  ],
});

/**
 * Office values of 79 that the rule books show read-only.
 * - beleg_max_bytes: wirksameEinstellungen always returns BUERO_STANDARD.beleg_max_bytes,
 *   so an own value never took effect (finding to 79, 80-01-SUMMARY).
 * - mahnstufen (typ 'objekt'): MahnwesenAbschnitt.jsx (79-03) edits the same field —
 *   one editor per value.
 * @type {Readonly<Record<string, {hinweis?: string}>>}
 */
const NUR_LESEND = Object.freeze({
  "buchhaltung.beleg_max_bytes": {},
  "buchhaltung.mahnstufen": { hinweis: "Pflege im Reiter Ausgangsrechnungen › Mahnwesen" },
});

/**
 * Adapts the accounting rules of alsRegeln() for the rule books. Appends nothing,
 * removes nothing: every rule comes back as a copy, the four choice fields as
 * `typ:'auswahl'` with `optionen`, mahnstufen and beleg_max_bytes as
 * `editierbar:false`. An id missing in a later 79 version simply stays missing.
 * The yes/no rules (dauerfrist, gewst_aktiv, est_ueber_buero) stay as they are.
 * @param {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>} regeln output of alsRegeln()
 * @returns {import("@core/lib/regelwerk.js").Regel[]} new objects, same order and length
 */
export function angepassteBuchhaltungsRegeln(regeln) {
  return (Array.isArray(regeln) ? regeln : []).map((r) => {
    const optionen = AUSWAHL[r.id];
    if (optionen) return { ...r, typ: "auswahl", optionen: optionen.map((o) => ({ ...o })) };
    const fest = NUR_LESEND[r.id];
    if (fest) return { ...r, editierbar: false, ...fest };
    return { ...r };
  });
}

/**
 * Freezes a rule tree; functions stay as they are.
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function tiefGefroren(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) tiefGefroren(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

/**
 * All rule books, in display order.
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").RegelGruppe>}
 */
export const REGELWERKE = tiefGefroren([
  {
    gruppe: "buchhaltung",
    titel: "Buchhaltung & Steuern",
    regeln: angepassteBuchhaltungsRegeln(alsRegeln()),
    speicher: { art: "setting", key: SETTING_KEY, feld: (id) => id.slice("buchhaltung.".length) },
    // Cloud: accounting is locked until phase 74 (E-03), so its rules are hidden
    // there — unless the cloud release E-20 is on (kontext.buchhaltungCloud).
    sichtbar: (k) => k?.datenquelle !== "supabase" || k?.buchhaltungCloud === true,
    // 83-02: the pre-write hook that seeded the demo's sample books is gone
    // with the demo; the generic `vorSchreiben` hook stays in the core.
  },
  {
    gruppe: "personal",
    titel: "Personal & Arbeitsrecht",
    regeln: [...HR_REGELN],
    speicher: { art: "zeilen" },
    sichtbar: (k) => k?.personalZugang === "erlaubt",
  },
]);

/**
 * Groups visible in a context (cloud, personnel access).
 * @param {RegelKontext} kontext
 * @returns {Array<import("@core/lib/regelwerk.js").RegelGruppe>}
 */
export function sichtbareRegelwerke(kontext) {
  return REGELWERKE.filter((g) => g.sichtbar(kontext || {}));
}

/**
 * A rule of any group by id (visibility is not checked).
 * @param {string} id e.g. "buchhaltung.rechtsform"
 * @returns {import("@core/lib/regelwerk.js").Regel|null}
 */
export function regelNachId(id) {
  for (const g of REGELWERKE) {
    const r = g.regeln.find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}
