// Calculation values of phase 81 (E-16) as rules of the rule core (80-01,
// @core/lib/regelwerk.js): time tracking, cost rate, fee offers, controlling.
// "Alles einstellbar, mit Quelle und gültig ab" — the office changes them in
// Einstellungen › Regelwerke (/Settings?tab=rules, 80-07); every reader goes
// through useRegelWerte(REGELWERKE) and never keeps a second list.
//
// Deliberately NOT here (one source each, E-16):
// - incidental costs 5 % and VAT 19 %: 79's buchhaltung.nebenkosten_prozent and
//   buchhaltung.ust_satz (alsRegeln());
// - the payment term 14 days: 79's buchhaltung.zahlungsziel_tage / zahlungszielTage().
// The employer share (zeit_honorar.ag_anteil) lives ONLY here — 80-10's
// personalkostenMonat reads the same rule (src/lib/people/kosten.js).
//
// Every value is [ASSUMED] in the sense of CLAUDE.md: the user decided the
// E-16 numbers on 27.09.2026 as office standards, not as checked market data.
//
// In:  nothing. Out: ZEIT_HONORAR_STAND, ZEIT_HONORAR_REGELN, ZEIT_HONORAR_REGELWERK
//      (deep-frozen). Labels and sections are German i18n keys (EN in
//      i18nTeile/zeit-honorar-fundament.js; the i18n guard reads REGELWERKE).

/** Date the values below were decided ('YYYY-MM-DD', decision list E-16). */
export const ZEIT_HONORAR_STAND = "2026-09-27";

const QUELLE_E16 = "Nutzerentscheidung E-16 vom 27.09.2026";
const QUELLE_81 = "Annahme Phase 81";

const A_ZEIT = "Zeiterfassung";
const A_KOSTEN = "Kostensatz";
const A_HONORAR = "Honorar";
const A_CONTROLLING = "Controlling";

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
 * One office rule of the group with the shared fields filled in.
 * @param {{id: string, label: string, einheit: string, typ: string, wert: any, abschnitt: string,
 *   quelle?: string, assumed: string, grenze?: {min?: number, max?: number, modus: 'fail'|'warn', quelle?: string},
 *   hinweis?: string}} r id without the "zeit_honorar." prefix
 * @returns {import("@core/lib/regelwerk.js").Regel}
 */
function regel({ id, wert, quelle = QUELLE_E16, ...rest }) {
  return /** @type {any} */ ({
    ...rest,
    id: `zeit_honorar.${id}`,
    art: "buero",
    editierbar: true,
    werte: [{ ab: ZEIT_HONORAR_STAND, wert, quelle }],
    stand: ZEIT_HONORAR_STAND,
    quelle,
  });
}

/**
 * The rules of the group "Zeit, Honorar & Controlling", in display order.
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>}
 */
export const ZEIT_HONORAR_REGELN = tiefGefroren([
  // --- Zeiterfassung -----------------------------------------------------
  regel({
    id: "raster", label: "Raster der Zeiterfassung", einheit: "Minuten", typ: "zahl", wert: 15, abschnitt: A_ZEIT,
    assumed: "Viertelstunde als Bürostandard (E-16)",
    grenze: { min: 5, max: 60, modus: "fail", quelle: "Eingabebereich der App (5 bis 60 Minuten)" },
  }),
  regel({
    id: "tagessoll", label: "Tagessoll ohne Arbeitsvertrag", einheit: "Minuten", typ: "zahl", wert: 480, abschnitt: A_ZEIT,
    // E-17: the owner has no employment contract; her target comes from here.
    assumed: "8 Stunden je Arbeitstag für Inhaber:innen ohne Arbeitsvertrag (E-16/E-17)",
    // warn, not fail: an owner may plan more than 12 h — the app only points it out.
    grenze: { min: 60, max: 720, modus: "warn", quelle: "Plausibilität: 1 bis 12 Stunden je Tag" },
  }),
  regel({
    id: "bearbeitbar_tage", label: "Buchungen bearbeitbar bis", einheit: "Tage", typ: "zahl", wert: 14, abschnitt: A_ZEIT,
    quelle: QUELLE_81, assumed: "Zwei Wochen Korrekturfrist für Entwürfe — vom Büro festzulegen",
    grenze: { min: 0, max: 365, modus: "fail", quelle: "Eingabebereich der App (0 bis 365 Tage)" },
  }),
  regel({
    id: "freigabe_pflicht", label: "Wochen müssen freigegeben werden", einheit: "ja/nein", typ: "ja_nein", wert: true, abschnitt: A_ZEIT,
    quelle: QUELLE_81, assumed: "Freigabe durch die Büroleitung als Standard — ohne Rollen (Phase 82) kann jede Person freigeben",
  }),
  regel({
    id: "tagesrahmen", label: "Tagesrahmen (Beginn, Ende, Pause) erfassen", einheit: "ja/nein", typ: "ja_nein", wert: true, abschnitt: A_ZEIT,
    assumed: "Optionaler Tagesrahmen mit ArbZG-Hinweisen, die nur warnen (E-15)",
  }),
  // --- Kostensatz ------------------------------------------------------------
  regel({
    id: "gemeinkosten", label: "Gemeinkostenzuschlag", einheit: "Prozent", typ: "prozent", wert: 80, abschnitt: A_KOSTEN,
    assumed: "Bürostandard 80 % auf die direkten Personalkosten (E-16); belegter Wert: Gemeinkosten des Vorjahres aus der Buchhaltung",
    grenze: { min: 0, max: 300, modus: "fail", quelle: "Eingabebereich der App (0 bis 300 %)" },
  }),
  regel({
    id: "ag_anteil", label: "Arbeitgeberanteil Sozialversicherung", einheit: "Prozent", typ: "prozent", wert: 21, abschnitt: A_KOSTEN,
    // The ONLY source of the employer share (E-16); 80-10 personalkostenMonat reads it too.
    assumed: "Pauschal 21 % auf das Bruttogehalt (E-16); belegter Wert: Lohnjournal des Steuerbüros",
    grenze: { min: 0, max: 50, modus: "fail", quelle: "Eingabebereich der App (0 bis 50 %)" },
  }),
  regel({
    id: "produktivquote", label: "Produktivquote", einheit: "Prozent", typ: "prozent", wert: 85, abschnitt: A_KOSTEN,
    assumed: "85 % der Anwesenheit sind projektbezogen (E-16); belegter Wert: Anteil Projektzeit in der Zeiterfassung",
    grenze: { min: 10, max: 100, modus: "fail", quelle: "Eingabebereich der App (10 bis 100 %)" },
  }),
  regel({
    id: "feiertage", label: "Feiertage je Jahr (Kalkulation)", einheit: "Tage", typ: "zahl", wert: 13, abschnitt: A_KOSTEN,
    assumed: "13 gesetzliche Feiertage in Bayern als Kalkulationsbasis (E-16); der Kalender zählt die Feiertage an Wochentagen genau",
    grenze: { min: 0, max: 20, modus: "fail", quelle: "Eingabebereich der App (0 bis 20 Tage)" },
  }),
  regel({
    id: "krankheitstage", label: "Krankheitstage je Jahr (Kalkulation)", einheit: "Tage", typ: "zahl", wert: 10, abschnitt: A_KOSTEN,
    assumed: "10 Tage als Kalkulationsbasis (E-16); belegter Wert: eigene Fehlzeiten der letzten Jahre",
    grenze: { min: 0, max: 60, modus: "fail", quelle: "Eingabebereich der App (0 bis 60 Tage)" },
  }),
  regel({
    id: "buerosatz", label: "Bürosatz (leer = Mittel der Kostensätze)", einheit: "Euro/Stunde", typ: "zahl", wert: null, abschnitt: A_KOSTEN,
    quelle: QUELLE_81,
    // Used where single rates are not readable (no personnel access, cloud) and for remaining hours.
    assumed: "Ohne eigenen Wert rechnet das Controlling mit dem Mittel der gültigen Kostensätze",
    grenze: { min: 0, max: 500, modus: "fail", quelle: "Eingabebereich der App (0 bis 500 Euro/Stunde)" },
  }),
  // --- Honorar --------------------------------------------------------------
  regel({
    id: "angebot_gueltigkeit", label: "Honorarangebot gültig", einheit: "Tage", typ: "zahl", wert: 30, abschnitt: A_HONORAR,
    assumed: "30 Tage Bindefrist als Bürostandard (E-16)",
    grenze: { min: 1, max: 365, modus: "fail", quelle: "Eingabebereich der App (1 bis 365 Tage)" },
  }),
  regel({
    id: "nummer_angebot", label: "Nummernkreis Honorarangebote", einheit: "Muster", typ: "text", wert: "HA-{jahr}-{nr3}", abschnitt: A_HONORAR,
    assumed: "Muster wie die Rechnungsnummern der Buchhaltung (RE-{jahr}-{nr3}, E-16)",
  }),
  regel({
    id: "nummer_vertrag", label: "Nummernkreis Architektenverträge", einheit: "Muster", typ: "text", wert: "AV-{jahr}-{nr3}", abschnitt: A_HONORAR,
    assumed: "Muster wie die Rechnungsnummern der Buchhaltung (RE-{jahr}-{nr3}, E-16)",
  }),
  regel({
    id: "verrechnungssatz_inhaber", label: "Verrechnungssatz Inhaber/in", einheit: "Euro/Stunde", typ: "zahl", wert: 115, abschnitt: A_HONORAR,
    quelle: QUELLE_81, assumed: "Stundensatz für Zeithonorare und Besondere Leistungen — vom Büro festzulegen",
    grenze: { min: 0, max: 500, modus: "fail", quelle: "Eingabebereich der App (0 bis 500 Euro/Stunde)" },
  }),
  regel({
    id: "verrechnungssatz_projektleitung", label: "Verrechnungssatz Projektleitung", einheit: "Euro/Stunde", typ: "zahl", wert: 105, abschnitt: A_HONORAR,
    quelle: QUELLE_81, assumed: "Stundensatz für Zeithonorare und Besondere Leistungen — vom Büro festzulegen",
    grenze: { min: 0, max: 500, modus: "fail", quelle: "Eingabebereich der App (0 bis 500 Euro/Stunde)" },
  }),
  regel({
    id: "verrechnungssatz_mitarbeit", label: "Verrechnungssatz Mitarbeit", einheit: "Euro/Stunde", typ: "zahl", wert: 85, abschnitt: A_HONORAR,
    quelle: QUELLE_81, assumed: "Stundensatz für Zeithonorare und Besondere Leistungen — vom Büro festzulegen",
    grenze: { min: 0, max: 500, modus: "fail", quelle: "Eingabebereich der App (0 bis 500 Euro/Stunde)" },
  }),
  // --- Controlling ----------------------------------------------------------
  regel({
    id: "ampel_gelb", label: "Ampel gelb ab Aufwand über Fortschritt", einheit: "Prozentpunkte", typ: "zahl", wert: 0, abschnitt: A_CONTROLLING,
    assumed: "Gelb, sobald der verbrauchte Anteil des Honorars den Fortschritt übersteigt (E-16)",
    grenze: { min: -50, max: 50, modus: "fail", quelle: "Eingabebereich der App (−50 bis 50 Prozentpunkte)" },
  }),
  regel({
    id: "ampel_rot", label: "Ampel rot ab Aufwand über Fortschritt", einheit: "Prozentpunkte", typ: "zahl", wert: 10, abschnitt: A_CONTROLLING,
    assumed: "Rot ab 10 Prozentpunkten Vorlauf des Aufwands (E-16)",
    grenze: { min: 0, max: 100, modus: "fail", quelle: "Eingabebereich der App (0 bis 100 Prozentpunkte)" },
  }),
]);

/**
 * The rule book of phase 81 in the RegelGruppe shape of 80-01 — ONE line in
 * REGELWERKE (src/lib/settings/regelwerke.js). One Setting row "regel:<id>" per
 * override (storage kind `zeilen`). Visible like the accounting group: hidden in
 * the cloud build unless the cloud release E-20 is on (kontext.buchhaltungCloud,
 * set by Settings.jsx from BUERO_CLOUD_FREIGABE) — the time and fee data follow
 * the accounting there (E-03/E-20).
 * @type {Readonly<import("@core/lib/regelwerk.js").RegelGruppe>}
 */
export const ZEIT_HONORAR_REGELWERK = Object.freeze({
  gruppe: "zeit_honorar",
  titel: "Zeit, Honorar & Controlling",
  regeln: /** @type {any} */ (ZEIT_HONORAR_REGELN),
  speicher: Object.freeze({ art: /** @type {const} */ ("zeilen") }),
  sichtbar: (/** @type {any} */ k) => k?.datenquelle !== "supabase" || k?.buchhaltungCloud === true,
});
