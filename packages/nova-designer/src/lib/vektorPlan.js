// Vector floor plan at TRUE scale (phase 97-09). Before, "Aktuellen Plan als PDF" rasterised the
// screen SVG to PNG and stretched it to the sheet while printing "Maßstab 1:100" — the printed
// scale was not true (a real risk: somebody measures off the paper). Now the plan is built from
// the model data in metres and drawn as vector paths with pdf-lib at the chosen scale; the sheet
// is the smallest DIN A format the drawing fits on, the title block names lens, scale, format and
// the status legend of the lens.
//
// Line weights after ISO 128-23 / DIN 1356-1, line group 0.5 at 1:100 and 0.7 at 1:50: cut edges
// = group width, visible edges = half, thin lines = quarter (mm on paper).
//
// In:  plan data (model, level, drawn elements already filtered by the lens), lens, hull status.
// Out: planGrafik() / schnittGrafik() (100-01, section with level marks) → primitives in metres;
//      blattLayout() → sheet and origin in mm;
//      vektorPlanPdf() → PDF bytes (Uint8Array). Pure apart from pdf-lib; node-testable.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { wandGeometrie, huellSchnittWaende } from "@core/lib/bauteil/referenz.js";
import { deckenLage, geschossHoeheAusModell } from "@core/lib/bauteil/hoehen.js"; // 107-02: slab thickness and side from the slab (default 0.25 m standing on its plane)
import { planDarstellung, schraffur45 } from "@core/lib/plan/brillen.js";
import { statusFarbe, STATUS_DARSTELLUNG } from "@core/lib/plan/statusDarstellung.js";

/** 1 mm in PDF points. */
const PT = 72 / 25.4;
/**
 * DIN EN ISO 216 sheets in mm (landscape: width ≥ height).
 * @type {ReadonlyArray<[string, number, number]>}
 */
export const BLAETTER = Object.freeze([["A3", 420, 297], ["A2", 594, 420], ["A1", 841, 594], ["A0", 1189, 841]]);
/** Sheet margin (DIN 824 fold edge 20 mm left, 10 mm elsewhere) and title block height in mm [ASSUMED]. */
const RAND = { links: 20, sonst: 10, kopfH: 46, kopfB: 180 };

/**
 * Line widths in mm on paper for a scale (ISO 128-23 line groups).
 * @param {number} massstab denominator
 * @returns {{schnitt: number, ansicht: number, duenn: number}}
 */
export function linienGruppe(massstab) {
  const g = massstab <= 50 ? 0.7 : 0.5;
  return { schnitt: g, ansicht: g / 2, duenn: g / 4 };
}

/** Wall as a four-point polygon (m), same geometry as the screen plan (BimPlan2D wallRectXZ) — 107-01: one derivation in @core. */
function wandPolygon(w) {
  return wandGeometrie(w).polygon;
}

/** Poché of a cut wall without status (architects' plan: dark grey, not black). */
const POCHE = "#3f3f46";

/**
 * Plan primitives in metres for one storey.
 * @param {{model: any, level: number, customWalls?: any[], customColumns?: any[], customSlabs?: any[], customRoofs?: any[], customZones?: any[], brille?: any, huelleStatus?: string|null, massstab?: number, sw?: boolean, layerVis?: Record<string, boolean>|null, werkstattWaende?: any[]|null}} e
 * layerVis: the plan's layer switches (BitBimStudio DEFAULT_LAYERS ids; missing = visible) — the
 * export prints what the screen shows (before 22.10.2026 a hidden layer was printed anyway).
 * werkstattWaende: workshop walls ({a, b, dicke_m, level, huelle, status}); drawn like on screen
 * (BimPlan2D) — only those with a decided status, never the hull.
 * Every element carries `ebene` (104-06, additive): the drawing layer it belongs to —
 * "wand" | "stuetze" | "decke" | "dach" | "schraffur" | "raum_text" — read by the DXF export.
 * @returns {{elemente: Array<{art: 'poly', pts: Array<{x: number, z: number}>, fill: string|null, stroke: string, breite_mm: number, dash?: string, deckkraft?: number, offen?: boolean, ebene?: string} | {art: 'text', x: number, z: number, text: string, groesse_mm: number, ebene?: string, ausrichtung?: 'links'|'rechts'}>, bbox: {x0: number, z0: number, x1: number, z1: number}|null}}
 */
export function planGrafik({ model, level, customWalls = [], customColumns = [], customSlabs = [], customRoofs = [], customZones = [], brille = null, huelleStatus = null, massstab = 100, sw = false, layerVis = null, werkstattWaende = null }) {
  const lg = linienGruppe(massstab);
  // Same layer mapping as BimPlan2D: shell = hull walls + slabs, attika = roofs, walls = drawn and
  // workshop walls, columns, zones = room labels.
  const zeige = (/** @type {string} */ id) => !layerVis || layerVis[id] !== false;
  /** @type {any[]} */
  const el = [];
  const auf = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => (x.level || 0) === level);
  const poly = (pts, status, { schnitt = true, fill = POCHE, ebene = "wand" } = {}) => {
    const lk = planDarstellung(brille, status, { sw });
    el.push({ art: "poly", pts, fill: lk?.leer ? null : lk ? lk.fill : fill, stroke: lk ? lk.stroke : "#18181b", breite_mm: schnitt ? lg.schnitt : lg.ansicht, dash: lk?.dash, deckkraft: lk?.opacity ?? 1, ebene });
    // 97-04b: S/W new build — 45° hatch, 2 mm apart on paper [ASSUMED usual spacing].
    if (lk?.schraffur) for (const [p, q] of schraffur45(pts, (2 * massstab) / 1000)) el.push({ art: "poly", pts: [p, q], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "schraffur" });
  };
  if (zeige("shell")) for (const s of auf(customSlabs)) if (s.points?.length >= 3) el.push({ art: "poly", pts: s.points, fill: null, stroke: "#71717a", breite_mm: lg.duenn, dash: "4 2", ebene: "decke" });
  if (zeige("attika")) for (const r of auf(customRoofs)) if (r.points?.length >= 3) el.push({ art: "poly", pts: r.points, fill: null, stroke: "#71717a", breite_mm: lg.duenn, dash: "6 2 1 2", ebene: "dach" });
  if (zeige("shell")) for (const w of (model?.walls || []).filter((w) => w.level === level)) poly(wandPolygon(w), huelleStatus);
  if (zeige("walls")) {
    for (const w of auf(customWalls)) if (w.a && w.b) poly(wandPolygon(w), w.status);
    for (const w of auf(werkstattWaende)) {
      if (w.huelle || !w.a || !w.b || !planDarstellung(brille, w.status, { sw })) continue;
      poly(wandPolygon({ ...w, thickness: w.dicke_m }), w.status);
    }
  }
  if (zeige("columns")) for (const c of auf(customColumns)) {
    const h = (c.size || 0.4) / 2;
    poly([{ x: c.x - h, z: c.z - h }, { x: c.x + h, z: c.z - h }, { x: c.x + h, z: c.z + h }, { x: c.x - h, z: c.z + h }], c.status, { ebene: "stuetze" });
  }
  if (zeige("zones")) for (const z of auf(customZones)) {
    if (!(z.points?.length >= 3)) continue;
    const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length, cz = z.points.reduce((s, p) => s + p.z, 0) / z.points.length;
    const a = Math.abs(z.points.reduce((s, p, i) => { const q = z.points[(i + 1) % z.points.length]; return s + (p.x * q.z - q.x * p.z); }, 0) / 2);
    el.push({ art: "text", x: cx, z: cz, text: `${String(z.name || "Raum").replace(/ ·WT$/, "")}  ${a.toFixed(2).replace(".", ",")} m²`, groesse_mm: 2.5, ebene: "raum_text" });
  }
  const pts = el.flatMap((e) => (e.art === "poly" ? e.pts : [{ x: e.x, z: e.z }]));
  // Loop instead of Math.min(...): hatched plans can exceed the argument limit of a spread call.
  let bbox = null;
  for (const p of pts) {
    if (!bbox) bbox = { x0: p.x, z0: p.z, x1: p.x, z1: p.z };
    else {
      if (p.x < bbox.x0) bbox.x0 = p.x;
      if (p.z < bbox.z0) bbox.z0 = p.z;
      if (p.x > bbox.x1) bbox.x1 = p.x;
      if (p.z > bbox.z1) bbox.z1 = p.z;
    }
  }
  return { elemente: el, bbox };
}

/** German decimal with sign for level marks: 0 → "±0,00", 3 → "+3,00", -2.5 → "-2,50". */
export function koteText(m) {
  const r = Math.round(m * 100) / 100;
  if (r === 0) return "±0,00";
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(2).replace(".", ",")}`;
}

/**
 * Section primitives in metres (100-01) — the same cut as the screen section (BimPlan2D `Schnitt`, cut at
 * z = 0 across the footprint): side walls of the hull with the lens look, slabs, parapet, the windows of
 * the back wall in elevation, plus level marks after DIN 1356-1 (filled triangle = carcass level
 * [ASSUMED: model elevations are structural levels], value ±0,00 / +3,00 m) and dimension lines. The
 * vertical axis is stored as z = -height so vektorPlanPdf (y down) draws it upright without a second path.
 * @param {{model: any, storeyHeight?: number, layerVis?: Record<string, boolean>|null, brille?: any, huelleStatus?: string|null, sw?: boolean, massstab?: number}} e
 * @returns {ReturnType<typeof planGrafik>}
 */
export function schnittGrafik({ model, storeyHeight = 3, layerVis = null, brille = null, huelleStatus = null, sw = false, massstab = 100 }) {
  const lg = linienGruppe(massstab);
  const zeige = (/** @type {string} */ id) => !layerVis || layerVis[id] !== false;
  const k = massstab / 1000; // metres per mm on paper
  /** @type {any[]} */
  const el = [];
  const fp = Array.isArray(model?.footprint) ? model.footprint : [];
  if (fp.length < 3) return { elemente: [], bbox: null };
  const x0 = Math.min(...fp.map((p) => p.x)), x1 = Math.max(...fp.map((p) => p.x));
  const totalH = model.totalHeight || 0;
  const paraH = zeige("attika") ? (model.parapetHeight || 0) : 0;
  // 107-01: the cut side walls come from the one derivation of @core (it follows the hull reference line `huelle_bezug`)
  const schnittWaende = huellSchnittWaende(model);
  const Z = (h) => 0 - h; // 0 - 0 is +0 (no "-0" in the output)
  const rechteck = (xa, xb, ha, hb) => [{ x: xa, z: Z(ha) }, { x: xb, z: Z(ha) }, { x: xb, z: Z(hb) }, { x: xa, z: Z(hb) }];
  const linie = (pts, breite_mm, ebene, dash) => el.push({ art: "poly", pts, fill: null, stroke: "#18181b", breite_mm, dash, offen: true, ebene });
  const geschnitten = (pts, status, ebene) => {
    const lk = status != null ? planDarstellung(brille, status, { sw }) : null;
    el.push({ art: "poly", pts, fill: lk?.leer ? null : lk ? lk.fill : POCHE, stroke: lk ? lk.stroke : "#18181b", breite_mm: lg.schnitt, dash: lk?.dash, deckkraft: lk?.opacity ?? 1, ebene });
    if (lk?.schraffur) for (const [p, q] of schraffur45(pts, 2 * k)) linie([p, q], lg.duenn, "schraffur");
  };

  // Ground line 3 m beyond the building on both sides (Ansicht weight).
  linie([{ x: x0 - 3, z: 0 }, { x: x1 + 3, z: 0 }], lg.ansicht, "gelaende");
  if (zeige("shell")) {
    for (const s of model.slabs || []) { const lage = deckenLage(s, undefined, "huelle"); geschnitten(rechteck(x0, x1, lage.unterkante_m, lage.oberkante_m), null, "decke"); }
    for (const s of schnittWaende) geschnitten(rechteck(s.von_m, s.bis_m, 0, totalH), huelleStatus, "wand");
  }
  if (paraH > 0) for (const s of schnittWaende) geschnitten(rechteck(s.von_m, s.bis_m, totalH, totalH + paraH), null, "dach");
  // Windows of the back wall seen in elevation — same rule as the screen and the 3D view (~1 per 3.5 m,
  // sill 0.90 m, height 1.40 m, width 1.40 m [ASSUMED like BimPlan2D windowsAlong]).
  if (zeige("openings")) for (const st of model.storeys || []) {
    const back = (model.walls || []).find((w) => w.level === st.level);
    if (!back) continue;
    const len = Math.hypot(back.b.x - back.a.x, back.b.z - back.a.z);
    const n = Math.max(0, Math.floor(len / 3.5));
    for (let i = 0; i < n; i += 1) {
      const cx = back.a.x + (back.b.x - back.a.x) * ((i + 0.5) / n);
      if (cx < x0 || cx > x1) continue;
      el.push({ art: "poly", pts: rechteck(cx - 0.7, cx + 0.7, st.elevation + 0.9, st.elevation + 2.3), fill: null, stroke: "#18181b", breite_mm: lg.ansicht, ebene: "oeffnung" });
    }
  }
  // Level marks left of the building: reference line, filled triangle with its tip on the level, value.
  if (zeige("labels")) {
    const xs = x0 - 14 * k, b = 1.6 * k, h = 2.4 * k;
    const kote = (hoehe, text) => {
      // reference line from the triangle's tip to the building; the value sits left of the triangle, above the line
      linie([{ x: xs, z: Z(hoehe) }, { x: x0, z: Z(hoehe) }], lg.duenn, "kote", "4 2");
      el.push({ art: "poly", pts: [{ x: xs, z: Z(hoehe) }, { x: xs - b, z: Z(hoehe + h) }, { x: xs + b, z: Z(hoehe + h) }], fill: "#18181b", stroke: "#18181b", breite_mm: lg.duenn, ebene: "kote" });
      el.push({ art: "text", x: xs - b - 1 * k, z: Z(hoehe + 1.6 * k), text, groesse_mm: 2.5, ausrichtung: "rechts", ebene: "kote" });
    };
    for (const st of model.storeys || []) kote(st.elevation, `${koteText(st.elevation)}  ${st.name || ""}`.trim());
    kote(totalH, `${koteText(totalH)}  OK Dach`);
    if (paraH > 0) kote(totalH + paraH, `${koteText(totalH + paraH)}  OK Attika`);
  }
  // Dimension lines (DIN 406: oblique ticks): storey height on the right, building width below.
  if (zeige("dimensions")) {
    const t = 1.2 * k;
    const masslinie = (a, b2, text, tx, tz, ausrichtung) => {
      linie([a, b2], lg.duenn, "bemassung");
      for (const p of [a, b2]) linie([{ x: p.x - t, z: p.z + t }, { x: p.x + t, z: p.z - t }], lg.ansicht, "bemassung");
      el.push({ art: "text", x: tx, z: tz, text, groesse_mm: 2.5, ausrichtung, ebene: "bemassung" });
    };
    const xr = x1 + 8 * k;
    // 107-02 review fix: height of the ground floor from the model (as the level marks), not the uniform `storeyHeight` (differs with a storey table)
    const egHoehe = geschossHoeheAusModell(model) || storeyHeight;
    masslinie({ x: xr, z: Z(0) }, { x: xr, z: Z(egHoehe) }, `${egHoehe.toFixed(2).replace(".", ",")}`, xr + 2 * k, Z(egHoehe / 2), "links");
    const zu = 8 * k;
    masslinie({ x: x0, z: zu }, { x: x1, z: zu }, `${(x1 - x0).toFixed(2).replace(".", ",")}`, (x0 + x1) / 2, zu - 2.2 * k, undefined);
  }
  // Text extent estimated as 0.55 × font size per character (Helvetica average) so no label leaves the sheet.
  const ausdehnung = (e) => {
    if (e.art === "poly") return e.pts;
    const w = String(e.text).length * 0.55 * e.groesse_mm * k;
    const xa = e.ausrichtung === "rechts" ? e.x - w : e.ausrichtung === "links" ? e.x : e.x - w / 2;
    return [{ x: xa, z: e.z - e.groesse_mm * k }, { x: xa + w, z: e.z }];
  };
  let bbox = null;
  for (const e of el) for (const p of ausdehnung(e)) {
    if (!bbox) bbox = { x0: p.x, z0: p.z, x1: p.x, z1: p.z };
    else { bbox.x0 = Math.min(bbox.x0, p.x); bbox.z0 = Math.min(bbox.z0, p.z); bbox.x1 = Math.max(bbox.x1, p.x); bbox.z1 = Math.max(bbox.z1, p.z); }
  }
  return { elemente: el, bbox };
}

/**
 * Smallest landscape DIN sheet the drawing fits on at the scale (with margins and title block
 * below the drawing), and the origin of the drawing in mm from the sheet's top-left corner.
 * @param {{x0: number, z0: number, x1: number, z1: number}} bbox metres
 * @param {number} massstab denominator
 * @returns {{format: string, breite_mm: number, hoehe_mm: number, zeichnung_mm: {b: number, h: number}, ursprung_mm: {x: number, y: number}}}
 * @throws when the drawing does not fit on A0 at this scale
 */
export function blattLayout(bbox, massstab) {
  const b = ((bbox.x1 - bbox.x0) * 1000) / massstab, h = ((bbox.z1 - bbox.z0) * 1000) / massstab;
  for (const [format, bw, bh] of BLAETTER) {
    const freiB = bw - RAND.links - RAND.sonst, freiH = bh - 2 * RAND.sonst - RAND.kopfH - 8;
    if (b <= freiB && h <= freiH) {
      return { format, breite_mm: bw, hoehe_mm: bh, zeichnung_mm: { b, h },
        ursprung_mm: { x: RAND.links + (freiB - b) / 2, y: RAND.sonst + (freiH - h) / 2 } };
    }
  }
  throw new Error(`Plan passt bei 1:${massstab} nicht auf A0 (${Math.round(b)} × ${Math.round(h)} mm) — kleineren Maßstab wählen.`);
}

const farbe = (hex) => { const n = parseInt(String(hex).slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

/**
 * PDF with the plan at true scale and a title block.
 * @param {ReturnType<typeof planGrafik>} grafik
 * @param {{massstab: number, projekt?: string, planinhalt?: string, brille?: any, plannummer?: string, datum?: string}} kopf
 * @returns {Promise<{bytes: Uint8Array, format: string}>}
 */
export async function vektorPlanPdf(grafik, { massstab, projekt = "", planinhalt = "", brille = null, plannummer = "", datum = "" }) {
  if (!grafik.bbox) throw new Error("Keine Zeichnung auf diesem Geschoss.");
  const lay = blattLayout(grafik.bbox, massstab);
  const doc = await PDFDocument.create();
  doc.setTitle(`${projekt} — ${planinhalt} 1:${massstab}`);
  doc.setCreator("BIT-Atelier");
  const page = doc.addPage([lay.breite_mm * PT, lay.hoehe_mm * PT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const mm = (m) => (m * 1000) / massstab; // metres in the model → mm on paper
  // drawSvgPath draws with y pointing down from (x, y) — the plan's z axis points down on screen too.
  const ox = lay.ursprung_mm.x * PT, oy = (lay.hoehe_mm - lay.ursprung_mm.y) * PT;
  const { x0, z0 } = /** @type {{x0: number, z0: number}} */ (grafik.bbox);
  for (const e of grafik.elemente) {
    if (e.art === "poly") {
      const d = e.pts.map((p, i) => `${i ? "L" : "M"}${(mm(p.x - x0)).toFixed(3)},${(mm(p.z - z0)).toFixed(3)}`).join(" ") + (e.offen ? "" : " Z");
      page.drawSvgPath(d, {
        x: ox, y: oy, scale: PT,
        color: e.fill ? farbe(e.fill) : undefined, opacity: e.fill ? (e.deckkraft ?? 1) : undefined,
        borderColor: farbe(e.stroke), borderWidth: e.breite_mm, borderOpacity: e.deckkraft ?? 1,
        borderDashArray: e.dash ? e.dash.split(/\s+/).map(Number) : undefined,
      });
    } else {
      const groesse = e.groesse_mm * PT;
      const breite = font.widthOfTextAtSize(e.text, groesse);
      // ausrichtung (100-01, optional): "links" starts at the anchor, "rechts" ends there, default centred.
      const dx = e.ausrichtung === "links" ? 0 : e.ausrichtung === "rechts" ? breite : breite / 2;
      page.drawText(e.text, { x: ox + mm(e.x - x0) * PT - dx, y: oy - mm(e.z - z0) * PT - groesse / 3, size: groesse, font, color: rgb(0.2, 0.2, 0.22) });
    }
  }
  // Scale bar 5 m (true length on paper) under the drawing.
  const sbY = (lay.hoehe_mm - lay.ursprung_mm.y - lay.zeichnung_mm.h - 6) * PT;
  const sbL = mm(5) * PT;
  page.drawLine({ start: { x: ox, y: sbY }, end: { x: ox + sbL, y: sbY }, thickness: 0.35 * PT, color: rgb(0, 0, 0) });
  for (const t of [0, 1]) page.drawLine({ start: { x: ox + t * sbL, y: sbY - 1.2 * PT }, end: { x: ox + t * sbL, y: sbY + 1.2 * PT }, thickness: 0.25 * PT, color: rgb(0, 0, 0) });
  page.drawText("5 m", { x: ox + sbL + 2 * PT, y: sbY - 1 * PT, size: 2.5 * PT, font });

  // Title block bottom right (DIN EN ISO 7200 fields, reduced).
  const kx = (lay.breite_mm - RAND.sonst - RAND.kopfB) * PT, ky = RAND.sonst * PT, kb = RAND.kopfB * PT, kh = RAND.kopfH * PT;
  page.drawRectangle({ x: kx, y: ky, width: kb, height: kh, borderColor: rgb(0, 0, 0), borderWidth: 0.5 * PT });
  const zeile = (label, wert, n, f = font) => {
    const y = ky + kh - (6 + n * 5.5) * PT;
    page.drawText(label, { x: kx + 3 * PT, y, size: 2.3 * PT, font, color: rgb(0.4, 0.4, 0.45) });
    page.drawText(String(wert || "—"), { x: kx + 32 * PT, y, size: 3 * PT, font: f, color: rgb(0.08, 0.08, 0.1) });
  };
  zeile("Projekt", projekt, 0, fett);
  zeile("Planinhalt", planinhalt, 1);
  zeile("Brille", brille ? brille.label : "Eingabe", 2);
  zeile("Maßstab", `1:${massstab}   Format ${lay.format}   (maßstäblich, Vektor)`, 3);
  zeile("Plannummer", plannummer, 4);
  zeile("Datum", datum, 5);
  // Status legend of the lens (colour from the ONE table; hidden statuses are not listed).
  let lx = kx + 3 * PT;
  const ly = ky + 3 * PT;
  for (const s of ["bestand", "abbruch", "neubau"]) {
    if (brille && brille.sicht?.[s] === "aus") continue;
    page.drawRectangle({ x: lx, y: ly, width: 4 * PT, height: 2.6 * PT, color: farbe(statusFarbe(s)), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.15 * PT });
    page.drawText(STATUS_DARSTELLUNG[s].label, { x: lx + 5.5 * PT, y: ly + 0.5 * PT, size: 2.3 * PT, font });
    lx += 26 * PT;
  }
  return { bytes: await doc.save(), format: lay.format };
}
