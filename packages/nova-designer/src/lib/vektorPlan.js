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
// 106-11: planGrafik marks the drawn elements of unreleased AI changes (dashed frame OUTSIDE the element + "?", layer
// "ki_vermerk"); vektorPlanPdf prints the model state in the title block, the note "Enthält ungeprüfte KI-Änderungen" in a dashed
// box left of the title block, and the machine-readable state line in the PDF keywords (read back by the plan list). Without a
// state the sheet says "nicht ermittelt" - no option leaves the note out (D-IM-04, @core/lib/zeigen/planStand.js).
// 107-09: with the switch "Wände verschneiden" the studio passes the cleaned layer outlines (`schichtFlaechen` for the plan, from the
// solid cut at the cut height or from the bands; `schnittFlaechen` for the section): a wall with a build-up is then drawn layer by layer
// with the cleaned joints instead of its whole rectangle. Without them the output is unchanged. The PDF waits for the derivation
// (the studio awaits it before calling), so the same sheet never depends on the moment of the export.
// 107-12: the view state (`ansicht` = {strukturdarstellung, optionen, regeln} of a saved view, @core/lib/plan/ansichtszustand.js) adds
// the structure display (layers hidden by function, the reference line unchanged), the graphic rules (elementDarstellung; status wins
// in renovation lenses), the opening symbols on their own layer "oeffnung" (DXF A_OEFFNUNG; door swing, window and penetration
// symbols switchable) and the material hatch. Without `ansicht` the output is byte-identical to before. The line group comes from
// detailgradFuer (one level-of-detail function). vektorPlanPdf prints the note of a fallback to the bands (`ableitungsVermerk`).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { wandGeometrie, huellSchnittWaende, ugSchnittWaende, schnittErsetzt, modellImSchnitt } from "@core/lib/bauteil/referenz.js";
import { dachSchnittLinie, GLOBAL_DACH_DICKE_M, umrissSpanneBeiZ } from "@core/lib/bauteil/dachGeometrie.js"; // 108-01: roof triangle in the section; 108-02: collar-beam floor
import { deckenLage, geschossHoeheAusModell } from "@core/lib/bauteil/hoehen.js"; // 107-02: slab thickness and side from the slab (default 0.25 m standing on its plane)
import { planDarstellung, schraffur45 } from "@core/lib/plan/brillen.js";
import { statusFarbe, STATUS_DARSTELLUNG } from "@core/lib/plan/statusDarstellung.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { VERMERK_DRUCK, markenRahmen, modellstandMetadaten, modellstandText, vermerkZeilen } from "@core/lib/zeigen/planStand.js";
import { oeffnungGuid } from "@core/lib/zeigen/aenderungen.js";
import { huellwandGuid } from "./bauteilInfo.js";
import { detailgradFuer } from "@core/lib/plan/massstab.js";
import { oeffnungsMasse, oeffnungsTyp, oeffnungMitte_m } from "@core/lib/bauteil/oeffnungen.js";
import { globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js"; // 108-02: the one eaves height
import { regelfensterPasst, AUTO_WINDOW } from "./autoOpenings.js"; // 108-02: the one rule-window guard (basement, knee wall)
import { baenderNachStruktur, darstellungsWerte, elementDarstellung, optionenFuer, schichtSichtbar, schnittGruppenNachStruktur, wandFunktionen, wandSchichtStreifen } from "@core/lib/plan/ansichtszustand.js";

/** 1 mm in PDF points. */
const PT = 72 / 25.4;
/**
 * DIN EN ISO 216 sheets in mm (landscape: width ≥ height).
 * @type {ReadonlyArray<[string, number, number]>}
 */
export const BLAETTER = Object.freeze([["A3", 420, 297], ["A2", 594, 420], ["A1", 841, 594], ["A0", 1189, 841]]);
/**
 * Sheet margin (DIN 824 fold edge 20 mm left, 10 mm elsewhere) and title block height in mm [ASSUMED].
 * 106-11 review: the row "Modellstand" fits into the old 46 mm (seven rows of 5 mm above the status legend instead of six of
 * 5.5 mm), so the free drawing height and with it the sheet format chosen by blattLayout stay as before 106-11.
 */
const RAND = { links: 20, sonst: 10, kopfH: 46, kopfB: 180 };
/** Row pitch of the title block in mm (106-11 review: 5.5 -> 5 for the seventh row). */
const KOPF_ZEILE_MM = 5;
/** 106-11: gap between a drawn element and its AI mark, mm on paper [ASSUMED: clear of the poché and the cut line]. */
const MARKE_ABSTAND_MM = 1.5;

/**
 * Line widths in mm on paper for a scale (ISO 128-23 line groups) — since 107-12 read from the one level-of-detail function
 * (detailgradFuer: 0.5 up to 1:100, 0.7 at 1:50, 1.0 at 1:20).
 * @param {number} massstab denominator
 * @returns {{schnitt: number, ansicht: number, duenn: number}}
 */
export function linienGruppe(massstab) {
  return detailgradFuer(massstab).linienGruppe;
}

/** Wall as a four-point polygon (m), same geometry as the screen plan (BimPlan2D wallRectXZ) — 107-01: one derivation in @core. */
function wandPolygon(w) {
  return wandGeometrie(w).polygon;
}

/** Poché of a cut wall without status (architects' plan: dark grey, not black). */
const POCHE = "#3f3f46";

/**
 * Plan primitives in metres for one storey.
 * @param {{model: any, level: number, customWalls?: any[], customColumns?: any[], customSlabs?: any[], customRoofs?: any[], customZones?: any[], customWindows?: any[], envOpenings?: any[], brille?: any, huelleStatus?: string|null, massstab?: number, sw?: boolean, layerVis?: Record<string, boolean>|null, werkstattWaende?: any[]|null, kiMarken?: {guids: ReadonlyArray<string>, projektId?: string|number|null}|null, schichtFlaechen?: Map<string, {baender: Array<{schicht?: number, ringe: Array<Array<{x: number, z: number}>>}>}>|null, ansicht?: {strukturdarstellung?: string, optionen?: Partial<Record<string, boolean>>|null, regeln?: any[]|null}|null, eingang?: object|null}} e
 *   eingang (108-01): the effective automatic entrance of the studio or null when it is off (no door symbol); undefined = as before
 * layerVis: the plan's layer switches (BitBimStudio DEFAULT_LAYERS ids; missing = visible) — the
 * export prints what the screen shows (before 22.10.2026 a hidden layer was printed anyway).
 * werkstattWaende: workshop walls ({a, b, dicke_m, level, huelle, status}); drawn like on screen
 * (BimPlan2D) — only those with a decided status, never the hull.
 * Every element carries `ebene` (104-06, additive): the drawing layer it belongs to —
 * "wand" | "stuetze" | "decke" | "dach" | "schraffur" | "raum_text" | "ki_vermerk" (106-11) — read by the DXF export.
 * schichtFlaechen (107-09): Map wall key ("env:<level>:<edge>", "cw:<_idx>") → {baender: [{ringe}]} cleaned layer outlines in m; a wall with an
 * entry is drawn as its layer outlines (poché per layer), without one as before.
 * ansicht (107-12): {strukturdarstellung, optionen, regeln} of the view (ansichtszustand.js); null = the plan as before 107-12.
 * kiMarken (106-11): GUIDs of elements touched by unreleased AI changes and the project of the derived GUIDs (bauteilGuid, the
 * same derivation as the IFC export and the change tools); every DRAWN element among them gets a dashed frame
 * MARKE_ABSTAND_MM outside its outline plus a "?" (form, not colour alone). 106-11 review: hull walls are marked too (GUID like
 * the selection, huellwandGuid), and a changed opening (customWindows / envOpenings, GUID like the change tools, oeffnungGuid)
 * marks its DRAWN host wall - openings themselves are not drawn on the sheet. Workshop walls have no GUID (the change tools cannot
 * target them) and are not marked; the note says "m von n markiert".
 * @returns {{elemente: Array<{art: 'poly', pts: Array<{x: number, z: number}>, fill: string|null, stroke: string, breite_mm: number, dash?: string, deckkraft?: number, offen?: boolean, ebene?: string, guid?: string} | {art: 'text', x: number, z: number, text: string, groesse_mm: number, ebene?: string, ausrichtung?: 'links'|'rechts', guid?: string, farbe?: string}>, bbox: {x0: number, z0: number, x1: number, z1: number}|null, markiert?: string[]}}
 *   markiert: GUIDs that got a mark on this sheet (106-11); farbe: text colour (hex), default dark grey.
 */
export function planGrafik({ model, level, customWalls = [], customColumns = [], customSlabs = [], customRoofs = [], customZones = [], customWindows = [], envOpenings = [], brille = null, huelleStatus = null, massstab = 100, sw = false, layerVis = null, werkstattWaende = null, kiMarken = null, schichtFlaechen = null, ansicht = null, eingang = undefined }) {
  const lg = linienGruppe(massstab);
  // 107-12: view state — structure display, options (opening symbols, hatches), graphic rules; all inert without `ansicht`
  const dg = detailgradFuer(massstab, brille);
  const sd = ansicht?.strukturdarstellung || "gesamt";
  const opt = ansicht ? optionenFuer(dg, ansicht.optionen) : null;
  const regeln = Array.isArray(ansicht?.regeln) && ansicht.regeln.length ? ansicht.regeln : null;
  // composite walls are drawn layer by layer when the view filters layers or hatches materials (else one rectangle as before)
  const streifenModus = !!ansicht && (sd !== "gesamt" || !!opt?.schraffurMaterial);
  // Same layer mapping as BimPlan2D: shell = hull walls + slabs, attika = roofs, walls = drawn and
  // workshop walls, columns, zones = room labels.
  const zeige = (/** @type {string} */ id) => !layerVis || layerVis[id] !== false;
  /** @type {any[]} */
  const el = [];
  const auf = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => (x.level || 0) === level);
  const poly = (pts, status, { schnitt = true, fill = POCHE, ebene = "wand", werte = /** @type {Record<string, any>|null} */ (null) } = {}) => {
    // 107-12: with rules the look goes through elementDarstellung (first matching rule; the status wins in renovation lenses)
    const lk = /** @type {any} */ (regeln && werte ? elementDarstellung(brille, { ...werte, status }, regeln, { sw, standard: { fill, stroke: "#18181b" } }) : planDarstellung(brille, status, { sw }));
    el.push({ art: "poly", pts, fill: lk?.leer ? null : lk ? lk.fill : fill, stroke: lk ? lk.stroke : "#18181b", breite_mm: lk?.breite_mm ?? (schnitt ? lg.schnitt : lg.ansicht), dash: lk?.dash, deckkraft: lk?.opacity ?? 1, ebene });
    // 97-04b: S/W new build — 45° hatch, 2 mm apart on paper [ASSUMED usual spacing]. 107-12: switchable (optionen.schraffurStatus).
    if (lk?.schraffur && opt?.schraffurStatus !== false) for (const [p, q] of schraffur45(pts, (2 * massstab) / 1000)) el.push({ art: "poly", pts: [p, q], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "schraffur" });
  };
  // 106-11: marks of unreleased AI changes - collected while drawing, drawn last (on top of everything)
  const markGuids = new Set((kiMarken?.guids || []).map(String));
  /** @type {Array<{guid: string, pts: Array<{x: number, z: number}>}>} */
  const marken = [];
  const merkeGuid = (/** @type {string} */ g, /** @type {Array<{x: number, z: number}>} */ pts) => { if (markGuids.has(g)) marken.push({ guid: g, pts }); };
  const merke = (/** @type {string} */ quelle, /** @type {any} */ e, /** @type {Array<{x: number, z: number}>} */ pts) => {
    if (markGuids.size) merkeGuid(bauteilGuid(kiMarken?.projektId ?? null, quelle, e), pts);
  };
  // drawn host walls of this storey: hull "env:<level>:<edge>" and drawn walls "cw:<_idx>" -> outline (marks of openings)
  /** @type {Map<string, Array<{x: number, z: number}>>} */
  const wirte = new Map();
  if (zeige("shell")) for (const s of auf(customSlabs)) if (s.points?.length >= 3) { el.push({ art: "poly", pts: s.points, fill: null, stroke: "#71717a", breite_mm: lg.duenn, dash: "4 2", ebene: "decke" }); merke("customSlabs", s, s.points); }
  if (zeige("attika")) for (const r of auf(customRoofs)) if (r.points?.length >= 3) { el.push({ art: "poly", pts: r.points, fill: null, stroke: "#71717a", breite_mm: lg.duenn, dash: "6 2 1 2", ebene: "dach" }); merke("customRoofs", r, r.points); }
  /**
   * 107-09: the cleaned layer outlines of a wall key drawn as poché, true when at least one ring was drawn (then its rectangle is not
   * drawn). An entry without a ring (review 107-09) keeps the rectangle — a wall never vanishes from the sheet.
   */
  const verschnitten = (/** @type {string} */ k, /** @type {string|null|undefined} */ status, /** @type {any} */ w = null, /** @type {Record<string, any>|null} */ werte = null) => {
    const vf = schichtFlaechen?.get(k);
    if (!vf) return false;
    // 107-12: the structure display filters the material groups of the solid cut by the same rule as the strips (function per layer)
    if (sd !== "gesamt" && w && vf.baender.some((b) => b.ringe.some((r) => r.length >= 3))) {
      for (const b of baenderNachStruktur(vf.baender, wandFunktionen(w), sd, werte?.tragend ?? true)) for (const r of b.ringe) if (r.length >= 3) poly(r, status, { werte });
      return true; // every layer filtered out: the wall is hidden on purpose, its rectangle is not drawn either
    }
    let gezeichnet = 0;
    for (const b of vf.baender) for (const r of b.ringe) if (r.length >= 3) { poly(r, status, { werte }); gezeichnet += 1; }
    return gezeichnet > 0;
  };
  /**
   * 107-12: visible depth of a wall under the structure display, across the wall relative to its body centre line (m): undefined =
   * the whole thickness, null = the wall is hidden, [von, bis] = the span of the visible strips. Opening symbols are cut only there,
   * so a formwork plan shows the openings in the core, not hanging over the hidden layers.
   */
  /** @type {Map<string, [number, number]|null|undefined>} */
  const sichtbareTiefe = new Map();
  /** @returns {[number, number]|null|undefined} */
  const tiefeSichtbar = (/** @type {any} */ w, /** @type {boolean} */ tragend) => {
    if (sd === "gesamt") return undefined;
    const streifen = wandSchichtStreifen(w);
    if (!streifen) return wandFunktionen(w).some((f) => schichtSichtbar(f, sd, tragend)) ? undefined : null;
    const sichtbar = baenderNachStruktur(streifen, streifen.map((x) => x.funktion), sd, tragend);
    if (!sichtbar.length) return null;
    const vo = wandGeometrie(w).versatz_m;
    return /** @type {[number, number]} */ ([Math.min(...sichtbar.map((b) => b.innen_m)) - vo, Math.max(...sichtbar.map((b) => b.aussen_m)) - vo]);
  };
  /**
   * 107-12: a wall under the view state — strips filtered by the structure display (reference line and offsets unchanged), material
   * hatch per strip; a wall without composite is one layer and is kept when any of its layer functions stays visible.
   */
  const wandMitAnsicht = (/** @type {any} */ w, /** @type {string} */ k, /** @type {string|null|undefined} */ status, /** @type {Record<string, any>} */ werte) => {
    sichtbareTiefe.set(k, tiefeSichtbar(w, werte.tragend));
    if (verschnitten(k, status, w, werte)) return;
    const streifen = streifenModus ? wandSchichtStreifen(w) : null;
    if (!streifen) {
      if (sd === "gesamt" || wandFunktionen(w).some((f) => schichtSichtbar(f, sd, werte.tragend))) poly(wandPolygon(w), status, { werte });
      return;
    }
    for (const b of baenderNachStruktur(streifen, streifen.map((x) => x.funktion), sd, werte.tragend)) {
      poly(b.pts, status, { werte });
      // material hatch (DIN ISO 128-50, simplified to 45° lines 2 mm apart on paper [ASSUMED]); strips are convex four-point polygons
      if (opt?.schraffurMaterial && b.hatch && b.hatch !== "none") for (const [p, q] of schraffur45(b.pts, (2 * massstab) / 1000)) el.push({ art: "poly", pts: [p, q], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "schraffur" });
    }
  };
  /** @type {Map<string, any>} 107-12: host wall records of this storey (opening symbols) */
  const wandJe = new Map();
  if (zeige("shell")) for (const w of (model?.walls || []).filter((w) => w.level === level)) {
    const pts = wandPolygon(w);
    if (ansicht) wandMitAnsicht(w, `env:${w.level}:${w.edge}`, huelleStatus, darstellungsWerte({ ...w, huelle: true }, "wand", { tragend: true }));
    else if (!verschnitten(`env:${w.level}:${w.edge}`, huelleStatus)) poly(pts, huelleStatus);
    wandJe.set(`env:${w.level}:${w.edge}`, w);
    wirte.set(`env:${w.level}:${w.edge}`, pts);
    if (markGuids.size) merkeGuid(huellwandGuid(kiMarken?.projektId ?? null, w.level, w.edge), pts);
  }
  if (zeige("walls")) {
    for (const w of auf(customWalls)) if (w.a && w.b) {
      const pts = wandPolygon(w);
      if (ansicht) wandMitAnsicht(w, `cw:${w._idx}`, w.status, darstellungsWerte(w, "wand"));
      else if (!verschnitten(`cw:${w._idx}`, w.status)) poly(pts, w.status);
      merke("customWalls", w, pts); wirte.set(`cw:${w._idx}`, pts); wandJe.set(`cw:${w._idx}`, w);
    }
    for (const w of auf(werkstattWaende)) {
      if (w.huelle || !w.a || !w.b || !planDarstellung(brille, w.status, { sw })) continue;
      const ww = { ...w, thickness: w.dicke_m };
      if (ansicht) wandMitAnsicht(ww, `wt:${w.guid ?? ""}`, w.status, darstellungsWerte(ww, "wand"));
      else poly(wandPolygon(ww), w.status);
    }
  }
  if (zeige("columns")) for (const c of auf(customColumns)) {
    const h = (c.size || 0.4) / 2;
    const pts = [{ x: c.x - h, z: c.z - h }, { x: c.x + h, z: c.z - h }, { x: c.x + h, z: c.z + h }, { x: c.x - h, z: c.z + h }];
    poly(pts, c.status, { ebene: "stuetze", werte: regeln ? darstellungsWerte(c, "stuetze") : null });
    merke("customColumns", c, pts);
  }
  if (zeige("zones")) for (const z of auf(customZones)) {
    if (!(z.points?.length >= 3)) continue;
    const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length, cz = z.points.reduce((s, p) => s + p.z, 0) / z.points.length;
    const a = Math.abs(z.points.reduce((s, p, i) => { const q = z.points[(i + 1) % z.points.length]; return s + (p.x * q.z - q.x * p.z); }, 0) / 2);
    el.push({ art: "text", x: cx, z: cz, text: `${String(z.name || "Raum").replace(/ ·WT$/, "")}  ${a.toFixed(2).replace(".", ",")} m²`, groesse_mm: 2.5, ebene: "raum_text" });
    merke("customZones", z, z.points);
  }
  // 107-12 (97-09 rest): opening symbols of the view on their own layer "oeffnung" — rule windows and placed openings of the hull,
  // the entrance door on the ground floor, placed openings of drawn walls; the same positions as the screen plan (BimPlan2D).
  if (opt && zeige("openings")) {
    const symbol = (/** @type {any} */ w, /** @type {number} */ mitte_u, /** @type {number} */ breite, /** @type {string} */ art, /** @type {string} */ k) => {
      const tiefe = sichtbareTiefe.get(k);
      if (tiefe === null) return; // wall hidden by the structure display: its openings go with it
      const g = wandGeometrie(w);
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
      const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
      const nx = -dz, nz = dx, vo = g.versatz_m;
      // the symbol spans the visible depth: centre line moved to the middle of the visible strips, half depth = half of their span
      const qm = tiefe ? (tiefe[0] + tiefe[1]) / 2 : 0, hh = tiefe ? (tiefe[1] - tiefe[0]) / 2 : g.dicke_m / 2;
      const cx = w.a.x + dx * mitte_u + nx * (vo + qm), cz = w.a.z + dz * mitte_u + nz * (vo + qm), hw = breite / 2;
      const P = (/** @type {number} */ u, /** @type {number} */ q) => ({ x: cx + dx * u + nx * q, z: cz + dz * u + nz * q });
      // the cut in the wall: white fill over the poché (the DXF leaves openings unfilled, dxfPlaene.js)
      el.push({ art: "poly", pts: [P(-hw, hh), P(hw, hh), P(hw, -hh), P(-hw, -hh)], fill: "#ffffff", stroke: "#18181b", breite_mm: lg.ansicht, ebene: "oeffnung" });
      if (art === "window" && opt.fensterSymbol) el.push({ art: "poly", pts: [P(-hw, 0), P(hw, 0)], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "oeffnung" });
      if (art === "oeffnung" && opt.durchbruchSymbol) {
        // penetration without filling: the crossed rectangle (DIN 1356-1 symbol for an opening through the wall)
        el.push({ art: "poly", pts: [P(-hw, hh), P(hw, -hh)], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "oeffnung" });
        el.push({ art: "poly", pts: [P(-hw, -hh), P(hw, hh)], fill: null, stroke: "#18181b", breite_mm: lg.duenn, offen: true, ebene: "oeffnung" });
      }
      if (art === "door") {
        if (opt.tuerAufschlag) {
          // leaf opened 90° to the +normal side like the screen symbol (BimPlan2D) and the swing as a polyline quarter circle (8 segments)
          const r = breite;
          el.push({ art: "poly", pts: [P(-hw, hh), P(-hw, hh + r)], fill: null, stroke: "#18181b", breite_mm: lg.ansicht, offen: true, ebene: "oeffnung" });
          const bogen = Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * (Math.PI / 2); return P(-hw + r * Math.sin(a), hh + r * Math.cos(a)); });
          el.push({ art: "poly", pts: bogen, fill: null, stroke: "#18181b", breite_mm: lg.duenn, dash: "2 2", offen: true, ebene: "oeffnung" });
        }
        // 1:20 (detailgradFuer.zarge): the frame as two small rectangles at the jambs, 5 cm [ASSUMED usual frame depth in the drawing]
        if (dg.zarge) for (const u0 of [-hw, hw - 0.05]) {
          el.push({ art: "poly", pts: [P(u0, hh), P(u0 + 0.05, hh), P(u0 + 0.05, -hh), P(u0, -hh)], fill: null, stroke: "#18181b", breite_mm: lg.duenn, ebene: "oeffnung" });
        }
      }
    };
    for (const w of (model?.walls || []).filter((x) => x.level === level && wandJe.has(`env:${x.level}:${x.edge}`))) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
      // rule windows of the hull (~1 per 3.5 m, 1.40 m wide, none below ground nor through a knee wall) — the rule of BimPlan2D windowsAlong
      if (regelfensterPasst(w)) { const n = Math.max(0, Math.floor(len / AUTO_WINDOW.spacing)); for (let i = 0; i < n; i += 1) symbol(w, len * ((i + 0.5) / n), AUTO_WINDOW.width, "window", `env:${w.level}:${w.edge}`); }
      for (const e of (Array.isArray(envOpenings) ? envOpenings : []).filter((o) => o.level === level && o.edge === w.edge)) {
        const b = oeffnungsMasse(e).w;
        symbol(w, oeffnungMitte_m(e.u, b, len), b, e.kind === "door" ? "door" : e.kind === "oeffnung" ? "oeffnung" : "window", `env:${w.level}:${w.edge}`);
      }
    }
    const eg = (model?.walls || []).find((x) => x.level === level);
    // entrance door like the screen (BimPlan2D): 1.0 m leaf hinged 1.0 m before the wall middle, swinging up to the middle — so the
    // symbol's centre is 0.5 m before the middle (review 107-12: was centred on the middle, 0.5 m off the screen symbol)
    // 108-01 (D-EFH-04): `eingang` null = the automatic entrance is off, nothing drawn; undefined = as before. Position and width stay
    // this old drawing until 108-04.
    if (level === 0 && eg && eingang !== null && wandJe.has(`env:${eg.level}:${eg.edge}`)) symbol(eg, Math.hypot(eg.b.x - eg.a.x, eg.b.z - eg.a.z) * 0.5 - 0.5, 1.0, "door", `env:${eg.level}:${eg.edge}`);
    for (const o of Array.isArray(customWindows) ? customWindows : []) {
      const w = wandJe.get(`cw:${o.wallIdx}`);
      if (!w) continue;
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z), b = oeffnungsTyp(o).w;
      symbol(w, oeffnungMitte_m(o.u, b, len), b, o.kind === "door" ? "door" : o.kind === "oeffnung" ? "oeffnung" : "window", `cw:${o.wallIdx}`);
    }
  }
  // openings: the mark frames the drawn host wall (an opening of another storey or in a hidden wall gets none)
  if (markGuids.size) {
    for (const [arr, env] of /** @type {Array<[any[], boolean]>} */ ([[customWindows, false], [envOpenings, true]])) {
      for (const o of Array.isArray(arr) ? arr : []) {
        const host = wirte.get(env ? `env:${o.level}:${o.edge}` : `cw:${o.wallIdx}`);
        if (host) merkeGuid(oeffnungGuid(kiMarken?.projektId ?? null, o, env), host);
      }
    }
  }
  // one mark per element; 0.5 mm line with the dash pattern of "ungeprüft", the "?" right of the frame's top-right corner
  const k = massstab / 1000; // metres per mm on paper
  /** @type {string[]} */
  const markiert = [];
  for (const m of marken) {
    if (markiert.includes(m.guid)) continue;
    markiert.push(m.guid);
    const r = markenRahmen(m.pts, MARKE_ABSTAND_MM * k);
    el.push({ art: "poly", pts: r, fill: null, stroke: VERMERK_DRUCK.linie, breite_mm: 0.5, dash: VERMERK_DRUCK.strich, ebene: "ki_vermerk", guid: m.guid });
    el.push({ art: "text", x: r[1].x + 0.8 * k, z: r[1].z + 1.2 * k, text: VERMERK_DRUCK.zeichen, groesse_mm: 3.5, ausrichtung: "links", ebene: "ki_vermerk", guid: m.guid, farbe: VERMERK_DRUCK.linie });
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
  return { elemente: el, bbox, markiert };
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
 * @param {{model: any, storeyHeight?: number, layerVis?: Record<string, boolean>|null, brille?: any, huelleStatus?: string|null, sw?: boolean, massstab?: number, schnittFlaechen?: Array<{schluessel: string, schicht?: number, ringe: Array<Array<{x: number, h: number}>>}>|null, ansicht?: {strukturdarstellung?: string}|null, dach?: any, achse?: "x"|"z"|null}} e
 *   dach (108-01): global roof form (dachGeometrie.globalesDach) — the cut roof plate on layer "dach" and the marks "Traufe" / "First"
 *   instead of "OK Dach"; achse (108-01): "z" = section B-B (model turned by referenz.modellImSchnitt), "x"/null = A-A as before.
 *   Without both the output is byte-identical to before.
 *   schnittFlaechen (107-09): cut layers of the intersected walls (x and height in m); with hull entries they replace the hull wall rectangles
 *   ansicht (107-12): structure display of the view filters the cut layers by function (whole hull rectangles are not split), null = as before
 * @returns {ReturnType<typeof planGrafik>}  markiert is always empty (106-11 review): the section marks no element, so the note
 *   on the sheet says "0 von n Bauteilen auf diesem Blatt markiert" instead of staying silent about it.
 */
export function schnittGrafik({ model: modellRoh, storeyHeight = 3, layerVis = null, brille = null, huelleStatus = null, sw = false, massstab = 100, schnittFlaechen = null, ansicht = null, dach = null, achse = null }) {
  const model = modellImSchnitt(modellRoh, achse); // 108-01: B-B turns the model, A-A is the model itself
  const lg = linienGruppe(massstab);
  const zeige = (/** @type {string} */ id) => !layerVis || layerVis[id] !== false;
  const k = massstab / 1000; // metres per mm on paper
  /** @type {any[]} */
  const el = [];
  const fp = Array.isArray(model?.footprint) ? model.footprint : [];
  if (fp.length < 3) return { elemente: [], bbox: null, markiert: [] };
  const x0 = Math.min(...fp.map((p) => p.x)), x1 = Math.max(...fp.map((p) => p.x));
  const totalH = model.totalHeight || 0;
  // 108-02 (D-EFH-01): with a knee wall the side walls and the parapet end at the eaves (model.traufhoehe_m) and a dimension "Kniestock"
  // runs from the top of the structural slab to the eaves; without one `wandOben` is totalH (byte-identical output)
  const wandOben = globaleTraufhoehe_m(model);
  const knie = Number.isFinite(Number(model.kniestock_m)) && model.kniestock_m != null ? Number(model.kniestock_m) : null;
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
    for (const s of model.slabs || []) {
      const lage = deckenLage(s, undefined, "huelle");
      // 108-02: the collar-beam floor only where its clipped outline crosses the section line
      const sp = s.kehlbalkenlage ? umrissSpanneBeiZ(s.polygon, 0) : { von_m: x0, bis_m: x1 };
      if (sp) geschnitten(rechteck(sp.von_m, sp.bis_m, lage.unterkante_m, lage.oberkante_m), null, "decke");
    }
    // 107-09: intersected hull walls layer by layer (solid or bands); their whole rectangles would cover the layers. Review 107-09: a
    // rectangle is left out only where layers replace it (same side, above / below ground) — the basement walls of the standard hull
    // carry a build-up while the walls above may not, and those must stay in the section
    const vSchnitt = Array.isArray(schnittFlaechen) ? schnittFlaechen : [];
    // 107-12: the structure display drops cut layers by the function of their layer — review 107-12: from the build-up of the group's
    // OWN wall (basement walls carry their own one), one helper shared with the screen section (hull = load-bearing). The rectangles
    // below still test the unfiltered groups: a hidden layer leaves its gap, the whole rectangle never comes back.
    const vSichtbar = schnittGruppenNachStruktur(vSchnitt, model.walls, ansicht?.strukturdarstellung);
    for (const f of vSichtbar) for (const r of f.ringe) if (r.length >= 3) geschnitten(r.map((p) => ({ x: p.x, z: Z(p.h) })), String(f.schluessel).startsWith("env:") ? huelleStatus : null, "wand");
    for (const s of schnittWaende) if (!schnittErsetzt(vSchnitt, s, false)) geschnitten(rechteck(s.von_m, s.bis_m, 0, wandOben), huelleStatus, "wand");
    // 107-13 (D-BK-20): basement walls from the lowest basement up to ±0.00 with their own thickness (bauteil/referenz.js); the walls
    // above ground keep their line from ±0.00 up. No ground subtraction (plan 107-10). Nothing is added without basements.
    // [ASSUMED] terrain = ±0.00 (assumption A4 of 107-13, the ground line above): the basement is fully below ground on every side.
    // Way to the real value: the terrain profile from the height grid (gelaende.js hoeheAn) with plan 107-10.
    for (const s of ugSchnittWaende(model)) if (!schnittErsetzt(vSchnitt, s, true)) geschnitten(rechteck(s.von_m, s.bis_m, s.unten_m, s.oben_m), huelleStatus, "wand");
  }
  if (paraH > 0) for (const s of schnittWaende) geschnitten(rechteck(s.von_m, s.bis_m, wandOben, wandOben + paraH), null, "dach");
  // 108-01: the cut roof plate of the global roof form (underside = roof surface along the section line, top = plate thickness above,
  // the plate of the IFC export) on layer "dach"; the side walls still end at the eaves (108-03 lets the gable walls follow the roof)
  const ax = achse === "z" ? "z" : "x";
  const dachUnten = dach ? dachSchnittLinie(dach, ax, 0) : null;
  const dachOben = dachUnten ? dachSchnittLinie(dach, ax, 0, { dicke_m: GLOBAL_DACH_DICKE_M }) : null;
  if (dachUnten && dachOben && zeige("attika")) {
    geschnitten([...dachUnten.punkte, ...[...dachOben.punkte].reverse()].map((p) => ({ x: p.s_m, z: Z(p.h_m) })), null, "dach");
  }
  // Windows of the back wall seen in elevation — same rule as the screen and the 3D view (~1 per 3.5 m,
  // sill 0.90 m, height 1.40 m, width 1.40 m [ASSUMED like BimPlan2D windowsAlong]).
  if (zeige("openings")) for (const st of model.storeys || []) {
    if (st.level < 0) continue; // 107-13: no rule windows below ground (as autoEnvOpenings and the screen section)
    const back = (model.walls || []).find((w) => w.level === st.level);
    if (!back) continue;
    if (!regelfensterPasst(back)) continue; // 108-02: the rule window does not fit under the eaves (the guard of autoEnvOpenings)
    const len = Math.hypot(back.b.x - back.a.x, back.b.z - back.a.z);
    const n = Math.max(0, Math.floor(len / AUTO_WINDOW.spacing));
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
    if (dachUnten) {
      // 108-01: a pitched roof has eaves and ridge; "OK Dach" at the eaves height was wrong for it
      kote(dachUnten.traufe_m, `${koteText(dachUnten.traufe_m)}  Traufe`);
      kote(dachUnten.first_m, `${koteText(dachUnten.first_m)}  First`);
    } else kote(totalH, `${koteText(totalH)}  OK Dach`);
    if (paraH > 0) kote(wandOben + paraH, `${koteText(wandOben + paraH)}  OK Attika`);
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
    // 108-02: knee wall from the top of the structural slab under the top storey to the eaves
    if (knie != null) masslinie({ x: xr, z: Z(wandOben - knie) }, { x: xr, z: Z(wandOben) }, `Kniestock ${knie.toFixed(2).replace(".", ",")}`, xr + 2 * k, Z(wandOben - knie / 2), "links");
    // 107-13: below the lowest basement (fusshoehe_m is negative, z points down here); 8 mm below ±0.00 without basements as before
    const zu = 8 * k - (Number(model.fusshoehe_m) || 0);
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
  return { elemente: el, bbox, markiert: [] };
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
 * 106-11: `modellstand` (planStand.js ModellStand) goes into the title block row "Modellstand", into the PDF keywords (machine
 * readable, read back by the plan list) and - when AI changes are unreleased or the state is unknown (null/undefined counts as
 * unknown) - into the dashed note box left of the title block. There is deliberately no option to print without the note.
 * @param {ReturnType<typeof planGrafik>} grafik
 * 107-12: `ableitungsVermerk` (text, e.g. RUECKFALL_VERMERK of ansichtszustand.js) is printed above the title block when walls of the
 * sheet come from the bands instead of the solid — a fallback is never silent; null/absent = nothing printed (byte-identical).
 * @param {{massstab: number, projekt?: string, planinhalt?: string, brille?: any, plannummer?: string, datum?: string, modellstand?: import("@core/lib/zeigen/planStand.js").ModellStand|null, ableitungsVermerk?: string|null}} kopf
 * @returns {Promise<{bytes: Uint8Array, format: string, vermerk: boolean}>}  vermerk: the sheet carries the note.
 */
export async function vektorPlanPdf(grafik, { massstab, projekt = "", planinhalt = "", brille = null, plannummer = "", datum = "", modellstand = null, ableitungsVermerk = null }) {
  if (!grafik.bbox) throw new Error("Keine Zeichnung auf diesem Geschoss.");
  const lay = blattLayout(grafik.bbox, massstab);
  const doc = await PDFDocument.create();
  doc.setTitle(`${projekt} — ${planinhalt} 1:${massstab}`);
  doc.setCreator("BIT-Atelier");
  doc.setKeywords([modellstandMetadaten(modellstand)]);
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
      // names come from people and agents: made encodable once, for the width AND the drawing (pdf-lib throws outside WinAnsi)
      const txt = winAnsi(e.text);
      const f = e.ebene === "ki_vermerk" ? fett : font;
      const breite = f.widthOfTextAtSize(txt, groesse);
      // ausrichtung (100-01, optional): "links" starts at the anchor, "rechts" ends there, default centred.
      const dx = e.ausrichtung === "links" ? 0 : e.ausrichtung === "rechts" ? breite : breite / 2;
      page.drawText(txt, { x: ox + mm(e.x - x0) * PT - dx, y: oy - mm(e.z - z0) * PT - groesse / 3, size: groesse, font: f, color: e.farbe ? farbe(e.farbe) : rgb(0.2, 0.2, 0.22) });
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
    const y = ky + kh - (6 + n * KOPF_ZEILE_MM) * PT;
    page.drawText(winAnsi(label), { x: kx + 3 * PT, y, size: 2.3 * PT, font, color: rgb(0.4, 0.4, 0.45) });
    // project and plan names may hold characters outside WinAnsi (106-11 review); long values are cut to the field
    page.drawText(kuerzen(winAnsi(String(wert || "—")), f, 3 * PT, (RAND.kopfB - 35) * PT), { x: kx + 32 * PT, y, size: 3 * PT, font: f, color: rgb(0.08, 0.08, 0.1) });
  };
  zeile("Projekt", projekt, 0, fett);
  zeile("Planinhalt", planinhalt, 1);
  zeile("Brille", brille ? brille.label : "Eingabe", 2);
  zeile("Maßstab", `1:${massstab}   Format ${lay.format}   (maßstäblich, Vektor)`, 3);
  zeile("Plannummer", plannummer, 4);
  zeile("Datum", datum, 5);
  zeile("Modellstand", modellstandText(modellstand), 6);
  // 107-12: fallback note right above the title block, right-aligned with it (the scale bar sits at the drawing's left edge)
  if (ableitungsVermerk) {
    const txt = `${VERMERK_DRUCK.zeichen} ${winAnsi(ableitungsVermerk)}`;
    const groesse = 2.5 * PT;
    page.drawText(txt, { x: kx + kb - fett.widthOfTextAtSize(txt, groesse), y: ky + kh + 1.5 * PT, size: groesse, font: fett, color: farbe(VERMERK_DRUCK.linie) });
  }
  // Status legend of the lens (colour from the ONE table; hidden statuses are not listed).
  let lx = kx + 3 * PT;
  const ly = ky + 3 * PT;
  for (const s of ["bestand", "abbruch", "neubau"]) {
    if (brille && brille.sicht?.[s] === "aus") continue;
    page.drawRectangle({ x: lx, y: ly, width: 4 * PT, height: 2.6 * PT, color: farbe(statusFarbe(s)), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.15 * PT });
    page.drawText(winAnsi(STATUS_DARSTELLUNG[s].label), { x: lx + 5.5 * PT, y: ly + 0.5 * PT, size: 2.3 * PT, font });
    lx += 26 * PT;
  }

  // 106-11: the note box in the free strip left of the title block (never covered by the drawing: blattLayout keeps the
  // drawing above the title block height). Dashed border + "?" + words; colours are the light warning tokens (VERMERK_DRUCK).
  const vermerk = vermerkZeilen(modellstand, undefined, { markiert: grafik.markiert ? grafik.markiert.length : undefined });
  if (vermerk) {
    const vx = RAND.links * PT, vb = Math.min(160, lay.breite_mm - RAND.links - RAND.sonst - RAND.kopfB - 6) * PT;
    const vy = RAND.sonst * PT, vh = RAND.kopfH * PT;
    page.drawRectangle({ x: vx, y: vy, width: vb, height: vh, color: farbe(VERMERK_DRUCK.flaeche), borderColor: farbe(VERMERK_DRUCK.linie),
      borderWidth: 0.7 * PT, borderDashArray: VERMERK_DRUCK.strich.split(/\s+/).map((n) => Number(n) * 2 * PT) });
    // the sign: "?" in a dashed square, top left
    page.drawRectangle({ x: vx + 3 * PT, y: vy + vh - 12 * PT, width: 9 * PT, height: 9 * PT, borderColor: farbe(VERMERK_DRUCK.linie), borderWidth: 0.5 * PT,
      borderDashArray: [1.5 * PT, 1 * PT] });
    page.drawText(VERMERK_DRUCK.zeichen, { x: vx + 5.3 * PT, y: vy + vh - 10.6 * PT, size: 7 * PT, font: fett, color: farbe(VERMERK_DRUCK.linie) });
    const tx = vx + 15 * PT, maxB = vb - 18 * PT;
    page.drawText(kuerzen(winAnsi(vermerk.titel), fett, 4.2 * PT, maxB), { x: tx, y: vy + vh - 8.5 * PT, size: 4.2 * PT, font: fett, color: farbe(VERMERK_DRUCK.linie) });
    vermerk.zeilen.forEach((z, i) => {
      page.drawText(kuerzen(winAnsi(z), font, 2.6 * PT, maxB), { x: tx, y: vy + vh - (15.5 + i * 4.6) * PT, size: 2.6 * PT, font, color: rgb(0.08, 0.08, 0.1) });
    });
  }
  return { bytes: await doc.save(), format: lay.format, vermerk: !!vermerk };
}

/** Characters the standard PDF fonts can encode (WinAnsi = Windows-1252): Latin-1 plus the cp1252 extras. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/**
 * Text the standard PDF fonts can draw: characters outside Windows-1252 become "?" (pdf-lib throws on them; element names come
 * from people and agents and may hold anything).
 * @param {string} s @returns {string}
 */
export function winAnsi(s) {
  return Array.from(String(s ?? "")).map((c) => {
    const n = c.codePointAt(0) ?? 0;
    // 0x20-0x7E ASCII, 0xA0-0xFF Latin-1; 0x80-0x9F are the cp1252 extras, reachable only through their own characters
    return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_EXTRA.includes(c) ? c : "?";
  }).join("");
}

/**
 * Cuts a line with "…" so it fits a width.
 * @param {string} s @param {any} f  pdf-lib font. @param {number} groesse  Font size in pt. @param {number} breite  Width in pt.
 * @returns {string}
 */
function kuerzen(s, f, groesse, breite) {
  if (f.widthOfTextAtSize(s, groesse) <= breite) return s;
  let t = s;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, groesse) > breite) t = t.slice(0, -1);
  return `${t}…`;
}
