// DXF R12 (AC1009) ASCII writer — own implementation of the public DXF format (group code /
// value pairs, one per line, CRLF). Plan 104-06: site plan and floor plan go to every CAD
// program without a new dependency; DWG stays out (closed format).
//
// Why R12: the oldest DXF every reader still accepts (AutoCAD, BricsCAD, Vectorworks,
// ArchiCAD, LibreCAD, QCAD). It has no LWPOLYLINE, no lineweights and no Unicode: polylines
// are POLYLINE + VERTEX + SEQEND, pen widths travel as ACI colours (the plot style table of
// the receiving office maps colour → width), text is Windows-1252.
//
// In:  layers, elements in METRES (x to the east, y to the NORTH — callers mirror screen y),
//      line types with dash lengths in metres, a comment.
// Out: dxfR12() → { text (CRLF), uebersprungen }; dxfBytes() → Windows-1252 bytes.
// Pure module: no DOM, no React, node-testable.

/**
 * @typedef {{x: number, y: number}} DxfPunkt point in metres (y north)
 * @typedef {{name: string, farbe?: number, linientyp?: string, aus?: boolean, gesperrt?: boolean, gefroren?: boolean}} DxfEbene
 *   layer: name (mapped through dxfEbenenName), ACI colour 1–255 (default 7), line type name, off/locked/frozen
 * @typedef {{name: string, beschreibung?: string, muster: number[]}} DxfLinientyp
 *   line type: dash pattern in METRES (positive = dash, negative = gap, 0 = dot)
 * @typedef {{art: 'linie', ebene: string, a: DxfPunkt, b: DxfPunkt, linientyp?: string}
 *   | {art: 'polylinie', ebene: string, punkte: DxfPunkt[], geschlossen?: boolean, linientyp?: string}
 *   | {art: 'text', ebene: string, x: number, y: number, text: string, hoehe: number, ausrichtung?: 'mitte'|'links', drehung_grad?: number}
 *   | {art: 'flaeche', ebene: string, punkte: DxfPunkt[]}} DxfElement
 *   drawing element; text height in metres; 'flaeche' = filled triangle/quadrilateral (SOLID);
 *   linientyp = line type of this element instead of the layer's (ByLayer when absent or unknown)
 */

const CRLF = "\r\n";
/** Largest absolute coordinate written, drawing units: beyond it toFixed() switches to exponents, and no plan is that large. */
const MAX_BETRAG = 1e15;

/**
 * Number as DXF value: fixed point, never an exponent (some R12 readers reject "1e-7"),
 * at most 6 decimals (micrometres at metre units), trailing zeros removed, -0 → "0".
 * @param {number} v value (metres, degrees or a plain factor)
 * @returns {string}
 * @throws {RangeError} for NaN/±Infinity or |v| ≥ 1e15 — dxfR12 skips such elements before writing
 */
export function dxfZahl(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) >= MAX_BETRAG) throw new RangeError(`DXF: keine endliche Zahl (${v})`);
  let s = n.toFixed(6);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s;
}

/**
 * Layer name valid in R12: German umlauts transliterated (ä → AE …), upper case, only
 * A–Z 0–9 _ $ - kept (anything else → "_"), at most 31 characters. Empty → "0".
 * @param {string} name layer name as shown in the UI, e.g. "Grundstück"
 * @returns {string} e.g. "GRUNDSTUECK"
 */
export function dxfEbenenName(name) {
  const s = String(name ?? "")
    .replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE")
    .replace(/ä/g, "AE").replace(/ö/g, "OE").replace(/ü/g, "UE").replace(/ß/g, "SS")
    .toUpperCase()
    .replace(/[^A-Z0-9_$-]/g, "_")
    .slice(0, 31);
  return s || "0";
}

// Windows-1252 code points 0x80–0x9F (the rest of 0xA0–0xFF equals Latin-1).
const CP1252_SONDER = /** @type {Record<number, number>} */ ({
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
});

/**
 * DXF text → bytes in Windows-1252 ($DWGCODEPAGE ANSI_1252). Characters without a
 * Windows-1252 code become "?" — visible, never silently dropped.
 * @param {string} text DXF text (CRLF lines)
 * @returns {Uint8Array} file content
 */
export function dxfBytes(text) {
  const s = String(text ?? "");
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[n++] = c;
    else if (CP1252_SONDER[c] != null) out[n++] = CP1252_SONDER[c];
    else out[n++] = 0x3f; // "?"
  }
  return out.slice(0, n);
}

/**
 * Line types for a drawing scale: the dash lengths of ISO 128-20 style patterns in mm ON
 * PAPER, converted to metres in the model so the file prints right at $LTSCALE 1.
 * [ASSUMED] pattern lengths (dash 6 mm / gap 2 mm, dash-dot 6/2/0.5/2 mm) — usual office
 * values, not taken from a standard table; the receiving CAD can rescale with LTSCALE.
 * @param {number} massstab scale denominator, e.g. 100 for 1:100
 * @returns {DxfLinientyp[]} STRICH (dashed), STRICHPUNKT (dash-dot), PUNKT (dotted)
 */
export function linientypenFuer(massstab) {
  const f = (Number(massstab) > 0 ? Number(massstab) : 100) / 1000; // mm on paper → m in the model
  return [
    { name: "STRICH", beschreibung: "Strich __ __ __", muster: [6 * f, -2 * f] },
    { name: "STRICHPUNKT", beschreibung: "Strichpunkt __ . __ .", muster: [6 * f, -2 * f, 0, -2 * f] },
    { name: "PUNKT", beschreibung: "Punkt . . . .", muster: [0, -1.5 * f] },
  ];
}

/**
 * Pen colour (ACI) for a line width in mm on paper. R12 has no lineweights; offices map ACI
 * colours to pen widths in their plot style table. [ASSUMED] mapping (common in German
 * offices, not normative): 0.7 → 6 magenta, 0.5 → 7 white/black, 0.35 → 4 cyan,
 * 0.25 → 3 green, 0.18 → 8 grey, thinner → 9 light grey.
 * @param {number} breite_mm line width in mm on paper
 * @returns {number} ACI colour 1–255
 */
export function stiftFarbe(breite_mm) {
  const b = Number(breite_mm) || 0;
  if (b >= 0.6) return 6;
  if (b >= 0.45) return 7;
  if (b >= 0.3) return 4;
  if (b >= 0.22) return 3;
  if (b >= 0.16) return 8;
  return 9;
}

const endlich = (/** @type {any} */ p) => p && [Number(p.x), Number(p.y)].every((v) => Number.isFinite(v) && Math.abs(v) < MAX_BETRAG);

/**
 * Writes a complete DXF R12 file.
 * Structure: 999 comment lines, HEADER ($ACADVER AC1009, $DWGCODEPAGE ANSI_1252, $INSUNITS 6 =
 * metres — an R2000 variable R12 readers ignore, hence the unit is also named in the comment —
 * $EXTMIN/$EXTMAX, $LTSCALE 1), TABLES (LTYPE, LAYER — layer "0" always —, STYLE STANDARD),
 * ENTITIES (LINE, POLYLINE/VERTEX/SEQEND, TEXT, SOLID), EOF.
 * Elements with non-finite coordinates or too few points are skipped and counted.
 * @param {{ebenen?: DxfEbene[], elemente?: DxfElement[], linientypen?: DxfLinientyp[], kommentar?: string|string[]}} daten
 * @returns {{text: string, uebersprungen: number}} file text (CRLF, even line count) and the number of skipped elements
 */
export function dxfR12({ ebenen = [], elemente = [], linientypen = [], kommentar = [] } = {}) {
  /** @type {string[]} */
  const z = [];
  const paar = (/** @type {number} */ code, /** @type {string|number} */ wert) => { z.push(String(code), String(wert)); };
  const zahl = (/** @type {number} */ code, /** @type {number} */ v) => paar(code, dxfZahl(v));
  // Group 1/2/3 values may not contain line breaks — one line per value.
  const textWert = (/** @type {string} */ s) => String(s ?? "").replace(/[\r\n]+/g, " ");

  // ---- usable elements and the drawing extents ----
  let uebersprungen = 0;
  /** @type {DxfElement[]} */
  const gut = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const erweitern = (/** @type {DxfPunkt} */ p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const e of Array.isArray(elemente) ? elemente : []) {
    if (!e || typeof e !== "object") { uebersprungen++; continue; }
    if (e.art === "linie") {
      if (!endlich(e.a) || !endlich(e.b)) { uebersprungen++; continue; }
      erweitern(e.a); erweitern(e.b);
    } else if (e.art === "polylinie") {
      const pts = Array.isArray(e.punkte) ? e.punkte : [];
      if (pts.length < 2 || !pts.every(endlich)) { uebersprungen++; continue; }
      pts.forEach(erweitern);
    } else if (e.art === "flaeche") {
      const pts = Array.isArray(e.punkte) ? e.punkte : [];
      if (pts.length < 3 || pts.length > 4 || !pts.every(endlich)) { uebersprungen++; continue; }
      pts.forEach(erweitern);
    } else if (e.art === "text") {
      if (!endlich(e) || !(Number(e.hoehe) > 0) || !String(e.text ?? "").trim()) { uebersprungen++; continue; }
      erweitern({ x: e.x, y: e.y });
    } else { uebersprungen++; continue; }
    gut.push(e);
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }

  // ---- layers: "0" always, then the given ones, then any layer only named by an element ----
  /** @type {Map<string, DxfEbene>} */
  const ebenenMap = new Map([["0", { name: "0", farbe: 7, linientyp: "CONTINUOUS" }]]);
  for (const eb of Array.isArray(ebenen) ? ebenen : []) {
    const n = dxfEbenenName(eb?.name);
    ebenenMap.set(n, { ...eb, name: n });
  }
  for (const e of gut) {
    const n = dxfEbenenName(e.ebene);
    if (!ebenenMap.has(n)) ebenenMap.set(n, { name: n, farbe: 7, linientyp: "CONTINUOUS" });
  }
  const lt = (Array.isArray(linientypen) ? linientypen : []).filter((l) => l && l.name && Array.isArray(l.muster));
  const ltNamen = new Set(["CONTINUOUS", ...lt.map((l) => dxfEbenenName(l.name))]);

  // ---- 999 comment ----
  for (const zeile of (Array.isArray(kommentar) ? kommentar : [kommentar]).filter(Boolean)) paar(999, textWert(zeile));

  // ---- HEADER ----
  paar(0, "SECTION"); paar(2, "HEADER");
  paar(9, "$ACADVER"); paar(1, "AC1009");
  paar(9, "$DWGCODEPAGE"); paar(3, "ANSI_1252");
  paar(9, "$INSUNITS"); paar(70, 6);
  paar(9, "$EXTMIN"); zahl(10, x0); zahl(20, y0); zahl(30, 0);
  paar(9, "$EXTMAX"); zahl(10, x1); zahl(20, y1); zahl(30, 0);
  paar(9, "$LTSCALE"); zahl(40, 1);
  paar(0, "ENDSEC");

  // ---- TABLES ----
  paar(0, "SECTION"); paar(2, "TABLES");
  paar(0, "TABLE"); paar(2, "LTYPE"); paar(70, lt.length + 1);
  paar(0, "LTYPE"); paar(2, "CONTINUOUS"); paar(70, 0); paar(3, "Solid line"); paar(72, 65); paar(73, 0); zahl(40, 0);
  for (const l of lt) {
    paar(0, "LTYPE"); paar(2, dxfEbenenName(l.name)); paar(70, 0); paar(3, textWert(l.beschreibung || l.name));
    paar(72, 65); paar(73, l.muster.length);
    zahl(40, l.muster.reduce((s, v) => s + Math.abs(Number(v) || 0), 0));
    for (const v of l.muster) zahl(49, Number(v) || 0);
  }
  paar(0, "ENDTAB");
  paar(0, "TABLE"); paar(2, "LAYER"); paar(70, ebenenMap.size);
  for (const eb of ebenenMap.values()) {
    // Flags (group 70): 1 = frozen, 4 = locked. Colour (62) negative = layer off.
    const flags = (eb.gefroren ? 1 : 0) | (eb.gesperrt ? 4 : 0);
    const farbe = Math.min(255, Math.max(1, Math.round(Number(eb.farbe) || 7)));
    const ltName = dxfEbenenName(eb.linientyp || "CONTINUOUS");
    paar(0, "LAYER"); paar(2, eb.name); paar(70, flags); paar(62, eb.aus ? -farbe : farbe);
    paar(6, ltNamen.has(ltName) ? ltName : "CONTINUOUS");
  }
  paar(0, "ENDTAB");
  paar(0, "TABLE"); paar(2, "STYLE"); paar(70, 1);
  paar(0, "STYLE"); paar(2, "STANDARD"); paar(70, 0); zahl(40, 0); zahl(41, 1); zahl(50, 0); paar(71, 0); zahl(42, 2.5); paar(3, "txt"); paar(4, "");
  paar(0, "ENDTAB");
  paar(0, "ENDSEC");

  // ---- ENTITIES ----
  paar(0, "SECTION"); paar(2, "ENTITIES");
  // Group 6 on the entity: its own line type (only when declared in the LTYPE table).
  const eigenerTyp = (/** @type {any} */ e) => {
    const n = e.linientyp ? dxfEbenenName(e.linientyp) : "";
    if (n && ltNamen.has(n)) paar(6, n);
  };
  for (const e of gut) {
    const eb = dxfEbenenName(e.ebene);
    if (e.art === "linie") {
      paar(0, "LINE"); paar(8, eb); eigenerTyp(e);
      zahl(10, e.a.x); zahl(20, e.a.y); zahl(30, 0); zahl(11, e.b.x); zahl(21, e.b.y); zahl(31, 0);
    } else if (e.art === "polylinie") {
      // R12 polyline: header (66 1 = vertices follow, 70 1 = closed), VERTEX…, SEQEND.
      paar(0, "POLYLINE"); paar(8, eb); eigenerTyp(e); paar(66, 1); zahl(10, 0); zahl(20, 0); zahl(30, 0); paar(70, e.geschlossen ? 1 : 0);
      for (const p of e.punkte) { paar(0, "VERTEX"); paar(8, eb); zahl(10, p.x); zahl(20, p.y); zahl(30, 0); }
      paar(0, "SEQEND"); paar(8, eb);
    } else if (e.art === "flaeche") {
      // SOLID corner order is p0, p1, p3, p2 (the 3rd and 4th corner are swapped against the
      // outline order); a triangle repeats its last corner.
      const [p0, p1, p2, p3 = p2] = e.punkte;
      paar(0, "SOLID"); paar(8, eb);
      zahl(10, p0.x); zahl(20, p0.y); zahl(30, 0);
      zahl(11, p1.x); zahl(21, p1.y); zahl(31, 0);
      zahl(12, p3.x); zahl(22, p3.y); zahl(32, 0);
      zahl(13, p2.x); zahl(23, p2.y); zahl(33, 0);
    } else if (e.art === "text") {
      paar(0, "TEXT"); paar(8, eb);
      zahl(10, e.x); zahl(20, e.y); zahl(30, 0); zahl(40, e.hoehe); paar(1, textWert(e.text));
      if (Number(e.drehung_grad)) zahl(50, Number(e.drehung_grad));
      paar(7, "STANDARD");
      if (e.ausrichtung !== "links") {
        // 72 4 = "Middle": centred horizontally and vertically on the alignment point 11/21.
        paar(72, 4); zahl(11, e.x); zahl(21, e.y); zahl(31, 0);
      }
    }
  }
  paar(0, "ENDSEC");
  paar(0, "EOF");
  return { text: z.join(CRLF) + CRLF, uebersprungen };
}
