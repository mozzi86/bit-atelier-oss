// novaXlsx — eigener XLSX-Schreiber über `fflate.zipSync`, isomorph.
// Phase 33 / W5 (Plan 33-03, ENGINE-06).
//
// ORT (Plan 66-14): bis 06.10.2026 packages/nova-ausschreibung/src/lib, jetzt in
// @core, weil die Paketgrenzen (eslint.config.js) dem Prüf-Suite-Paket @ifc nur
// @core erlauben und die Befundliste dort als Excel erscheinen soll. Der alte Pfad
// `@ava/lib/novaXlsx.js` bleibt als Re-Export bestehen — Aufrufer, Tests und das
// Paritätsgate G14 ändern sich nicht. Der Inhalt ist unverändert (Feature-Freeze).
//
// WARUM EIGENBAU (und was das kostet):
// Die Alternative wäre `exceljs` — 21,8 MB im Kundenpaket samt archivierter
// Node-Polyfills, für eine Datei, die im Browser entsteht. Der Preis des
// Eigenbaus ist Eigenwartung (T-33-06), und der wird ausdrücklich getragen —
// aber unter drei Bedingungen:
//
//   1. FEATURE-FREEZE auf genau die 12 Fähigkeiten, die gegen einen unabhängigen
//      Python-XLSX-Leser (Version im Entwickler-Gate G14 festgehalten)
//      nachgewiesen sind. Jede Erweiterung braucht einen neuen Roundtrip-Nachweis.
//      Wer hier „nur schnell" ein Diagramm einbaut, hat ein halbes Excel gebaut.
//   2. Roundtrip-Nachweis gegen UNABHÄNGIGE Leser (Gate G14).
//   3. Eine goldene Referenzdatei als Vergleichsanker.
//
// DIE 12 FÄHIGKEITEN:
//   (1) Zellen: Zahl / Text / Formel   (2) numFmt   (3) Füllungen (solid)
//   (4) Merges   (5) freeze panes      (6) auto filter
//   (7) Spaltenbreiten                 (8) dxf + cfRules (expression, stopIfTrue)
//   (9) definedNames                   (10) Cross-Sheet-Formeln (SUMIF/COUNTIF/HYPERLINK)
//   (11) Blattnamen-Hygiene            (12) Zip-Container (OOXML-Minimalgerüst)
//
// Ausgabe ist ein `Uint8Array` — im Browser als Blob herunterladbar, in Node
// direkt schreibbar. Kein Server, kein Node im Kundenpaket.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

import { zipSync, strToU8 } from 'fflate';

/** 1980-01-01T00:00:00Z — die untere Grenze der ZIP-Zeitstempel. */
export const ZIP_ZEITSTEMPEL = Date.UTC(1980, 0, 1);

/**
 * Farbe → ARGB, wie OOXML es verlangt (8 Hexstellen, Alpha zuerst).
 *
 * ACHTUNG, echte Falle: ein naives `replace(/^FF/, '')` behandelt die
 * ROTKOMPONENTE von `FFC7CE` als Alphapräfix und schreibt eine andere Farbe.
 * Deshalb wird hier über die LÄNGE entschieden: 6 Stellen sind RGB (Alpha `FF`
 * davor), 8 Stellen sind bereits ARGB und bleiben unangetastet.
 */
export function argb(farbe) {
  const h = String(farbe || '').replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{8}$/.test(h)) return h;
  if (/^[0-9A-F]{6}$/.test(h)) return `FF${h}`;
  throw new Error(`XLSX-Export: "${farbe}" ist keine Farbe (6 oder 8 Hexstellen erwartet)`);
}

/** XML-Text escapen. Auch für Formeln nötig: `>`/`<`/`&` kommen dort vor. */
export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
/** Attributwert escapen (zusätzlich Anführungszeichen). */
export function escAttr(v) {
  return esc(v).replace(/"/g, '&quot;');
}

/** 1-basierter Spaltenindex → Buchstaben. */
export function spalte(n) {
  let s = '';
  let x = Number(n) || 0;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * (11) BLATTNAMEN-HYGIENE. Excel verbietet `\ / ? * [ ] :` und begrenzt auf
 * 31 Zeichen. Ein ungeprüfter Name lässt Excel die Datei als „reparaturbedürftig"
 * melden — und der Nutzer sieht eine Warnung, nicht eine Kostenberechnung.
 * Zusätzlich: `'` ist am Rand verboten und bricht Cross-Sheet-Formeln.
 */
export const BLATTNAME_MAX = 31;
export function blattname(roh) {
  let n = String(roh ?? '')
    .replace(/[\\/?*[\]:']/g, '')
    .trim()
    .slice(0, BLATTNAME_MAX)
    .trim();
  if (!n) n = 'Blatt';
  return n;
}

/** Blattname für eine Cross-Sheet-Referenz zitieren. */
export function blattRef(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${String(name).replace(/'/g, "''")}'`;
}

// --- Arbeitsmappe ---------------------------------------------------------

/**
 * Neue Arbeitsmappe.
 * @returns {{blaetter: Array, definedNames: Array, addSheet: Function,
 *            definedName: Function}}
 */
export function createWorkbook() {
  const wb = {
    blaetter: [],
    definedNames: [],
    /** (9) definedNames — z. B. `Preisindex` → `Zusammenfassung!$E$3`. */
    definedName(name, ref) {
      wb.definedNames.push({ name, ref });
      return wb;
    },
    addSheet(name) {
      const rein = blattname(name);
      if (wb.blaetter.some((b) => b.name === rein)) {
        throw new Error(`Blattname "${rein}" ist doppelt — Excel verweigert die Datei.`);
      }
      const ws = createSheet(rein);
      wb.blaetter.push(ws);
      return ws;
    },
  };
  return wb;
}

function createSheet(name) {
  const ws = {
    name,
    zellen: new Map(), // "R,C" → {row, col, wert, formel, stil}
    merges: [],
    freezeRef: null,
    autoFilterRef: null,
    breiten: new Map(), // colNr → width
    cf: [], // {range, formel, stil}
    maxRow: 0,
    maxCol: 0,

    /**
     * (1) ZELLE. `wert` ist Zahl, Text, Boolean, `null` — oder ein String, der
     * mit `=` beginnt: dann ist es eine FORMEL (übliche Bibliothekskonvention).
     * `null` schreibt NICHTS (leere Zelle) — bewusst nicht 0: eine 0 im
     * Kostenanschlag sieht wie ein belegter Nullpreis aus.
     */
    setze(row, col, wert, stil = null) {
      const r = Number(row);
      const c = Number(col);
      if (!Number.isInteger(r) || r < 1 || !Number.isInteger(c) || c < 1) {
        throw new Error(`XLSX-Export: ungültige Zellposition (${row}, ${col})`);
      }
      const istFormel = typeof wert === 'string' && wert.startsWith('=');
      ws.zellen.set(`${r},${c}`, {
        row: r,
        col: c,
        wert: istFormel ? null : wert,
        formel: istFormel ? wert.slice(1) : null,
        stil: stil || null,
      });
      if (r > ws.maxRow) ws.maxRow = r;
      if (c > ws.maxCol) ws.maxCol = c;
      return ws;
    },
    /** Eine ganze Zeile ab Spalte 1 schreiben. */
    zeile(row, werte = [], stile = null) {
      werte.forEach((v, i) => {
        const stil = typeof stile === 'function' ? stile(i + 1, v) : (stile?.[i] ?? stile ?? null);
        ws.setze(row, i + 1, v, stil);
      });
      return ws;
    },
    /** (4) Merges. */
    merge(range) { ws.merges.push(range); return ws; },
    /** (5) freeze panes. */
    freeze(ref) { ws.freezeRef = ref; return ws; },
    /** (6) auto filter. */
    autoFilter(ref) { ws.autoFilterRef = ref; return ws; },
    /** (7) Spaltenbreiten. */
    breite(col, width) { ws.breiten.set(Number(col), Number(width)); return ws; },
    /**
     * (8) BEDINGTE FORMATIERUNG, Typ `expression`, mit `stopIfTrue`.
     * Die REIHENFOLGE der Aufrufe ist die Auswertungsreihenfolge (priority 1..n).
     * Genau darauf beruht die 3-Regel-Ampel: rot zuerst, dann gelb, dann grün —
     * ohne `stopIfTrue` würde jede Regel greifen und grün die anderen übermalen.
     */
    cfRegel(range, formel, stil) {
      ws.cf.push({ range, formel: String(formel).replace(/^=/, ''), stil });
      return ws;
    },
  };
  return ws;
}

// --- Stilregister --------------------------------------------------------
// Ein Stil ist ein einfaches Objekt: {numFmt, fill, bold, italic, fontColor, fontSize}.
// Gleiche Stile werden dedupliziert — sonst wächst styles.xml mit jeder Zelle.

const STANDARD_NUMFMT = {
  '#,##0.00': 164,
  '+0%;-0%': 165,
  '0.00': 166,
};

function stilRegister() {
  const numFmts = new Map(Object.entries(STANDARD_NUMFMT));
  let numFmtId = 200;
  const fonts = [{ bold: false, italic: false, color: null, size: null }];
  const fills = [{ solid: null }, { solid: null }]; // 0 = none, 1 = gray125 (Pflicht)
  const xfs = [{ font: 0, fill: 0, numFmt: 0 }];
  const dxfs = [];

  const key = (o) => JSON.stringify(o);
  const fontIdx = new Map([[key(fonts[0]), 0]]);
  const fillIdx = new Map();
  const xfIdx = new Map([[key(xfs[0]), 0]]);
  const dxfIdx = new Map();

  function font(s) {
    const f = {
      bold: Boolean(s?.bold),
      italic: Boolean(s?.italic),
      color: s?.fontColor || null,
      size: s?.fontSize || null,
    };
    const k = key(f);
    if (!fontIdx.has(k)) { fonts.push(f); fontIdx.set(k, fonts.length - 1); }
    return fontIdx.get(k);
  }
  function fill(farbe) {
    if (!farbe) return 0;
    const k = String(farbe).toUpperCase();
    if (!fillIdx.has(k)) { fills.push({ solid: k }); fillIdx.set(k, fills.length - 1); }
    return fillIdx.get(k);
  }
  function fmt(f) {
    if (!f) return 0;
    if (!numFmts.has(f)) { numFmts.set(f, numFmtId); numFmtId += 1; }
    return numFmts.get(f);
  }
  function xf(s) {
    if (!s) return 0;
    const e = { font: font(s), fill: fill(s.fill), numFmt: fmt(s.numFmt) };
    const k = key(e);
    if (!xfIdx.has(k)) { xfs.push(e); xfIdx.set(k, xfs.length - 1); }
    return xfIdx.get(k);
  }
  function dxf(s) {
    const e = { fill: s?.fill ? String(s.fill).toUpperCase() : null, bold: Boolean(s?.bold) };
    const k = key(e);
    if (!dxfIdx.has(k)) { dxfs.push(e); dxfIdx.set(k, dxfs.length - 1); }
    return dxfIdx.get(k);
  }
  return { xf, dxf, numFmts, fonts, fills, xfs, dxfs };
}

function stylesXml(reg) {
  const eigene = [...reg.numFmts.entries()].filter(([, id]) => id >= 164);
  const numFmtXml = eigene.length
    ? `<numFmts count="${eigene.length}">${eigene
        .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escAttr(code)}"/>`)
        .join('')}</numFmts>`
    : '';
  const fontXml = reg.fonts
    .map((f) => {
      const teile = [];
      if (f.bold) teile.push('<b/>');
      if (f.italic) teile.push('<i/>');
      teile.push(`<sz val="${f.size || 11}"/>`);
      teile.push(f.color ? `<color rgb="${argb(f.color)}"/>` : '<color theme="1"/>');
      teile.push('<name val="Calibri"/>');
      return `<font>${teile.join('')}</font>`;
    })
    .join('');
  const fillXml = reg.fills
    .map((f, i) => {
      if (i === 0) return '<fill><patternFill patternType="none"/></fill>';
      if (i === 1 && !f.solid) return '<fill><patternFill patternType="gray125"/></fill>';
      return `<fill><patternFill patternType="solid"><fgColor rgb="${argb(f.solid)}"/><bgColor indexed="64"/></patternFill></fill>`;
    })
    .join('');
  const xfXml = reg.xfs
    .map(
      (x) =>
        `<xf numFmtId="${x.numFmt}" fontId="${x.font}" fillId="${x.fill}" borderId="0" xfId="0"` +
        `${x.numFmt ? ' applyNumberFormat="1"' : ''}${x.font ? ' applyFont="1"' : ''}${x.fill ? ' applyFill="1"' : ''}/>`,
    )
    .join('');
  const dxfXml = reg.dxfs
    .map((d) => {
      const teile = [];
      if (d.bold) teile.push('<font><b/></font>');
      if (d.fill) {
        // dxf-Füllung: Excel liest hier `bgColor` als sichtbare Farbe.
        teile.push(
          `<fill><patternFill><bgColor rgb="${argb(d.fill)}"/></patternFill></fill>`,
        );
      }
      return `<dxf>${teile.join('')}</dxf>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    numFmtXml +
    `<fonts count="${reg.fonts.length}">${fontXml}</fonts>` +
    `<fills count="${reg.fills.length}">${fillXml}</fills>` +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${reg.xfs.length}">${xfXml}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
    `<dxfs count="${reg.dxfs.length}">${dxfXml}</dxfs>` +
    '<tableStyles count="0"/>' +
    '</styleSheet>'
  );
}

function sheetXml(ws, reg, sst) {
  // Zeilen sortiert, Zellen je Zeile sortiert — Excel verlangt aufsteigende Refs.
  const nachZeile = new Map();
  for (const z of ws.zellen.values()) {
    if (!nachZeile.has(z.row)) nachZeile.set(z.row, []);
    nachZeile.get(z.row).push(z);
  }
  const zeilen = [...nachZeile.keys()].sort((a, b) => a - b);
  const rowsXml = zeilen
    .map((r) => {
      const cells = nachZeile.get(r).sort((a, b) => a.col - b.col);
      const inner = cells
        .map((z) => {
          const ref = `${spalte(z.col)}${z.row}`;
          const s = z.stil ? reg.xf(z.stil) : 0;
          const sAttr = s ? ` s="${s}"` : '';
          if (z.formel != null) {
            // (1)/(10) Formel. Kein gecachter Wert — `fullCalcOnLoad` sorgt
            // dafür, dass Excel/LibreOffice beim Öffnen rechnen.
            return `<c r="${ref}"${sAttr}><f>${esc(z.formel)}</f></c>`;
          }
          if (z.wert == null || z.wert === '') return `<c r="${ref}"${sAttr}/>`;
          if (typeof z.wert === 'number' && Number.isFinite(z.wert)) {
            return `<c r="${ref}"${sAttr}><v>${z.wert}</v></c>`;
          }
          if (typeof z.wert === 'boolean') {
            return `<c r="${ref}"${sAttr} t="b"><v>${z.wert ? 1 : 0}</v></c>`;
          }
          return `<c r="${ref}"${sAttr} t="s"><v>${sst.index(String(z.wert))}</v></c>`;
        })
        .join('');
      return `<row r="${r}">${inner}</row>`;
    })
    .join('');

  const dim = ws.maxRow > 0 ? `A1:${spalte(Math.max(ws.maxCol, 1))}${ws.maxRow}` : 'A1';
  const colsXml = ws.breiten.size
    ? `<cols>${[...ws.breiten.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  // (5) freeze panes: xSplit/ySplit aus der oberen linken Zelle ableiten.
  let paneXml = '';
  if (ws.freezeRef) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(ws.freezeRef);
    if (m) {
      let x = 0;
      for (const ch of m[1].toUpperCase()) x = x * 26 + (ch.charCodeAt(0) - 64);
      const xSplit = x - 1;
      const ySplit = Number(m[2]) - 1;
      const teile = [];
      if (xSplit > 0) teile.push(`xSplit="${xSplit}"`);
      if (ySplit > 0) teile.push(`ySplit="${ySplit}"`);
      paneXml = `<pane ${teile.join(' ')} topLeftCell="${escAttr(ws.freezeRef)}" activePane="bottomRight" state="frozen"/>`;
    }
  }
  const mergeXml = ws.merges.length
    ? `<mergeCells count="${ws.merges.length}">${ws.merges
        .map((r) => `<mergeCell ref="${escAttr(r)}"/>`)
        .join('')}</mergeCells>`
    : '';
  const afXml = ws.autoFilterRef ? `<autoFilter ref="${escAttr(ws.autoFilterRef)}"/>` : '';
  // (8) cfRules: nach Bereich gruppiert, Priorität = Aufrufreihenfolge.
  const nachBereich = new Map();
  ws.cf.forEach((r, i) => {
    if (!nachBereich.has(r.range)) nachBereich.set(r.range, []);
    nachBereich.get(r.range).push({ ...r, prio: i + 1 });
  });
  const cfXml = [...nachBereich.entries()]
    .map(
      ([range, regeln]) =>
        `<conditionalFormatting sqref="${escAttr(range)}">${regeln
          .map(
            (r) =>
              `<cfRule type="expression" dxfId="${reg.dxf(r.stil)}" priority="${r.prio}" stopIfTrue="1">` +
              `<formula>${esc(r.formel)}</formula></cfRule>`,
          )
          .join('')}</conditionalFormatting>`,
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml +
    `<sheetData>${rowsXml}</sheetData>` +
    // Reihenfolge im Schema: autoFilter VOR mergeCells VOR conditionalFormatting.
    afXml +
    mergeXml +
    cfXml +
    '</worksheet>'
  );
}

function sharedStrings() {
  const liste = [];
  const idx = new Map();
  return {
    index(s) {
      if (!idx.has(s)) { liste.push(s); idx.set(s, liste.length - 1); }
      return idx.get(s);
    },
    xml() {
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${liste.length}" uniqueCount="${liste.length}">` +
        liste.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') +
        '</sst>'
      );
    },
    get laenge() { return liste.length; },
  };
}

/**
 * (12) ZIP-CONTAINER. Arbeitsmappe → `Uint8Array` (XLSX).
 * @param {object} wb aus `createWorkbook()`
 * @returns {Uint8Array}
 */
export function writeWorkbook(wb) {
  if (!wb?.blaetter?.length) throw new Error('XLSX-Export: Arbeitsmappe ohne Blatt');
  const reg = stilRegister();
  const sst = sharedStrings();
  // Reihenfolge: Blätter zuerst rendern (füllt Stil- und String-Register).
  const blattXml = wb.blaetter.map((ws) => sheetXml(ws, reg, sst));

  const wbSheets = wb.blaetter
    .map((ws, i) => `<sheet name="${escAttr(ws.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const dnXml = wb.definedNames.length
    ? `<definedNames>${wb.definedNames
        .map((d) => `<definedName name="${escAttr(d.name)}">${esc(d.ref)}</definedName>`)
        .join('')}</definedNames>`
    : '';
  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${wbSheets}</sheets>` +
    dnXml +
    // fullCalcOnLoad: die Datei enthält keine gecachten Formelwerte — ohne das
    // Flag zeigen Excel und LibreOffice leere Zellen statt Zahlen.
    '<calcPr calcId="124519" fullCalcOnLoad="1"/>' +
    '</workbook>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    wb.blaetter
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${wb.blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${wb.blaetter.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    wb.blaetter
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  const wurzelRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const dateien = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(wurzelRels),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/styles.xml': strToU8(stylesXml(reg)),
    'xl/sharedStrings.xml': strToU8(sst.xml()),
  };
  blattXml.forEach((xml, i) => {
    dateien[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
  });
  // FESTER Zeitstempel (1980-01-01, die untere Grenze des ZIP-Formats). Ohne das
  // wäre jede Ausgabe byte-verschieden und selbst ein Strukturvergleich schwer
  // reproduzierbar. Verglichen werden ohnehin Zahlen und Strukturen, nie Bytes.
  return zipSync(dateien, { level: 6, mtime: ZIP_ZEITSTEMPEL });
}

/**
 * Download im Browser (Muster `downloadGaeb`). In Node nicht aufrufen — dort
 * wird das `Uint8Array` direkt geschrieben.
 */
export function downloadXlsx(filename, bytes) {
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Die 12 eingefrorenen Fähigkeiten — maschinenlesbar für das Gate. */
export const FAEHIGKEITEN = Object.freeze([
  'zellen_zahl_text_formel',
  'numFmt',
  'fill_solid',
  'merges',
  'freeze_panes',
  'auto_filter',
  'spaltenbreiten',
  'dxf_cfRules_expression_stopIfTrue',
  'definedNames',
  'cross_sheet_formeln',
  'blattnamen_hygiene',
  'zip_container',
]);
