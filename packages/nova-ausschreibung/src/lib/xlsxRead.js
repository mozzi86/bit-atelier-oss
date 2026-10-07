// XLSX-Leser — isomorph, über `fflate.unzipSync`, ohne Fremdbibliothek.
// Phase 33 / W4-W5 (Plan 33-03).
//
// Zwei Aufgaben:
//  1. KA-2020-Import: die 15 LV-Kostenanschläge (Excel) einlesen. Das Orakel
//     (`oracle/parse_ka2020.py`) hatte die Adressen HART im Code: Summe in `H7`,
//     Daten ab Zeile 12, Spalten B/G/H. Damit funktioniert genau eine Vorlage.
//     Hier ist es ein PROFIL — Summenzelle, Startzeile, Spalten und OZ-Muster
//     sind Daten. Ein Büro mit anderer Vorlage ändert ein Profil, keinen Code.
//  2. Struktur-Rücklesen der eigenen Ausgabe (`novaXlsx`/`kbWorkbook`) für die
//     Gates: Blätter, Zellen, Formeln, definedNames, cfRules, dxf-Füllungen.
//
// „Gecachte Werte" (≙ dem `data_only`-Modus der Python-Leser): Excel legt zu jeder Formel den
// letzten berechneten Wert in `<v>` ab. Wir rechnen KEINE Formeln nach — wir
// lesen den gecachten Wert und sagen, dass es einer ist. Alles andere wäre eine
// halbe Excel-Implementierung mit ungewissem Ergebnis.
//
// Zip-Bomb-Schutz (ASVS V5, T-33-17): Größenlimit auf die entpackte Summe. Ohne
// das kann eine 40-kB-Datei den Browser-Tab mit Gigabytes fluten.

import { unzipSync } from 'fflate';

/** Standard-Obergrenze der ENTPACKTEN Gesamtgröße (Zip-Bomb-Schutz). */
export const MAX_ENTPACKT = 128 * 1024 * 1024;

const dec = new TextDecoder('utf-8');

function alsBytes(daten) {
  if (daten instanceof Uint8Array) return daten;
  if (daten && typeof daten === 'object' && 'byteLength' in daten) return new Uint8Array(daten);
  throw new Error('xlsxRead: Rohbytes erwartet (Uint8Array/ArrayBuffer) — ein String kann kein Zip sein.');
}

/** Spaltenbuchstaben → 1-basierter Index ("A" = 1, "AA" = 27). */
export function spalteZuNr(letters) {
  let n = 0;
  for (const ch of String(letters || '').toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

/** 1-basierter Index → Spaltenbuchstaben. */
export function nrZuSpalte(n) {
  let s = '';
  let x = Number(n) || 0;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** "B12" → {col: 2, row: 12}. */
export function zelleZerlegen(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  return { col: spalteZuNr(m[1]), row: Number(m[2]), spalte: m[1].toUpperCase() };
}

// --- Mini-XML-Leser ----------------------------------------------------------
// Phase 71-04: 1:1 nach @core/lib/xmlMini gehoben — @ifc (BCF-Import) braucht
// denselben Leser und darf @ava nicht importieren (Boundary-Regel). Der Code
// bleibt unverändert; Import FÜR DIESES MODUL + Re-Export halten alle
// bestehenden Importe (`import { xmlDurchlaufen } from '@ava/lib/xlsxRead'`) grün.

import { xmlDurchlaufen } from '@core/lib/xmlMini';

export { xmlEntschaerfen, xmlDurchlaufen } from '@core/lib/xmlMini';

// --- Arbeitsmappe lesen ---------------------------------------------------

/**
 * XLSX-Container entpacken und strukturell lesen.
 *
 * @param {Uint8Array|ArrayBuffer} daten
 * @param {{maxEntpackt?: number, mitFormeln?: boolean}} opt
 * @returns {{blaetter: Array, blattNamen: string[], definedNames: Object,
 *            dxfs: Array, sharedStrings: string[], warnungen: string[]}}
 */
export function leseArbeitsmappe(daten, { maxEntpackt = MAX_ENTPACKT } = {}) {
  const bytes = alsBytes(daten);
  const files = unzipSync(bytes);
  let summe = 0;
  for (const k of Object.keys(files)) {
    summe += files[k].length;
    if (summe > maxEntpackt) {
      throw new Error(`xlsxRead: entpackte Größe übersteigt ${maxEntpackt} Byte (Zip-Bomb-Schutz)`);
    }
  }
  const txt = (pfad) => (files[pfad] ? dec.decode(files[pfad]) : null);
  const warnungen = [];

  // sharedStrings
  const sharedStrings = [];
  const ssXml = txt('xl/sharedStrings.xml');
  if (ssXml) {
    let inSi = false;
    let puffer = '';
    xmlDurchlaufen(ssXml, (t) => {
      if (t.name === 'si' && !t.ende) { inSi = true; puffer = ''; return; }
      if (t.name === 'si' && t.ende) { sharedStrings.push(puffer); inSi = false; return; }
      if (inSi && t.name === 't' && t.ende) puffer += t.text;
    });
  }

  // dxfs (Differential-Formate — die Ampel-Füllungen hängen daran)
  const dxfs = [];
  const stylesXml = txt('xl/styles.xml');
  if (stylesXml) {
    let inDxfs = false;
    let cur = null;
    xmlDurchlaufen(stylesXml, (t) => {
      if (t.name === 'dxfs') { inDxfs = !t.ende; return; }
      if (!inDxfs) return;
      if (t.name === 'dxf' && !t.ende) { cur = { fill: null, fontColor: null }; return; }
      if (t.name === 'dxf' && t.ende) { dxfs.push(cur || {}); cur = null; return; }
      if (cur && t.name === 'fgColor' && t.attrs?.rgb) cur.fill = t.attrs.rgb;
      if (cur && t.name === 'bgColor' && t.attrs?.rgb && !cur.fill) cur.fill = t.attrs.rgb;
    });
  }

  // Blattreihenfolge + rId → Ziel
  const wbXml = txt('xl/workbook.xml') || '';
  const relXml = txt('xl/_rels/workbook.xml.rels') || '';
  const rels = {};
  xmlDurchlaufen(relXml, (t) => {
    if (t.name === 'Relationship' && t.attrs?.Id) rels[t.attrs.Id] = t.attrs.Target;
  });
  const blattRefs = [];
  const definedNames = {};
  let dnName = null;
  xmlDurchlaufen(wbXml, (t) => {
    if (t.name === 'sheet' && !t.ende) {
      blattRefs.push({ name: t.attrs?.name || '', rid: t.attrs?.id || t.attrs?.['r:id'] || null });
    }
    if (t.name === 'definedName' && !t.ende) dnName = t.attrs?.name || null;
    if (t.name === 'definedName' && t.ende && dnName) { definedNames[dnName] = t.text.trim(); dnName = null; }
  });

  const blaetter = blattRefs.map((ref) => {
    // Relationship-Target ist entweder absolut ("/xl/worksheets/sheet1.xml") oder
    // relativ zum Part "xl/workbook.xml" ("worksheets/sheet1.xml").
    let ziel = rels[ref.rid] || null;
    if (ziel) {
      ziel = ziel.startsWith('/') ? ziel.slice(1) : (ziel.startsWith('xl/') ? ziel : `xl/${ziel}`);
    }
    const xml = ziel ? txt(ziel) : null;
    if (!xml) {
      warnungen.push(`Blatt "${ref.name}" nicht lesbar (${ziel})`);
      return { name: ref.name, zellen: {}, maxRow: 0, maxCol: 0, cfRules: [], merges: [], freeze: null, autoFilter: null };
    }
    return { name: ref.name, ...leseBlatt(xml, sharedStrings) };
  });

  return {
    blaetter,
    blattNamen: blaetter.map((b) => b.name),
    definedNames,
    dxfs,
    sharedStrings,
    warnungen,
    dateien: Object.keys(files),
  };
}

function leseBlatt(xml, sharedStrings) {
  const zellen = {};
  let maxRow = 0;
  let maxCol = 0;
  const cfRules = [];
  const merges = [];
  let freeze = null;
  let autoFilter = null;
  const spaltenBreiten = {};

  let curRef = null;
  let curTyp = null;
  let curFormel = null;
  let curWert = null;
  let inIs = false;
  let isText = '';
  let cfSqref = null;
  let curRule = null;

  xmlDurchlaufen(xml, (t) => {
    if (t.name === 'c' && !t.ende) {
      curRef = t.attrs?.r || null;
      curTyp = t.attrs?.t || 'n';
      curFormel = null;
      curWert = null;
      inIs = false;
      isText = '';
      if (t.selbstschliessend) { curRef = null; }
      return;
    }
    if (t.name === 'f' && t.ende) { curFormel = t.text; return; }
    if (t.name === 'v' && t.ende) { curWert = t.text; return; }
    if (t.name === 'is') { inIs = !t.ende; return; }
    if (inIs && t.name === 't' && t.ende) { isText += t.text; return; }
    if (t.name === 'c' && t.ende && curRef) {
      const pos = zelleZerlegen(curRef);
      let wert = null;
      if (curTyp === 's' && curWert != null) wert = sharedStrings[Number(curWert)] ?? null;
      else if (curTyp === 'inlineStr') wert = isText;
      else if (curTyp === 'str') wert = curWert;
      else if (curTyp === 'b') wert = curWert === '1';
      else if (curWert != null && curWert !== '') {
        const n = Number(curWert);
        wert = Number.isFinite(n) ? n : curWert;
      }
      zellen[curRef] = {
        ref: curRef,
        row: pos?.row ?? null,
        col: pos?.col ?? null,
        typ: curTyp,
        // `wert` ist bei Formelzellen der GECACHTE Wert (≙ data_only=True).
        wert,
        formel: curFormel == null ? null : `=${curFormel}`,
        gecacht: curFormel != null && curWert != null,
      };
      if (pos) {
        if (pos.row > maxRow) maxRow = pos.row;
        if (pos.col > maxCol) maxCol = pos.col;
      }
      curRef = null;
      return;
    }
    if (t.name === 'conditionalFormatting' && !t.ende) { cfSqref = t.attrs?.sqref || null; return; }
    if (t.name === 'conditionalFormatting' && t.ende) { cfSqref = null; return; }
    if (t.name === 'cfRule' && !t.ende) {
      curRule = {
        sqref: cfSqref,
        typ: t.attrs?.type || null,
        dxfId: t.attrs?.dxfId != null ? Number(t.attrs.dxfId) : null,
        prioritaet: t.attrs?.priority != null ? Number(t.attrs.priority) : null,
        stopIfTrue: t.attrs?.stopIfTrue === '1' || t.attrs?.stopIfTrue === 'true',
        formeln: [],
      };
      if (t.selbstschliessend) { cfRules.push(curRule); curRule = null; }
      return;
    }
    if (t.name === 'formula' && t.ende && curRule) { curRule.formeln.push(t.text); return; }
    if (t.name === 'cfRule' && t.ende && curRule) { cfRules.push(curRule); curRule = null; return; }
    if (t.name === 'mergeCell' && t.attrs?.ref) { merges.push(t.attrs.ref); return; }
    if (t.name === 'pane' && t.attrs) { freeze = t.attrs.topLeftCell || null; return; }
    if (t.name === 'autoFilter' && t.attrs?.ref) { autoFilter = t.attrs.ref; return; }
    if (t.name === 'col' && t.attrs?.min) {
      const von = Number(t.attrs.min);
      const bis = Number(t.attrs.max || t.attrs.min);
      for (let c = von; c <= bis && c - von < 1024; c += 1) spaltenBreiten[nrZuSpalte(c)] = Number(t.attrs.width);
    }
  });

  return { zellen, maxRow, maxCol, cfRules, merges, freeze, autoFilter, spaltenBreiten };
}

/** Bequemer Zugriff: Wert einer Zelle eines Blatts. */
export function zellwert(blatt, ref) {
  return blatt?.zellen?.[String(ref).toUpperCase()]?.wert ?? null;
}
/** Bequemer Zugriff: Formel einer Zelle eines Blatts. */
export function zellformel(blatt, ref) {
  return blatt?.zellen?.[String(ref).toUpperCase()]?.formel ?? null;
}
/** Anzahl Formelzellen eines Blatts. */
export function formelzahl(blatt) {
  return Object.values(blatt?.zellen || {}).filter((z) => z.formel != null).length;
}

// --- KA-2020-Import als PROFIL -------------------------------------------

/**
 * Standardprofil = genau das, was `oracle/parse_ka2020.py` hart im Code hatte.
 * Es steht hier als DATEN, damit eine andere Vorlage kein Codeproblem ist.
 * `oz_muster` ist ein Glob-artiges Muster für „zwei Ziffern, dann Gruppen aus
 * Punkt+zwei Ziffern, dann Punkt+vier Ziffern" — als Regex-Quelle, damit ein
 * Büro sie ändern kann.
 */
export const KA2020_PROFIL = Object.freeze({
  name: 'LV-Kostenanschlag 2020 (Büro-Vorlage)',
  blatt: 0,
  summenzelle: 'H7',
  startzeile: 12,
  spalte_oz: 'A',
  spalte_menge: 'B',
  spalte_ep: 'G',
  spalte_gb: 'H',
  oz_muster: '^\\d{2}(\\.\\d{2})+\\.\\d{4}$',
  oz_punkte_entfernen: true,
});

/**
 * Ein KA-2020-Blatt nach Profil lesen.
 *
 * @param {Uint8Array|ArrayBuffer} daten Rohbytes der XLSX
 * @param {object} profil Import-Profil (Default `KA2020_PROFIL`)
 * @param {{gewerk_nr?: string|null}} opt
 * @returns {{summe: number|null, positionen: Object, gelesen: number,
 *            uebersprungen: number, warnungen: string[], profil: object}}
 */
export function leseKa2020(daten, profil = KA2020_PROFIL, { gewerk_nr = null, maxEntpackt = MAX_ENTPACKT } = {}) {
  const p = { ...KA2020_PROFIL, ...(profil || {}) };
  const wb = leseArbeitsmappe(daten, { maxEntpackt });
  const blatt = typeof p.blatt === 'number' ? wb.blaetter[p.blatt] : wb.blaetter.find((b) => b.name === p.blatt);
  const warnungen = [...wb.warnungen];
  if (!blatt) {
    return { summe: null, positionen: {}, gelesen: 0, uebersprungen: 0, warnungen: [...warnungen, `Blatt ${p.blatt} nicht gefunden`], profil: p };
  }
  let ozRe;
  try {
    ozRe = new RegExp(p.oz_muster);
  } catch {
    return { summe: null, positionen: {}, gelesen: 0, uebersprungen: 0, warnungen: [...warnungen, `oz_muster "${p.oz_muster}" ist kein gültiges Muster`], profil: p };
  }
  const summe = zellwert(blatt, p.summenzelle);
  if (summe == null) warnungen.push(`Summenzelle ${p.summenzelle} ist leer — Kontrollsumme nicht prüfbar`);

  const positionen = {};
  let gelesen = 0;
  let uebersprungen = 0;
  const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  for (let r = p.startzeile; r <= blatt.maxRow; r += 1) {
    const rohOz = zellwert(blatt, `${p.spalte_oz}${r}`);
    const oz = rohOz == null ? '' : String(rohOz).trim();
    if (!oz || !ozRe.test(oz)) { if (oz) uebersprungen += 1; continue; }
    const schluessel = p.oz_punkte_entfernen ? oz.replace(/\./g, '') : oz;
    const k = gewerk_nr ? `${gewerk_nr}|${schluessel}` : schluessel;
    positionen[k] = {
      menge: zahl(zellwert(blatt, `${p.spalte_menge}${r}`)),
      ep: zahl(zellwert(blatt, `${p.spalte_ep}${r}`)),
      // `gb` nur, wenn es wirklich eine Zahl ist — ein Text („s. u.") darf nicht
      // still zu 0 werden. Ein 0-€-Gesamtbetrag sieht wie ein belegter Nullpreis aus.
      gb: zahl(zellwert(blatt, `${p.spalte_gb}${r}`)),
      oz_quelle: oz,
      zeile: r,
    };
    gelesen += 1;
  }
  return { summe: zahl(summe), positionen, gelesen, uebersprungen, warnungen, profil: p };
}
