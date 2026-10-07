// kbWorkbook — die Kostenberechnungs-XLSX, 1:1 nach der Vorlage des Büros.
// Phase 33 / W5 (Plan 33-03, ENGINE-06).
//
// Das Layout ist NICHT frei gestaltet. Es ist die Excel, die im Büro benutzt
// wird (`parity/oracle/kb_excel.py`), Spalte für Spalte, Formel für Formel:
//
//   A–F  Identifikation  (Gewerk-Nr, Gewerk, OZ, Kurztext, KG 2018, KG 2008)
//   G    ME
//   H–J  KOSTENANSCHLAG 17.12.2020 — grau `D9D9D9`, LITERAL, EINGEFROREN.
//        Keine Formel schreibt in diesen Block (T-33-18).
//   K–M  KOSTENSTAND HEUTE (M = K*L; K grün `E2EFDA` bei Modellbindung)
//   N–P  ANALYSE (Δ Menge · Δ EP vs. Index = AMPEL · Δ GB ges., informativ)
//   Q–S  Provenance (Mengen-Quelle, Bauteile (IFC), Hinweis)
//
// Die Ampel liegt auf Spalte O — der MENGENNEUTRALEN Preisabweichung. Auf P
// (Δ GB gesamt) läge sie falsch: dort mischen sich Mengen- und Preiseffekt, und
// eine rote Zelle hieße dann „irgendwas ist anders", nicht „der Preis weicht ab".
//
// Zwei DefinedNames machen die Datei rechnend: `Preisindex` (E3) und
// `PreisindexUmsetzung` (E4) im Blatt Zusammenfassung, gelb = nutzeränderbar.
// Wer dort ein Datum… genauer: einen Faktor ändert, sieht 498 Zeilen nachrechnen.
// Das ist der Grund, warum die EPs als FORMEL und nicht als Wert dort stehen.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

import { blattRef, blattname, createWorkbook, spalte, writeWorkbook } from './novaXlsx.js';

// --- Stile ---------------------------------------------------------------
const KOPF = { bold: true, fill: '1F4E79', fontColor: 'FFFFFF' };
const FIX = { fill: 'D9D9D9' };                       // 2020-Block: grau = eingefroren
const FIX_ZAHL = { fill: 'D9D9D9', numFmt: '#,##0.00' };
const IFC = { fill: 'E2EFDA' };                       // Modellbindung: grün
const ZAHL = { numFmt: '#,##0.00' };
const PROZ = { numFmt: '+0%;-0%' };
const TITEL = { bold: true, fontSize: 13 };
const NOTIZ = { italic: true, fontSize: 9 };
const FETT = { bold: true };
const FETT_ZAHL = { bold: true, numFmt: '#,##0.00' };
const GELB = { bold: true, fill: 'FFEB9C', numFmt: '0.00' };

// Die drei Ampelfarben — Reihenfolge IST die Auswertungsreihenfolge.
export const AMPEL_STUFEN = Object.freeze([
  { op: '>', grenze: 0.2, fill: 'FFC7CE' },   // rot
  { op: '>', grenze: 0.1, fill: 'FFEB9C' },   // gelb
  { op: '<=', grenze: 0.1, fill: 'C6EFCE' },  // grün
]);

export const HEAD = Object.freeze([
  'Gewerk-Nr', 'Gewerk', 'OZ', 'Kurztext', 'KG 2018', 'KG 2008', 'ME',
  'Menge 2020', 'EP 2020 [€]', 'GB 2020 [€] (fix)',
  'Menge heute', 'EP heute [€]', 'GB heute [€]',
  'Δ Menge', 'Δ EP vs. Index', 'Δ GB ges.',
  'Mengen-Quelle', 'Bauteile (IFC)', 'Hinweis',
]);
const BREITEN = [9, 24, 11, 46, 9, 9, 7, 11, 11, 13, 11, 12, 13, 9, 10, 9, 16, 10, 38];
const NUMFMT_SPALTEN = new Set([8, 9, 10, 11, 12, 13]);
const PROZ_SPALTEN = new Set([14, 15, 16]);

export const KOPFZEILE = 4;
export const ERSTE_ZEILE = 5;

/** Die 5 Formeln — WÖRTLICH wie in der Vorlage. Als Funktionen, damit die
 *  Zeilennummer eingesetzt wird, nicht damit der Text „ungefähr stimmt". */
export const FORMELN = Object.freeze({
  epHeute: (r) => `=ROUND(I${r}*Preisindex,2)`,
  gbHeute: (r) => `=K${r}*L${r}`,
  deltaEp: (r) => `=IF(OR(L${r}="",N(I${r})=0),"",L${r}/(I${r}*Preisindex)-1)`,
  deltaGb: (r) => `=IF(OR(M${r}=0,N(J${r})=0),"",M${r}/(J${r}*Preisindex)-1)`,
  prognose: (r) => `=E${r}*(PreisindexUmsetzung/Preisindex-1)`,
});

/** Die 3-Regel-Ampel auf eine Spalte legen. `stopIfTrue` steckt im Writer. */
export function ampel(ws, col, r1, r2) {
  if (r2 < r1) return;
  const range = `${col}${r1}:${col}${r2}`;
  for (const s of AMPEL_STUFEN) {
    ws.cfRegel(range, `AND(ISNUMBER(${col}${r1}),ABS(${col}${r1})${s.op}${s.grenze})`, { fill: s.fill });
  }
}

const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Positionen aus den Rohquellen zusammenstellen — dieselbe Kaskade wie das
 * Orakel, aber ohne einen einzigen Preis im Quelltext: Marktpreise und
 * Referenzpreise kommen als DATEN herein.
 *
 * Rückgabe enthält auch die SYNTHETISCHEN Auftragszeilen (eine je komplett
 * beauftragtem Gewerk). Sie sind der sichtbare Beweis der Σ-Invarianz: die
 * Positionen des Gewerks tragen GB 0, diese Zeile trägt den Vertragswert.
 */
export function bereiteZeilen({
  positionen = [],
  kg = {},
  ka2020 = {},
  marktpreise = [],
  referenzpreise = {},
  vertragsstand = {},
  // Label of the reference price source in the notes column. Neutral by
  // default; a real project's label is passed in by the caller (the parity
  // gate takes it from the NDA archive), never written into this module.
  referenzLv = 'Referenz-LV',
  referenzKurz = 'Referenz',
} = {}) {
  const mp = new Map((marktpreise || []).map((m) => [`${m.gewerk_nr}|${m.oz}`, m]));
  const zeilen = (positionen || []).map((d) => {
    const k = `${d.gewerk_nr}|${d.oz}`;
    const z = kg[k] || {};
    const kaz = ka2020[k] || {};
    const v = vertragsstand[d.gewerk_nr];
    const beauftragt = v?.status === 'gewerk_komplett_beauftragt';
    let hinweis = d.hinweis || null;
    if (beauftragt) {
      let notiz = `BEAUFTRAGT: Leistung im Vertrag ${v.firma} (${v.paket}) enthalten — Kosten in Auftragszeile`;
      if (v.deckung_pruefen?.[d.oz]) notiz += ` · DECKUNG PRÜFEN: ${v.deckung_pruefen[d.oz]}`;
      hinweis = hinweis ? `${notiz} · ${hinweis}` : notiz;
    }
    const m = mp.get(k);
    const rp = referenzpreise[k];
    // Welcher EP steht heute in Spalte L? Reihenfolge = fachliche Priorität.
    // `formel` heißt: Excel rechnet ihn (Indexfortschreibung); `wert` heißt:
    // belegter Preis. `null` heißt: es gibt keinen — und dann bleibt die Zelle
    // LEER, nicht 0.
    let epHeute = { typ: 'keiner', wert: null, art: null };
    if (beauftragt) {
      epHeute = { typ: 'keiner', wert: null, art: 'vertragssperre' };
    } else if (m && m.ep != null) {
      epHeute = { typ: 'wert', wert: m.ep, art: 'markt' };
      const beleg = m.herkunft?.beleg;
      if (beleg && !(hinweis || '').includes(beleg)) hinweis = hinweis ? `${beleg} · ${hinweis}` : beleg;
    } else if (rp && rp.ep != null && !rp.review) {
      epHeute = { typ: 'wert', wert: rp.ep, art: 'referenzprojekt' };
      const notiz = `EP: ${referenzLv}, fortgeschrieben ≤05/2025 (statt Index)`;
      if (!(hinweis || '').includes(notiz)) hinweis = hinweis ? `${notiz} · ${hinweis}` : notiz;
    } else if (kaz.ep != null) {
      epHeute = { typ: 'formel', wert: null, art: 'index' };
      if (rp?.review) {
        const notiz = `REVIEW: ${referenzKurz}-EP ${rp.ep} € nicht übernommen (${rp.grund || 'Sichtung'})`;
        if (!(hinweis || '').includes(notiz)) hinweis = hinweis ? `${notiz} · ${hinweis}` : notiz;
      }
    }
    const mengeBasis = zahl(kaz.menge) ?? zahl(d.menge_2019);
    const modellbasiert = String(d.quelle || '').startsWith('IFC');
    const deltaMenge =
      modellbasiert && zahl(d.menge_final) && mengeBasis ? d.menge_final / mengeBasis - 1 : null;
    return {
      gewerk_nr: d.gewerk_nr,
      gewerk: d.gewerk,
      oz: d.oz,
      kurztext: d.kurztext,
      kg2018: z.kg2018 ?? '?',
      kg2018_name: z.kg2018_name ?? '',
      kg2008: z.kg2008 ?? '?',
      kg2008_name: z.kg2008_name ?? '',
      einheit: d.einheit,
      menge_2020: zahl(kaz.menge) ?? zahl(d.menge_2019),
      ep_2020: zahl(kaz.ep),
      gb_2020: zahl(kaz.gb),
      menge_final: zahl(d.menge_final),
      ep_heute: epHeute,
      delta_menge: deltaMenge,
      quelle: d.quelle || '',
      modellbasiert,
      guids: d.guids || [],
      variable: d.variable ?? null,
      faktor: d.faktor ?? null,
      hinweis,
      beauftragt,
      // Nur die synthetischen Vertragszeilen tragen `true` — daran erkennt die
      // Zusammenfassung, dass der Betrag aus dem Vertrag und nicht aus einer
      // Position stammt.
      auftragszeile: false,
    };
  });

  // Synthetische Auftragszeile je komplett beauftragtem Gewerk.
  for (const [gnr, v] of Object.entries(vertragsstand || {})) {
    if (v?.status !== 'gewerk_komplett_beauftragt') continue;
    const name = zeilen.find((z) => z.gewerk_nr === gnr)?.gewerk ?? gnr;
    zeilen.push({
      gewerk_nr: gnr,
      gewerk: name,
      oz: '99999999',
      kurztext: `AUFTRAG: ${v.firma} — ${v.paket} (netto, inkl. Nachträge)`,
      kg2018: '394', kg2018_name: 'Abbruchmaßnahmen',
      kg2008: '394', kg2008_name: 'Abbruchmaßnahmen',
      einheit: 'psch',
      menge_2020: null, ep_2020: null, gb_2020: null,
      menge_final: 1,
      ep_heute: { typ: 'wert', wert: v.summe_netto, art: 'vertrag' },
      delta_menge: null,
      quelle: 'Vertrag (Auftrag + NA)',
      modellbasiert: false,
      guids: [],
      variable: null, faktor: null,
      hinweis: `${v.beleg} · ${v.abgleich}`,
      beauftragt: false,
      auftragszeile: true,
    });
  }
  return zeilen;
}

/** Eine der drei Haupttabellen schreiben. Rückgabe: letzte Datenzeile. */
function schreibeTabelle(ws, zeilen, { stand, ifcStand, projekt }) {
  ws.setze(1, 1, `${projekt} · Kostenberechnung (modellbasiert)`, TITEL);
  ws.setze(
    2, 1,
    `Stand ${stand} · Mengen heute: ${ifcStand} · Block 2020 = LV-Kostenanschlag 17.12.2020, FIX (grau) · ` +
      "EP heute = EP 2020 × Preisindex (Zelle 'Preisindex' in Zusammenfassung) — überschlägig, wird durch " +
      'STLB-/NOVA-Preise ersetzt · Ampel = Δ EP vs. Index (reine Preisabweichung, mengenneutral)',
    NOTIZ,
  );
  // Blockkopf (Zeile 3): die drei Spaltenblöcke sichtbar trennen.
  ws.merge('H3:J3'); ws.setze(3, 8, 'KOSTENANSCHLAG 17.12.2020 (FIX)', { bold: true, fill: 'D9D9D9' });
  ws.merge('K3:M3'); ws.setze(3, 11, 'KOSTENSTAND HEUTE', { bold: true, fill: 'E2EFDA' });
  ws.merge('N3:P3'); ws.setze(3, 14, 'ANALYSE', FETT);

  HEAD.forEach((h, i) => {
    ws.setze(KOPFZEILE, i + 1, h, KOPF);
    ws.breite(i + 1, BREITEN[i]);
  });

  let r = ERSTE_ZEILE;
  for (const d of zeilen) {
    const werte = [
      d.gewerk_nr, d.gewerk, d.oz, d.kurztext, d.kg2018, d.kg2008, d.einheit,
      d.menge_2020, d.ep_2020, d.gb_2020,                       // H–J: 2020 FIX (literal)
      d.menge_final,
      d.ep_heute.typ === 'formel' ? FORMELN.epHeute(r) : d.ep_heute.wert,
      FORMELN.gbHeute(r),                                       // M = K*L
      d.delta_menge,
      FORMELN.deltaEp(r),                                       // O = AMPEL
      FORMELN.deltaGb(r),                                       // P = informativ
      d.quelle, d.guids.length || null, d.hinweis,
    ];
    werte.forEach((v, i) => {
      const c = i + 1;
      let stil = null;
      if (c >= 8 && c <= 10) stil = NUMFMT_SPALTEN.has(c) ? FIX_ZAHL : FIX;
      else if (NUMFMT_SPALTEN.has(c)) stil = ZAHL;
      else if (PROZ_SPALTEN.has(c)) stil = PROZ;
      if (d.modellbasiert && (c === 11 || c === 17)) {
        stil = c === 11 ? { ...IFC, numFmt: '#,##0.00' } : IFC;
      }
      ws.setze(r, c, v, stil);
    });
    r += 1;
  }
  ws.freeze(`E${ERSTE_ZEILE}`);
  ws.autoFilter(`A${KOPFZEILE}:${spalte(HEAD.length)}${r - 1}`);
  ampel(ws, 'O', ERSTE_ZEILE, r - 1);
  return r - 1;
}

/** Die 12 Spalten der verlinkten Gewerkblätter: Quellspalte → Beschriftung. */
/** @type {ReadonlyArray<[string, string, number]>} */
const GSP = Object.freeze([
  ['C', 'OZ', 11], ['D', 'Kurztext', 50], ['E', 'KG 2018', 9], ['G', 'ME', 7],
  ['H', 'Menge 2020', 11], ['J', 'GB 2020 [€] (fix)', 14],
  ['K', 'Menge heute', 11], ['L', 'EP heute [€]', 12], ['M', 'GB heute [€]', 13],
  ['O', 'Δ EP vs. Index', 10], ['Q', 'Mengen-Quelle', 16], ['S', 'Hinweis', 40],
]);

/** Blattname eines Gewerkblatts — die Hygiene steckt in `novaXlsx.blattname`. */
export function gewerkBlattname(nr, gewerk) {
  return blattname(`${nr} ${String(gewerk ?? '').replace(/[\\/?*[\]:']/g, '').slice(0, 26)}`.trim());
}

/**
 * Die vollständige Kostenberechnungs-Arbeitsmappe.
 *
 * @param {object|Array} quellen Entweder das Bündel aus benannten Quellen oder
 *   (Kurzform) direkt das `kb_daten`-Array — dann fehlen KG, 2020-Preise und
 *   das Blatt „Beauftragt vorgezogen", weil die Quellen dafür fehlen. Die
 *   Kurzform ist für schnelle Proben, nicht für die Auslieferung.
 * @returns {Uint8Array} XLSX
 */
export function buildKbWorkbook(quellen) {
  const q = Array.isArray(quellen) ? { positionen: quellen } : (quellen || {});
  const stand = q.stand || new Date().toISOString().slice(0, 10);
  const ifcStand = q.ifcStand || 'IFC-Stand nicht angegeben';
  const projekt = q.projekt || 'Kostenberechnung';
  const preisindex = q.preisindex ?? null;
  const preisindexUmsetzung = q.preisindexUmsetzung ?? null;
  const zeilen = q.zeilen || bereiteZeilen(q);

  const wb = createWorkbook();

  // --- 1–3: die drei Haupttabellen -----------------------------------
  const nachGewerk = [...zeilen].sort((a, b) =>
    a.gewerk_nr === b.gewerk_nr ? String(a.oz).localeCompare(String(b.oz)) : String(a.gewerk_nr).localeCompare(String(b.gewerk_nr)));
  const ws1 = wb.addSheet('KB nach Gewerk');
  schreibeTabelle(ws1, nachGewerk, { stand, ifcStand, projekt });
  const REF = `${blattRef('KB nach Gewerk')}!`;

  const ws2 = wb.addSheet('KB nach DIN 276-2018');
  schreibeTabelle(
    ws2,
    [...zeilen].sort((a, b) => `${a.kg2018}${a.gewerk_nr}${a.oz}`.localeCompare(`${b.kg2018}${b.gewerk_nr}${b.oz}`)),
    { stand, ifcStand, projekt },
  );
  const ws3 = wb.addSheet('KB nach DIN 276-2008');
  schreibeTabelle(
    ws3,
    [...zeilen].sort((a, b) => `${a.kg2008}${a.gewerk_nr}${a.oz}`.localeCompare(`${b.kg2008}${b.gewerk_nr}${b.oz}`)),
    { stand, ifcStand, projekt },
  );

  // Blockgrenzen je Gewerk in Blatt 1 — Grundlage der verlinkten Gewerkblätter.
  const bloecke = new Map();
  nachGewerk.forEach((d, i) => {
    const r = ERSTE_ZEILE + i;
    if (!bloecke.has(d.gewerk_nr)) bloecke.set(d.gewerk_nr, { von: r, bis: r, name: d.gewerk });
    bloecke.get(d.gewerk_nr).bis = r;
  });

  // --- 4: Beauftragt vorgezogen --------------------------------------
  const bea = q.beauftragt || null;
  const wsb = wb.addSheet('Beauftragt vorgezogen');
  wsb.setze(1, 1, 'Bereits beauftragte Leistungen — vorgezogene Maßnahmen (Pakete 001–010)', TITEL);
  wsb.setze(2, 1, bea
    ? `Stand ${bea.stand} · Beträge netto · HLS-/ELT-Pakete nicht enthalten (s. unten)`
    : 'Keine Vergabedaten übergeben — dieses Blatt bleibt leer, statt eine Summe zu erfinden.', NOTIZ);
  const BH = ['Paket', 'Bezeichnung', 'Firma', 'Auftrags-Nr', 'Hauptauftrag netto [€]',
    'Nachträge netto [€]', 'Summe netto [€]', 'Summe brutto [€]', 'Quelle', 'Hinweis'];
  BH.forEach((h, i) => { wsb.setze(4, i + 1, h, KOPF); wsb.breite(i + 1, [7, 38, 30, 11, 19, 17, 15, 15, 42, 55][i]); });
  let rb = 5;
  if (bea) {
    for (const p of bea.pakete || []) {
      const na = (p.nachtraege || []).reduce((a, n) => a + n.netto, 0);
      const naTxt = (p.nachtraege || []).map((n) => `NA${n.na}: ${n.netto.toFixed(2)}`).join('; ') || null;
      const netto = p.hauptauftrag_netto + na;
      const werte = [p.nr, p.bezeichnung, p.firma, p.ba_nr, p.hauptauftrag_netto,
        na && p.nachtraege?.length ? na : null, netto, Math.round(netto * 1.19 * 100) / 100,
        p.quelle, `${p.hinweis || ''}${naTxt ? ` [${naTxt}]` : ''}` || null];
      werte.forEach((v, i) => wsb.setze(rb, i + 1, v, [5, 6, 7, 8].includes(i + 1) ? ZAHL : null));
      rb += 1;
    }
    wsb.setze(rb, 2, 'Summe beauftragt (Architektur) netto / brutto', FETT);
    wsb.setze(rb, 7, `=SUM(G5:G${rb - 1})`, FETT_ZAHL);
    wsb.setze(rb, 8, `=SUM(H5:H${rb - 1})`, FETT_ZAHL);
    rb += 4;
    wsb.setze(rb, 1, 'Nicht enthalten (Vergabe/Kosten über HLS- bzw. ELT-Planer):', FETT);
    rb += 1;
    for (const p of bea.ausgeschlossen_hls_elt || []) {
      wsb.setze(rb, 1, p.nr); wsb.setze(rb, 2, p.bezeichnung);
      wsb.setze(rb, 3, p.firma); wsb.setze(rb, 4, p.planer);
      rb += 1;
    }
  }

  // --- 5: Zusammenfassung (die rechnende Mitte) ----------------------
  const zs = wb.addSheet('Zusammenfassung');
  zs.setze(1, 1, `Zusammenfassung ${projekt}`, TITEL);
  zs.setze(2, 1,
    `Stand ${stand} — 'GB 2020' = Kostenanschlag 17.12.2020 (fix) · 'GB heute' = aktuelle Mengen × EP heute ` +
    '(EPs überschlägig indexiert; Marktpreise mit Beleg) · Δ ges. enthält Mengen- UND Preiseffekt', NOTIZ);
  zs.setze(3, 1,
    'Preisindex 12/2020→Mitte 2026 (destatis-Baupreisindex gewerbl. Betriebsgebäude, 2021=100 — ' +
    '[ASSUMED], nicht gegen destatis geprüft; anpassbar):', FETT);
  zs.setze(3, 5, preisindex, GELB);
  zs.setze(4, 1,
    'Faktor für Umsetzung 2027/28 (PROGNOSE: destatis-Trend +5 % p. a. ab Mitte 2026 fortgeschrieben; ' +
    'ggü. Preisstand 12/2020; anpassbar):', FETT);
  zs.setze(4, 5, preisindexUmsetzung, GELB);
  // Die zwei DefinedNames — hier hängt die ganze Rechenfähigkeit der Datei dran.
  wb.definedName('Preisindex', 'Zusammenfassung!$E$3');
  wb.definedName('PreisindexUmsetzung', 'Zusammenfassung!$E$4');

  let r = 5;
  zs.setze(r, 1, 'Nach Gewerk / Bauleistung', FETT); r += 1;
  ['Gewerk-Nr', 'Gewerk', 'Positionen', 'GB 2020 [€] (fix)', 'GB heute [€]', 'Δ ges. (Menge+Preis)', 'Blatt']
    .forEach((h, i) => zs.setze(r, i + 1, h, KOPF));
  r += 1;
  const gStart = r;
  const gewerke = [...new Set(zeilen.map((d) => `${d.gewerk_nr} ${d.gewerk}`))].sort();
  for (const g of gewerke) {
    const [nr, name] = g.split(' ');
    zs.setze(r, 1, nr); zs.setze(r, 2, name);
    zs.setze(r, 3, `=COUNTIF(${REF}A:A,A${r})`);
    zs.setze(r, 4, `=SUMIF(${REF}A:A,A${r},${REF}J:J)`, FIX_ZAHL);
    zs.setze(r, 5, `=SUMIF(${REF}A:A,A${r},${REF}M:M)`, ZAHL);
    zs.setze(r, 6, `=IF(OR(D${r}=0,E${r}=0),"",E${r}/(D${r}*Preisindex)-1)`, PROZ);
    zs.setze(r, 7, `=HYPERLINK("#${blattRef(gewerkBlattname(nr, name))}!A1","öffnen")`);
    r += 1;
  }
  ampel(zs, 'F', gStart, r - 1);
  zs.setze(r, 2, 'Summe netto', FETT);
  zs.setze(r, 4, `=SUM(D${gStart}:D${r - 1})`, { bold: true, fill: 'D9D9D9', numFmt: '#,##0.00' });
  zs.setze(r, 5, `=SUM(E${gStart}:E${r - 1})`, FETT_ZAHL);
  zs.setze(r, 6, `=IF(OR(D${r}=0,E${r}=0),"",E${r}/(D${r}*Preisindex)-1)`, PROZ);
  ampel(zs, 'F', r, r);
  const summenZeile = r;
  r += 1;
  zs.setze(r, 2,
    '+ Preissteigerung bis Umsetzung 2027/28 (Faktor in Zelle E4 — DIN-276-konform SEPARAT ausgewiesen, ' +
    'nie in den Kostenstand eingerechnet)', { italic: true });
  zs.setze(r, 5, FORMELN.prognose(summenZeile), ZAHL);
  r += 1;
  zs.setze(r, 2, 'Prognose Kostenstand Umsetzung 2027/28 netto', FETT);
  zs.setze(r, 5, `=E${summenZeile}*PreisindexUmsetzung/Preisindex`, { bold: true, fill: 'FFEB9C', numFmt: '#,##0.00' });

  for (const [kgSpalte, kgKey, titel] of [[5, 'kg2018', 'Nach DIN 276:2018'], [6, 'kg2008', 'Nach DIN 276:2008']]) {
    r += 3;
    zs.setze(r, 1, titel, FETT); r += 1;
    ['KG', 'Bezeichnung', 'Positionen', 'GB 2020 [€] (fix)', 'GB heute [€]']
      .forEach((h, i) => zs.setze(r, i + 1, h, KOPF));
    r += 1;
    const brief = spalte(kgSpalte);
    const start = r;
    const kgs = [...new Set(zeilen.map((d) => `${d[kgKey]} ${d[`${kgKey}_name`]}`))].sort();
    for (const g of kgs) {
      const [nr, name] = g.split(' ');
      zs.setze(r, 1, nr); zs.setze(r, 2, name);
      zs.setze(r, 3, `=COUNTIF(${REF}${brief}:${brief},A${r})`);
      zs.setze(r, 4, `=SUMIF(${REF}${brief}:${brief},A${r},${REF}J:J)`, FIX_ZAHL);
      zs.setze(r, 5, `=SUMIF(${REF}${brief}:${brief},A${r},${REF}M:M)`, ZAHL);
      r += 1;
    }
    zs.setze(r, 2, 'Summe netto', FETT);
    zs.setze(r, 4, `=SUM(D${start}:D${r - 1})`, { bold: true, fill: 'D9D9D9', numFmt: '#,##0.00' });
    zs.setze(r, 5, `=SUM(E${start}:E${r - 1})`, FETT_ZAHL);
  }
  [10, 42, 11, 17, 16, 13, 9].forEach((w, i) => zs.breite(i + 1, w));

  // --- 6–20: je Gewerk ein verlinktes Blatt --------------------------
  // Rein formelverlinkt: die EPs werden in Blatt 1 gepflegt, hier nie doppelt
  // gehalten. Zwei Wahrheiten für denselben Preis wären der Anfang vom Ende.
  for (const [nr, blk] of [...bloecke.entries()].sort()) {
    const wsg = wb.addSheet(gewerkBlattname(nr, blk.name));
    wsg.setze(1, 1, `Gewerk ${nr} — ${blk.name}`, TITEL);
    wsg.setze(2, 1, "Werte verlinkt aus 'KB nach Gewerk' — EPs dort pflegen · GB 2020 = fix (grau)", NOTIZ);
    GSP.forEach(([, h, w], i) => { wsg.setze(4, i + 1, h, KOPF); wsg.breite(i + 1, w); });
    let rg = 5;
    for (let src = blk.von; src <= blk.bis; src += 1) {
      GSP.forEach(([col, h], i) => {
        let stil = null;
        if (/^(Menge|EP|GB)/.test(h)) stil = ZAHL;
        if (h.startsWith('Δ')) stil = PROZ;
        if (h.includes('2020')) stil = /^(Menge|EP|GB)/.test(h) ? FIX_ZAHL : FIX;
        wsg.setze(rg, i + 1, `=${REF}${col}${src}`, stil);
      });
      rg += 1;
    }
    // Spalte J des Gewerkblatts ist die 10. Spalte = Δ EP vs. Index.
    ampel(wsg, 'J', 5, rg - 1);
    wsg.setze(rg, 2, 'Gesamtsumme Gewerk netto', FETT);
    wsg.setze(rg, 6, `=SUM(F5:F${rg - 1})`, { bold: true, fill: 'D9D9D9', numFmt: '#,##0.00' });
    wsg.setze(rg, 9, `=SUM(I5:I${rg - 1})`, FETT_ZAHL);
    wsg.setze(rg, 10, `=IF(OR(I${rg}=0,F${rg}=0),"",I${rg}/(F${rg}*Preisindex)-1)`, PROZ);
    ampel(wsg, 'J', rg, rg);
    wsg.freeze('A5');
  }

  // --- 21: IFC-Verknüpfung — EINE Zeile je GUID ----------------------
  // Gelesen wird ausschließlich `guids` (die Nachweis-GUIDs), NIE ein anderes
  // Feld: landete die Liste im falschen Feld, kippten die 15 Filterpositionen
  // still auf „auswahl", die Menge fror ein — und dieses Blatt hätte die falsche
  // Zeilenzahl (T-33-05). Deshalb ist die Zeilenzahl selbst ein Gate.
  const wg = wb.addSheet('IFC-Verknüpfung');
  ['Gewerk-Nr', 'OZ', 'Kurztext', 'Variable', 'Faktor', 'IFC-GUID']
    .forEach((h, i) => { wg.setze(1, i + 1, h, KOPF); wg.breite(i + 1, [9, 11, 46, 14, 7, 26][i]); });
  let rg = 2;
  for (const d of zeilen) {
    for (const g of d.guids) {
      wg.zeile(rg, [d.gewerk_nr, d.oz, d.kurztext, d.variable, d.faktor, g]);
      rg += 1;
    }
  }
  wg.freeze('A2');
  wg.autoFilter(`A1:F${rg - 1}`);

  return writeWorkbook(wb);
}

/** Der Deckungsreport als eigene Arbeitsmappe (derselbe Writer). */
export function buildDeckungWorkbook(report) {
  const wb = createWorkbook();
  const ws = wb.addSheet('Offene Bauteile');
  ws.setze(1, 1, 'Bauteile ohne LV-Position — Deckungsreport', TITEL);
  ws.setze(2, 1,
    `Deckungsdefinition: ${report?.definition || 'nicht angegeben'} · ` +
    'Die Zahl ist ein Deckungsgrad, KEINE fachliche Vollständigkeitsaussage.', NOTIZ);
  const kopf = ['Zustand', 'IFC-Klasse (deutsch)', 'Bauteiltyp', 'Geschoss(e)', 'Anzahl',
    'gedeckt', 'Deckung', 'Fläche [m²]', 'Volumen [m³]', 'Länge [m]',
    'Zielgewerk', 'Einschätzung', 'Beispiel-GlobalId'];
  kopf.forEach((h, i) => { ws.setze(4, i + 1, h, KOPF); ws.breite(i + 1, [12, 22, 42, 18, 9, 9, 10, 12, 12, 12, 26, 34, 26][i]); });
  let r = 5;
  for (const g of report?.gruppen || []) {
    ws.zeile(r, [
      g.status, g.klasse_de, g.typ, g.geschosse, g.anzahl, g.gedeckt,
      g.anzahl ? g.gedeckt / g.anzahl : null,
      g.flaeche, g.volumen, g.laenge, g.zielgewerk, g.einschaetzung, g.beispiel_guid,
    ], (c) => (c === 7 ? PROZ : ([5, 6, 8, 9, 10].includes(c) ? ZAHL : null)));
    r += 1;
  }
  ws.freeze('A5');
  ws.autoFilter(`A4:${spalte(kopf.length)}${Math.max(r - 1, 4)}`);
  return writeWorkbook(wb);
}
