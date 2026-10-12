// Guide values of the deadline calendar (phase 82, E-16) as rules of the rule
// core (80-01, @core/lib/regelwerk.js): reminder lead times, the agenda window,
// warranty periods after VOB/B and BGB, the architect's liability, the
// inspection lead time before a warranty ends, and the return of a security.
// One place to maintain them: Einstellungen › Regelwerke (/Settings?tab=rules,
// 80-07); every reader goes through useRegelWerte(REGELWERKE).
//
// Legal periods carry their norm; VOB/B periods apply only when VOB/B is agreed
// (the acceptance record says so, 82-03). Every check that reads these values
// warns, never fails — a wrong reminder must not block work (liability choice).
//
// In:  nothing. Out: FRISTEN_STAND, FRISTEN_REGELN, FRISTEN_REGELWERK (deep-frozen).
//      Labels and sections are German i18n keys (EN in i18nTeile/buero-orga-fundament.js).

/** Date the values below were set ('YYYY-MM-DD'). */
export const FRISTEN_STAND = "2026-01-01";

const A_ERINNERUNG = "Erinnerungen";
const A_GEWAEHR = "Gewährleistung";

/**
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
 * @param {{id: string, label: string, einheit: string, typ: string, wert: any, abschnitt: string, art?: 'gesetz'|'buero'|'praxis',
 *   quelle: string, assumed?: string, grenze?: {min?: number, max?: number, modus: 'fail'|'warn', quelle?: string}}} r id without "fristen."
 * @returns {import("@core/lib/regelwerk.js").Regel}
 */
function regel({ id, wert, quelle, art = "buero", ...rest }) {
  return /** @type {any} */ ({
    ...rest,
    id: `fristen.${id}`,
    art,
    editierbar: art !== "gesetz",
    werte: [{ ab: FRISTEN_STAND, wert, quelle }],
    stand: FRISTEN_STAND,
    quelle,
  });
}

const BUERO = "Annahme Phase 82 (Bürostandard)";

/**
 * The rules of the group "Fristen & Gewährleistung", in display order.
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>}
 */
export const FRISTEN_REGELN = tiefGefroren([
  regel({ id: "vorlauf_frist_tage", label: "Vorlauf für Fristen", einheit: "Tage", typ: "liste", wert: [30, 7, 1], abschnitt: A_ERINNERUNG, quelle: BUERO,
    assumed: "Erinnerung 30, 7 und 1 Tag vor einer Frist — vom Büro festzulegen" }),
  regel({ id: "vorlauf_termin_tage", label: "Vorlauf für Termine", einheit: "Tage", typ: "liste", wert: [7, 1], abschnitt: A_ERINNERUNG, quelle: BUERO,
    assumed: "Erinnerung 7 und 1 Tag vor einem Termin — vom Büro festzulegen" }),
  regel({ id: "vorlauf_hinweis_tage", label: "Vorlauf für Hinweise", einheit: "Tage", typ: "liste", wert: [14], abschnitt: A_ERINNERUNG, quelle: BUERO,
    assumed: "Hinweise erscheinen 14 Tage vorher — vom Büro festzulegen" }),
  regel({ id: "agenda_tage", label: "Agenda-Zeitraum", einheit: "Tage", typ: "zahl", wert: 90, abschnitt: A_ERINNERUNG, quelle: BUERO,
    assumed: "Die Agenda zeigt die nächsten 90 Tage",
    grenze: { min: 7, max: 730, modus: "fail", quelle: "Eingabebereich der App (7 bis 730 Tage)" } }),
  regel({ id: "vob_bauwerk_jahre", label: "Gewährleistung VOB/B Bauwerk", einheit: "Jahre", typ: "zahl", wert: 4, abschnitt: A_GEWAEHR, art: "praxis",
    quelle: "§ 13 Abs. 4 Nr. 1 VOB/B (gilt nur bei vereinbarter VOB/B)", grenze: { min: 0, max: 30, modus: "warn" } }),
  regel({ id: "vob_sonstige_jahre", label: "Gewährleistung VOB/B andere Werke", einheit: "Jahre", typ: "zahl", wert: 2, abschnitt: A_GEWAEHR, art: "praxis",
    quelle: "§ 13 Abs. 4 Nr. 1 VOB/B", grenze: { min: 0, max: 30, modus: "warn" } }),
  regel({ id: "vob_wartungsanlage_jahre", label: "Gewährleistung VOB/B wartungsrelevante Anlagen ohne Wartungsvertrag", einheit: "Jahre", typ: "zahl", wert: 2, abschnitt: A_GEWAEHR, art: "praxis",
    quelle: "§ 13 Abs. 4 Nr. 2 VOB/B", grenze: { min: 0, max: 30, modus: "warn" } }),
  regel({ id: "bgb_bauwerk_jahre", label: "Gewährleistung BGB Bauwerk", einheit: "Jahre", typ: "zahl", wert: 5, abschnitt: A_GEWAEHR, art: "gesetz",
    quelle: "§ 634a Abs. 1 Nr. 2 BGB" }),
  regel({ id: "bgb_sonstige_jahre", label: "Gewährleistung BGB sonstige Werke", einheit: "Jahre", typ: "zahl", wert: 2, abschnitt: A_GEWAEHR, art: "gesetz",
    quelle: "§ 634a Abs. 1 Nr. 1 BGB" }),
  regel({ id: "architektenhaftung_jahre", label: "Haftung der Architektin", einheit: "Jahre", typ: "zahl", wert: 5, abschnitt: A_GEWAEHR, art: "gesetz",
    quelle: "§ 634a Abs. 1 Nr. 2 BGB, Teilabnahme nach § 650s BGB" }),
  regel({ id: "begehung_vorlauf_monate", label: "Objektbegehung vor Gewährleistungsende", einheit: "Monate", typ: "zahl", wert: 3, abschnitt: A_GEWAEHR, quelle: BUERO,
    assumed: "Begehung 3 Monate vor Ablauf (HOAI Anlage 10 LPH 9 „vor Ablauf der Verjährungsfristen“, Vorlauf vom Büro festzulegen)",
    grenze: { min: 0, max: 24, modus: "warn" } }),
  regel({ id: "sicherheit_rueckgabe_jahre", label: "Rückgabe der Sicherheit nach", einheit: "Jahre", typ: "zahl", wert: 2, abschnitt: A_GEWAEHR, art: "praxis",
    quelle: "§ 17 Abs. 8 Nr. 2 VOB/B", grenze: { min: 0, max: 10, modus: "warn" } }),
]);

/** The group in the rule book (80 RegelGruppe form, pattern 81 ZEIT_HONORAR_REGELWERK). */
export const FRISTEN_REGELWERK = Object.freeze({
  gruppe: "fristen",
  titel: "Fristen & Gewährleistung",
  regeln: /** @type {any} */ (FRISTEN_REGELN),
  speicher: Object.freeze({ art: /** @type {const} */ ("zeilen") }),
  // Like 81: no editing place in the locked cloud build (there the standard values apply);
  // with the release E-20 (buchhaltungCloud) visible.
  sichtbar: (/** @type {any} */ k) => k?.datenquelle !== "supabase" || k?.buchhaltungCloud === true,
});
