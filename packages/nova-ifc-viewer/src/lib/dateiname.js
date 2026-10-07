// dateiname.js — Dateinamenkonvention eines Bauherren-Organisationshandbuchs
// (Phase 71-03). Quelle privat unter .planning/quellen/ (nie ausliefern).
// IFC-Muster (Format ifc/native):
//   P2_00000-02_AX_TM_XX_V_01_FREITEXT.ifc
//   Phase_Gebäudenummer_Fachsicht_Modellart_Geschoss_Status_Index_Freitext.Endung
// Gebäudenummern sind Projektdaten: geprüft wird das Muster, der Katalog
// liefert nur neutrale Beispiele (Phase-78-Hotfix, keine Projektbezüge).
//
// In:  Teile (Objekt) oder ein Dateiname (String).
// Out: baueDateiname → String (oder Error mit Klartext je Feld),
//      pruefeDateiname → { gueltig, teile, fehler[], warnungen[] }.
//
// Besonderheit (Plan 71-03 must_have): die Ausgangsdateien des Bauherrn heißen
// `P5_00000-01_TX_FM_XX_V_01_--.ifc` — Freitext `--` verletzt die Konvention
// („keine Binde- und Unterstriche", Zeile 9/16 des Textextrakts). Der Prüfer
// meldet das als WARNUNG (AG-Datei), nicht als Fehler — wir dürfen die
// Lieferung des Bauherrn nicht „ungültig" nennen, aber der Hinweis gehört
// ins Protokoll.

/**
 * Vollständiger Katalog aus der Namensrichtlinie (Textextrakt Seite 2-3).
 * Jede Liste mit Klartext — die Fehlertexte nennen Feld + erlaubte Werte.
 */
export const KATALOG = Object.freeze({
  /** Planungsphasen P0-P7 (Namensrichtlinie S. 2, „Planungsphasen"). */
  phasen: Object.freeze([
    { wert: 'P0', text: 'vorbereitende Planung (Bauleitpläne, Wettbewerbspläne)' },
    { wert: 'P1', text: 'Grundlagenermittlung, LP 1' },
    { wert: 'P2', text: 'Vorplanung, LP 2' },
    { wert: 'P3', text: 'Entwurfsplanung, LP 3' },
    { wert: 'P4', text: 'Genehmigungsplanung nach Art. 73 BayBO, LP 4' },
    { wert: 'P5', text: 'Ausführungsplanung, LP 5' },
    { wert: 'P6', text: 'Montageplanung (Detailplanung etc.)' },
    { wert: 'P7', text: 'Bestandsplanung / Benutzungspläne' },
  ]),
  /** Gebäudenummern (Namensrichtlinie S. 3, „Gebäudenummer, -bezeichnung"). */
  gebaeude: Object.freeze([
    { wert: '00000-01', text: 'Gebäude 1 (Beispiel)' },
    { wert: '00000-02', text: 'Gebäude 2 (Beispiel)' },
    { wert: '00000-00', text: 'Erschließung (Beispiel)' },
    { wert: '00000-XX', text: 'Gebäudeübergreifend (Beispiel)' },
  ]),
  /** Fachsichten, 2 Buchstaben (Namensrichtlinie S. 2, vollständige Liste inkl. TGA/Elektro). */
  fachsichten: Object.freeze([
    { wert: 'AX', text: 'Architektur' },
    { wert: 'AB', text: 'Architektur bauliche Anlagen' },
    { wert: 'AF', text: 'Architektur Fassade' },
    { wert: 'AE', text: 'Architektur Einrichtung' },
    { wert: 'AK', text: 'Architektur Küchen' },
    { wert: 'AM', text: 'Architektur Möblierung' },
    { wert: 'AU', text: 'Außenanlagen' },
    { wert: 'TX', text: 'Tragwerk' },
    { wert: 'TE', text: 'Tragwerk Entwurfsplan' },
    { wert: 'TL', text: 'Tragwerk Lastenplan' },
    { wert: 'TT', text: 'Tragwerk Tabuzonenplan' },
    { wert: 'TK', text: 'Tragwerk Tragwerkskonzept' },
    { wert: 'TP', text: 'Tragwerk Positionsplanung' },
    { wert: 'TS', text: 'Tragwerk Schalplanung' },
    { wert: 'TB', text: 'Tragwerk Bewehrungsplanung' },
    { wert: 'TI', text: 'Tragwerk Stahlbau' },
    { wert: 'EX', text: 'Elektro' },
    { wert: 'ET', text: 'Elektro Trassen' },
    { wert: 'EB', text: 'Elektro Beleuchtung' },
    { wert: 'EA', text: 'Elektro Ausstattung' },
    { wert: 'ES', text: 'Elektro Blitzschutz' },
    { wert: 'FF', text: 'Brandschutz Sprinkler' },
    { wert: 'FL', text: 'Brandschutz Löschanlagen' },
    { wert: 'GG', text: 'TGA Gesamtmodell' },
    { wert: 'GH', text: 'TGA Heizung' },
    { wert: 'GK', text: 'TGA Kälte' },
    { wert: 'GS', text: 'TGA Sanitär' },
    { wert: 'GD', text: 'TGA Durchbrüche' },
    { wert: 'GL', text: 'TGA Lüftung' },
    { wert: 'IB', text: 'Ingenieurbau' },
  ]),
  /** Modellarten (Namensrichtlinie S. 2, „Modellarten"). */
  modellarten: Object.freeze([
    { wert: 'TM', text: 'Teilmodell' },
    { wert: 'FM', text: 'Fachmodell' },
    { wert: 'KM', text: 'Koordinationsmodell' },
  ]),
  /** Ebenen/Geschosse (Namensrichtlinie S. 2, „Ebenen (Stockwerke)"). */
  ebenen: Object.freeze([
    { wert: 'GR', text: 'Gründung' },
    { wert: '00', text: 'Erdgeschoss' },
    { wert: '01', text: '1. Obergeschoss' },
    { wert: '02', text: '2. Obergeschoss' },
    { wert: '03', text: '3. Obergeschoss' },
    { wert: 'U1', text: '1. Untergeschoss' },
    { wert: 'U2', text: '2. Untergeschoss' },
    { wert: 'UZ', text: 'Zwischengeschoss unter EG' },
    { wert: 'Z1', text: '1. Zwischengeschoss über EG' },
    { wert: 'DA', text: 'Dachaufsicht' },
    { wert: 'XX', text: 'Übergreifend' },
  ]),
  /** Status (Namensrichtlinie S. 1+3, „Status und Indizierung"). */
  status: Object.freeze([
    { wert: 'V', text: 'Vorabzug' },
    { wert: 'P', text: 'zur Prüfung' },
    { wert: 'F', text: 'Final' },
  ]),
  /** Endungen für Modelle (Namensrichtlinie S. 1: .ifc, native = .rvt/.smc u. a.). */
  endungen: Object.freeze(['ifc', 'rvt', 'smc']),
});

/** Feld-Wert-Mengen für schnelle Mitgliedschaftsprüfung. */
const WERTE = {
  phase: KATALOG.phasen.map((p) => p.wert),
  gebaeude: KATALOG.gebaeude.map((g) => g.wert),
  fachsicht: KATALOG.fachsichten.map((f) => f.wert),
  modellart: KATALOG.modellarten.map((m) => m.wert),
  ebene: KATALOG.ebenen.map((e) => e.wert),
  status: KATALOG.status.map((s) => s.wert),
};

/**
 * Verbotene Zeichen im Freitext (Namensrichtlinie S. 1 Zeile 9-10):
 * „Im Freitext dürfen keine Leer- und Sonderzeichen sowie Binde- und
 * Unterstriche verwendet werden! Als Sonderzeichen gelten: \ / : * ? " < > |"
 * [ASSUMED] Die Aufzählung nennt Binde-/Unterstriche explizit; weitere
 * Satzzeichen (Punkt, Komma, Klammer) zählen zu „Sonderzeichen" — erlaubt
 * bleiben nur Buchstaben und Ziffern (Bsp. „BodAufbau", S. 1 Zeile 22).
 */
const FREITEXT_ERLAUBT = /^[A-Za-z0-9]{0,10}$/;

/** Sonderzeichen-Liste der Namensrichtlinie (für Klartext-Fehlermeldungen). */
const SONDERZEICHEN = '\\/:*?"<>|';

/** Gebäudenummer: fünf Ziffern, Bindestrich, zwei Ziffern oder XX. */
const GEBAEUDE_MUSTER = /^\d{5}-(\d{2}|XX)$/;

/**
 * Prüft eine Gebäudenummer gegen das Muster (nicht gegen eine feste Liste —
 * die Nummern sind Projektdaten).
 * @param {string} wert z. B. "00000-01"
 * @returns {boolean}
 */
export function gebaeudeGueltig(wert) {
  return GEBAEUDE_MUSTER.test(String(wert || ''));
}

/**
 * @param {keyof typeof WERTE} feld
 * @param {string} wert
 * @returns {boolean} true, wenn der Wert für das Feld erlaubt ist
 */
function feldErlaubt(feld, wert) {
  return feld === 'gebaeude' ? gebaeudeGueltig(wert) : WERTE[feld].includes(wert);
}

/**
 * Klartext-Liste der erlaubten Werte eines Katalogfelds.
 * @param {'phase'|'gebaeude'|'fachsicht'|'modellart'|'ebene'|'status'} feld
 * @returns {string} z. B. "P0, P1, …"
 */
function erlaubtText(feld) {
  if (feld === 'gebaeude') return 'fünf Ziffern, Bindestrich, zwei Ziffern oder XX, z. B. 00000-01';
  return WERTE[feld].join(', ');
}

/**
 * Baut einen Dateinamen nach der Namensrichtlinie.
 *
 * @param {{phase: string, gebaeude: string, fachsicht: string, modellart: string,
 *   ebene: string, status: string, index: number|string, freitext?: string,
 *   endung?: string}} teile
 *   index: 1-99, wird zweistellig geschrieben (V_01); freitext: ≤ 10 Zeichen,
 *   nur Buchstaben/Ziffern — ohne Freitext bleibt der Name 7-teilig (das
 *   Schlussegment entfällt; Namensrichtlinie zeigt es nur im Muster mit Text).
 *   endung: Default 'ifc'.
 * @returns {string} vollständiger Dateiname MIT Endung
 * @throws {Error} Klartext je Feld mit den erlaubten Werten
 */
export function baueDateiname({
  phase, gebaeude, fachsicht, modellart, ebene, status, index,
  freitext = '', endung = 'ifc',
}) {
  // Jedes Feld einzeln prüfen — der erste Fehler nennt Feld + erlaubte Werte.
  for (const [feld, wert] of /** @type {Array<[keyof typeof WERTE, string]>} */ ([
    ['phase', phase], ['gebaeude', gebaeude], ['fachsicht', fachsicht],
    ['modellart', modellart], ['ebene', ebene], ['status', status],
  ])) {
    if (!feldErlaubt(feld, wert)) {
      throw new Error(`baueDateiname: ${feld} „${wert}" ist nicht erlaubt (${erlaubtText(feld)})`);
    }
  }
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 1 || idx > 99) {
    throw new Error(`baueDateiname: index „${index}" muss eine ganze Zahl 1-99 sein`);
  }
  if (!FREITEXT_ERLAUBT.test(String(freitext))) {
    throw new Error(
      `baueDateiname: Freitext „${freitext}" verletzt die Namenskonvention — maximal 10 Zeichen, ` +
      `keine Leer-/Sonderzeichen (${SONDERZEICHEN}) und keine Binde-/Unterstriche`,
    );
  }
  if (!KATALOG.endungen.includes(endung)) {
    throw new Error(`baueDateiname: Endung „${endung}" ist nicht erlaubt (${KATALOG.endungen.join(', ')})`);
  }

  const teile = [phase, gebaeude, fachsicht, modellart, ebene, status, String(idx).padStart(2, '0')];
  if (freitext) teile.push(freitext);
  return `${teile.join('_')}.${endung}`;
}

/**
 * Zerlegt + prüft einen Dateinamen nach der Namensrichtlinie.
 *
 * @param {string} name Dateiname mit oder ohne Pfad, MIT Endung
 * @returns {{gueltig: boolean, teile: object|null, fehler: string[], warnungen: string[]}}
 *   teile: { phase, gebaeude, fachsicht, modellart, ebene, status, index,
 *   freitext, endung } oder null (Zerlegung unmöglich).
 *   fehler: harte Verstöße (Segment fehlt/unbekannt, Freitext zu LANG).
 *   warnungen: Regelverstöße des BAUHERRN an eigenen Dateien — z. B. Freitext
 *   `--` (Bindestriche laut Namenskonvention verboten), Endung außerhalb des
 *   Katalogs. Die Ausgangsdateien TX_FM_…_01_--.ifc sollen als „geliefert,
 *   mit Hinweis" erkennbar bleiben, nicht als ungültig.
 */
export function pruefeDateiname(name) {
  const fehler = [];
  const warnungen = [];
  const basis = String(name || '').split(/[\\/]/).pop() || '';

  const punkt = basis.lastIndexOf('.');
  const endung = punkt > 0 ? basis.slice(punkt + 1).toLowerCase() : '';
  const stamm = punkt > 0 ? basis.slice(0, punkt) : basis;
  if (!endung) fehler.push('Dateiendung fehlt (erlaubt: ' + KATALOG.endungen.join(', ') + ')');
  else if (!KATALOG.endungen.includes(endung)) {
    warnungen.push(`Endung „.${endung}" steht nicht im Richtlinien-Katalog (${KATALOG.endungen.join(', ')})`);
  }

  const seg = stamm.split('_');
  // Ohne Freitext 7 Segmente, mit Freitext 8 (Namensrichtlinie Muster).
  if (seg.length < 7 || seg.length > 8) {
    fehler.push(
      `${seg.length} Segmente — die Namenskonvention verlangt 7 oder 8 ` +
      `(Phase_Gebäude_Fachsicht_Modellart_Geschoss_Status_Index[_Freitext]), gefunden: „${stamm}"`,
    );
    return { gueltig: false, teile: null, fehler, warnungen };
  }

  const [phase, gebaeude, fachsicht, modellart, ebene, status, indexRoh, freitext = ''] = seg;
  const teile = { phase, gebaeude, fachsicht, modellart, ebene, status, index: indexRoh, freitext, endung };

  for (const [feld, wert] of /** @type {Array<[keyof typeof WERTE, string]>} */ ([
    ['phase', phase], ['gebaeude', gebaeude], ['fachsicht', fachsicht],
    ['modellart', modellart], ['ebene', ebene], ['status', status],
  ])) {
    if (!feldErlaubt(feld, wert)) {
      fehler.push(`${feld} „${wert}" ist nicht erlaubt (${erlaubtText(feld)})`);
    }
  }
  if (!/^\d{2}$/.test(indexRoh) || Number(indexRoh) < 1) {
    fehler.push(`Index „${indexRoh}" muss zweistellig numerisch sein (01-99)`);
  }

  // Freitext-Prüfung: der `--`-Fall der AG-Ausgangsdateien ist eine WARNUNG
  // (fremde Datei), ein ZU LANGER Freitext ein Fehler (eigene Benennung).
  if (freitext) {
    if (freitext.length > 10) {
      fehler.push(`Freitext „${freitext}" ist ${freitext.length} Zeichen lang — maximal 10 (Namenskonvention)`);
    }
    if (/[-_]/.test(freitext)) {
      warnungen.push(
        `Freitext „${freitext}": Binde-/Unterstriche sind laut Namenskonvention verboten ` +
        `(„Im Freitext dürfen keine Leer- und Sonderzeichen sowie Binde- und Unterstriche verwendet werden")`,
      );
    } else if (/[^A-Za-z0-9]/.test(freitext)) {
      warnungen.push(`Freitext „${freitext}" enthält Sonder-/Leerzeichen — laut Namenskonvention verboten (${SONDERZEICHEN})`);
    }
  }

  return { gueltig: fehler.length === 0, teile, fehler, warnungen };
}

/**
 * Nächster freier Index (1-99) für eine Teile-Kombination aus einer Liste
 * bestehender Namen — gleiche Phase/Gebäude/Fachsicht/Modellart/Ebene/Status.
 *
 * @param {string[]} namen bestehende Dateinamen (gleiche Kombination)
 * @param {{phase: string, gebaeude: string, fachsicht: string, modellart: string,
 *   ebene: string, status: string}} teile Ziel-Kombination
 * @returns {number} 1, wenn nichts passt; sonst max(Index)+1 (Obergrenze 99)
 */
export function naechsterIndex(namen, teile) {
  let max = 0;
  for (const n of namen || []) {
    const p = pruefeDateiname(n);
    if (!p.teile) continue;
    const t = p.teile;
    const gleich =
      t.phase === teile.phase && t.gebaeude === teile.gebaeude &&
      t.fachsicht === teile.fachsicht && t.modellart === teile.modellart &&
      t.ebene === teile.ebene && t.status === teile.status;
    if (!gleich) continue;
    const idx = Number(t.index);
    if (Number.isInteger(idx) && idx > max) max = idx;
  }
  return Math.min(max + 1, 99);
}
