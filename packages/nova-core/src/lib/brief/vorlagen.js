// Letter contents of the fee chain (phase 81-03/81-04, D-P81-27): pure builders that
// turn already-computed, already-formatted figures into the input of 79-03's
// briefLayout() — subject, paragraphs and the amount table. Phase 81-04 adds the
// order confirmation and the fee amendment; phase 82-05 makes the texts editable.
//
// The texts are GERMAN DOCUMENT CONTENT, not UI strings: a fee offer to a German
// client is a German letter whatever language the app shows, so they do not go
// through t(). Only invented sample names appear in tests (projektneutral).
// @core formats nothing itself (79-03 contract, app/package boundary): amounts,
// dates and percentages arrive as text.
//
// In:  a context object per letter (see the typedefs). Out: {betreff, absaetze,
//      tabelle} for briefLayout(); every builder carries a `version`. Phase 82-05
//      adds BRIEFARTEN (templates with placeholders), alleVorlagen() and mitBueroFassung().

/**
 * One line of the amount table: label, percentage text (may be ""), amount text.
 * @typedef {{bezeichnung: string, prozent: string, betrag: string}} BriefZeile
 */

/** Column layout of the amount tables: label left, percent and amount right (mm, sum 165 = text width). */
export const BETRAGS_SPALTEN = Object.freeze([
  Object.freeze({ breite_mm: 105, ausrichtung: /** @type {const} */ ("links") }),
  Object.freeze({ breite_mm: 20, ausrichtung: /** @type {const} */ ("rechts") }),
  Object.freeze({ breite_mm: 40, ausrichtung: /** @type {const} */ ("rechts") }),
]);

/**
 * Context of the fee offer letter (all values formatted by the caller).
 * @typedef {{
 *   nummer: string, fassung: number, datum: string, gueltigBis: string, projektName: string,
 *   leistungsbild: string, lphParagraf: string|number, fassungHoai: string,
 *   zeilen: BriefZeile[], netto: string, ust: string, brutto: string, ustProzent: string|number,
 *   zahlungszielTage: number, zahlungszielVertraglich: boolean,
 *   vorbemerkung?: string, annahmen?: string, ausschluesse?: string,
 *   umbauOhneTextform?: boolean, gegenlesen?: boolean,
 * }} AngebotKontext
 */

/**
 * Context of the order confirmation (81-04; all values formatted by the caller).
 * @typedef {{
 *   nummer: string, angebotNummer?: string, projektName: string, vertragsdatum: string,
 *   leistungsbild: string, lphParagraf: string|number, fassungHoai: string,
 *   stufen: string[], zeilen: BriefZeile[], netto: string, ust: string, brutto: string, ustProzent: string|number,
 *   zahlungszielTage: number, zahlungszielQuelle: string, zahlungszielVertraglich: boolean,
 *   termine: string[], haftung: string[], verbraucher: boolean, gegenlesen?: boolean,
 * }} BestaetigungKontext
 */

/**
 * Context of a fee amendment letter (81-04; values formatted by the caller).
 * @typedef {{
 *   nr: number|string, titel: string, vertragNummer: string, projektName: string, grund: string, grundQuelle: string,
 *   lph?: string, berechnung: string, betrag: string, nebenkostenProzent: string|number, gegenlesen?: boolean,
 * }} NachtragKontext
 */

/**
 * The letter builders by key; `version` changes when the wording changes (the
 * stored PDF keeps the old wording, a new version builds the new one).
 * 81-04 adds the order confirmation and the fee amendment.
 */
export const HONORAR_BRIEFE = Object.freeze({
  honorarangebot: Object.freeze({
    version: 1,
    /**
     * @param {AngebotKontext} k
     * @returns {{betreff: string, absaetze: string[], tabelle: {kopf: string[], zeilen: string[][], spalten: typeof BETRAGS_SPALTEN}}}
     */
    bauen(k) {
      const absaetze = ["Sehr geehrte Damen und Herren,"];
      absaetze.push(`für das Projekt „${k.projektName}“ bieten wir Ihnen die Leistungen des Leistungsbilds ${k.leistungsbild} nach § ${k.lphParagraf} ${k.fassungHoai} wie folgt an.`);
      if (k.vorbemerkung) absaetze.push(k.vorbemerkung);
      if (k.annahmen) absaetze.push(`Annahmen: ${k.annahmen}`);
      if (k.ausschluesse) absaetze.push(`Nicht enthalten: ${k.ausschluesse}`);
      absaetze.push(`Das Honorar beträgt ${k.netto} netto zuzüglich ${k.ustProzent} % Umsatzsteuer (${k.ust}), zusammen ${k.brutto}.`);
      absaetze.push(`Zahlungsziel ${k.zahlungszielTage} Tage nach Rechnungseingang${k.zahlungszielVertraglich ? " (vertraglich vereinbart)" : ""}.`);
      if (k.umbauOhneTextform) absaetze.push("Der Umbauzuschlag von 20 % gilt nach § 6 Abs. 2 HOAI, solange kein anderer Zuschlag in Textform vereinbart ist.");
      absaetze.push("Das Honorar wird mit dem Architektenvertrag in Textform vereinbart (§ 7 Abs. 1 HOAI).");
      absaetze.push(`Dieses Honorarangebot gilt bis ${k.gueltigBis}.`);
      if (k.gegenlesen) absaetze.push("Entwurf — Richtwerte nach HOAI 2021, vor Versand gegenlesen.");
      absaetze.push("Mit freundlichen Grüßen");
      return {
        betreff: `Honorarangebot ${k.nummer}${k.fassung > 1 ? ` (Fassung ${k.fassung})` : ""} — ${k.projektName}`,
        absaetze,
        tabelle: {
          kopf: ["Leistung", "Anteil", "Betrag"],
          zeilen: [...k.zeilen.map((z) => [z.bezeichnung, z.prozent, z.betrag]), ["Honorar netto", "", k.netto], [`Umsatzsteuer ${k.ustProzent} %`, "", k.ust], ["Honorar brutto", "", k.brutto]],
          spalten: BETRAGS_SPALTEN,
        },
      };
    },
  }),
  auftragsbestaetigung: Object.freeze({
    version: 1,
    /**
     * @param {BestaetigungKontext} k
     * @returns {{betreff: string, absaetze: string[], tabelle: {kopf: string[], zeilen: string[][], spalten: typeof BETRAGS_SPALTEN}}}
     */
    bauen(k) {
      const absaetze = ["Sehr geehrte Damen und Herren,"];
      absaetze.push(`vielen Dank für Ihren Auftrag${k.angebotNummer ? ` auf unser Honorarangebot ${k.angebotNummer}` : ""}. Wir bestätigen den Architektenvertrag ${k.nummer} vom ${k.vertragsdatum} für das Projekt „${k.projektName}“: Leistungsbild ${k.leistungsbild} nach § ${k.lphParagraf} ${k.fassungHoai}.`);
      if (k.stufen.length) absaetze.push(`Beauftragt: ${k.stufen.join("; ")}.`);
      absaetze.push(`Das Honorar beträgt ${k.netto} netto zuzüglich ${k.ustProzent} % Umsatzsteuer (${k.ust}), zusammen ${k.brutto}.`);
      absaetze.push("Abschlagszahlungen nach Leistungsstand (§ 15 HOAI); die Nebenkosten werden mit der Schlussrechnung abgerechnet.");
      absaetze.push(`Zahlungsziel ${k.zahlungszielTage} Tage nach Rechnungseingang (${k.zahlungszielQuelle}${k.zahlungszielVertraglich ? ", vertraglich vereinbart" : ""}).`);
      if (k.termine.length) absaetze.push(`Termine: ${k.termine.join("; ")}.`);
      if (k.haftung.length) absaetze.push(`Haftung: ${k.haftung.join("; ")}.`);
      // [ASSUMED] wording, to be checked by a lawyer (78-09 checklist) — a hint, not legal advice.
      if (k.verbraucher) absaetze.push("Hinweis für Verbraucher: Ihnen steht ein Sonderkündigungsrecht nach § 650r BGB zu.");
      if (k.gegenlesen) absaetze.push("Entwurf — Richtwerte nach HOAI 2021, vor Versand gegenlesen.");
      absaetze.push("Mit freundlichen Grüßen");
      return {
        betreff: `Auftragsbestätigung Architektenvertrag ${k.nummer} — ${k.projektName}`,
        absaetze,
        tabelle: {
          kopf: ["Leistung", "Anteil", "Betrag"],
          zeilen: [...k.zeilen.map((z) => [z.bezeichnung, z.prozent, z.betrag]), ["Honorar netto", "", k.netto], [`Umsatzsteuer ${k.ustProzent} %`, "", k.ust], ["Honorar brutto", "", k.brutto]],
          spalten: BETRAGS_SPALTEN,
        },
      };
    },
  }),
  honorarnachtrag: Object.freeze({
    version: 1,
    /**
     * @param {NachtragKontext} k
     * @returns {{betreff: string, absaetze: string[], tabelle: {kopf: string[], zeilen: string[][], spalten: typeof BETRAGS_SPALTEN}}}
     */
    bauen(k) {
      const absaetze = ["Sehr geehrte Damen und Herren,"];
      absaetze.push(`zum Architektenvertrag ${k.vertragNummer} für das Projekt „${k.projektName}“ bieten wir Ihnen den Honorarnachtrag ${k.nr} „${k.titel}“ an.`);
      absaetze.push(`Grund: ${k.grund} (${k.grundQuelle})${k.lph ? `, ${k.lph}` : ""}.`);
      absaetze.push(`Berechnung: ${k.berechnung}. Zuzüglich Nebenkosten von ${k.nebenkostenProzent} % laut Vertrag und Umsatzsteuer.`);
      absaetze.push("Wir bitten um Beauftragung in Textform (§ 7 Abs. 1 HOAI).");
      if (k.gegenlesen) absaetze.push("Entwurf — vor Versand gegenlesen.");
      absaetze.push("Mit freundlichen Grüßen");
      return {
        betreff: `Honorarnachtrag ${k.nr} zum Architektenvertrag ${k.vertragNummer} — ${k.titel}`,
        absaetze,
        tabelle: { kopf: ["Leistung", "", "Betrag"], zeilen: [[`Honorarnachtrag ${k.nr} – ${k.titel}`, "", k.betrag]], spalten: BETRAGS_SPALTEN },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Phase 82 (82-05), additive: general letter types of the correspondence next to
// the fee builders above. Same rule — German document content, no t(). An 82
// template is text with placeholders (platzhalter.js); a fee builder stays a
// builder: the editor calls bauen(kontext) once and edits the result as a draft.
// The dunning letter formulates nothing itself (D-P82-25): its text comes from
// 79's mahnBrief(mahnTextFelder(…)) when it is opened; the template only gives
// subject and frame. `richtwert` marks templates with legal wording of their
// owner (79, 81) — the editor shows "Richtwert – vor Versand prüfen" (78-09 checklist).

/**
 * A general template of phase 82.
 * @typedef {{
 *   key: string, art: string, version: number, quelle: '82'|'79', betreff: string, text: string,
 *   anlagen: string[], pflichtPlatzhalter: string[], richtwert?: boolean, variante?: 'verteiler',
 *   textAus79?: boolean,
 * }} Briefart
 */

/** @type {Readonly<Record<string, Readonly<Briefart>>>} */
export const BRIEFARTEN = Object.freeze({
  brief: Object.freeze({
    key: "brief", art: "brief", version: 1, quelle: "82",
    betreff: "",
    text: "Sehr geehrte Damen und Herren,\n\n\n\nMit freundlichen Grüßen",
    anlagen: [], pflichtPlatzhalter: [],
  }),
  antwort: Object.freeze({
    key: "antwort", art: "antwort", version: 1, quelle: "82",
    betreff: "Ihr Schreiben vom {{postbuch.datum|datum}} – {{postbuch.betreff}}",
    text: "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Schreiben vom {{postbuch.datum|datum}}.\n\n\n\nMit freundlichen Grüßen",
    anlagen: [], pflichtPlatzhalter: ["postbuch.datum", "postbuch.betreff"],
  }),
  anschreiben_honorarangebot: Object.freeze({
    key: "anschreiben_honorarangebot", art: "anschreiben_honorarangebot", version: 1, quelle: "82",
    betreff: "Honorarangebot {{angebot.nummer}} – {{projekt.name}}",
    text: "Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unser Honorarangebot {{angebot.nummer}} vom {{angebot.datum|datum}} für das Projekt „{{projekt.name}}“. Das Angebot gilt bis {{angebot.gueltig_bis|datum}}.\n\nFür Rückfragen stehen wir Ihnen gern zur Verfügung.\n\nMit freundlichen Grüßen",
    anlagen: ["Honorarangebot {{angebot.nummer}}"], pflichtPlatzhalter: ["angebot.nummer", "projekt.name"],
  }),
  protokoll: Object.freeze({
    key: "protokoll", art: "protokoll", version: 1, quelle: "82", variante: "verteiler",
    betreff: "Protokoll {{protokoll.titel}} vom {{protokoll.datum|datum}}",
    text: "Projekt: {{projekt.name}}\nOrt: {{protokoll.ort}}\n\n{{tabelle:tops}}",
    anlagen: [], pflichtPlatzhalter: ["protokoll.titel", "protokoll.datum"],
  }),
  // 88-02: hindrance notice after VOB/B § 6 Abs. 1 from the documented bad-weather
  // days of the site diary (bezug bautagebuch:<id>). Legal wording → richtwert: the
  // editor shows "Richtwert – vor Versand prüfen". [ASSUMED] wording, to be checked
  // by the office (who notifies whom depends on the contract: contractor → client
  // under VOB/B, or the site management informing the client).
  behinderungsanzeige: Object.freeze({
    key: "behinderungsanzeige", art: "behinderungsanzeige", version: 1, quelle: "82", richtwert: true,
    betreff: "Behinderungsanzeige nach § 6 Abs. 1 VOB/B – {{projekt.name}}",
    text: "Sehr geehrte Damen und Herren,\n\nhiermit zeigen wir gemäß § 6 Abs. 1 VOB/B an, dass die Ausführung der Arbeiten am Bauvorhaben „{{projekt.name}}“ im Zeitraum {{behinderung.zeitraum}} an {{behinderung.tage}} Tagen behindert war.\n\nGrundlage sind die Einträge im Bautagebuch:\n{{behinderung.text}}\n\nDie Auswirkungen auf die Ausführungsfristen (§ 6 Abs. 2 und 4 VOB/B) legen wir gesondert dar. Wir bitten um Bestätigung des Eingangs.\n\nMit freundlichen Grüßen",
    anlagen: ["Auszug Bautagebuch"], pflichtPlatzhalter: ["projekt.name", "behinderung.zeitraum", "behinderung.text"],
  }),
  // N-9 (user decision 13.10.2026: "both"): the office version — the site management
  // informs the client of a hindrance it documented in the site diary (e.g. a trade
  // delayed by weather). Unlike the VOB/B notice above it is not the contractor's
  // statutory notice; it reports and announces the effect on the schedule.
  // [ASSUMED] wording → richtwert, check before sending.
  behinderung_bauherr: Object.freeze({
    key: "behinderung_bauherr", art: "behinderung_bauherr", version: 1, quelle: "82", richtwert: true,
    betreff: "Mitteilung über eine Behinderung der Bauausführung – {{projekt.name}}",
    text: "Sehr geehrte Damen und Herren,\n\nals Bauleitung teilen wir Ihnen mit, dass die Ausführung der Arbeiten am Bauvorhaben „{{projekt.name}}“ im Zeitraum {{behinderung.zeitraum}} an {{behinderung.tage}} Tagen behindert war.\n\nGrundlage sind die Einträge im Bautagebuch:\n{{behinderung.text}}\n\nWir prüfen die Auswirkungen auf den Terminplan und informieren Sie über eine mögliche Verschiebung von Fertigstellungsterminen. Behinderungsanzeigen der ausführenden Firmen nach § 6 Abs. 1 VOB/B leiten wir Ihnen gesondert weiter.\n\nMit freundlichen Grüßen",
    anlagen: ["Auszug Bautagebuch"], pflichtPlatzhalter: ["projekt.name", "behinderung.zeitraum", "behinderung.text"],
  }),
  mahnung: Object.freeze({
    key: "mahnung", art: "mahnung", version: 1, quelle: "79", richtwert: true, textAus79: true,
    betreff: "Rechnung {{rechnung.nummer}} – Mahnstufe {{mahnung.stufe}}",
    text: "",
    anlagen: [], pflichtPlatzhalter: ["rechnung.nummer"],
  }),
});

/**
 * Description of a fee builder of phase 81 in the template list.
 * @typedef {{key: string, art: string, version: number, quelle: '81', richtwert: true, bauen: (k: any) => {betreff: string, absaetze: string[], tabelle?: any}}} HonorarBeschreibung
 */

/**
 * All templates: the fee builders of 81 (unchanged, as descriptions) and the general letter types of 82.
 * @returns {Array<HonorarBeschreibung|Readonly<Briefart>>}
 */
export function alleVorlagen() {
  const honorar = Object.entries(HONORAR_BRIEFE).map(([key, b]) => /** @type {HonorarBeschreibung} */ ({
    key, art: key, version: b.version, quelle: "81", richtwert: true, bauen: (/** @type {any} */ k) => b.bauen(k),
  }));
  return [...honorar, ...Object.values(BRIEFARTEN)];
}

/**
 * The office version of a template: a stored Briefvorlage with the same key
 * replaces subject, text and enclosures. When the standard is newer than the
 * version the office text was based on, the office text stays and carries the
 * hint 'standard_aktualisiert' (the editor offers "Auf Standard zurücksetzen").
 * Fee builders (no text) have no office version.
 * @param {Readonly<Briefart>|HonorarBeschreibung} standard
 * @param {ReadonlyArray<Record<string, any>>} briefvorlagen stored Briefvorlage records
 * @returns {Record<string, any>} the template with `buero` (bool), `briefvorlage_id`, `hinweis`
 */
export function mitBueroFassung(standard, briefvorlagen) {
  if (!("text" in standard)) return { ...standard, buero: false, briefvorlage_id: null, hinweis: null };
  const eigene = (briefvorlagen || []).filter((v) => v && v.vorlage_key === standard.key)
    .sort((a, b) => String(b.updated_date || b.created_date || "").localeCompare(String(a.updated_date || a.created_date || "")))[0];
  if (!eigene) return { ...standard, buero: false, briefvorlage_id: null, hinweis: null };
  return {
    ...standard,
    betreff: typeof eigene.betreff === "string" ? eigene.betreff : standard.betreff,
    text: typeof eigene.text === "string" ? eigene.text : standard.text,
    anlagen: Array.isArray(eigene.anlagen) ? eigene.anlagen : standard.anlagen,
    buero: true,
    briefvorlage_id: eigene.id || null,
    hinweis: Number(eigene.basis_version) < standard.version ? "standard_aktualisiert" : null,
  };
}
