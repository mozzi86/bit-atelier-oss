// DXF reader for plan bases ("Plangrundlagen") of the Stände world: a DXF plan from outside is
// read ONCE into an immutable, serialisable vector list that later PRs show, align and compare.
// Own implementation, no dependency, no GPL code. DWG is not read (DXF only).
//
// Why a module of its own next to plan/dxfLesen.js: dxfLesen.js is tuned for the parcel import
// (LINE chaining into rings, bulges as chords, blocks skipped) and its behaviour is pinned by the
// parcel tests. A plan base needs the opposite: everything visible, blocks resolved, arcs kept.
// The tokenizer (dxfPaare) and the message filler (meldungText) are shared, nothing else.
//
// Read: LINE, LWPOLYLINE and POLYLINE (+VERTEX/SEQEND) incl. bulges, ARC, CIRCLE, TEXT, MTEXT,
//   ATTRIB (visible attribute values of a block reference), INSERT with BLOCKS (base point,
//   scale x/y, rotation, MINSERT columns/rows, nested up to BLOECKE_MAX_TIEFE), layer name and
//   ACI colour per element (BYLAYER via the LAYER table, BYBLOCK from the INSERT, layer "0"
//   inside a block takes the INSERT's layer), extrusion (0,0,-1) = mirrored 2D objects,
//   $INSUNITS → metres.
// Not read (counted in `ignoriert` by entity type, never silently dropped): HATCH, SPLINE,
//   ELLIPSE, DIMENSION, SOLID, 3DFACE, POINT, … ; polygon/polyface meshes ("POLYLINE-NETZ");
//   paper-space entities ("PAPIERBEREICH", layout title blocks are not part of the plan);
//   block references to unknown blocks ("INSERT-OHNE-BLOCK") and beyond the nesting limit
//   ("INSERT-ZU-TIEF"). Per-block insertion units (BLOCK_RECORD code 70) are ignored: every
//   block is taken in the drawing's $INSUNITS [ASSUMED — the common case for exported plans].
//
// Geometry decision: ARC/CIRCLE stay true arcs ({mx, my, r, start, ende} in metres/radians,
//   counter-clockwise) as long as the placement is a similarity (uniform scale, rotation,
//   mirror); under a non-uniform block scale they become an ellipse and are resolved into a
//   polyline instead. Bulge segments of polylines are ALWAYS resolved into polyline points
//   (a polyline stays one list of points for the viewer and for comparing). Step: at most
//   BOGEN_SCHRITT per point [ASSUMED 5° — below 1 mm deviation up to r ≈ 1 m, ~1 cm at 10 m].
//
// In:  DXF file TEXT (untrusted user input), options.
// Out: {einheit, linienzuege, boegen, texte, ebenen, bbox, ignoriert, warnungen, fehler};
//      all coordinates in METRES (x east, y north as in the file). Messages as {text, werte}
//      (German template + values, fill with meldungText()). Never throws.
// Pure module: no DOM, no React, node-testable.

import { dxfPaare, meldungText } from "../plan/dxfLesen.js";

export { meldungText };

/**
 * Reader limits [ASSUMED]: a large architectural floor plan has some 10^5 primitives; beyond
 * that the tab would freeze, so reading stops loudly instead.
 * @type {Readonly<{maxBytes: number, maxElemente: number}>}
 */
export const PLAN_GRENZEN = Object.freeze({
  maxBytes: 60_000_000,   // ~60 MB DXF text [ASSUMED]
  maxElemente: 500_000,   // output primitives incl. resolved blocks [ASSUMED]
});

/** Max nesting depth of block references (INSERT in a block in a block …) — guards against cycles. [ASSUMED 8] */
export const BLOECKE_MAX_TIEFE = 8;

/** Max angle per resolved arc step, radians [ASSUMED 5°, see file head]. */
export const BOGEN_SCHRITT = Math.PI / 36;

/**
 * Metres per drawing unit for $INSUNITS (AutoCAD unit codes 1–20). 0 / missing = unitless.
 * @type {Readonly<Record<number, number>>}
 */
export const INSUNITS_METER = Object.freeze({
  1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 8: 2.54e-8, 9: 2.54e-5,
  10: 0.9144, 11: 1e-10, 12: 1e-9, 13: 1e-6, 14: 0.1, 15: 10, 16: 100, 17: 1e9,
  18: 1.495978707e11, 19: 9.4607304725808e15, 20: 3.0856776e16,
});

/**
 * German message templates ({name} = placeholder; English part file follows with the UI PR).
 * @type {Readonly<Record<string, string>>}
 */
export const PLAN_MELDUNGEN = Object.freeze({
  leer: "DXF-Datei ist leer.",
  zuGross: "DXF-Datei zu groß ({kb} kB > {max} kB).",
  binaer: "Binäres DXF wird nicht gelesen — bitte als ASCII-DXF speichern.",
  keinDxf: "Datei ist kein lesbares DXF (Gruppencode/Wert-Paare fehlen).",
  keineEntities: "DXF enthält keinen ENTITIES-Abschnitt.",
  nichtsLesbar: "DXF enthält keine lesbaren Zeichnungsobjekte.",
  unerwartet: "DXF konnte nicht gelesen werden ({grund}).",
  abgebrochen: "DXF ab Zeile {zeile} nicht lesbar (kein Gruppencode) — alles danach fehlt.",
  zuVieleElemente: "Mehr als {max} Zeichnungsobjekte — Rest nicht gelesen.",
  einheitUnbekannt: "DXF ohne Einheit ($INSUNITS) — {annahme} angenommen, bitte prüfen.",
  ignoriert: "{n} Objekt(e) nicht gelesen ({arten}).",
});

/**
 * @typedef {{x: number, y: number}} PlanPunkt point in metres
 * @typedef {{ebene: string, farbe: number, punkte: PlanPunkt[], geschlossen: boolean}} PlanLinienzug
 * @typedef {{ebene: string, farbe: number, mx: number, my: number, r: number, start: number, ende: number, kreis: boolean}} PlanBogen
 *   centre and radius in metres; start/ende in radians, counter-clockwise from start to ende
 *   (ende > start, ende - start ≤ 2π); kreis = full circle
 * @typedef {{ebene: string, farbe: number, x: number, y: number, hoehe: number, drehung: number, text: string}} PlanText
 *   insertion point and height in metres, drehung in radians (counter-clockwise from east);
 *   text = plain text, MTEXT paragraphs as "\n"
 * @typedef {{name: string, farbe: number, aus: boolean, gefroren: boolean, anzahl: number}} PlanEbene
 *   anzahl = output primitives on this layer
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} PlanBbox metres
 * @typedef {{text: string, werte?: Record<string, string|number>}} PlanMeldung
 * @typedef {{code: number, meterJeEinheit: number, angenommen: boolean}} PlanEinheit
 * @typedef {{einheit: PlanEinheit, linienzuege: PlanLinienzug[], boegen: PlanBogen[], texte: PlanText[],
 *   ebenen: PlanEbene[], bbox: PlanBbox|null, ignoriert: Record<string, number>,
 *   warnungen: PlanMeldung[], fehler: PlanMeldung|null}} Plangrundlage
 */

/** @typedef {{code: number, wert: string}} Paar */
/** @typedef {{typ: string, g: Paar[]}} Ent one entity: type + its group pairs */
/** Affine 2D map x' = a·x + c·y + e, y' = b·x + d·y + f. @typedef {{a: number, b: number, c: number, d: number, e: number, f: number}} Matrix */

/** @type {Matrix} */
const EINS = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** m2 after m1 (apply m1 first). */
function mal(/** @type {Matrix} */ m2, /** @type {Matrix} */ m1) {
  return {
    a: m2.a * m1.a + m2.c * m1.b, b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d, d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e, f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}
const pkt = (/** @type {Matrix} */ m, /** @type {number} */ x, /** @type {number} */ y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
const vek = (/** @type {Matrix} */ m, /** @type {number} */ x, /** @type {number} */ y) => ({ x: m.a * x + m.c * y, y: m.b * x + m.d * y });

const num = (/** @type {string|undefined} */ w) => { const n = Number(w); return w != null && w !== "" && Number.isFinite(n) ? n : NaN; };
/** First value of group code c, as number (NaN when missing). */
const zahl = (/** @type {Paar[]} */ g, /** @type {number} */ c) => num(g.find((p) => p.code === c)?.wert);
/** First value of group code c, as number with default. */
const zahlOder = (/** @type {Paar[]} */ g, /** @type {number} */ c, /** @type {number} */ std) => { const n = zahl(g, c); return Number.isFinite(n) ? n : std; };
const textVon = (/** @type {Paar[]} */ g, /** @type {number} */ c) => g.find((p) => p.code === c)?.wert;

/**
 * Object coordinate system of a 2D entity. Only the extrusion (0,0,±1) is planar; (0,0,-1) is
 * what CAD programs write for mirrored arcs/polylines: by the DXF "arbitrary axis algorithm"
 * its OCS x axis is world −x, y stays → mirror x. Other directions are not planar → null.
 * @param {Paar[]} g
 * @returns {Matrix|null}
 */
function ocs(g) {
  const nx = zahlOder(g, 210, 0), ny = zahlOder(g, 220, 0), nz = zahlOder(g, 230, 1);
  if (Math.abs(nx) > 1e-9 || Math.abs(ny) > 1e-9) return null;
  return nz < 0 ? { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 } : EINS;
}

/**
 * Plain text from MTEXT content: \P → line break, \~ → space, \\ \{ \} → literal, formatting
 * codes (\f…; \F…; \H…; \W…; \Q…; \T…; \A…; \C…; \c…; \p…;), toggles (\L \l \O \o \K \k),
 * stacking \S a^b; → "a/b", \U+XXXX → character, braces removed; %%c/%%d/%%p as in TEXT.
 * @param {string} roh MTEXT content (codes 3 + 1 concatenated)
 * @returns {string}
 */
export function mtextKlartext(roh) {
  let s = String(roh ?? "");
  /** @type {string[]} */
  const geschuetzt = [];
  const schuetze = (/** @type {string} */ z) => { geschuetzt.push(z); return `\uE000${geschuetzt.length - 1}\uE000`; };
  s = s.replace(/\\\\/g, () => schuetze("\\")).replace(/\\\{/g, () => schuetze("{")).replace(/\\\}/g, () => schuetze("}"));
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => schuetze(String.fromCharCode(parseInt(h, 16))));
  s = s.replace(/\\S([^;]*);/g, (_, x) => String(x).replace(/[\^#]/g, "/"));
  s = s.replace(/\\[PN]/g, "\n").replace(/\\~/g, " ");
  s = s.replace(/\\[fFHWQTACcp][^;]*;/g, "");
  s = s.replace(/\\[LlOoKkX]/g, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\(.)/g, "$1");
  s = textSonderzeichen(s);
  s = s.replace(/\uE000(\d+)\uE000/g, (_, i) => geschuetzt[Number(i)]);
  return s.split("\n").map((z) => z.trim()).join("\n").trim();
}

/** TEXT control codes: %%c Ø, %%d °, %%p ±, %%% %, %%u/%%o (underline/overline toggles) removed, %%nnn char. */
function textSonderzeichen(/** @type {string} */ s) {
  return s.replace(/%%(\d{3}|[cdpuoCDPUO%])/g, (_, k) => {
    const z = String(k).toLowerCase();
    if (z === "c") return "Ø";
    if (z === "d") return "°";
    if (z === "p") return "±";
    if (z === "%") return "%";
    if (z === "u" || z === "o") return "";
    return String.fromCharCode(Number(z));
  });
}

/**
 * Points of a bulge segment p1 → p2 (bulge = tan(sweep/4), positive = counter-clockwise),
 * WITHOUT p1, WITH p2, at most `schritt` radians apart. bulge 0 → [p2].
 * @param {PlanPunkt} p1
 * @param {PlanPunkt} p2
 * @param {number} bulge DXF code 42
 * @param {number} [schritt] radians per step
 * @returns {PlanPunkt[]}
 */
export function bulgePunkte(p1, p2, bulge, schritt = BOGEN_SCHRITT) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const sehne = Math.hypot(dx, dy);
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12 || sehne < 1e-12) return [{ x: p2.x, y: p2.y }];
  const sweep = 4 * Math.atan(bulge);
  const r = sehne / (2 * Math.abs(Math.sin(sweep / 2)));
  // Centre: from the chord midpoint perpendicular by the sagitta-complement h; side by sign of bulge.
  const h = r * Math.cos(sweep / 2) * Math.sign(bulge);
  const mx = (p1.x + p2.x) / 2 - (dy / sehne) * h, my = (p1.y + p2.y) / 2 + (dx / sehne) * h;
  const a0 = Math.atan2(p1.y - my, p1.x - mx);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / schritt));
  /** @type {PlanPunkt[]} */
  const out = [];
  for (let i = 1; i < n; i++) { const a = a0 + (sweep * i) / n; out.push({ x: mx + r * Math.cos(a), y: my + r * Math.sin(a) }); }
  out.push({ x: p2.x, y: p2.y });
  return out;
}

/**
 * Points of an arc (counter-clockwise from start to ende), both ends included.
 * @param {{mx: number, my: number, r: number, start: number, ende: number}} b radians
 * @param {number} [schritt] radians per step
 * @returns {PlanPunkt[]}
 */
export function bogenPunkte(b, schritt = BOGEN_SCHRITT) {
  const sweep = b.ende - b.start;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / schritt));
  /** @type {PlanPunkt[]} */
  const out = [];
  for (let i = 0; i <= n; i++) { const a = b.start + (sweep * i) / n; out.push({ x: b.mx + b.r * Math.cos(a), y: b.my + b.r * Math.sin(a) }); }
  return out;
}

/** Angle into [0, 2π). */
const norm = (/** @type {number} */ a) => { const t = a % (2 * Math.PI); return t < 0 ? t + 2 * Math.PI : t; };

/**
 * Groups pairs from index `start` into entities until ENDSEC/EOF (code 0 starts the next one).
 * @param {Paar[]} paare
 * @param {number} start
 * @returns {{ents: Ent[], ende: number}} ende = index of the ENDSEC pair (or paare.length)
 */
function entitaetenAb(paare, start) {
  /** @type {Ent[]} */
  const ents = [];
  /** @type {Ent|null} */
  let akt = null;
  let i = start;
  for (; i < paare.length; i++) {
    const p = paare[i];
    if (p.code === 0) {
      if (akt) ents.push(akt);
      akt = null;
      if (p.wert === "ENDSEC" || p.wert === "EOF") break;
      akt = { typ: p.wert.toUpperCase(), g: [] };
    } else if (akt) akt.g.push(p);
  }
  if (akt) ents.push(akt);
  return { ents, ende: i };
}

/**
 * Reads a DXF plan into a plan base (see file head for what is read and what is counted).
 * @param {string} text DXF file content (untrusted)
 * @param {{meterJeEinheit?: number|null, schritt?: number}} [opt]
 *   meterJeEinheit = metres per drawing unit when the file names no unit ($INSUNITS missing or
 *   0; default 1 = metres, with a warning); a unit named in the file always wins.
 *   schritt = arc resolution, radians (default BOGEN_SCHRITT)
 * @returns {Plangrundlage}
 */
export function dxfPlangrundlage(text, opt = {}) {
  try {
    return lesen(text, opt);
  } catch (e) {
    // Last line of defence: an unforeseen file shape must give a message, not a crash.
    return leeresErgebnis({ text: PLAN_MELDUNGEN.unerwartet, werte: { grund: String(/** @type {any} */ (e)?.message || e).slice(0, 200) } });
  }
}

/** @returns {Plangrundlage} */
function leeresErgebnis(/** @type {PlanMeldung|null} */ fehler) {
  return { einheit: { code: 0, meterJeEinheit: 1, angenommen: true }, linienzuege: [], boegen: [], texte: [], ebenen: [], bbox: null, ignoriert: {}, warnungen: [], fehler };
}

/**
 * @param {string} text
 * @param {{meterJeEinheit?: number|null, schritt?: number}} opt
 * @returns {Plangrundlage}
 */
function lesen(text, { meterJeEinheit = null, schritt = BOGEN_SCHRITT } = {}) {
  const s = String(text ?? "");
  if (s.length > PLAN_GRENZEN.maxBytes) {
    return leeresErgebnis({ text: PLAN_MELDUNGEN.zuGross, werte: { kb: Math.round(s.length / 1024).toLocaleString("de-DE"), max: Math.round(PLAN_GRENZEN.maxBytes / 1024).toLocaleString("de-DE") } });
  }
  const { paare, fehler, abbruchZeile } = dxfPaare(s);
  if (fehler) return leeresErgebnis({ text: PLAN_MELDUNGEN[fehler] || PLAN_MELDUNGEN.keinDxf });
  /** @type {PlanMeldung[]} */
  const warnungen = [];
  if (abbruchZeile != null) warnungen.push({ text: PLAN_MELDUNGEN.abgebrochen, werte: { zeile: abbruchZeile.toLocaleString("de-DE") } });

  // ---- sections: HEADER ($INSUNITS), TABLES (LAYER), BLOCKS, ENTITIES ----
  let insunits = 0;
  /** @type {Map<string, {name: string, farbe: number, aus: boolean, gefroren: boolean}>} */
  const layerTabelle = new Map();
  /** @type {Map<string, {bx: number, by: number, ents: Ent[]}>} */
  const bloecke = new Map();
  /** @type {Ent[]|null} */
  let entities = null;
  for (let i = 0; i < paare.length; i++) {
    if (!(paare[i].code === 0 && paare[i].wert === "SECTION" && paare[i + 1]?.code === 2)) continue;
    const name = paare[i + 1].wert.toUpperCase();
    if (name === "HEADER") {
      for (let k = i + 2; k < paare.length && !(paare[k].code === 0 && paare[k].wert === "ENDSEC"); k++) {
        if (paare[k].code === 9 && paare[k].wert === "$INSUNITS" && paare[k + 1]?.code === 70) insunits = num(paare[k + 1].wert) || 0;
      }
    } else if (name === "TABLES") {
      const { ents, ende } = entitaetenAb(paare, i + 2);
      for (const e of ents) {
        if (e.typ !== "LAYER") continue;
        const ln = textVon(e.g, 2);
        if (!ln) continue;
        const f = zahlOder(e.g, 62, 7), flags = zahlOder(e.g, 70, 0);
        // Negative colour = layer switched off (DXF reference, LAYER group 62).
        layerTabelle.set(ln.toUpperCase(), { name: ln, farbe: Math.abs(f) || 7, aus: f < 0, gefroren: (flags & 1) === 1 });
      }
      // TABLES contains several TABLE/ENDTAB runs; entitaetenAb stops at the section's ENDSEC.
      i = ende;
    } else if (name === "BLOCKS") {
      const { ents, ende } = entitaetenAb(paare, i + 2);
      /** @type {{name: string, bx: number, by: number, ents: Ent[]}|null} */
      let blk = null;
      for (const e of ents) {
        if (e.typ === "BLOCK") { blk = { name: (textVon(e.g, 2) || "").toUpperCase(), bx: zahlOder(e.g, 10, 0), by: zahlOder(e.g, 20, 0), ents: [] }; }
        else if (e.typ === "ENDBLK") { if (blk && blk.name) bloecke.set(blk.name, blk); blk = null; }
        else if (blk) blk.ents.push(e);
      }
      i = ende;
    } else if (name === "ENTITIES") {
      const { ents, ende } = entitaetenAb(paare, i + 2);
      entities = ents;
      i = ende;
    }
  }
  if (!entities) return { ...leeresErgebnis({ text: PLAN_MELDUNGEN.keineEntities }), warnungen };

  const einheitBekannt = Number.isFinite(INSUNITS_METER[insunits]);
  const faktor = einheitBekannt ? INSUNITS_METER[insunits]
    : (Number.isFinite(meterJeEinheit) && /** @type {number} */ (meterJeEinheit) > 0 ? /** @type {number} */ (meterJeEinheit) : 1);
  /** @type {PlanEinheit} */
  const einheit = { code: insunits, meterJeEinheit: faktor, angenommen: !einheitBekannt };
  if (!einheitBekannt) warnungen.push({ text: PLAN_MELDUNGEN.einheitUnbekannt, werte: { annahme: faktor === 1 ? "Meter" : `${faktor.toLocaleString("de-DE")} m je Einheit` } });

  /** @type {PlanLinienzug[]} */
  const linienzuege = [];
  /** @type {PlanBogen[]} */
  const boegen = [];
  /** @type {PlanText[]} */
  const texte = [];
  /** @type {Record<string, number>} */
  const ignoriert = {};
  /** @type {Map<string, number>} */
  const ebenenZahl = new Map();
  let anzahl = 0, voll = false;
  const zaehleIgnoriert = (/** @type {string} */ art) => { ignoriert[art] = (ignoriert[art] || 0) + 1; };
  /** Room for one more primitive? Sets `voll` once the limit is reached. */
  const platz = () => { if (anzahl >= PLAN_GRENZEN.maxElemente) { voll = true; return false; } anzahl++; return true; };
  const ebeneZaehlen = (/** @type {string} */ eb) => ebenenZahl.set(eb, (ebenenZahl.get(eb) || 0) + 1);

  /**
   * Colour of an entity: 62 missing/256 = BYLAYER, 0 = BYBLOCK (the INSERT's colour, 7 at top
   * level), 1–255 = ACI. BYLAYER resolves through the LAYER table (7 for a layer not in it).
   */
  const farbeVon = (/** @type {Paar[]} */ g, /** @type {string} */ eb, /** @type {number} */ blockFarbe) => {
    const f = Math.abs(zahlOder(g, 62, 256));
    if (f === 0) return blockFarbe;
    if (f >= 1 && f <= 255) return f;
    return layerTabelle.get(eb.toUpperCase())?.farbe ?? 7;
  };

  /**
   * Context of one level of block resolution.
   * @typedef {{m: Matrix, ebene0: string|null, farbe0: number, tiefe: number}} Kontext
   *   m = drawing units → metres incl. all INSERT placements; ebene0/farbe0 = layer/colour of
   *   the enclosing INSERT (null/7 at top level)
   */

  /**
   * Handles one list of entities (ENTITIES section or a block body).
   * @param {Ent[]} ents
   * @param {Kontext} kx
   * @param {Set<string>} kette names of the blocks currently being resolved (cycle guard)
   */
  const verarbeiten = (ents, kx, kette) => {
    for (let i = 0; i < ents.length && !voll; i++) {
      const e = ents[i];
      const g = e.g;
      if (e.typ === "VERTEX" || e.typ === "SEQEND" || e.typ === "ATTDEF") {
        // ATTDEF = attribute template inside a block definition (not drawn); VERTEX/SEQEND are
        // consumed by their POLYLINE/INSERT; a stray one carries no geometry of its own.
        continue;
      }
      if (kx.tiefe === 0 && zahlOder(g, 67, 0) === 1) {
        zaehleIgnoriert("PAPIERBEREICH");
        if (e.typ === "POLYLINE" || (e.typ === "INSERT" && zahlOder(g, 66, 0) === 1)) i = folgeUeberspringen(ents, i);
        continue;
      }
      const ebRoh = textVon(g, 8) || "0";
      // Layer "0" inside a block takes the layer of the INSERT (DXF convention).
      const eb = ebRoh === "0" && kx.ebene0 ? kx.ebene0 : ebRoh;
      const farbe = farbeVon(g, eb, kx.farbe0);

      if (e.typ === "LINE") {
        const a = pkt(kx.m, zahl(g, 10), zahl(g, 20)), b = pkt(kx.m, zahl(g, 11), zahl(g, 21));
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) { zaehleIgnoriert("LINE-UNGUELTIG"); continue; }
        if (!platz()) break;
        linienzuege.push({ ebene: eb, farbe, punkte: [a, b], geschlossen: false });
        ebeneZaehlen(eb);
      } else if (e.typ === "LWPOLYLINE") {
        const o = ocs(g);
        if (!o) { zaehleIgnoriert("LWPOLYLINE-3D"); continue; }
        /** @type {Array<{x: number, y: number, bulge: number}>} */
        const roh = [];
        for (const p of g) {
          if (p.code === 10) roh.push({ x: num(p.wert), y: NaN, bulge: 0 });
          else if (p.code === 20 && roh.length) roh[roh.length - 1].y = num(p.wert);
          else if (p.code === 42 && roh.length) roh[roh.length - 1].bulge = num(p.wert) || 0;
        }
        if (!polylinieAusgeben(roh, (zahlOder(g, 70, 0) & 1) === 1, mal(kx.m, o), eb, farbe)) break;
      } else if (e.typ === "POLYLINE") {
        const flags = zahlOder(g, 70, 0);
        /** @type {Array<{x: number, y: number, bulge: number}>} */
        const roh = [];
        let k = i + 1;
        for (; k < ents.length && ents[k].typ === "VERTEX"; k++) {
          const v = ents[k].g;
          if (zahlOder(v, 70, 0) & (16 | 128)) continue; // spline frame point / polyface face record
          roh.push({ x: zahl(v, 10), y: zahl(v, 20), bulge: zahlOder(v, 42, 0) });
        }
        i = ents[k]?.typ === "SEQEND" ? k : k - 1;
        if (flags & (16 | 64)) { zaehleIgnoriert("POLYLINE-NETZ"); continue; }
        // 3D polylines (flag 8) are in world coordinates, 2D ones in the OCS.
        const o = flags & 8 ? EINS : ocs(g);
        if (!o) { zaehleIgnoriert("POLYLINE-3D"); continue; }
        if (!polylinieAusgeben(roh, (flags & 1) === 1, mal(kx.m, o), eb, farbe)) break;
      } else if (e.typ === "ARC" || e.typ === "CIRCLE") {
        const o = ocs(g);
        const mx = zahl(g, 10), my = zahl(g, 20), r = zahl(g, 40);
        if (!o || ![mx, my, r].every(Number.isFinite) || r <= 0) { zaehleIgnoriert(`${e.typ}-UNGUELTIG`); continue; }
        const kreis = e.typ === "CIRCLE";
        // DXF angles are degrees, counter-clockwise in the OCS.
        const a0 = kreis ? 0 : (zahlOder(g, 50, 0) * Math.PI) / 180;
        let a1 = kreis ? 2 * Math.PI : (zahlOder(g, 51, 360) * Math.PI) / 180;
        if (!kreis) { a1 = norm(a1 - a0); if (a1 < 1e-12) a1 = 2 * Math.PI; a1 += a0; }
        if (!bogenAusgeben({ mx, my, r, start: a0, ende: a1 }, kreis, mal(kx.m, o), eb, farbe)) break;
      } else if (e.typ === "TEXT" || e.typ === "MTEXT" || e.typ === "ATTRIB") {
        if (e.typ === "ATTRIB" && (zahlOder(g, 70, 0) & 1)) continue; // invisible attribute
        const t = textLesen(e.typ, g);
        if (!t) { zaehleIgnoriert(`${e.typ}-LEER`); continue; }
        // TEXT/ATTRIB are in the OCS, MTEXT in world coordinates.
        const o = e.typ === "MTEXT" ? EINS : ocs(g);
        if (!o) { zaehleIgnoriert(`${e.typ}-3D`); continue; }
        const m = mal(kx.m, o);
        const p = pkt(m, t.x, t.y);
        const u = vek(m, Math.cos(t.drehung), Math.sin(t.drehung));
        const v = vek(m, -Math.sin(t.drehung), Math.cos(t.drehung));
        if (!platz()) break;
        texte.push({ ebene: eb, farbe, x: p.x, y: p.y, hoehe: t.hoehe * Math.hypot(v.x, v.y), drehung: norm(Math.atan2(u.y, u.x)), text: t.text });
        ebeneZaehlen(eb);
      } else if (e.typ === "INSERT") {
        const mitAttributen = zahlOder(g, 66, 0) === 1;
        const ende = mitAttributen ? folgeUeberspringen(ents, i) : i;
        insertAufloesen(g, eb, farbe, kx, kette);
        // ATTRIB values following the INSERT are already placed in the INSERT's coordinates
        // (world at top level, the enclosing block's system inside a block).
        if (mitAttributen) verarbeiten(ents.slice(i + 1, ende + 1).filter((x) => x.typ === "ATTRIB"), { ...kx, ebene0: eb === "0" ? kx.ebene0 : eb, farbe0: farbe }, kette);
        i = ende;
      } else {
        zaehleIgnoriert(e.typ);
      }
    }
  };

  /** Index of the SEQEND that closes the run starting after index i (or the last VERTEX/ATTRIB). */
  const folgeUeberspringen = (/** @type {Ent[]} */ ents, /** @type {number} */ i) => {
    let k = i + 1;
    while (k < ents.length && (ents[k].typ === "VERTEX" || ents[k].typ === "ATTRIB")) k++;
    return ents[k]?.typ === "SEQEND" ? k : k - 1;
  };

  /**
   * Resolves an INSERT (and MINSERT grid): block entities are placed by
   * world = m · T(insert) · R(rotation) · S(sx, sy) · T(−base).
   */
  const insertAufloesen = (/** @type {Paar[]} */ g, /** @type {string} */ eb, /** @type {number} */ farbe, /** @type {Kontext} */ kx, /** @type {Set<string>} */ kette) => {
    const name = (textVon(g, 2) || "").toUpperCase();
    const blk = bloecke.get(name);
    if (!blk) { zaehleIgnoriert("INSERT-OHNE-BLOCK"); return; }
    if (kx.tiefe + 1 > BLOECKE_MAX_TIEFE || kette.has(name)) { zaehleIgnoriert("INSERT-ZU-TIEF"); return; }
    const o = ocs(g);
    if (!o) { zaehleIgnoriert("INSERT-3D"); return; }
    const ix = zahlOder(g, 10, 0), iy = zahlOder(g, 20, 0);
    const sx = zahlOder(g, 41, 1), sy = zahlOder(g, 42, 1);
    const rot = (zahlOder(g, 50, 0) * Math.PI) / 180;
    const spalten = Math.max(1, Math.min(10_000, Math.round(zahlOder(g, 70, 1)))), zeilen = Math.max(1, Math.min(10_000, Math.round(zahlOder(g, 71, 1))));
    const ds = zahlOder(g, 44, 0), dz = zahlOder(g, 45, 0);
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const neu = new Set(kette); neu.add(name);
    for (let r = 0; r < zeilen && !voll; r++) {
      for (let c = 0; c < spalten && !voll; c++) {
        // MINSERT spacing runs along the rotated block axes.
        const ox = c * ds, oy = r * dz;
        const tx = ix + cos * ox - sin * oy, ty = iy + sin * ox + cos * oy;
        /** @type {Matrix} */
        const platzierung = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: 0, f: 0 };
        platzierung.e = tx - (platzierung.a * blk.bx + platzierung.c * blk.by);
        platzierung.f = ty - (platzierung.b * blk.bx + platzierung.d * blk.by);
        verarbeiten(blk.ents, { m: mal(kx.m, mal(o, platzierung)), ebene0: eb, farbe0: farbe, tiefe: kx.tiefe + 1 }, neu);
      }
    }
  };

  /**
   * Polyline with bulges → one point list in metres. Invalid vertices are dropped.
   * @returns {boolean} false when the element limit is reached
   */
  const polylinieAusgeben = (/** @type {Array<{x: number, y: number, bulge: number}>} */ roh, /** @type {boolean} */ geschlossen, /** @type {Matrix} */ m, /** @type {string} */ eb, /** @type {number} */ farbe) => {
    const v = roh.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (v.length < 2) { zaehleIgnoriert("POLYLINIE-UNGUELTIG"); return true; }
    // Bulges are resolved in drawing units BEFORE the placement, so a non-uniform block scale
    // turns the arc into the correct ellipse-like curve.
    /** @type {PlanPunkt[]} */
    const lokal = [{ x: v[0].x, y: v[0].y }];
    const n = geschlossen ? v.length : v.length - 1;
    for (let k = 0; k < n; k++) {
      const a = v[k], b = v[(k + 1) % v.length];
      lokal.push(...bulgePunkte(a, b, a.bulge, schritt));
    }
    if (geschlossen) lokal.pop(); // the closing point is the first point again
    if (!platz()) return false;
    linienzuege.push({ ebene: eb, farbe, punkte: lokal.map((p) => pkt(m, p.x, p.y)), geschlossen });
    ebeneZaehlen(eb);
    return true;
  };

  /**
   * Arc under a placement: stays an arc for a similarity (also mirrored), becomes a polyline
   * for a non-uniform scale.
   * @returns {boolean} false when the element limit is reached
   */
  const bogenAusgeben = (/** @type {{mx: number, my: number, r: number, start: number, ende: number}} */ b, /** @type {boolean} */ kreis, /** @type {Matrix} */ m, /** @type {string} */ eb, /** @type {number} */ farbe) => {
    const lx = Math.hypot(m.a, m.b), ly = Math.hypot(m.c, m.d);
    const det = m.a * m.d - m.b * m.c;
    const orthogonal = Math.abs(m.a * m.c + m.b * m.d) <= 1e-9 * Math.max(1, lx * ly);
    if (!platz()) return false;
    ebeneZaehlen(eb);
    if (orthogonal && Math.abs(lx - ly) <= 1e-9 * Math.max(1, lx) && lx > 0) {
      const c = pkt(m, b.mx, b.my);
      const phi = Math.atan2(m.b, m.a);
      // Rotation: angles + φ. Mirror (det < 0): m = s·R(φ)·diag(1,−1), an angle θ maps to φ − θ,
      // so the counter-clockwise arc start..ende becomes φ−ende .. φ−start.
      const s0 = det >= 0 ? phi + b.start : phi - b.ende;
      const sweep = b.ende - b.start;
      const start = kreis ? 0 : norm(s0);
      boegen.push({ ebene: eb, farbe, mx: c.x, my: c.y, r: b.r * lx, start, ende: kreis ? 2 * Math.PI : start + sweep, kreis });
      return true;
    }
    const pts = bogenPunkte(b, schritt);
    if (kreis) pts.pop();
    linienzuege.push({ ebene: eb, farbe, punkte: pts.map((p) => pkt(m, p.x, p.y)), geschlossen: kreis });
    return true;
  };

  verarbeiten(entities, { m: { a: faktor, b: 0, c: 0, d: faktor, e: 0, f: 0 }, ebene0: null, farbe0: 7, tiefe: 0 }, new Set());
  if (voll) warnungen.push({ text: PLAN_MELDUNGEN.zuVieleElemente, werte: { max: PLAN_GRENZEN.maxElemente.toLocaleString("de-DE") } });
  const arten = Object.keys(ignoriert).sort();
  if (arten.length) warnungen.push({ text: PLAN_MELDUNGEN.ignoriert, werte: { n: arten.reduce((s, k) => s + ignoriert[k], 0), arten: arten.join(", ") } });

  // ---- layer list: every layer of the table plus every layer used ----
  /** @type {Map<string, PlanEbene>} */
  const ebenen = new Map();
  for (const l of layerTabelle.values()) ebenen.set(l.name.toUpperCase(), { ...l, anzahl: 0 });
  for (const [name, n] of ebenenZahl) {
    const k = name.toUpperCase();
    const vorh = ebenen.get(k);
    if (vorh) vorh.anzahl += n;
    else ebenen.set(k, { name, farbe: 7, aus: false, gefroren: false, anzahl: n });
  }

  const ergebnis = {
    einheit, linienzuege, boegen, texte,
    ebenen: [...ebenen.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bbox: planBbox({ linienzuege, boegen, texte }),
    ignoriert, warnungen,
    fehler: /** @type {PlanMeldung|null} */ (null),
  };
  if (!linienzuege.length && !boegen.length && !texte.length) ergebnis.fehler = { text: PLAN_MELDUNGEN.nichtsLesbar };
  return ergebnis;
}

/**
 * Reads TEXT / MTEXT / ATTRIB geometry in entity coordinates.
 * @param {string} typ
 * @param {Paar[]} g
 * @returns {{x: number, y: number, hoehe: number, drehung: number, text: string}|null} drehung radians
 */
function textLesen(typ, g) {
  let x = zahl(g, 10), y = zahl(g, 20);
  let drehung = (zahlOder(g, 50, 0) * Math.PI) / 180;
  let inhalt;
  if (typ === "MTEXT") {
    // MTEXT direction: x axis vector 11/21 wins over the angle 50 (DXF reference).
    const ux = zahl(g, 11), uy = zahl(g, 21);
    if (Number.isFinite(ux) && Number.isFinite(uy) && (ux || uy)) drehung = Math.atan2(uy, ux);
    inhalt = mtextKlartext(g.filter((q) => q.code === 3 || q.code === 1).map((q) => q.wert).join(""));
  } else {
    // TEXT/ATTRIB with an alignment (72/73/74 ≠ 0) is placed by its alignment point 11/21.
    const ausgerichtet = (zahlOder(g, 72, 0) || zahlOder(g, typ === "ATTRIB" ? 74 : 73, 0)) && Number.isFinite(zahl(g, 11));
    if (ausgerichtet) { x = zahl(g, 11); y = zahl(g, 21); }
    inhalt = textSonderzeichen(textVon(g, 1) || "").trim();
  }
  if (!inhalt || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, hoehe: zahlOder(g, 40, 0), drehung, text: inhalt };
}

/**
 * Bounding box of a plan base (polyline points, full arc extents, text insertion points).
 * @param {{linienzuege?: PlanLinienzug[], boegen?: PlanBogen[], texte?: PlanText[]}} plan metres
 * @returns {PlanBbox|null} null when there is no geometry
 */
export function planBbox(plan) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const nimm = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const l of plan.linienzuege || []) for (const p of l.punkte) nimm(p.x, p.y);
  for (const b of plan.boegen || []) {
    nimm(b.mx + b.r * Math.cos(b.start), b.my + b.r * Math.sin(b.start));
    nimm(b.mx + b.r * Math.cos(b.ende), b.my + b.r * Math.sin(b.ende));
    // Axis extremes (0, 90, 180, 270°) that lie on the arc.
    for (let k = Math.ceil(b.start / (Math.PI / 2) - 1e-12); k * (Math.PI / 2) <= b.ende + 1e-12; k++) {
      const a = k * (Math.PI / 2);
      nimm(b.mx + b.r * Math.cos(a), b.my + b.r * Math.sin(a));
    }
  }
  for (const t of plan.texte || []) nimm(t.x, t.y);
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/**
 * Area of a bounding box, m² (0 for null).
 * @param {PlanBbox|null|undefined} b
 * @returns {number}
 */
export function bboxFlaeche(b) {
  return b ? Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY) : 0;
}
