import React, { useMemo, useRef, useState, useEffect } from "react";
import { oeffnungsMasse, oeffnungsTyp, oeffnungMitte_m } from "@core/lib/bauteil/oeffnungen.js";
import { wandGeometrie, wandDicke_m, huellSchnittWaende, ugSchnittWaende, schnittErsetzt, modellImSchnitt } from "@core/lib/bauteil/referenz.js"; // 107-01: the one reference-line derivation; 108-01: section B-B
import { dachSchnittLinie, dachAnsichtImSchnitt, dachFalllinienImSchnitt, wandOberkanteUnterDach, GLOBAL_DACH_DICKE_M, umrissSpanneBeiZ } from "@core/lib/bauteil/dachGeometrie.js"; // 108-01: roof triangle in the section; 108-02: collar-beam floor
import { planEbene, globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js"; // 107-13: storey levels incl. basements; 108-02: eaves
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_EFH_108 } from "@core/lib/i18nTeile/efh-108.js"; // 108-01: lazy part (section marks)
import { profilFlaechen, profilAussen, ERDBAU_FARBE } from "@core/lib/massing/gelaendeEbenen.js"; // 108-10: terrain lines of the section
import { EN as EN_RAEUME_10711 } from "@core/lib/i18nTeile/raeume-107-11.js"; // 115-02: lazy part (label "Kniestock" of the section chain)
import { deckenLage, geschosshoehe, elevationOf } from "@core/lib/bauteil/hoehen.js"; // 107-02: the one slab thickness/side (was the literal 0.25)
import { treppeBerechnen, treppenLoch, deckeUeber } from "@core/lib/bauteil/treppe.js"; // 108-06: stair symbol
import { treppeSymbol } from "@core/lib/plan/treppeSymbol.js";
import { istUTreppe } from "@core/lib/bauteil/treppeU.js"; // 115-13: two-flight stair with landing
import { treppeUPlan } from "@core/lib/plan/treppeUSymbol.js";
import { gaubeBerechnen } from "@core/lib/bauteil/gauben.js"; // 108-13: dormer outline in the top storey
import { vordachBerechnen } from "@core/lib/bauteil/vordach.js"; // W-1118-29: canopy outline in its storey
import { tuerSymbol, tuerFelder } from "@core/lib/plan/tuerSymbol.js"; // 108-05: ONE door symbol (DIN 1356-1) for screen, PDF and DXF
import { innenSeiteVon } from "@core/lib/bauteil/grundrissBearbeiten.js"; // 108-05 inside rule, one place for plan symbol and door tool
import { drehRahmen, drehePunkt, drehePunktZurueck, normiereDrehung, textWinkelImRahmen, nordpfeilWinkel, nordRichtung } from "@core/lib/plan/planDrehung.js"; // 115-04: plan turned in 90° steps (display only)

/**
 * 108-05: SVG of a door symbol (leaf + swing polyline) in the plan. `P(u, q)` maps wall coordinates (u along the wall from the opening
 * middle, q across = +normal) to plan metres; the hinge sits on the wall face of the swing side (tuerSymbol). Sliding doors get no swing.
 * @param {{P: (u: number, q: number) => {x: number, z: number}, X: (x: number) => number, Z: (z: number) => number,
 *   t: {breite_m: number, dicke_m: number, anschlag?: string, aufschlag?: string, innenSeite?: 1|-1, fluegel?: 1|2},
 *   look: {stroke: string, strokeWidth: string|number, bogen?: boolean}}} props
 * @returns {import("react").ReactElement}
 */
function TuerSymbolSvg({ P, X, Z, t, look }) {
  const s = tuerSymbol(/** @type {any} */ (t));
  const pt = (/** @type {{u: number, q: number}} */ p) => { const w = P(p.u, p.q); return `${X(w.x)},${Z(w.z)}`; };
  return (
    <g stroke={look.stroke} strokeWidth={look.strokeWidth} fill="none" data-tuer-seite={s.seite}>
      {s.fluegel.map((f, i) => (
        <g key={i} data-tuer-drehpunkt={`${P(f.drehpunkt.u, f.drehpunkt.q).x.toFixed(3)},${P(f.drehpunkt.u, f.drehpunkt.q).z.toFixed(3)}`}>
          <line x1={X(P(f.drehpunkt.u, f.drehpunkt.q).x)} y1={Z(P(f.drehpunkt.u, f.drehpunkt.q).z)} x2={X(P(f.blattEnde.u, f.blattEnde.q).x)} y2={Z(P(f.blattEnde.u, f.blattEnde.q).z)} />
          {look.bogen !== false && <polyline points={f.bogen.map(pt).join(" ")} strokeDasharray="2 2" strokeWidth={0.6} />}
        </g>
      ))}
    </g>
  );
}

import { fmtLen } from "@core/lib/useBuildingProgram";
import { planDarstellung, schraffur45 } from "@core/lib/plan/brillen.js"; // 97-04: status look per lens
// 107-12: one level-of-detail function and the view state (structure display, options, rules) — inert without the `ansicht` prop
import { detailgradFuer } from "@core/lib/plan/massstab.js";
import { baenderNachStruktur, elementDarstellung, darstellungsWerte, optionenFuer, schichtSichtbar, schnittGruppenNachStruktur, tragendVon, wandFunktionen, wandSchichtStreifen } from "@core/lib/plan/ansichtszustand.js";
import { usePlanViewport, bildPxJeEinheit } from "@core/lib/usePlanViewport"; // 75-09: bildPxJeEinheit = Letterbox-korrekte Bildschirm-Skala (MSB-16)
// 75-11 Task 4 (MSB-5/MSB-12): short room names + label collision in screen
// pixels — reuse the 75-05 helpers, never rebuild them (one source).
import { kurzRaumname, labelKollision } from "@designer/lib/massstab";
// 75-09 Task 2: fixed-scale mode — ONE scale convention with the iso camera
// (1:50 = pxJeMeter(50) ≈ 75.59 CSS px/m). isoKamera stays import-free.
import { planZoomFuerMassstab } from "@designer/lib/isoKamera";
import { seiteVon, formatMeter } from "@designer/lib/masskette"; // 75-15: architectural dimension chains
import { schnittMassInhalt, schnittMassLayout, koteText } from "@designer/lib/schnittMasse"; // 115-02: one layout of the section dimensions (screen = PDF)
import { regelfensterPasst, AUTO_WINDOW } from "@designer/lib/autoOpenings"; // 108-02: the one rule-window guard (basement, knee wall)
import Masskette from "./Masskette";
englischErgaenzen(EN_EFH_108);
englischErgaenzen(EN_RAEUME_10711);

// 75-09: max zoom in fixed-scale mode. [ASSUMED] 48 — with the default view
// (maxZoom 12) even 1:50 on large sites would clamp before reaching the scale;
// 48 keeps 1:50 reachable for buildings up to ≈ 400 m edge length. Only used
// when the `massstab` prop is set; every other caller keeps the hook default.
const MASSSTAB_MAX_ZOOM = 48;

/**
 * Grundriss-Bedienung part 1: hit tolerance of thin drawn elements (walls, columns, openings) in SCREEN pixels beyond their outline.
 * [ASSUMED] 6 px — about half a fingertip on a mouse screen, the usual CAD pick box; no norm value.
 */
const TREFFER_PX = 6;

/**
 * Grundriss-Bedienung part 2: a press on the selection becomes a drag only after the pointer moved this many SCREEN pixels; below
 * it stays a click (pick / Shift toggle as before). [ASSUMED] 4 px — the usual drag threshold of desktop toolkits, no norm value.
 */
const ZUG_SCHWELLE_PX = 4;

// 2D-Ableitung aus DEMSELBEN Gebäudemodell (buildingModel.js).
// "Grundriss" = Draufsicht eines Geschosses, "Schnitt" = vertikaler Schnitt z=0.
// Grundriss unterstützt interaktives Zeichnen (Wand/Stütze) via edit-Props.
// Phase 34 (Plan-Werkstatt): Zoom/Pan lebt in @core/lib/usePlanViewport;
// Fachplaner-Reiter betten den Plan per readOnly + overlay-Render-Prop ein.

// ---- gemeinsame Helfer -----------------------------------------------------
function bboxXZ(fp) {
  const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

// Fensterpositionen entlang einer Wand (gleiche Logik wie 3D: ~1 je 3,5 m).
function windowsAlong(w) {
  // 107-13 / 108-02: no rule windows on basement walls nor where they would cut through a knee wall into the roof — the guard of
  // autoEnvOpenings (regelfensterPasst), so plan, dimension chains and section agree with 3D/IFC
  if (!regelfensterPasst(w)) return [];
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  const count = Math.max(0, Math.floor(len / AUTO_WINDOW.spacing));
  const out = [];
  for (let k = 0; k < count; k++) out.push({ t: (k + 0.5) / count, len });
  return out;
}

// Schicht-Bänder einer mehrschichtigen Wand (Composite) als Polygone von außen nach innen.
// 107-12: the strips come from @core (plan/ansichtszustand.js wandSchichtStreifen) so plan, PDF and DXF filter the SAME strips by the
// structure display; the four points and colours are the ones drawn here before (same path text).
function wallSkinBands(w) {
  return wandSchichtStreifen(w);
}

// Effektive Wanddicke (Composite-Gesamtdicke oder Einzeldicke) in m — one rule in @core (107-01).
function wallThicknessM(w) {
  return wandDicke_m(w);
}

// Rechteck (Wand) als Polygon-Punkte aus Kante a->b + Dicke + Referenzlinie (107-01: @core wandGeometrie).
function wallRectXZ(w) {
  return wandGeometrie(w).polygon;
}

// ---- Markierungsrahmen-Trefferprüfung (alles in Metern, XZ-Ebene) ----------
function ptInRect(p, r) { return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ; }
function segIntersect(p1, p2, p3, p4) {
  const d = (p4.z - p3.z) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.z - p1.z);
  if (Math.abs(d) < 1e-9) return false;
  const ua = ((p4.x - p3.x) * (p1.z - p3.z) - (p4.z - p3.z) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.z - p3.z) - (p2.z - p1.z) * (p1.x - p3.x)) / d;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
function segRect(a, b, r) {
  if (ptInRect(a, r) || ptInRect(b, r)) return true;
  const c = [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
  for (let i = 0; i < 4; i++) if (segIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}
function polyHit(pts, r, crossing) {
  if (!pts || pts.length < 2) return false;
  if (!crossing) return pts.every((p) => ptInRect(p, r)); // umschließend: alle Ecken im Rahmen
  if (pts.some((p) => ptInRect(p, r))) return true;        // berührend: Ecke im Rahmen …
  for (let i = 0; i < pts.length; i++) if (segRect(pts[i], pts[(i + 1) % pts.length], r)) return true; // … oder Kante schneidet
  return false;
}

// =====================  GRUNDRISS  =========================================
/**
 * 97-04b: material hatches after DIN ISO 128-50 / DIN 1356-1 [ASSUMED mapping of the catalogue's
 * hatch keys]: concrete = 45° lines with dots, brick = dense 45° lines, block (sand-lime) = 45°
 * lines, insulation = zigzag band, wood = crossing diagonals. Size in plan units (≈ 2 mm on paper).
 * 115-04: `drehung` (plan turned, degrees counter-clockwise as seen) — the patterns are used inside the turned drawing, so they are
 * turned back by the same angle and the hatch keeps its direction on the screen (45° rising to the right); 0 = the markup as before.
 * @param {{groesse: number, drehung?: number}} props
 */
function MaterialSchraffuren({ groesse, drehung = 0 }) {
  const g = Math.max(1.5, groesse);
  const linie = { stroke: "#27272a", strokeWidth: Math.max(0.25, g / 14) };
  return (
    <defs>
      <pattern id="iso-concrete" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={`rotate(${45 + drehung})`}>
        <line x1="0" y1="0" x2="0" y2={g} {...linie} /><circle cx={g * 0.55} cy={g * 0.4} r={g / 16} fill="#27272a" />
      </pattern>
      <pattern id="iso-brick" width={g / 2} height={g / 2} patternUnits="userSpaceOnUse" patternTransform={`rotate(${45 + drehung})`}>
        <line x1="0" y1="0" x2="0" y2={g / 2} {...linie} />
      </pattern>
      <pattern id="iso-block" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={`rotate(${45 + drehung})`}>
        <line x1="0" y1="0" x2="0" y2={g} {...linie} />
      </pattern>
      <pattern id="iso-insul" width={g} height={g / 2} patternUnits="userSpaceOnUse" patternTransform={drehung ? `rotate(${drehung})` : undefined}>
        <polyline points={`0,0 ${g / 4},${g / 2} ${g / 2},0 ${(3 * g) / 4},${g / 2} ${g},0`} fill="none" {...linie} />
      </pattern>
      <pattern id="iso-wood" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={drehung ? `rotate(${drehung})` : undefined}>
        <line x1="0" y1="0" x2={g} y2={g} {...linie} /><line x1={g} y1="0" x2="0" y2={g} {...linie} />
      </pattern>
    </defs>
  );
}

function Grundriss({ model, level, edit, layerVis, envOpenings, customZones, customSlabs, customRoofs, unit = "m", focus, overlay, overlayBounds, maxSvgH = 460, readOnly = false, massstab = null, fuellen = false, brille = null, huelleStatus = null, sw = false, werkstattWaende = null, schichtFlaechen = null, ansicht = null, detailMassstab = null, eingang = undefined, baufeldUmriss = null, baufeldMittig = false, customStairs = null, gauben = null, vordaecher = null, geschosse = null, dach = null, drehung = 0 }) {
  const { t } = useI18n(); // 108-01: label "Baufeld"
  // 97-04: look of an element with renovation status under the chosen lens (null = today's look).
  const look = (status) => planDarstellung(brille, status, { sw });
  // 107-12: the level of detail with the lens as override (detailgradFuer). Review 107-12: from the studio's chosen scale
  // (`detailMassstab`) like the PDF and the option boxes, so screen, boxes and sheet agree (e.g. no door swing at 1:200); callers
  // without it keep the lens's scale. Layers/hatch follow the lens either way (override), so the plan without a view is unchanged.
  // The `massstab` prop is the fixed-zoom mode, not the detail level, and is not read here.
  const dg = detailgradFuer(detailMassstab ?? brille?.massstab ?? 100, brille);
  const opt = ansicht ? optionenFuer(dg, ansicht.optionen) : null;
  const sd = ansicht?.strukturdarstellung || "gesamt";
  const regeln = Array.isArray(ansicht?.regeln) && ansicht.regeln.length ? ansicht.regeln : null;
  /** 107-12: look with the graphic rules of the view (elementDarstellung), else the lens look as before. */
  const lookEl = (/** @type {any} */ el, /** @type {string|null|undefined} */ status, /** @type {string} */ art, /** @type {{fill: string, stroke: string, strokeWidth?: number}} */ standard) => (regeln
    ? elementDarstellung(brille, { ...darstellungsWerte(el, art), status }, regeln, { sw, standard })
    : look(status));
  /** 107-12: layer bands filtered by the structure display (reference line unchanged); "gesamt" = the bands as they are. */
  const struktur = (/** @type {any} */ w, /** @type {any[]|null} */ bands, /** @type {boolean} */ tragend) => (sd === "gesamt" || !bands ? bands : baenderNachStruktur(bands, wandFunktionen(w), sd, tragend));
  /** 107-12: a wall without strips hidden by the structure display (none of its layer functions visible). */
  const verborgen = (/** @type {any} */ w, /** @type {boolean} */ tragend) => sd !== "gesamt" && !wandFunktionen(w).some((f) => schichtSichtbar(f, sd, tragend));
  // 97-04b: at layer depth (1:50 lens) the layer bands carry their material hatch (DIN ISO 128-50). 107-12: switchable (optionen).
  const schichtTiefe = opt ? opt.schraffurMaterial : dg.schraffur;
  // 107-09: a band is a four-point layer strip (wallSkinBands) or, with the switch "Wände verschneiden", the cleaned outline of the layer
  // (`ringe`: one or several rings from the solid cut or the bands, schichtFlaechen). For four points the path text is the old one.
  const ringPfad = (/** @type {Array<{x: number, z: number}>} */ pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
  const bandPfad = (/** @type {any} */ b) => (b.ringe ? b.ringe.map(ringPfad).join(" ") : ringPfad(b.pts));
  const schraffurUeber = (b, k) => (schichtTiefe && b.hatch && b.hatch !== "none"
    ? <path key={`h${k}`} d={bandPfad(b)} fillRule={b.ringe ? "evenodd" : undefined} fill={`url(#iso-${b.hatch})`} stroke="none" data-schraffur-material={b.hatch} style={{ pointerEvents: "none" }} />
    : null);
  // 107-09: cleaned layer outlines of a wall key ("env:<level>:<edge>", "cw:<_idx>") when the studio intersects walls, else null. An
  // entry without a single ring counts as none (review 107-09): the wall keeps its layer strips and its click target.
  const verschnitten = (/** @type {string} */ k) => {
    const vf = schichtFlaechen?.get(k);
    return vf && vf.baender.some((b) => b.ringe.some((r) => r.length >= 3)) ? vf : null;
  };
  const svgRef = useRef(null);
  const L = layerVis || {};
  const show = (id) => L[id] !== false;
  const fp = model.footprint;
  // Bounds: Footprint + alle Custom-Elemente einschließen, damit nichts abgeschnitten wird.
  const all = [...fp];
  (edit?.customWalls || []).forEach((w) => { if (w.level === level) { all.push(w.a, w.b); } });
  (edit?.customColumns || []).forEach((c) => { if (c.level === level) all.push({ x: c.x, z: c.z }); });
  // PW-01: Fachlayer-Inhalte (Overlay) können die BBox erweitern, sonst würden
  // Elemente außerhalb des Footprints abgeschnitten (SCALE ist BBox-dynamisch).
  (overlayBounds || []).forEach((p) => {
    if (Number.isFinite(p?.x) && Number.isFinite(p?.z)) all.push({ x: p.x, z: p.z });
  });
  // 108-01: the building envelope of the site planning (type "baufeld", m in the model frame) stays inside the drawing
  const baufeld = Array.isArray(baufeldUmriss) && baufeldUmriss.length >= 3 ? baufeldUmriss.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z)) : null;
  if (baufeld) all.push(...baufeld);
  // Grundriss-Bedienung part 2: while the selection is dragged the bounds stay those of the press — the moved elements would
  // otherwise refit SCALE and origin under the pointer on every move, and pointer and model would drift apart (refit after release)
  const bbFestRef = useRef(/** @type {any} */ (null));
  const bb = bbFestRef.current || bboxXZ(all.length >= 3 ? all : fp);
  const PAD = 4;
  const wM = bb.maxX - bb.minX, hM = bb.maxZ - bb.minZ;
  // 115-04 (D-115-13): the plan turned in 90° steps, DISPLAY ONLY. This is the ONE place of the transformation model ↔ screen:
  //  - everything is still drawn in the model frame through X()/Z() (walls, symbols, grips, hit areas, dimension chains, overlays),
  //    inside ONE group that carries `dreh.transform`;
  //  - the viewport (viewBox, pan, zoom, trackpad) works on the TURNED frame W × H, so a swipe to the right moves the drawing to
  //    the right in every rotation;
  //  - the pointer comes back through `dreh.zurueck` in rawMeters — snap, grips and tools read model metres as before, the model
  //    itself is never turned.
  // Texts are turned back about their own point (`aufrecht`, textWinkelImRahmen), the north arrow turns with the drawing.
  // `quer` = quarter turn: the fit box (620 × 360 units) then holds the drawing with width and height swapped.
  const gedreht = normiereDrehung(drehung); // 0 | 90 | 180 | 270, degrees counter-clockwise as seen
  const quer = gedreht === 90 || gedreht === 270;
  const SCALE = quer ? Math.min(620 / (hM + PAD * 2), 360 / (wM + PAD * 2)) : Math.min(620 / (wM + PAD * 2), 360 / (hM + PAD * 2));
  const dreh = drehRahmen(gedreht, (wM + PAD * 2) * SCALE, (hM + PAD * 2) * SCALE);
  const W = dreh.breite, H = dreh.hoehe; // size of the turned frame, viewBox units (for 0 the old W and H)
  const X = (x) => (x - bb.minX + PAD) * SCALE;
  const Z = (z) => (z - bb.minZ + PAD) * SCALE;
  /** 115-04: SVG transform that keeps a text horizontal in the turned drawing — turned back about its base point (viewBox units of the model frame); undefined for 0. */
  const aufrecht = (/** @type {number} */ xu, /** @type {number} */ yu) => (gedreht ? `rotate(${gedreht} ${xu} ${yu})` : undefined);
  /** 115-04: a model-frame point (viewBox units) where the reader sees it — the turned frame the viewport works on. */
  const imBild = (/** @type {number} */ xu, /** @type {number} */ yu) => dreh.hin(xu, yu);

  const walls = model.walls.filter((w) => w.level === level);
  const space = model.spaces.find((s) => s.level === level);
  const cx = fp.reduce((s, p) => s + p.x, 0) / fp.length;
  const cz = fp.reduce((s, p) => s + p.z, 0) / fp.length;
  const areaM2 = Math.abs(fp.reduce((a, p, i) => {
    const q = fp[(i + 1) % fp.length]; return a + (p.x * q.z - q.x * p.z);
  }, 0) / 2);

  const customWalls = (edit?.customWalls || []).filter((w) => w.level === level);
  const customCols = (edit?.customColumns || []).filter((c) => c.level === level);

  // ---- Zoom / Pan (gemeinsamer Hook) / Cursor-Koordinaten / Markierungsrahmen ----
  // 75-09: im Maßstabsmodus höhere Zoom-Grenze (1:50 auch für große Modelle
  // erreichbar); ohne `massstab`-Prop bleibt maxZoom undefined ⇒ Hook-Default 12
  // ⇒ Verhalten für alle Bestandsaufrufer byte-gleich.
  const vp = usePlanViewport({ svgRef, W, H, maxZoom: massstab ? MASSSTAB_MAX_ZOOM : undefined, fuellen }); // Defaults: Zoom 0,3–12, Faktor 1,15 (wie bisher)
  const { viewT } = vp;
  // 75-11 Task 4 (MSB-5): screen pixels → viewBox units — labels use px() so
  // they measure the same on screen at every zoom (75-01/05 pattern from
  // MassingStudio). ONLY possible after renaming the two local px bindings
  // above (wandX :254ff, mittePx :399ff) — order matters, a local binding
  // would silently shadow this helper. Acceptance: exactly ONE px binding in
  // this file.
  const px = vp.px;
  // 75-09 (MSB-16): Letterbox-korrekte Bildschirm-Skala. s0 = CSS-px je
  // viewBox-Einheit bei Zoom 1; bildPxJeU = aktueller Wert; pxJeM = CSS-px je
  // Meter auf dem Bildschirm (SCALE = viewBox-Einheiten je Meter). Geht als
  // ZUSATZ-Info ins Overlay — BimPlan2D-eigene Labels/ScaleBar bleiben auf px()
  // (Bestand unverändert; Umstellung = eigener Plan, Befund MSB-16).
  const s0 = bildPxJeEinheit(1, W, H, vp.renderedW, vp.renderedH);
  const bildPxJeU = s0 * viewT.zoom;
  // Screen CSS px per metre (named so the 75-11 acceptance grep "const px" = 1
  // stays clean — the ONE px binding above must not get company).
  const bildschirmPxJeM = SCALE * bildPxJeU;
  // bereit = beide Rendermaße gemessen (ResizeObserver) — der Maßstab-Effekt
  // rechnet sonst mit dem rw/rh-0-Fallback (1 px je Einheit) und springt falsch.
  const massstabBereit = vp.renderedW > 0 && vp.renderedH > 0;
  const [cursorM, setCursorM] = useState(null);                 // Live-Koordinaten unter dem Cursor (Meter)
  const [marquee, setMarquee] = useState(null);                 // Gummiband-Rahmen (Meter)
  const marqRef = useRef(null);
  const suppressClick = useRef(false);

  // Bildschirm-Pixel -> Meter (roh, ohne Snap).
  const rawMeters = (e) => {
    const lokal = vp.clientToLocal(e); if (!lokal) return null;
    const loc = dreh.zurueck(lokal.x, lokal.y); // 115-04: turned frame → model frame (identity for 0)
    return { x: loc.x / SCALE - PAD + bb.minX, z: loc.y / SCALE - PAD + bb.minZ };
  };
  // Bildschirm-Pixel -> Meter (mit 0,25 m-Raster-Snap).
  const toMeters = (e) => { const p = rawMeters(e); if (!p) return null; const s = (v) => Math.round(v / 0.25) * 0.25; return { x: s(p.x), z: s(p.z) }; };

  // Zoom-auf-Auswahl (BIM-C): Eltern-Komponente schickt {bbox in Metern, nonce} bzw. {reset:true}.
  useEffect(() => {
    // 75-09: im Maßstabsmodus gehört die Sicht dem Maßstab-Effekt unten — der
    // BBox-Fokus würde sonst gegen ihn kämpfen. Ohne Prop läuft der Effekt
    // exakt wie vorher (Wächter als erste Zeile, Bestandsverhalten byte-gleich).
    if (massstab) return;
    if (!focus?.nonce) return;
    if (focus.reset || !focus.bbox) { vp.resetView(); return; }
    const b = focus.bbox;
    const e0 = imBild(X(b.minX), Z(b.minZ)), e1 = imBild(X(b.maxX), Z(b.maxZ)); // 115-04: the box where the reader sees it
    vp.zoomToBBox({ x0: e0.x, x1: e1.x, y0: e0.y, y1: e1.y }, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // 75-09: fester Maßstab (1:50 = pxJeMeter(50) Bildschirm-px je Meter).
  // Zielzoom über planZoomFuerMassstab(massstab, SCALE, s0); Zentrum = Mitte der
  // Fokus-BBox (viewBox-Einheiten über X/Z), ohne BBox die Modellmitte (W/2, H/2).
  // Läuft bei gesetztem Maßstab, neuer nonce (erneuter Chip-Klick) und sobald die
  // Rendermaße gemessen sind. Resize ändert danach px/m (Anzeige weicht ab) —
  // bewusst KEIN Zurückspringen bei Resize, sonst ginge der Pan des Nutzers
  // verloren; ein erneuter Chip-Klick (neue nonce) stellt den Maßstab wieder her.
  useEffect(() => {
    if (!massstab || !massstabBereit) return;
    const b = focus?.bbox;
    const zentrum = b
      ? imBild((X(b.minX) + X(b.maxX)) / 2, (Z(b.minZ) + Z(b.maxZ)) / 2)
      : { x: W / 2, y: H / 2 };
    vp.zoomZentriert(planZoomFuerMassstab(massstab, SCALE, s0), zentrum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [massstab, focus?.nonce, massstabBereit]);

  // 115-04: after a turn the sheet has another shape (width and height swap, new fit) — the old pan / zoom would show an arbitrary
  // corner, so the whole drawing is fitted again. Not on mount (the first render keeps the hook's start view).
  const drehAltRef = useRef(gedreht);
  useEffect(() => {
    if (drehAltRef.current === gedreht) return;
    drehAltRef.current = gedreht;
    vp.resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gedreht]);

  const dragRef = useRef(null);
  const startDrag = (e, d) => {
    // Grundriss-Bedienung part 1: no preventDefault on the grip's pointerdown — cancelling it suppresses the compatibility mouse events
    // (mousemove/mouseup) until pointerup (Pointer Events spec), so in Chrome the plan's onMouseMove never saw the drag and grips did
    // not move. handleDown below already ignores the mousedown of a grip (dragRef is set first).
    e.stopPropagation();
    if (!dragRef.current) edit?.onGriffStart?.(); // one undo step for the whole grip drag
    dragRef.current = d;
  };

  // Markierungsrahmen auswerten → Liste betroffener Custom-Elemente (umschließend vs. berührend).
  const finalizeMarquee = (m, additiv = false) => {
    const r = { minX: Math.min(m.sx, m.cx), maxX: Math.max(m.sx, m.cx), minZ: Math.min(m.sz, m.cz), maxZ: Math.max(m.sz, m.cz) };
    // von rechts nach links gezogen = berührend (crossing), sonst umschließend — 115-04: "left" is what the reader sees
    const crossing = gedreht ? imBild(X(m.cx), Z(m.cz)).x < imBild(X(m.sx), Z(m.sz)).x : m.cx < m.sx;
    const list = [];
    customWalls.forEach((w) => { const hit = crossing ? segRect(w.a, w.b, r) : (ptInRect(w.a, r) && ptInRect(w.b, r)); if (hit) list.push({ type: "wall", index: w._idx }); });
    customCols.forEach((c) => { if (ptInRect({ x: c.x, z: c.z }, r)) list.push({ type: "column", index: c._idx }); });
    (edit?.customWindows || []).forEach((cw) => {
      const w = customWalls.find((x) => x._idx === cw.wallIdx); if (!w) return;
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1; const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
      if (ptInRect({ x: w.a.x + dx * cw.u, z: w.a.z + dz * cw.u }, r)) list.push({ type: "opening", index: cw._idx, scope: "custom" });
    });
    (customZones || []).filter((z) => z.level === level).forEach((z) => { if (polyHit(z.points, r, crossing)) list.push({ type: "zone", index: z._idx }); });
    (customSlabs || []).filter((s) => s.level === level).forEach((s) => { if (polyHit(s.points, r, crossing)) list.push({ type: "slab", index: s._idx }); });
    (customRoofs || []).filter((rf) => rf.level === level).forEach((rf) => { if (polyHit(rf.points, r, crossing)) list.push({ type: "roof", index: rf._idx }); });
    edit?.onMarquee?.(list, { crossing, additiv }); // Grundriss-Bedienung part 1: Shift at release = add to the selection
  };

  // Grundriss-Bedienung part 2: after a selection drag the click that follows the release must not pick the element under the
  // pointer (it would cut a multiple selection down to that one) — eaten in the capture phase, cleared after the event turn
  const zugKlickSperre = useRef(false);
  const handleDown = (e) => {
    if (dragRef.current) return; // Griff-Drag hat Vorrang (pointerdown feuert vor mousedown)
    if (e.button === 1 || (e.button === 0 && vp.leertaste())) { e.preventDefault(); vp.beginPan(e); return; } // Mittel-Taste oder Leertaste+Ziehen (95-03) = verschieben
    // Grundriss-Bedienung part 2: a press on an element of the selection may become a drag of the selection (not a frame)
    if (e.button === 0 && edit?.tool === "arrow" && edit.zugTreffer) {
      const roh = rawMeters(e);
      if (roh && edit.zugTreffer(roh, bildschirmPxJeM)) { dragRef.current = { kind: "auswahl", sx: e.clientX, sy: e.clientY, roh, an: false }; return; }
    }
    if (e.button === 0 && edit?.tool === "arrow") { const p = rawMeters(e); if (p) marqRef.current = { sx: p.x, sz: p.z, cx: p.x, cz: p.z, moved: false }; }
  };
  const handleClick = (e) => {
    if (suppressClick.current) { suppressClick.current = false; return; } // nach Rahmen/Drag keinen Klick auswerten
    if (dragRef.current) return;
    if (edit?.tool === "arrow") { if (!e.shiftKey) edit.onClear?.(); return; } // Klick ins Leere hebt Auswahl auf (nicht bei Shift)
    if (edit?.onPoint) edit.onPoint(toMeters(e), e, rawMeters(e), bildschirmPxJeM); // 107-07: raw point for the snap core of the studio; screen px per m for its capture radius
  };
  const handleMove = (e) => {
    const raw = rawMeters(e); if (raw) setCursorM(raw);
    if (vp.panMove(e)) return; // verschieben (Pan)
    if (marqRef.current) { // Markierungsrahmen aufziehen
      const m = marqRef.current; if (!raw) return; m.cx = raw.x; m.cz = raw.z;
      if (Math.abs(raw.x - m.sx) > 0.15 || Math.abs(raw.z - m.sz) > 0.15) m.moved = true;
      if (m.moved) setMarquee({ x0: m.sx, z0: m.sz, x1: raw.x, z1: raw.z });
      return;
    }
    const d = dragRef.current;
    if (d?.kind === "auswahl") {
      if (!d.an) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < ZUG_SCHWELLE_PX) return;
        d.an = true; bbFestRef.current = bb; edit?.onAuswahlZugStart?.(d.roh, bildschirmPxJeM);
      }
      edit?.onAuswahlZug?.(raw, e, bildschirmPxJeM);
      return;
    }
    if (d) {
      const p = toMeters(e); if (!p) return;
      // Grundriss-Bedienung part 1: wall end, wall middle and column grips also hand over the raw pointer, the event (Shift, Alt) and
      // the screen scale, so the studio can put them through its object snap; callers without a snap read only the grid point `p`
      const fang = { roh: raw, e, pxJeM: bildschirmPxJeM };
      if (d.kind === "wallA") edit.onMoveWallPt?.(d.idx, "a", p, fang);
      else if (d.kind === "wallB") edit.onMoveWallPt?.(d.idx, "b", p, fang);
      else if (d.kind === "wallMid") { edit.onMoveWall?.(d.idx, { x: p.x - d.last.x, z: p.z - d.last.z }, fang); d.last = p; }
      else if (d.kind === "col") edit.onMoveColumn?.(d.idx, p, fang);
      else if (d.kind === "opening") edit.onMoveOpening?.(d.idx, p);
      else if (d.kind === "polyVert") edit.onMovePolyVert?.(d.which, d.idx, d.vi, p);
      else if (d.kind === "footVert") edit.onMoveFootVert?.(d.vi, p);
      else if (d.kind === "footEdge") { edit.onMoveFootEdge?.(d.edge, { x: p.x - d.last.x, z: p.z - d.last.z }); d.last = p; }
      return;
    }
    if (edit?.onHover) edit.onHover(toMeters(e), rawMeters(e), e, bildschirmPxJeM); // review 107-07: the event too (Alt = free, as the click)
  };
  const endDrag = (/** @type {any} */ e) => {
    vp.endPan();
    if (marqRef.current) {
      const m = marqRef.current; marqRef.current = null;
      if (m.moved) { finalizeMarquee(m, !!e?.shiftKey); suppressClick.current = true; }
      setMarquee(null);
    }
    const d = dragRef.current;
    if (d?.kind === "auswahl") {
      bbFestRef.current = null;
      if (d.an) {
        suppressClick.current = true; zugKlickSperre.current = true;
        setTimeout(() => { suppressClick.current = false; zugKlickSperre.current = false; }, 0);
        edit?.onAuswahlZugEnde?.(e);
      }
    } else if (d) { suppressClick.current = true; edit?.onGriffEnde?.(); } // nach Griff-Drag kein versehentliches Deselektieren
    dragRef.current = null;
  };
  const handleDbl = (e) => { if (edit?.onFinish) { e.preventDefault(); edit.onFinish(); } };

  // Phase 43: im readOnly-Modus trägt `edit` nur die Elemente (customWalls/-Columns/-Windows,
  // Prop `elements`), kein Werkzeug — der Cursor bleibt dann Standard.
  const cursor = readOnly || !edit || edit.tool === "arrow" ? "default" : "crosshair";
  const draft = edit?.draft || [];
  const hover = edit?.hover;

  // ---- Automatische, dezente Bemaßung ----
  // Pro Hüllkante eine Maßkette mit Öffnungen + Wandstücken (+ Gesamtmaß außen); Custom-Wand-Längen.
  // 75-15 (MSB-23): the hull chains are <Masskette> (extension lines, 45° slashes,
  // numbers above and parallel to the line, screen-px sizes) — the opening cuts
  // (windows, envOpenings incl. the 75-14 doors) stay the measured points.
  // Numbers follow the `unit` prop; in metres they use the chain default
  // (two decimals, comma, no unit) [ASSUMED].
  const massFormat = unit && unit !== "m" ? (m) => fmtLen(m, unit, false) : undefined;
  const autoDims = () => {
    const els = [];
    const screenAngle = (a, b) => { let ang = Math.atan2(Z(b.z) - Z(a.z), X(b.x) - X(a.x)) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; return ang; };
    walls.forEach((w, wi) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.5) return;
      const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
      const cuts = [0, len];
      windowsAlong(w).forEach((win) => { const u = win.t * len; cuts.push(u - 0.7, u + 0.7); });
      if (level === 0 && wi === 0 && eingang !== null) { const u = len * 0.5; cuts.push(u - 0.6, u + 0.6); } // 108-01: no cut for a switched-off entrance
      (envOpenings || []).filter((e) => e.level === w.level && e.edge === w.edge).forEach((e) => { const bw = oeffnungsMasse(e).w, um = oeffnungMitte_m(e.u, bw, len); cuts.push(um - bw / 2, um + bw / 2); }); // 107-04: own width, position kept in the wall like IFC and 3D
      const sorted = [...new Set(cuts.map((v) => Math.max(0, Math.min(len, v))))].sort((a, b) => a - b);
      const us = []; sorted.forEach((v) => { if (!us.length || v - us[us.length - 1] > 0.2) us.push(v); });
      if (us[us.length - 1] < len - 0.05) us.push(len);
      const punkte = us.map((u) => ({ x: w.a.x + dx * u, z: w.a.z + dz * u }));
      els.push(
        <Masskette
          key={`mk${wi}`} punkte={punkte} seite={seiteVon(punkte, { x: cx, z: cz })} offsetM={0.7}
          X={X} Z={Z} px={px} SCALE={SCALE} format={massFormat} farbe="#475569" schriftPx={9}
          daten={{ "data-plan-mass": String(wi) }} drehung={gedreht}
        />,
      );
    });
    (customWalls || []).forEach((w, i) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.3) return;
      const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
      const ang = screenAngle(w.a, w.b);
      // screen-fixed like the room labels (75-11 px()): a fixed viewBox size grew with the zoom (user finding 08.11.)
      // 115-04: in a turned plan the anchor still sits 3 px above the wall middle AS SEEN, and the angle is the readable one
      const hoch = gedreht ? dreh.vektorZurueck(0, -px(3)) : null;
      const tx = hoch ? X(mx) + hoch.x : X(mx), ty = hoch ? Z(mz) + hoch.y : Z(mz) - px(3);
      els.push(<text key={`cwl${i}`} x={tx} y={ty} textAnchor="middle" fontSize={px(9)} fill="#0f766e" transform={`rotate(${gedreht ? textWinkelImRahmen(ang, gedreht) : ang} ${tx} ${ty})`} style={{ pointerEvents: "none" }}>{fmtLen(len, unit, false)}</text>);
    });
    return els;
  };

  return (
    <div className="relative w-full flex items-center justify-center">
    {/* 75-16: fill mode — fixed SVG height, the viewBox takes the box aspect (usePlanViewport fuellen). */}
    <svg ref={svgRef} data-testid="bim-plan" viewBox={vp.viewBox} className="w-full" style={fuellen ? { height: maxSvgH, cursor } : { maxHeight: maxSvgH, cursor }}
      /* review 107-07: plan frame for tests and agents — local unit = (metre − x0|z0) × skala (the inverse of rawMeters).
         115-04: in a turned plan that is the frame INSIDE the turned group; data-plan-drehung (90 | 180 | 270, absent = 0) names the rotation */
      data-plan-skala={SCALE} data-plan-x0={bb.minX - PAD} data-plan-z0={bb.minZ - PAD} data-plan-drehung={gedreht || undefined}
      onMouseDown={handleDown} onClickCapture={(e) => { if (zugKlickSperre.current) { zugKlickSperre.current = false; e.stopPropagation(); } }} onClick={handleClick} onMouseMove={handleMove} onDoubleClick={handleDbl} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {fuellen
        ? <rect x={vp.sicht.x} y={vp.sicht.y} width={vp.sicht.w} height={vp.sicht.h} fill="#f8fafc" />
        : <rect x="0" y="0" width={W} height={H} fill="#f8fafc" />}
      {schichtTiefe && <MaterialSchraffuren groesse={(2 * (brille?.massstab || 50) / 1000) * SCALE} drehung={gedreht} />}
      {/* 115-04: the ONE group of the turned drawing — everything inside is drawn in the model frame; without a rotation it is a
          fragment (no extra element, the markup stays as before). Scale bar and north arrow stay outside (sheet furniture). */}
      <PlanDrehGruppe transform={dreh.transform} grad={gedreht}>

      {/* ---- Räume/Zonen (Polygon-Füllung + Name + Fläche) ----
          75-11 Task 4 (MSB-5/MSB-12): labels in SCREEN PIXELS via px() (was
          SCALE-bound viewBox units — small on zoom-in, overlapping at many
          rooms), short name (kurzRaumname: no ·WT, no (WE …)), area with 0
          decimals, ONE label per room, collision-checked in screen px like
          75-05 (bigger area first — small chambers disappear before the
          living room). */}
      {show("zones") && (() => {
        const zonesLevel = (customZones || []).filter((z) => z.level === level);
        if (!zonesLevel.length) return null;
        // Screen px per viewBox unit = 1 / px(1) (75-16: fill-mode aware; outside
        // fill mode identical to the 75-05 formula renderedW · zoom / W).
        const bildPxProU = 1 / px(1);
        const fontPx = 11;
        const flaecheVon = (z) => Math.abs(z.points.reduce((a, p, k) => { const q = z.points[(k + 1) % z.points.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
        const kandidaten = zonesLevel.map((z, i) => {
          const ok = z.points && z.points.length >= 3;
          const area = ok ? flaecheVon(z) : 0;
          return { z, i, ok, area };
        }).filter((k) => k.ok);
        // Priority: bigger area first (collision input order = priority). 75-17:
        // zones flagged ohneLabel (the caller labels them itself) take no part.
        const sortiert = kandidaten.filter((k) => !k.z.ohneLabel).sort((a, b) => b.area - a.area);
        const rects = sortiert.map((k) => {
          const cxm = k.z.points.reduce((s, p) => s + p.x, 0) / k.z.points.length;
          const czm = k.z.points.reduce((s, p) => s + p.z, 0) / k.z.points.length;
          const zeilen = [kurzRaumname(k.z.name), `${Math.round(k.area).toLocaleString("de-DE")} m²`];
          const ort = imBild(X(cxm), Z(czm)); // 115-04: where the reader sees the label (the boxes are upright on the screen)
          const sx = (ort.x - vp.sicht.x) * bildPxProU, sy = (ort.y - vp.sicht.y) * bildPxProU;
          // 87-01: the box must cover the RENDERED text, not an ideal one — bold 11 px
          // runs ≈ 0,7 px per character, and the block hangs from the baseline at sy:
          // ascent of line 1 above, line 2 (dy 13) plus its descent below. The old
          // 0,6 · len × 2 · fontPx box was a few px short on both axes, so two labels
          // passed the check and still overlapped on screen (werkstatt-75-11).
          const w = 0.7 * fontPx * Math.max(...zeilen.map((s) => s.length));
          return { x0: sx - w / 2, y0: sy - fontPx, x1: sx + w / 2, y1: sy + 13 + 9 * 0.3 };
        });
        const sichtbar = new Set(labelKollision(rects).map((si) => sortiert[si].i));
        // NOTE: the collision filter hides LABELS only — every zone polygon
        // still renders (and stays clickable in edit mode). MSB-5 asked for
        // non-overlapping labels, not for invisible rooms.
        return kandidaten.map((k) => {
          const z = k.z;
          const sel = edit?.selected?.type === "zone" && edit.selected.index === z._idx;
          const d = z.points.map((p, idx) => `${idx ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
          const cxm = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
          const czm = z.points.reduce((s, p) => s + p.z, 0) / z.points.length;
          const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "zone", index: z._idx }, e.shiftKey); } };
          return (
            <g key={`zone${k.i}`} onClick={onClick} data-zone={z._idx} data-belag={z.belag || undefined} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
              <path d={d} fill={sel ? "#7dd3fc" : "#bae6fd"} fillOpacity={sel ? 0.55 : 0.35} stroke={sel ? "#0284c7" : "#38bdf8"} strokeWidth={sel ? "1.2" : "0.6"} />
              {show("labels") && sichtbar.has(k.i) && (
                <text data-plan-label x={X(cxm)} y={Z(czm)} textAnchor="middle" fontSize={px(fontPx)} fontWeight="600" className="fill-sky-800" transform={aufrecht(X(cxm), Z(czm))} style={{ pointerEvents: "none" }}>
                  {kurzRaumname(z.name)}
                  <tspan x={X(cxm)} dy={px(13)} fontSize={px(9)} fontWeight="400" className="fill-sky-600">{`${Math.round(k.area).toLocaleString("de-DE")} m²`}</tspan>
                </text>
              )}
              {sel && edit?.tool === "arrow" && z.points.map((p, vi) => (
                <Handle key={`zh${vi}`} x={X(p.x)} y={Z(p.z)} onDown={(ev) => startDrag(ev, { kind: "polyVert", which: "zone", idx: z._idx, vi })} />
              ))}
            </g>
          );
        });
      })()}

      {/* ---- Decken (gezeichnet) als Umriss ---- */}
      {show("shell") && (customSlabs || []).filter((s) => s.level === level).map((s, i) => {
        if (!s.points || s.points.length < 3) return null;
        const sel = edit?.selected?.type === "slab" && edit.selected.index === s._idx;
        // 107-04: holes of the slab (`oeffnungen: [{points}]`) are further sub-paths of the same path, filled even-odd; without holes the path is unchanged
        const loecher = (Array.isArray(s.oeffnungen) ? s.oeffnungen : []).filter((l) => Array.isArray(l?.points) && l.points.length >= 3)
          .map((l) => l.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z").join(" ");
        const d = s.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z" + (loecher ? ` ${loecher}` : "");
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "slab", index: s._idx }, e.shiftKey); } };
        return (
          <g key={`cslab${i}`}>
            {(() => { const lk = look(s.status); return (
              <path d={d} fillRule="evenodd" fill={lk ? lk.fill : "#cbd5e1"} fillOpacity={sel ? 0.5 : 0.25} stroke={sel ? "#475569" : lk ? lk.stroke : "#94a3b8"} strokeWidth={sel ? "1.2" : lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash || "4 2"} opacity={lk?.opacity} data-status={s.status || undefined} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }} />
            ); })()}
            {sel && edit?.tool === "arrow" && s.points.map((p, vi) => (
              <Handle key={`sh${vi}`} x={X(p.x)} y={Z(p.z)} onDown={(ev) => startDrag(ev, { kind: "polyVert", which: "slab", idx: s._idx, vi })} />
            ))}
          </g>
        );
      })}
      {/* ---- 108-06: Treppen — Symbol aus plan/treppeSymbol.js: dieses Geschoss (Ansicht „unten“) und das Geschoss darunter (oberer Teil + Deckenloch) ---- */}
      {show("walls") && (customStairs || []).map((t, i) => {
        if (!t?.start) return null;
        const lvl = Math.round(Number(t.level) || 0);
        if (lvl !== level && lvl !== level - 1) return null;
        // 115-13: the two-flight stair draws from its own helper (same primitives, also used by the PDF/DXF plan)
        const u = istUTreppe(t) ? treppeUPlan(t, model, level, geschosse) : null;
        const erg = u ? null : treppeBerechnen(t, geschosshoehe(lvl, geschosse));
        const decke = erg ? deckeUeber(model, lvl, geschosse) : null;
        const loch = erg && decke ? treppenLoch(t, erg, deckenLage(decke, geschosse, "huelle").unterkante_m - elevationOf(lvl, geschosse)) : null;
        const teile = u ? u.teile : treppeSymbol(/** @type {any} */ (erg), lvl === level ? { ansicht: "unten" } : { ansicht: "oben", loch: loch?.points || null });
        const umriss = u ? u.umriss : /** @type {any} */ (erg).umriss;
        const sel = edit?.selected?.type === "stair" && edit.selected.index === t._idx;
        const farbe = sel ? "#0f766e" : "#334155";
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "stair", index: t._idx }, e.shiftKey); } };
        const P = (p) => `${X(p.x)},${Z(p.z)}`;
        return (
          <g key={`stair${i}`} data-treppe={t._idx} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
            {/* hit area: the flight outline, filled faintly so a click lands */}
            <path d={umriss.map((p, k) => `${k ? "L" : "M"}${P(p)}`).join(" ") + " Z"} fill={sel ? "#99f6e4" : "#e2e8f0"} fillOpacity={sel ? 0.5 : 0.25} stroke="none" />
            {teile.map((s, k) => {
              const sw1 = s.gewicht === "ansicht" ? 0.9 : 0.5;
              const dash = s.strich === "gestrichelt" ? "3 2" : undefined;
              if (s.art === "linie") return <line key={k} x1={X(s.pts[0].x)} y1={Z(s.pts[0].z)} x2={X(s.pts[1].x)} y2={Z(s.pts[1].z)} stroke={farbe} strokeWidth={sw1} strokeDasharray={dash} />;
              if (s.art === "poly") return <path key={k} d={s.pts.map((p, j) => `${j ? "L" : "M"}${P(p)}`).join(" ") + " Z"} fill="none" stroke={farbe} strokeWidth={sw1} strokeDasharray={dash} />;
              if (s.art === "kreis") return <circle key={k} cx={X(s.pts[0].x)} cy={Z(s.pts[0].z)} r={(s.radius_m || 0.1) * SCALE} fill="none" stroke={farbe} strokeWidth={0.5} />;
              if (s.art === "pfeil") {
                const [a, b] = s.pts; const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L; const h = 0.25;
                const l1 = { x: b.x - ux * h - uz * h * 0.5, z: b.z - uz * h + ux * h * 0.5 }, l2 = { x: b.x - ux * h + uz * h * 0.5, z: b.z - uz * h - ux * h * 0.5 };
                return <g key={k}><line x1={X(a.x)} y1={Z(a.z)} x2={X(b.x)} y2={Z(b.z)} stroke={farbe} strokeWidth={0.6} /><polyline points={`${P(l1)} ${P(b)} ${P(l2)}`} fill="none" stroke={farbe} strokeWidth={0.6} /></g>;
              }
              if (s.art === "text") {
                const w = Number(s.winkel_grad) || 0; const wk = w > 90 || w < -90 ? w + 180 : w;
                return <text key={k} x={X(s.pts[0].x)} y={Z(s.pts[0].z)} fontSize={px(10)} fill={farbe} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${gedreht ? textWinkelImRahmen(-wk, gedreht) : -wk} ${X(s.pts[0].x)} ${Z(s.pts[0].z)})`} style={{ pointerEvents: "none" }}>{s.text}</text>;
              }
              return null;
            })}
          </g>
        );
      })}
      {/* ---- 108-13: Gauben im obersten Geschoss — Umriss Front→Gaubenfirst gestrichelt (über der Schnittebene), Front als Linie, Fenster als Doppellinie ---- */}
      {show("attika") && dach && (gauben || []).length > 0 && level === Math.max(0, ...(model.storeys || []).map((s) => Number(s.level)).filter((l) => Number.isFinite(l) && l >= 0)) && (gauben || []).map((g, i) => {
        const erg = gaubeBerechnen(g, model, dach, geschosse);
        if (!erg.ok) return null;
        const sel = edit?.selected?.type === "gaube" && edit.selected.index === g._idx;
        const farbe = sel ? "#9a3412" : "#78350f";
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "gaube", index: g._idx }, e.shiftKey); } };
        const P = (p) => `${X(p.x)},${Z(p.z)}`;
        return (
          <g key={`gaube${i}`} data-gaube={g._idx} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
            <path d={erg.grundriss.map((p, k) => `${k ? "L" : "M"}${P(p)}`).join(" ") + " Z"} fill={sel ? "#fed7aa" : "#fef3c7"} fillOpacity={sel ? 0.5 : 0.3} stroke={farbe} strokeWidth={0.6} strokeDasharray="3 2" />
            <line x1={X(erg.frontLinie[0].x)} y1={Z(erg.frontLinie[0].z)} x2={X(erg.frontLinie[1].x)} y2={Z(erg.frontLinie[1].z)} stroke={farbe} strokeWidth={1.2} />
            {erg.fenster && <line x1={X(erg.fenster.punkte3d[0].x)} y1={Z(erg.fenster.punkte3d[0].z)} x2={X(erg.fenster.punkte3d[1].x)} y2={Z(erg.fenster.punkte3d[1].z)} stroke="#1d4ed8" strokeWidth={2} />}
          </g>
        );
      })}
      {/* ---- W-1118-29: Vordächer im Geschoss — Plattenumriss gestrichelt (hängt über der Schnittebene), anklickbar ---- */}
      {show("shell") && (vordaecher || []).map((v, i) => {
        const erg = vordachBerechnen(v, model, geschosse);
        if (!erg.ok || erg.level !== level) return null;
        const sel = edit?.selected?.type === "vordach" && edit.selected.index === v._idx;
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "vordach", index: v._idx }, e.shiftKey); } };
        return (
          <g key={`vordach${i}`} data-vordach={v._idx} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
            <path d={erg.grundriss.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z"} fill={sel ? "#bae6fd" : "#e0f2fe"} fillOpacity={sel ? 0.6 : 0.35} stroke={sel ? "#0369a1" : "#0c4a6e"} strokeWidth={0.6} strokeDasharray="3 2" />
          </g>
        );
      })}
      {/* ---- Dächer (gezeichnet) als Umriss + First ---- */}
      {show("attika") && (customRoofs || []).filter((r) => r.level === level).map((rf, i) => {
        if (!rf.points || rf.points.length < 3) return null;
        const sel = edit?.selected?.type === "roof" && edit.selected.index === rf._idx;
        const xs = rf.points.map((p) => p.x), zs = rf.points.map((p) => p.z);
        const mnX = Math.min(...xs), mxX = Math.max(...xs), mnZ = Math.min(...zs), mxZ = Math.max(...zs);
        const along = (mxX - mnX) >= (mxZ - mnZ);
        const ridge = along ? [{ x: mnX, z: (mnZ + mxZ) / 2 }, { x: mxX, z: (mnZ + mxZ) / 2 }] : [{ x: (mnX + mxX) / 2, z: mnZ }, { x: (mnX + mxX) / 2, z: mxZ }];
        const d = rf.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "roof", index: rf._idx }, e.shiftKey); } };
        return (
          <g key={`croof${i}`} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
            {(() => { const lk = look(rf.status); return (
              <path d={d} fill={lk ? lk.fill : "#fed7aa"} fillOpacity={sel ? 0.5 : 0.25} stroke={sel ? "#9a3412" : lk ? lk.stroke : "#fb923c"} strokeWidth={sel ? "1.2" : lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash} opacity={lk?.opacity} data-status={rf.status || undefined} />
            ); })()}
            <line x1={X(ridge[0].x)} y1={Z(ridge[0].z)} x2={X(ridge[1].x)} y2={Z(ridge[1].z)} stroke="#9a3412" strokeWidth="0.8" strokeDasharray="5 2" />
            {sel && edit?.tool === "arrow" && rf.points.map((p, vi) => (
              <Handle key={`rh${vi}`} x={X(p.x)} y={Z(p.z)} onDown={(ev) => startDrag(ev, { kind: "polyVert", which: "roof", idx: rf._idx, vi })} />
            ))}
          </g>
        );
      })}

      {/* Hüllwände — anklickbar, mehrschichtig, mit Griffen */}
      {show("shell") && walls.map((w, i) => {
        const sel = edit?.selected?.type === "hullwall" && edit.selected.level === w.level && edit.selected.edge === w.edge;
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "hullwall", level: w.level, edge: w.edge }, e.shiftKey); } };
        const style = { cursor: edit?.tool === "arrow" ? "pointer" : "inherit" };
        const lk = look(huelleStatus);
        const lr = regeln ? lookEl({ ...w, huelle: true }, huelleStatus, "wand", { fill: "#334155", stroke: "#1e293b", strokeWidth: 0.5 }) : lk;
        // 97-04: with a status the core shows the status colour; 1:50 (tiefe "schichten") keeps the layers.
        // 107-12: a structure display other than "gesamt" always draws the (filtered) layers.
        const vf = verschnitten(`env:${w.level}:${w.edge}`);
        const bands = struktur(w, lk && !dg.schichten && sd === "gesamt" ? null : vf ? vf.baender : wallSkinBands(w), true);
        const r = wallRectXZ(w);
        const outline = `M${X(r[0].x)},${Z(r[0].z)} L${X(r[1].x)},${Z(r[1].z)} L${X(r[2].x)},${Z(r[2].z)} L${X(r[3].x)},${Z(r[3].z)} Z`;
        const n = fp.length, va = fp[w.edge], vb = fp[(w.edge + 1) % n];
        const grips = sel && edit?.tool === "arrow" ? (
          <g>
            <Handle x={X(va.x)} y={Z(va.z)} onDown={(ev) => startDrag(ev, { kind: "footVert", vi: w.edge })} onDouble={(e) => { e.stopPropagation(); edit.onDeleteFootVert?.(w.edge); }} />
            <Handle x={X(vb.x)} y={Z(vb.z)} onDown={(ev) => startDrag(ev, { kind: "footVert", vi: (w.edge + 1) % n })} onDouble={(e) => { e.stopPropagation(); edit.onDeleteFootVert?.((w.edge + 1) % n); }} />
            <Handle square x={X((va.x + vb.x) / 2)} y={Z((va.z + vb.z) / 2)} onDown={(ev) => startDrag(ev, { kind: "footEdge", edge: w.edge, last: { x: (va.x + vb.x) / 2, z: (va.z + vb.z) / 2 } })} onDouble={(e) => { e.stopPropagation(); edit.onInsertFootVert?.(w.edge); }} />
          </g>
        ) : null;
        if (bands) {
          return (
            <g key={`w${i}`} onClick={onClick} style={style} data-huellwand={`${w.level}:${w.edge}`} data-status={huelleStatus || undefined} opacity={lk?.opacity} data-verschneidung={vf?.quelle}>
              {bands.map((b, k) => <path key={k} d={bandPfad(b)} fillRule={b.ringe ? "evenodd" : undefined} fill={b.color} stroke="#475569" strokeWidth="0.3" data-schicht={b.ringe ? b.schicht : undefined}><title>{b.name}</title></path>)}
              {bands.map(schraffurUeber)}
              {bands.length === 0 && <path d={outline} fill="transparent" stroke="none" data-struktur-verborgen="1" />}
              {lr && <path d={outline} fill="none" stroke={lr.stroke} strokeWidth={lr.strokeWidth} strokeDasharray={lr.dash} />}
              {sel && <path d={outline} fill="none" stroke="#0d9488" strokeWidth="1.2" />}
              {grips}
            </g>
          );
        }
        return (
          <g key={`w${i}`} onClick={onClick} style={style} data-huellwand={`${w.level}:${w.edge}`} data-status={huelleStatus || undefined} opacity={lr?.opacity}>
            {verborgen(w, true)
              ? <path d={outline} fill="transparent" stroke="none" data-struktur-verborgen="1" />
              : <path d={outline} fill={lr ? lr.fill : sel ? "#0f766e" : "#334155"} stroke={sel ? "#0d9488" : lr ? lr.stroke : "#1e293b"} strokeWidth={sel ? "1.2" : lr ? lr.strokeWidth : "0.5"} strokeDasharray={lr?.dash} />}
            {grips}
          </g>
        );
      })}

      {/* Fenster der Hüllwände — anklickbar */}
      {show("openings") && walls.map((w, wi) => windowsAlong(w).map((win, k) => {
        const len = win.len, t = win.t;
        const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
        // 107-01: the symbol sits in the wall body, shifted by the reference line (0 for "center")
        const vo = wandGeometrie(w).versatz_m;
        const cxm = w.a.x + dx * len * t - dz * vo, czm = w.a.z + dz * len * t + dx * vo;
        const half = 0.7;
        const ax = cxm - dx * half, az = czm - dz * half, bx = cxm + dx * half, bz = czm + dz * half;
        const nx = -dz, nz = dx, hh = (w.thickness / 2) + 0.05;
        const selW = edit?.selected?.type === "autowin" && edit.selected.level === w.level && edit.selected.edge === w.edge;
        const onClickW = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "autowin", kind: "window", level: w.level, edge: w.edge }, e.shiftKey); } };
        return (
          <g key={`win${wi}-${k}`} onClick={onClickW} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
            <path d={`M${X(ax + nx * hh)},${Z(az + nz * hh)} L${X(bx + nx * hh)},${Z(bz + nz * hh)} L${X(bx - nx * hh)},${Z(bz - nz * hh)} L${X(ax - nx * hh)},${Z(az - nz * hh)} Z`}
              fill="#dbeafe" stroke={selW ? "#0d9488" : "#60a5fa"} strokeWidth={selW ? "1.2" : "0.6"} />
            {opt?.fensterSymbol !== false && <line x1={X(ax)} y1={Z(az)} x2={X(bx)} y2={Z(bz)} stroke="#3b82f6" strokeWidth="0.8" />}
          </g>
        );
      }))}

      {/* 108-01 (D-EFH-05): building envelope of the site planning, dashed, not selectable */}
      {baufeld && (
        <g style={{ pointerEvents: "none" }} data-baufeld-umriss>
          <path d={baufeld.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z"} fill="none" className="stroke-warnung" strokeWidth="1" strokeDasharray="6 4" />
          {/* 115-04: in a turned plan the label sits above the corner the reader sees top-left, upright (for 0 the corner min x / min z as before) */}
          {gedreht
            ? (() => {
              const xs = baufeld.map((p) => p.x), zs = baufeld.map((p) => p.z);
              const e0 = imBild(X(Math.min(...xs)), Z(Math.min(...zs))), e1 = imBild(X(Math.max(...xs)), Z(Math.max(...zs)));
              const ecke = dreh.zurueck(Math.min(e0.x, e1.x), Math.min(e0.y, e1.y));
              return <text x={ecke.x} y={ecke.y - px(4)} fontSize={px(10)} className="fill-warnung" transform={aufrecht(ecke.x, ecke.y)}>{baufeldMittig ? t("Baufeld (mittig, ohne Lagebezug)") : t("Baufeld")}</text>;
            })()
            : <text x={X(Math.min(...baufeld.map((p) => p.x)))} y={Z(Math.min(...baufeld.map((p) => p.z))) - px(4)} fontSize={px(10)} className="fill-warnung">{baufeldMittig ? t("Baufeld (mittig, ohne Lagebezug)") : t("Baufeld")}</text>}
        </g>
      )}
      {/* Eingangstür (EG) — 108-01: `eingang` null = the automatic entrance is off (D-EFH-04), undefined = as before. Position and
          width stay the old drawing (wall middle, 1.0 m) until 108-04 reads the opening itself. */}
      {show("openings") && level === 0 && walls[0] && eingang !== null && (() => {
        const w = walls[0], len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
        const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
        // 75-11 Task 4: renamed mittePx (was `px`) — no shadowing of vp.px.
        // 107-01 review fix: like the other opening symbols the door sits in the wall BODY, shifted by the reference line (0 for "center")
        const vo = wandGeometrie(w).versatz_m;
        const mittePx = w.a.x + dx * len * 0.5 - dz * vo, pz = w.a.z + dz * len * 0.5 + dx * vo;
        const nx = -dz, nz = dx; const door = 1.0;
        // 108-05: the entrance through the one door helper — 1.00 m leaf centred 0.50 m before the wall middle (the old position), hinge on the
        // inner wall face, swing to the inside (innenSeiteVon); when the view hides swings only the closed leaf line stays
        const cxE = mittePx - dx * door / 2, czE = pz - dz * door / 2;
        const PE = (/** @type {number} */ u, /** @type {number} */ q) => ({ x: cxE + dx * u + nx * q, z: czE + dz * u + nz * q });
        if (opt?.tuerAufschlag === false) return <g stroke="#0f766e" strokeWidth="1" fill="none" style={{ pointerEvents: "none" }} data-tuer-aufschlag="aus"><line x1={X(PE(-0.5, 0).x)} y1={Z(PE(-0.5, 0).z)} x2={X(PE(0.5, 0).x)} y2={Z(PE(0.5, 0).z)} /></g>;
        return (
          <g style={{ pointerEvents: "none" }} data-eingang-symbol="din1356">
            <TuerSymbolSvg P={PE} X={X} Z={Z} t={{ breite_m: door, dicke_m: wallThicknessM(w), anschlag: "links", aufschlag: "innen", innenSeite: innenSeiteVon(w, model?.footprint) }} look={{ stroke: "#0f766e", strokeWidth: "1" }} />
          </g>
        );
      })()}

      {/* ---- Custom-Wände (gezeichnet) — mehrschichtig (Composite) oder einfach ---- */}
      {show("walls") && customWalls.map((w, i) => {
        const sel = edit?.selected?.type === "wall" && edit.selected.index === w._idx;
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "wall", index: w._idx }, e.shiftKey); } };
        const style = { cursor: edit?.tool === "arrow" ? "pointer" : cursor };
        const lk = look(w.status);
        const tragend = sd === "nur-kern-tragend" ? tragendVon(w) : true;
        const lr = regeln ? lookEl(w, w.status, "wand", { fill: "#0f766e", stroke: "#134e4a", strokeWidth: 0.6 }) : lk;
        const regelNr = /** @type {any} */ (lr)?.regel; // index of the matching graphic rule (elementDarstellung), undefined = no rule
        const vf = verschnitten(`cw:${w._idx}`);
        const bands = struktur(w, lk && !dg.schichten && sd === "gesamt" ? null : vf ? vf.baender : wallSkinBands(w), tragend);
        if (bands) {
          const o = wallRectXZ(w);
          const umriss = `M${X(o[0].x)},${Z(o[0].z)} L${X(o[1].x)},${Z(o[1].z)} L${X(o[2].x)},${Z(o[2].z)} L${X(o[3].x)},${Z(o[3].z)} Z`;
          return (
            <g key={`cw${i}`} onClick={onClick} style={style} data-wand={w._idx} data-erscheinung={w.erscheinung || undefined} data-status={w.status || undefined} opacity={lk?.opacity} data-verschneidung={vf?.quelle}>
              {lr && !sel && regelNr == null && <path d={umriss} fill="none" stroke={lr.stroke} strokeWidth={lr.strokeWidth} strokeDasharray={lr.dash} />}
              {bands.length === 0 && <path d={umriss} fill="transparent" stroke="none" data-struktur-verborgen="1" />}
              {bands.map((b, k) => <path key={k} d={bandPfad(b)} fillRule={b.ringe ? "evenodd" : undefined} fill={b.color} stroke="#475569" strokeWidth="0.3" data-schicht={b.ringe ? b.schicht : undefined}><title>{b.name}</title></path>)}
              {bands.map(schraffurUeber)}
              {/* review 107-12: a rule outline lies ON the layer fills (as for hull walls), the status outline stays below them */}
              {lr && !sel && regelNr != null && <path d={umriss} fill="none" stroke={lr.stroke} strokeWidth={lr.strokeWidth} strokeDasharray={lr.dash} data-regel-kontur={regelNr} style={{ pointerEvents: "none" }} />}
              {sel && (() => {
                const o = wallRectXZ(w);
                const d = `M${X(o[0].x)},${Z(o[0].z)} L${X(o[1].x)},${Z(o[1].z)} L${X(o[2].x)},${Z(o[2].z)} L${X(o[3].x)},${Z(o[3].z)} Z`;
                return <path d={d} fill="none" stroke="#0d9488" strokeWidth="1.2" />;
              })()}
            </g>
          );
        }
        const r = wallRectXZ(w);
        const d = `M${X(r[0].x)},${Z(r[0].z)} L${X(r[1].x)},${Z(r[1].z)} L${X(r[2].x)},${Z(r[2].z)} L${X(r[3].x)},${Z(r[3].z)} Z`;
        if (verborgen(w, tragend)) return <path key={`cw${i}`} d={d} fill="transparent" stroke="none" onClick={onClick} style={style} data-wand={w._idx} data-erscheinung={w.erscheinung || undefined} data-struktur-verborgen="1" />;
        return <path key={`cw${i}`} d={d} fill={sel ? "#0ea5a4" : lr ? lr.fill : "#0f766e"} stroke={sel ? "#0d9488" : lr ? lr.stroke : "#134e4a"} strokeWidth={lr ? lr.strokeWidth : "0.6"}
          strokeDasharray={lr?.dash} opacity={lr?.opacity} onClick={onClick} style={style} data-wand={w._idx} data-erscheinung={w.erscheinung || undefined} data-status={w.status || undefined} data-sw={lr?.schraffur ? "schraffur" : lr?.leer ? "leer" : undefined} data-regel={/** @type {any} */ (lr)?.regel ?? undefined} />;
      })}

      {/* 97-04b: hatch of S/W new-build walls (45°, 2 mm on paper at the lens scale [ASSUMED]) */}
      {show("walls") && sw && customWalls.map((w) => {
        const lk = look(w.status);
        if (!lk?.schraffur || opt?.schraffurStatus === false) return null;
        const abst = (2 * (brille?.massstab || 100)) / 1000;
        return <g key={`sch${w._idx}`} style={{ pointerEvents: "none" }} data-schraffur={w._idx}>
          {/* 115-04: hatched in the frame the reader sees and brought back, so the hatch keeps 45° in a turned plan */}
          {(gedreht ? schraffur45(wallRectXZ(w).map((q) => drehePunkt(q, gedreht)), abst).map(([p, q]) => [drehePunktZurueck(p, gedreht), drehePunktZurueck(q, gedreht)]) : schraffur45(wallRectXZ(w), abst)).map(([p, q], k) => <line key={k} x1={X(p.x)} y1={Z(p.z)} x2={X(q.x)} y2={Z(q.z)} stroke="#18181b" strokeWidth="0.4" />)}
        </g>;
      })}

      {/* 97-04b: workshop walls as own elements — only those with a decided status (table
          bauteil_attribute_layer); without status the zone outlines stay as they are. */}
      {show("walls") && (werkstattWaende || []).filter((w) => w.level === level && !w.huelle && look(w.status)).map((w) => {
        const lk = /** @type {any} */ (look(w.status));
        const r = wallRectXZ({ ...w, thickness: w.dicke_m });
        const d = `M${X(r[0].x)},${Z(r[0].z)} L${X(r[1].x)},${Z(r[1].z)} L${X(r[2].x)},${Z(r[2].z)} L${X(r[3].x)},${Z(r[3].z)} Z`;
        return <path key={`wt${w.guid}`} d={d} fill={lk.fill} stroke={lk.stroke} strokeWidth={lk.strokeWidth} strokeDasharray={lk.dash} opacity={lk.opacity}
          data-werkstattwand={w.guid} data-status={w.status} style={{ pointerEvents: "none" }} />;
      })}

      {/* Grundriss-Bedienung part 1: wider, invisible hit area around each drawn wall (TREFFER_PX screen px beyond its outline), so a thin
          wall is still hit at a low zoom. Drawn before columns and openings — the later layers lie above, so the rank opening > column
          > wall of the click stays. Only while the arrow tool picks. */}
      {show("walls") && edit?.tool === "arrow" && edit.onPick && customWalls.map((w) => {
        const r = wallRectXZ(w);
        return <path key={`cwt${w._idx}`} d={`M${X(r[0].x)},${Z(r[0].z)} L${X(r[1].x)},${Z(r[1].z)} L${X(r[2].x)},${Z(r[2].z)} L${X(r[3].x)},${Z(r[3].z)} Z`}
          fill="none" stroke="transparent" strokeWidth={px(2 * TREFFER_PX)} strokeLinejoin="round" pointerEvents="stroke" style={{ cursor: "pointer" }} data-wand-treffer={w._idx}
          onClick={(e) => { e.stopPropagation(); edit.onPick({ type: "wall", index: w._idx }, e.shiftKey); }} />;
      })}

      {/* ---- Custom-Stützen ---- */}
      {show("columns") && customCols.map((c, i) => {
        const s = (c.size || 0.4);
        const sel = edit?.selected?.type === "column" && edit.selected.index === c._idx;
        const lk = regeln ? lookEl(c, c.status, "stuetze", { fill: "#475569", stroke: "#1e293b", strokeWidth: 0.6 }) : look(c.status);
        return <rect key={`cc${i}`} x={X(c.x - s / 2)} y={Z(c.z - s / 2)} width={s * SCALE} height={s * SCALE}
          fill={sel ? "#0ea5a4" : lk ? lk.fill : "#475569"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth={lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash} opacity={lk?.opacity} data-status={c.status || undefined}
          onClick={(e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "column", index: c._idx }, e.shiftKey); } }}
          style={{ cursor: edit?.tool === "arrow" ? "pointer" : cursor }} />;
      })}
      {/* Grundriss-Bedienung part 1: hit area of the columns (above the walls' one, below the openings) */}
      {show("columns") && edit?.tool === "arrow" && edit.onPick && customCols.map((c) => {
        const s = (c.size || 0.4);
        return <rect key={`cct${c._idx}`} x={X(c.x - s / 2)} y={Z(c.z - s / 2)} width={s * SCALE} height={s * SCALE} fill="none" stroke="transparent" strokeWidth={px(2 * TREFFER_PX)}
          pointerEvents="stroke" style={{ cursor: "pointer" }} data-stuetze-treffer={c._idx}
          onClick={(e) => { e.stopPropagation(); edit.onPick({ type: "column", index: c._idx }, e.shiftKey); }} />;
      })}

      {/* ---- Hüllwand-Öffnungen (platziert) als Symbol ---- */}
      {show("openings") && (envOpenings || []).filter((e) => e.level === level).map((e, i) => {
        const w = walls.find((x) => x.edge === e.edge); if (!w) return null;
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
        const nx = -dz, nz = dx; const hw = oeffnungsMasse(e).w / 2, hh = ((w.thickness || 0.3) / 2) + 0.05;
        const vo = wandGeometrie(w).versatz_m; // 107-01: symbol in the wall body (0 for "center")
        const eu = oeffnungMitte_m(e.u, hw * 2, len); // 107-04: position kept in the wall like IFC and 3D
        const cxm = w.a.x + dx * eu - dz * vo, czm = w.a.z + dz * eu + dx * vo;
        const ax = cxm - dx * hw, az = czm - dz * hw, bx = cxm + dx * hw, bz = czm + dz * hw;
        // 107-04 review: an opening without a filling on a hull wall has no mesh in 3D, so the plan is the only place to pick it (inspector: sizes, delete)
        const ohneF = e.kind === "oeffnung";
        const gewaehlt = ohneF && edit?.selected?.type === "opening" && edit.selected.scope === "env" && edit.selected.index === e._idx;
        const onPickEnv = ohneF ? (/** @type {any} */ ev) => { if (edit?.tool === "arrow" && edit.onPick) { ev.stopPropagation(); edit.onPick({ type: "opening", index: e._idx, scope: "env" }, ev.shiftKey); } } : undefined;
        return (
          <g key={`env${i}`} style={ohneF ? { cursor: edit?.tool === "arrow" ? "pointer" : cursor } : { pointerEvents: "none" }} onClick={onPickEnv} data-huell-oeffnung={ohneF ? e._idx : undefined}>
            <path d={`M${X(ax + nx * hh)},${Z(az + nz * hh)} L${X(bx + nx * hh)},${Z(bz + nz * hh)} L${X(bx - nx * hh)},${Z(bz - nz * hh)} L${X(ax - nx * hh)},${Z(az - nz * hh)} Z`}
              fill={e.kind === "door" ? "#fef3c7" : e.kind === "oeffnung" ? "#ffffff" : "#dbeafe"} stroke={gewaehlt ? "#0d9488" : "#60a5fa"} strokeWidth={gewaehlt ? "1.4" : "0.6"} strokeDasharray={e.kind === "oeffnung" && opt?.durchbruchSymbol !== false ? "2 2" : undefined} />
            {(e.kind === "oeffnung" ? opt?.durchbruchSymbol !== false : e.kind === "door" ? false : opt?.fensterSymbol !== false) && <line x1={X(ax)} y1={Z(az)} x2={X(bx)} y2={Z(bz)} stroke="#3b82f6" strokeWidth="0.9" />}
            {/* 108-05: hull doors get the DIN 1356-1 symbol (before: rectangle only); sliding doors keep the plain line */}
            {e.kind === "door" && opt?.tuerAufschlag !== false && e.typeId !== "sliding" && (
              <TuerSymbolSvg P={(u, q) => ({ x: cxm + dx * u + nx * q, z: czm + dz * u + nz * q })} X={X} Z={Z}
                t={{ breite_m: hw * 2, dicke_m: wallThicknessM(w), ...tuerFelder(e), innenSeite: innenSeiteVon(w, model?.footprint), fluegel: e.typeId === "doubleLeaf" ? 2 : 1 }} look={{ stroke: "#0f766e", strokeWidth: "1" }} />
            )}
            {e.kind === "door" && e.typeId === "sliding" && <line x1={X(ax)} y1={Z(az)} x2={X(bx)} y2={Z(bz)} stroke="#0f766e" strokeWidth="1" />}
          </g>
        );
      })}

      {/* ---- Platzierte Fenster/Türen als Symbol auf der Wand ---- */}
      {show("openings") && (edit?.customWindows || []).map((cw, i) => {
        const w = customWalls.find((x) => x._idx === cw.wallIdx); if (!w) return null;
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
        const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
        const nx = -dz, nz = dx; const ty = oeffnungsTyp(cw); // 107-04: own width/height of the record first
        const hw = ty.w / 2, hh = (wallThicknessM(w) / 2) + 0.05;
        const vo = wandGeometrie(w).versatz_m; // 107-01: symbol in the wall body, shifted by the reference line (0 for "center")
        const cu = oeffnungMitte_m(cw.u, ty.w, len); // 107-04: position kept in the wall like IFC and 3D
        const cxm = w.a.x + dx * cu - dz * vo, czm = w.a.z + dz * cu + dx * vo;
        const ax = cxm - dx * hw, az = czm - dz * hw, bx = cxm + dx * hw, bz = czm + dz * hw;
        const sel = edit?.selected?.type === "opening" && edit.selected.index === cw._idx;
        const onClick = (e) => { if (edit?.tool === "arrow" && edit.onPick) { e.stopPropagation(); edit.onPick({ type: "opening", index: cw._idx, scope: "custom" }, e.shiftKey); } };
        const style = { cursor: edit?.tool === "arrow" ? "pointer" : cursor };
        const handle = sel && edit?.tool === "arrow"
          ? <Handle x={X(cxm)} y={Z(czm)} onDown={(ev) => startDrag(ev, { kind: "opening", idx: cw._idx })} />
          : null;
        // Grundriss-Bedienung part 1: invisible hit band around the opening (TREFFER_PX screen px), part of the group so its click picks it
        const treffer = edit?.tool === "arrow" ? <path d={`M${X(ax + nx * hh)},${Z(az + nz * hh)} L${X(bx + nx * hh)},${Z(bz + nz * hh)} L${X(bx - nx * hh)},${Z(bz - nz * hh)} L${X(ax - nx * hh)},${Z(az - nz * hh)} Z`}
          fill="none" stroke="transparent" strokeWidth={px(2 * TREFFER_PX)} strokeLinejoin="round" pointerEvents="stroke" data-oeffnung-treffer={cw._idx} /> : null;
        if (cw.kind === "door" && opt?.tuerAufschlag !== false && cw.typeId !== "sliding") {
          // 108-05: DIN 1356-1 symbol from the one helper — hinge on the wall face of the swing side, anschlag/aufschlag from the record
          // (defaults links/innen = the old picture's side), swing as a polyline (no arc flag that a mirrored axis could flip). The opening cut
          // in the wall stays visible as the jamb-to-jamb rectangle so the door is still clickable.
          return (
            <g key={`cop${i}`} onClick={onClick} style={style} data-oeffnung={cw._idx} data-rahmen={cw.rahmen || undefined} data-glas={cw.glas || undefined}>
              <path d={`M${X(ax + nx * hh)},${Z(az + nz * hh)} L${X(bx + nx * hh)},${Z(bz + nz * hh)} L${X(bx - nx * hh)},${Z(bz - nz * hh)} L${X(ax - nx * hh)},${Z(az - nz * hh)} Z`} fill="#fef3c7" stroke="none" />
              {treffer}
              <TuerSymbolSvg P={(u, q) => ({ x: cxm + dx * u + nx * q, z: czm + dz * u + nz * q })} X={X} Z={Z}
                t={{ breite_m: ty.w, dicke_m: wallThicknessM(w), ...tuerFelder(cw), innenSeite: 1, fluegel: cw.typeId === "doubleLeaf" ? 2 : 1 }} look={{ stroke: sel ? "#0d9488" : "#0f766e", strokeWidth: sel ? "1.4" : "1" }} />
              {handle}
            </g>
          );
        }
        return (
          <g key={`cop${i}`} onClick={onClick} style={style} data-oeffnung={cw._idx} data-rahmen={cw.rahmen || undefined} data-glas={cw.glas || undefined}>
            {treffer}
            <path d={`M${X(ax + nx * hh)},${Z(az + nz * hh)} L${X(bx + nx * hh)},${Z(bz + nz * hh)} L${X(bx - nx * hh)},${Z(bz - nz * hh)} L${X(ax - nx * hh)},${Z(az - nz * hh)} Z`}
              fill={cw.kind === "oeffnung" ? "#ffffff" : cw.kind === "door" ? "#fef3c7" : "#dbeafe"} stroke={sel ? "#0d9488" : "#60a5fa"} strokeWidth={sel ? "1.2" : "0.6"} strokeDasharray={cw.kind === "oeffnung" && opt?.durchbruchSymbol !== false ? "2 2" : undefined} />
            {(cw.kind === "oeffnung" ? opt?.durchbruchSymbol !== false : cw.kind === "door" ? false : opt?.fensterSymbol !== false) && <line x1={X(ax)} y1={Z(az)} x2={X(bx)} y2={Z(bz)} stroke="#3b82f6" strokeWidth="0.9" />}
            {handle}
          </g>
        );
      })}

      {/* ---- Griffe (Handles) für ausgewähltes Element ---- */}
      {edit?.tool === "arrow" && edit.selected?.type === "wall" && (() => {
        const w = customWalls.find((x) => x._idx === edit.selected.index);
        if (!w) return null;
        const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
        return (
          <g>
            {/* Referenzlinie (a-b) sichtbar machen */}
            <line x1={X(w.a.x)} y1={Z(w.a.z)} x2={X(w.b.x)} y2={Z(w.b.z)} stroke="#0ea5a4" strokeWidth="1" strokeDasharray="3 2" />
            <Handle x={X(w.a.x)} y={Z(w.a.z)} onDown={(e) => startDrag(e, { kind: "wallA", idx: w._idx })} />
            <Handle x={X(w.b.x)} y={Z(w.b.z)} onDown={(e) => startDrag(e, { kind: "wallB", idx: w._idx })} />
            <Handle x={X(mid.x)} y={Z(mid.z)} square onDown={(e) => startDrag(e, { kind: "wallMid", idx: w._idx, last: { x: mid.x, z: mid.z } })} />
          </g>
        );
      })()}
      {edit?.tool === "arrow" && edit.selected?.type === "column" && (() => {
        const c = customCols.find((x) => x._idx === edit.selected.index);
        if (!c) return null;
        return <Handle x={X(c.x)} y={Z(c.z)} onDown={(e) => startDrag(e, { kind: "col", idx: c._idx })} />;
      })()}

      {/* ---- Zeichen-Vorschau (Wand-Kette) ---- */}
      {draft.length > 0 && (
        <g style={{ pointerEvents: "none" }}>
          {draft.map((p, i) => i < draft.length - 1 && (
            <line key={`d${i}`} x1={X(p.x)} y1={Z(p.z)} x2={X(draft[i + 1].x)} y2={Z(draft[i + 1].z)} stroke="#0ea5a4" strokeWidth="2" strokeDasharray="4 3" />
          ))}
          {/* Schließ-Vorschau zurück zum ersten Punkt (Polygon-Werkzeuge) */}
          {draft.length >= 3 && (
            <line x1={X(draft[draft.length - 1].x)} y1={Z(draft[draft.length - 1].z)} x2={X(draft[0].x)} y2={Z(draft[0].z)} stroke="#0ea5a4" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
          )}
          {hover && (
            <line x1={X(draft[draft.length - 1].x)} y1={Z(draft[draft.length - 1].z)} x2={X(hover.x)} y2={Z(hover.z)} stroke="#0ea5a4" strokeWidth="1.5" strokeDasharray="2 3" />
          )}
          {draft.map((p, i) => <circle key={`dp${i}`} cx={X(p.x)} cy={Z(p.z)} r="2.5" fill="#0ea5a4" />)}
          {hover && draft.length > 0 && (() => {
            const a = draft[draft.length - 1];
            const len = Math.hypot(hover.x - a.x, hover.z - a.z);
            return <text x={X((a.x + hover.x) / 2)} y={Z((a.z + hover.z) / 2) - px(4)} textAnchor="middle" fontSize={px(9)} className="fill-teal-700" transform={aufrecht(X((a.x + hover.x) / 2), Z((a.z + hover.z) / 2))}>{fmtLen(len, unit)}</text>;
          })()}
        </g>
      )}
      {/* Fadenkreuz-Vorschau für Stütze */}
      {edit?.tool === "column" && hover && (
        <rect x={X(hover.x - 0.2)} y={Z(hover.z - 0.2)} width={0.4 * SCALE} height={0.4 * SCALE} fill="#0ea5a4" opacity="0.5" />
      )}

      {/* Raumlabel (Beschriftung) — klick-durchlässig, sonst blockiert es die Auswahl.
          75-11 Task 4 (MSB-5): screen pixels via px() + short name; area with
          0 decimals. Review 23.09.: the storey label sits at the plan centre,
          exactly where the corridor zone's label lands (customZones) — two
          label sources, one spot. When zone labels are shown on this level the
          rooms already describe the storey, so the storey label yields. */}
      {show("labels") && space
        && !(show("zones") && (customZones || []).some((z) => z.level === level && z.points && z.points.length >= 3)) && (
        <text data-plan-label x={X(cx)} y={Z(cz)} textAnchor="middle" className="fill-slate-700" fontSize={px(11)} fontWeight="600" transform={aufrecht(X(cx), Z(cz))} style={{ pointerEvents: "none" }}>
          {kurzRaumname(space.name)}
          <tspan x={X(cx)} dy={px(13)} fontSize={px(9)} className="fill-slate-400" fontWeight="400">{`${Math.round(areaM2).toLocaleString("de-DE")} m²`}</tspan>
        </text>
      )}
      {/* Bemaßung — automatisch & dezent: Öffnungsketten je Hüllkante mit
          Gesamtmaß außen (75-15, <Masskette>) + Wandlängen. The two bbox
          DimLines of before are gone: every hull chain carries its own
          overall dimension, so the bbox totals were a second, redundant row.
          show("dimensions") stays the switch. */}
      {show("dimensions") && autoDims()}
      {/* Mehrfachauswahl (aus Markierungsrahmen) hervorheben */}
      {edit?.tool === "arrow" && (edit?.multiSel?.length > 0) && (
        <g style={{ pointerEvents: "none" }}>
          {edit.multiSel.map((m, i) => {
            if (m.type === "wall") { const w = customWalls.find((x) => x._idx === m.index); if (!w) return null; const r = wallRectXZ(w); return <path key={i} d={`M${X(r[0].x)},${Z(r[0].z)} L${X(r[1].x)},${Z(r[1].z)} L${X(r[2].x)},${Z(r[2].z)} L${X(r[3].x)},${Z(r[3].z)} Z`} fill="#0d9488" fillOpacity="0.15" stroke="#0d9488" strokeWidth="1.5" strokeDasharray="3 2" />; }
            if (m.type === "column") { const c = customCols.find((x) => x._idx === m.index); if (!c) return null; const s = c.size || 0.4; return <rect key={i} x={X(c.x - s / 2)} y={Z(c.z - s / 2)} width={s * SCALE} height={s * SCALE} fill="none" stroke="#0d9488" strokeWidth="1.5" />; }
            if (m.type === "opening") { const cw = (edit.customWindows || []).find((x) => x._idx === m.index); if (!cw) return null; const w = customWalls.find((x) => x._idx === cw.wallIdx); if (!w) return null; const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1; const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len; return <circle key={i} cx={X(w.a.x + dx * cw.u)} cy={Z(w.a.z + dz * cw.u)} r="6" fill="none" stroke="#0d9488" strokeWidth="1.5" />; }
            const arr = m.type === "zone" ? customZones : m.type === "slab" ? customSlabs : m.type === "roof" ? customRoofs : null;
            if (arr) { const o = (arr || []).find((x) => x._idx === m.index); if (!o || !o.points) return null; const d = o.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z"; return <path key={i} d={d} fill="#0d9488" fillOpacity="0.12" stroke="#0d9488" strokeWidth="1.5" strokeDasharray="3 2" />; }
            return null;
          })}
        </g>
      )}
      {/* Markierungsrahmen (Gummiband): blau = umschließend, grün-gestrichelt = berührend */}
      {marquee && (() => {
        const x = Math.min(X(marquee.x0), X(marquee.x1)), y = Math.min(Z(marquee.z0), Z(marquee.z1));
        const w = Math.abs(X(marquee.x1) - X(marquee.x0)), h = Math.abs(Z(marquee.z1) - Z(marquee.z0));
        const crossing = gedreht ? imBild(X(marquee.x1), Z(marquee.z1)).x < imBild(X(marquee.x0), Z(marquee.z0)).x : marquee.x1 < marquee.x0; // 115-04: as seen
        return <rect x={x} y={y} width={w} height={h} fill={crossing ? "#22c55e" : "#0ea5e9"} fillOpacity="0.12" stroke={crossing ? "#16a34a" : "#0284c7"} strokeWidth="1" strokeDasharray={crossing ? "4 3" : undefined} style={{ pointerEvents: "none" }} />;
      })()}
      {/* ---- Fachlayer-Overlay (Phase 34, PW-01): Render-Prop mit LIVE-Transformatoren.
           SCALE/X/Z hängen an der Modell-BBox — Overlays dürfen sie NIE cachen. */}
      {overlay && (
        <g data-plan-overlay>
          {overlay({
            X, Z, SCALE, level, mode: "grundriss", toMeters, rawMeters, bounds: bb, zoom: viewT.zoom,
            // 75-09 (additiv — Bestands-Overlays lesen die neuen Felder nicht):
            // px = Letterbox-korrekte Bildschirm-px → viewBox-Einheiten (MSB-16);
            // pxJeM = CSS-px je Meter auf dem Bildschirm (echte Bildskala);
            // massstab = gesetzter Maßstabs-Nenner (null = kein Maßstabsmodus);
            // sicht = aktueller ViewBox-Ausschnitt in viewBox-Einheiten.
            px: vp.pxBild, pxJeM: bildschirmPxJeM, massstab,
            sicht: vp.sicht,
            // 115-04 (additive): the overlay is drawn inside the turned drawing. drehung = degrees counter-clockwise as seen (0 = not
            // turned); aufrecht(x, y) = SVG transform that keeps a text / symbol horizontal about its base point (viewBox units),
            // undefined for 0. Geometry needs nothing — it turns with the plan. `sicht` stays the frame the reader sees.
            drehung: gedreht, aufrecht,
          })}
        </g>
      )}
      </PlanDrehGruppe>
      <ScaleBar x={12} y={H - 14} scale={SCALE} />
      <NorthArrow x={W - 26} y={26} drehung={gedreht} />
    </svg>
      {/* Live-Koordinaten unter dem Cursor */}
      <div className="absolute bottom-2 left-2 rounded bg-white/90 border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 font-mono pointer-events-none select-none">
        {cursorM ? `X ${fmtLen(cursorM.x, unit)}   Z ${fmtLen(cursorM.z, unit)}` : "—"}
      </div>
      {/* Zoom-Steuerung */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[11px]">
        <button onClick={() => vp.zoomBy(1 / 1.2)} className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Verkleinern" title="Verkleinern">−</button>
        <span className="px-1 tabular-nums text-slate-500 select-none" title="Zoom-Stufe">{Math.round(viewT.zoom * 100)}%</span>
        <button onClick={() => vp.zoomBy(1.2)} className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Vergrößern" title="Vergrößern">+</button>
        <button onClick={vp.resetView} className="h-6 px-1.5 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Ansicht zurücksetzen" title="Zoom/Verschiebung zurücksetzen">⌖</button>
      </div>
    </div>
  );
}

// =====================  SCHNITT (z = 0)  ===================================
function Schnitt({ model: modellRoh, storeyHeight, layerVis, unit = "m", maxSvgH = 460, brille = null, huelleStatus = null, sw = false, schnittFlaechen = null, ansicht = null, dach = null, achse = null, gelaende = null }) {
  // 97-04b: the cut hull walls take the status look of the lens (null = today's hatch).
  const lk = planDarstellung(brille, huelleStatus, { sw });
  const { t } = useI18n();
  // 108-01: section B-B (`achse` "z") turns the model so everything below keeps cutting at z = 0 (referenz.modellImSchnitt); "x" or
  // none = the model itself. `dach` (globalesDach of the studio) adds the cut roof plate along the same line: its underside is the
  // roof surface, its top the IFC plate thickness above it (dachSchnittLinie). Without `dach` the output is the same as before.
  const model = modellImSchnitt(modellRoh, achse);
  const dachUnten = dach ? dachSchnittLinie(dach, achse === "z" ? "z" : "x", 0) : null;
  const dachOben = dachUnten ? dachSchnittLinie(dach, achse === "z" ? "z" : "x", 0, { dicke_m: GLOBAL_DACH_DICKE_M }) : null;
  // user finding 15.11.2026 ("im Schnitt ist das Dach nicht zu sehen"): the roof faces behind the cut in elevation (a section along the
  // ridge shows only a strip of the cut plate), and a cut wall reaches up to the roof underside where the roof lies above it (gable wall)
  const dachAnsicht = dach ? dachAnsichtImSchnitt(dach, achse === "z" ? "z" : "x") : [];
  // (with a parapet the walls keep ending at the eaves, where the parapet stands — review 108-01)
  const wandOK = (/** @type {{von_m: number, bis_m: number}} */ w) => (show("attika") && (model.parapetHeight || 0) > 0 ? globaleTraufhoehe_m(model) : wandOberkanteUnterDach(dachUnten, w.von_m, w.bis_m, globaleTraufhoehe_m(model)));
  const L = layerVis || {};
  const show = (id) => L[id] !== false;
  const fp = model.footprint;
  const bb = bboxXZ(fp);
  const wM = bb.maxX - bb.minX;
  const totalH = model.totalHeight;
  // 108-02 (D-EFH-01): with a knee wall the cut side walls end at the eaves (model.traufhoehe_m), the parapet stands there and the
  // dimension "Kniestock" runs from the top of the structural slab to the eaves; without one `wandOben` is totalH (output as before)
  const wandOben = globaleTraufhoehe_m(model);
  const knie = Number.isFinite(Number(model.kniestock_m)) && model.kniestock_m != null ? Number(model.kniestock_m) : null;
  const paraH = show("attika") ? (model.parapetHeight || 0) : 0;
  // 108-01 review: the parapet stands on the eaves (top = totalH + paraH, like the PDF section vektorPlan.schnittGrafik), never on the
  // ridge; only the drawing height and the scale follow the roof
  const attikaOK = wandOben + paraH;
  // 108-01: with a pitched roof the drawing (and the scale) reaches up to the top of the cut roof plate at the ridge
  const topH = dachOben ? Math.max(attikaOK, ...dachOben.punkte.map((p) => p.h_m)) : attikaOK;
  const PAD = 4;
  // 107-13 (D-BK-20): depth of the basements below ±0.00 in m (0 without basements = every value below exactly as before)
  const untiefe = Math.max(0, -(Number(model.fusshoehe_m) || 0));
  // 108-10: terrain profiles along this section (existing ground dashed, new ground solid, cut and fill marked — the rule of the PDF
  // section, vektorPlan.schnittGrafik). The drawing reaches down to the lowest terrain point; without profiles everything is as before.
  const glBestand = Array.isArray(gelaende?.bestand) && gelaende.bestand.length >= 2 ? gelaende.bestand : null;
  const glNeu = Array.isArray(gelaende?.neu) && gelaende.neu.length >= 2 ? gelaende.neu : null;
  const glTief = Math.max(0, ...[...(glBestand || []), ...(glNeu || [])].map((q) => -q.h_m));
  const unten = Math.max(untiefe, glTief);
  // labels of the terrain lines: at the left end of each line, baseline `unter` px below it (the existing ground under a new one
  // one line lower) — the level marks keep clear of these bands (schnittMassLayout `gesperrt`)
  /** @type {Array<{art: "bestand"|"neu", h_m: number, s_m: number, unter: number, text: string}>} */
  const glLabel = [
    ...(glNeu ? [{ art: /** @type {"neu"} */ ("neu"), h_m: glNeu[0].h_m, s_m: glNeu[0].s_m, unter: 11, text: t("Gelände neu") }] : []),
    ...(glBestand ? [{ art: /** @type {"bestand"} */ ("bestand"), h_m: glBestand[0].h_m, s_m: glBestand[0].s_m, unter: glNeu ? 22 : 11,
      text: glNeu ? t("Gelände Bestand") : gelaende?.annahme ? t("Gelände (Höhenmodell, Annahme)") : t("Gelände") }] : []),
  ];
  const SCALE = Math.min(620 / (wM + PAD * 2), 360 / (topH + unten + PAD * 2));
  // 115-02 (W-1115-05): level marks (left) and height chains (right) from ONE layout shared with the PDF section (schnittMasse.js) —
  // no text on another one. Drawing unit = viewBox px, so jeM = SCALE; numbers follow the `unit` prop like the floor plan chains
  // (metres: two decimals, comma, no unit sign).
  const massZahl = unit && unit !== "m" ? (/** @type {number} */ m) => fmtLen(m, unit, false) : formatMeter;
  /** @type {Record<string, string>} */
  const koteName = { dach: "OK Dach", traufe: t("Traufe"), first: t("First"), attika: "OK Attika" };
  const massInhalt = schnittMassInhalt({ storeys: model.storeys, totalH_m: totalH, wandOben_m: wandOben, kniestock_m: knie, attika_m: paraH, dachLinie: dachUnten });
  const masse = schnittMassLayout({
    ketten: show("dimensions") ? massInhalt.ketten : [],
    koten: show("labels") ? massInhalt.koten.map((k) => ({ ...k, text: k.art === "geschoss" ? `${k.name} · ${koteText(k.h_m)}` : `${koteName[k.art]} ${koteText(k.h_m)}` })) : [],
    jeM: SCALE, schrift: SCHNITT_SCHRIFT_PX, format: massZahl, namen: { kniestock: t("Kniestock") },
    // the ground label "Gelände ±0,00" (107-13, below: baseline 11 px under ±0,00, 9 px text) stands in the column of the marks
    // 108-10: with terrain profiles the terrain labels stand there instead (below their line at its left end, see glLabel)
    gesperrt: !show("labels") ? [] : glLabel.length
      ? glLabel.map((l) => ({ h_m: l.h_m, von: -(l.unter + 0.2 * SCHNITT_SCHRIFT_PX), bis: -(l.unter - 0.8 * SCHNITT_SCHRIFT_PX) }))
      : untiefe > 0 ? [{ h_m: 0, von: -(11 + 0.2 * SCHNITT_SCHRIFT_PX), bis: -(11 - 0.8 * SCHNITT_SCHRIFT_PX) }] : [],
  });
  // 115-02: the margins grow beyond PAD (m) where the marks, the chains or the width chain above the scale bar need more room (tall or
  // narrow buildings: PAD · SCALE gets small); with enough room every coordinate is the one before
  const padL = Math.max(PAD, (masse.links.breite + SCHNITT_RAND_PX) / SCALE), padR = Math.max(PAD, (masse.rechts.breite + SCHNITT_RAND_PX) / SCALE);
  const padU = Math.max(PAD, SCHNITT_UNTEN_PX / SCALE);
  const W = (wM + (padL + padR)) * SCALE, H = (topH + unten + (PAD * 2 + padU)) * SCALE;
  const X = (x) => (x - bb.minX + padL) * SCALE;
  const Y = (y) => H - (padU + unten) * SCALE - y * SCALE;
  const glPfad = (/** @type {Array<{s_m: number, h_m: number}>} */ pr) => pr.map((q, i) => `${i ? "L" : "M"}${X(q.s_m)},${Y(q.h_m)}`).join(" ");
  // the ground the building stands in: the new one, else the existing one — drawn outside the building only (it stops at the outer
  // faces); the existing ground under a new one runs through as the dashed line of the original terrain
  const glMassgebend = glNeu || glBestand;
  const glAussen = (/** @type {Array<{s_m: number, h_m: number}>|null} */ pr) => profilAussen(pr, bb.minX, bb.maxX);
  const glBestandAussen = glAussen(glBestand), glNeuAussen = glAussen(glNeu);
  // 107-13: cut basement walls from ±0.00 down to the lowest basement (build-up of the basement walls, bauteil/referenz.js)
  const ugWaende = ugSchnittWaende(model);
  // 107-01: cut side walls from the one derivation of @core (follows the hull reference line `huelle_bezug`)
  const sideWalls = huellSchnittWaende(model);
  // 107-09: with the switch "Wände verschneiden" the cut hull walls with a build-up come per layer from the solid (or the bands); the
  // rectangle of a wall is left out only where layers replace it (review 107-09: same side, above / below ground — the rule of the PDF
  // section, vektorPlan.schnittErsetzt). Without hull entries everything stays as before.
  const vSchnitt = Array.isArray(schnittFlaechen) ? schnittFlaechen : [];
  // review 107-12: the structure display of the view drops cut layers by the function of their own wall's layer — the same helper as
  // the PDF section (schnittGruppenNachStruktur); the rectangles keep testing the unfiltered groups (the gap of a hidden layer stays)
  const vSichtbar = schnittGruppenNachStruktur(vSchnitt, model.walls, ansicht?.strukturdarstellung);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: maxSvgH }}>
      <rect x="0" y="0" width={W} height={H} fill="#f8fafc" />
      {!glMassgebend && <line x1="0" y1={Y(0)} x2={W} y2={Y(0)} stroke="#94a3b8" strokeWidth="1.5" />}
      {!glMassgebend && <rect x="0" y={Y(0)} width={W} height={H - Y(0)} fill="#eef2f4" />}
      {glMassgebend && (
        <g data-testid="schnitt-gelaende">
          {/* earth below the ground the building stands in */}
          {(glNeu ? glNeuAussen : glBestandAussen).map((teil, i) => (
            <path key={`erde${i}`} d={`${glPfad(teil)} L${X(teil[teil.length - 1].s_m)},${H} L${X(teil[0].s_m)},${H} Z`} fill="#eef2f4" />
          ))}
          {glBestand && glNeu && glBestandAussen.flatMap((b, i) => (glNeuAussen[i] ? profilFlaechen(b, glNeuAussen[i]) : [])).map((f, i) => (
            <path key={`ef${i}`} d={`${glPfad(f.pts)} Z`} fill={sw ? "none" : ERDBAU_FARBE[f.art]} fillOpacity="0.7" stroke="#64748b" strokeWidth="0.3" strokeDasharray={f.art === "abtrag" ? "1 1.5" : undefined} data-erdbau={f.art} />
          ))}
          {glBestand && glNeu && <path d={glPfad(glBestand)} fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="5 3" data-gelaende="bestand" />}
          {glBestand && !glNeu && glBestandAussen.map((teil, i) => <path key={`gb${i}`} d={glPfad(teil)} fill="none" stroke="#334155" strokeWidth="1.5" data-gelaende="bestand" />)}
          {glNeu && glNeuAussen.map((teil, i) => <path key={`gn${i}`} d={glPfad(teil)} fill="none" stroke="#334155" strokeWidth="1.5" data-gelaende="neu" />)}
          {show("labels") && glLabel.map((l) => (
            <text key={l.art} x={X(l.s_m) + 2} y={Y(l.h_m) + l.unter} fontSize="9" className="fill-muted-foreground" data-gelaende-label={l.art}>{l.text}</text>
          ))}
        </g>
      )}
      {show("attika") && dachAnsicht.map((ring, i) => (
        <g key={`da${i}`} data-dachansicht={achse === "z" ? "z" : "x"}>
          <path d={ring.map((q, k) => `${k ? "L" : "M"}${X(q.s_m)},${Y(q.h_m)}`).join(" ") + " Z"} fill="#f1f5f9" stroke="#64748b" strokeWidth="0.8" />
          {/* rafter lines: the face reads as an inclined roof seen from inside, not as a wall or a flat roof */}
          {dachFalllinienImSchnitt(ring).map(([a, b], k) => <line key={k} x1={X(a.s_m)} y1={Y(a.h_m)} x2={X(b.s_m)} y2={Y(b.h_m)} stroke="#94a3b8" strokeWidth="0.5" />)}
          {show("labels") && (
            <text x={X((Math.min(...ring.map((q) => q.s_m)) + Math.max(...ring.map((q) => q.s_m))) / 2)} y={Y((Math.min(...ring.map((q) => q.h_m)) + Math.max(...ring.map((q) => q.h_m))) / 2) + 3}
              textAnchor="middle" fontSize="9" className="fill-muted-foreground" stroke="#f1f5f9" strokeWidth="3" paintOrder="stroke" data-dachansicht-text>{t("Dachfläche in Ansicht")}</text>
          )}
        </g>
      ))}
      {show("shell") && model.slabs.map((s, i) => {
        const lage = deckenLage(s, undefined, "huelle");
        // 108-02: the collar-beam floor is clipped to the roof — drawn only where its outline crosses the section line
        if (s.kehlbalkenlage) {
          const sp = umrissSpanneBeiZ(s.polygon, 0);
          return sp ? <rect key={`s${i}`} x={X(sp.von_m)} y={Y(lage.oberkante_m)} width={(sp.bis_m - sp.von_m) * SCALE} height={lage.dicke_m * SCALE} fill="#9aa6b2" stroke="#64748b" strokeWidth="0.4" data-kehlbalkenlage="1" /> : null;
        }
        return <rect key={`s${i}`} x={X(bb.minX)} y={Y(lage.oberkante_m)} width={wM * SCALE} height={lage.dicke_m * SCALE} fill="#9aa6b2" stroke="#64748b" strokeWidth="0.4" />;
      })}
      {show("shell") && vSichtbar.map((f, i) => (
        <path key={`vs${i}`} d={f.ringe.map((/** @type {Array<{x: number, h: number}>} */ r) => r.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Y(p.h)}`).join(" ") + " Z").join(" ")} fillRule="evenodd"
          fill={lk ? (lk.leer ? "none" : lk.fill) : f.color || "url(#hatch)"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth="0.4" data-schnittschicht={`${f.schluessel}:${f.schicht}`} data-verschneidung={f.quelle} />
      ))}
      {show("shell") && sideWalls.map((sw, i) => schnittErsetzt(vSchnitt, sw, false) ? null : (
        <rect key={`sw${i}`} x={X(sw.von_m)} y={Y(wandOK(sw))} width={sw.dicke_m * SCALE} height={wandOK(sw) * SCALE} fill={lk ? (lk.leer ? "none" : lk.fill) : "url(#hatch)"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth={lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash} opacity={lk?.opacity} data-schnittwand={i} data-status={huelleStatus || undefined} />
      ))}
      {show("shell") && ugWaende.map((uw, i) => schnittErsetzt(vSchnitt, uw, true) ? null : (
        <rect key={`ugw${i}`} x={X(uw.von_m)} y={Y(uw.oben_m)} width={uw.dicke_m * SCALE} height={(uw.oben_m - uw.unten_m) * SCALE} fill={lk ? (lk.leer ? "none" : lk.fill) : "url(#hatch)"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth={lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash} opacity={lk?.opacity} data-schnittwand={`ug${i}`} data-unterirdisch="1" data-status={huelleStatus || undefined} />
      ))}
      {/* 108-01: cut roof plate of the global roof form (underside = roof surface, top = plate thickness above it), roof layer like 3D */}
      {show("attika") && dachUnten && dachOben && (
        <path d={[...dachUnten.punkte, ...[...dachOben.punkte].reverse()].map((p, k) => `${k ? "L" : "M"}${X(p.s_m)},${Y(p.h_m)}`).join(" ") + " Z"}
          fill={lk ? (lk.leer ? "none" : lk.fill) : "url(#hatch)"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth={lk ? lk.strokeWidth : "0.6"}
          strokeDasharray={lk?.dash} opacity={lk?.opacity} data-dachschnitt={achse === "z" ? "z" : "x"} />
      )}
      {/* 107-13 [ASSUMED] terrain = ±0.00 (assumption A4): the basement counts as fully below ground on every side; way to the real
          value: the terrain profile from the height grid (gelaende.js hoeheAn) with plan 107-10. Named once there are basements below it */}
      {show("labels") && untiefe > 0 && !glMassgebend && <text x={X(bb.minX) - 10} y={Y(0) + 11} textAnchor="end" fontSize="9" className="fill-muted-foreground" data-gelaende-label>{t("Gelände ±0,00")}</text>}
      {/* Attika (Brüstung) auf dem Dach */}
      {paraH > 0 && sideWalls.map((sw, i) => (
        <rect key={`pa${i}`} x={X(sw.von_m)} y={Y(attikaOK)} width={sw.dicke_m * SCALE} height={paraH * SCALE} fill="url(#hatch)" stroke="#1e293b" strokeWidth="0.6" />
      ))}
      {show("openings") && model.storeys.map((st) => {
        const back = model.walls.find((w) => w.level === st.level);
        if (!back) return null;
        return windowsAlong(back).map((win, k) => {
          const cxm = back.a.x + (back.b.x - back.a.x) * win.t;
          if (cxm < bb.minX || cxm > bb.maxX) return null;
          const sill = st.elevation + AUTO_WINDOW.sill, top = sill + AUTO_WINDOW.height;
          return <rect key={`fw${st.level}-${k}`} x={X(cxm) - 0.7 * SCALE} y={Y(top)} width={1.4 * SCALE} height={(top - sill) * SCALE} fill="#dbeafe" stroke="#60a5fa" strokeWidth="0.6" />;
        });
      })}
      {show("labels") && model.storeys.map((st) => (
        <line key={`lvl${st.level}`} x1={X(bb.minX) - 6} y1={Y(st.elevation)} x2={X(bb.maxX)} y2={Y(st.elevation)} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="3 3" />
      ))}
      {/* 115-02: level marks in one column (DIN 1356-1: triangle with its tip on the level, value with sign and decimal comma); a mark
          too close to the one above hangs below its level, one without a free place is left out (schnittMasse.js). 108-01: a pitched
          roof has the marks eaves and ridge instead of "OK Dach" */}
      {masse.links.koten.map((k, i) => {
        const q = (/** @type {{dx: number, h_m: number, dy: number}} */ p) => `${X(bb.minX) - p.dx},${Y(p.h_m) - p.dy}`;
        return (
          <g key={`kote${i}`} className={k.art === "geschoss" ? "fill-muted-foreground" : "fill-foreground"} style={{ pointerEvents: "none" }}>
            <line x1={X(bb.minX) - k.linie.a.dx} y1={Y(k.h_m)} x2={X(bb.minX) - k.linie.b.dx} y2={Y(k.h_m)} stroke="#94a3b8" strokeWidth="0.5" />
            <path d={`M${q(k.dreieck[0])} L${q(k.dreieck[1])} L${q(k.dreieck[2])} Z`} />
            <text x={X(bb.minX) - k.p.dx} y={Y(k.p.h_m) - k.p.dy} textAnchor="end" fontSize={SCHNITT_SCHRIFT_PX} fontWeight={k.art === "geschoss" ? undefined : "600"} data-kote={k.art}>{k.text}</text>
          </g>
        );
      })}
      {show("dimensions") && <>
        {/* 115-02: height chains right of the building, from the inside out: detail (108-02 knee wall = top of the structural slab under
            the top storey up to the eaves; parapet), storey heights, overall heights. Numbers above the line; a piece too short for
            its number carries it beside the chain with a leader; the name "Kniestock" is its own text */}
        <g stroke={MASS_STIL.stroke} strokeWidth="0.8" className={MASS_STIL.klasse} style={{ pointerEvents: "none" }} data-schnittmasse>
          {masse.rechts.linien.map((l, i) => (
            <line key={`ml${i}`} x1={X(bb.maxX) + l.a.dx} y1={Y(l.a.h_m) - l.a.dy} x2={X(bb.maxX) + l.b.dx} y2={Y(l.b.h_m) - l.b.dy} strokeWidth={l.art === "hilf" || l.art === "hinweis" ? "0.4" : undefined} />
          ))}
          {masse.rechts.texte.map((tx, i) => {
            const x = X(bb.maxX) + tx.p.dx, y = Y(tx.p.h_m) - tx.p.dy;
            return <text key={`mt${i}`} x={x} y={y} textAnchor={tx.winkel ? "middle" : "start"} fontSize={SCHNITT_SCHRIFT_PX} stroke="none" transform={tx.winkel ? `rotate(${tx.winkel} ${x} ${y})` : undefined} data-kote={tx.name}>{tx.text}</text>;
          })}
        </g>
        <DimLine x1={X(bb.minX)} y1={Y(-untiefe) + 22} x2={X(bb.maxX)} y2={Y(-untiefe) + 22} label={massZahl(wM)} />
      </>}
      <ScaleBar x={12} y={H - 10} scale={SCALE} />
      <defs>
        <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#cbd5e1" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#64748b" strokeWidth="0.8" />
        </pattern>
      </defs>
    </svg>
  );
}

// ---- Bemaßungslinie / Maßstab / Nordpfeil ---------------------------------
/** 115-02: line colour and text class of the section's dimension lines — one place for DimLine and the height chains. */
const MASS_STIL = { stroke: "#0f766e", klasse: "fill-teal-700" };
/** 115-02: text height of the section's marks and dimensions in viewBox px (the size DimLine always had). */
const SCHNITT_SCHRIFT_PX = 9;
/** 115-02: clear margin outside the level marks / height chains of the section in viewBox px [ASSUMED: a little air to the frame]. */
const SCHNITT_RAND_PX = 6;
/**
 * 115-02: smallest margin below the lowest level of the section in viewBox px: width chain 22 px below it, then the scale bar with its
 * text (H − 23 … H − 7) — 48 px keep the two apart [ASSUMED from those sizes].
 */
const SCHNITT_UNTEN_PX = 48;

/** @param {{x1: number, y1: number, x2: number, y2: number, label: string, vertical?: boolean}} props viewBox units */
function DimLine({ x1, y1, x2, y2, label, vertical }) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return (
    <g stroke={MASS_STIL.stroke} strokeWidth="0.8" className={MASS_STIL.klasse} style={{ pointerEvents: "none" }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - (vertical ? 4 : 0)} y1={y1 - (vertical ? 0 : 4)} x2={x1 + (vertical ? 4 : 0)} y2={y1 + (vertical ? 0 : 4)} />
      <line x1={x2 - (vertical ? 4 : 0)} y1={y2 - (vertical ? 0 : 4)} x2={x2 + (vertical ? 4 : 0)} y2={y2 + (vertical ? 0 : 4)} />
      <text x={vertical ? mx - 6 : mx} y={vertical ? my : my - 4} textAnchor="middle" fontSize="9" stroke="none"
        transform={vertical ? `rotate(-90 ${mx - 6} ${my})` : undefined}>{label}</text>
    </g>
  );
}

// 75-05: named export so the massing studio reuses the same bar (no second one);
// laengeM keeps the 5 m default of BimPlan2D.
export function ScaleBar({ x, y, scale, laengeM = 5 }) {
  const len5 = laengeM * scale;
  return (
    <g style={{ pointerEvents: "none" }}>
      <line x1={x} y1={y} x2={x + len5} y2={y} stroke="#0f172a" strokeWidth="2" />
      <line x1={x} y1={y - 3} x2={x} y2={y + 3} stroke="#0f172a" strokeWidth="1.5" />
      <line x1={x + len5} y1={y - 3} x2={x + len5} y2={y + 3} stroke="#0f172a" strokeWidth="1.5" />
      <text x={x + len5 / 2} y={y - 5} textAnchor="middle" fontSize="8" className="fill-slate-500">{laengeM} m</text>
    </g>
  );
}

// Editier-Griff (Handle) — Kreis (Endpunkt) oder Quadrat (Verschieben). Optional Doppelklick.
/** @param {{x: number, y: number, square?: boolean, onDown?: (e: any) => void, onDouble?: (e: any) => void}} props viewBox units */
function Handle({ x, y, square, onDown, onDouble }) {
  const common = { fill: "#fff", stroke: "#0d9488", strokeWidth: 1.5, style: { cursor: "move" }, onPointerDown: onDown, onDoubleClick: onDouble ? (e) => { e.stopPropagation(); onDouble(e); } : undefined };
  return square
    ? <rect x={x - 4} y={y - 4} width="8" height="8" {...common} />
    : <circle cx={x} cy={y} r="4.5" {...common} />;
}

/**
 * North arrow of the floor plan. 115-04: it turns with the plan (`drehung`, degrees counter-clockwise as seen; north is up on the
 * unturned plan), the letter "N" stays upright and sits behind the arrow's tail. With 0 the markup is the one before 115-04.
 * @param {{x: number, y: number, drehung?: number}} props x, y: centre in viewBox units of the sheet frame
 */
function NorthArrow({ x, y, drehung = 0 }) {
  const w = nordpfeilWinkel(drehung), r = nordRichtung(drehung);
  // letter: 11 units behind the centre against the arrow direction, baseline 3 units lower (for 0: x, y + 14 as before)
  return (
    <g style={{ pointerEvents: "none" }} data-nordpfeil-winkel={w || undefined}>
      <path d={`M${x},${y - 10} L${x + 4},${y + 4} L${x},${y + 1} L${x - 4},${y + 4} Z`} fill="#0f172a" transform={w ? `rotate(${w} ${x} ${y})` : undefined} />
      <text x={x - r.x * 11} y={y - r.y * 11 + 3} textAnchor="middle" fontSize="8" className="fill-slate-500">N</text>
    </g>
  );
}

/**
 * 115-04: the group of the turned floor plan — an SVG group with the frame transform, or a plain fragment when the plan is not
 * turned (so the markup without a rotation has no extra element).
 * @param {{transform?: string, grad: number, children?: import("react").ReactNode}} props transform: SVG matrix of drehRahmen;
 *   grad: rotation in degrees counter-clockwise as seen
 */
function PlanDrehGruppe({ transform, grad, children }) {
  if (!grad) return <>{children}</>;
  return <g transform={transform} data-plan-drehgruppe={grad}>{children}</g>;
}

/**
 * @typedef {object} BimPlan2DProps
 * @property {object} model createBuildingModel-Ergebnis
 * @property {"grundriss"|"schnitt"} mode
 * @property {number} [level] Geschoss (0 = EG)
 * @property {number} [storeyHeight] Geschosshöhe in Metern
 * @property {object} [edit] Editier-Props (siehe unten)
 * @property {object} [layerVis] Sichtbarkeit je Layer-Id
 * @property {any} [brille] 97-04: lens of the core lens register (plan/brillen.js, status look); null = today's look
 * @property {string|null} [huelleStatus] 97-04: status of the generated hull (attribute table "hull-wall")
 * @property {boolean} [sw] 97-04b: black-and-white variant of the permit lens
 * @property {Array<any>|null} [werkstattWaende] 97-04b: workshop walls (with table status) drawn as own elements when they have a status
 * @property {Map<string, {quelle: string, baender: Array<{color: string, name: string, hatch?: string, schicht: number, ringe: Array<Array<{x: number, z: number}>>}>}>|null} [schichtFlaechen]
 *   107-09: cleaned layer outlines per wall key ("env:<level>:<edge>", "cw:<_idx>", m) when the studio intersects walls; null = today's bands
 * @property {Array<{schluessel: string, schicht: number, quelle: string, color?: string, ringe: Array<Array<{x: number, h: number}>>}>|null} [schnittFlaechen]
 *   107-09: cut layers of the intersected walls in the section (x and height in m); null = today's section
 * @property {Array<object>} [envOpenings]
 * @property {Array<object>} [customZones]
 * @property {Array<object>} [customSlabs]
 * @property {Array<object>} [customRoofs]
 * @property {Array<object>|null} [customStairs]  108-06: stairs (symbol in this storey and the one above)
 * @property {Array<object>|null} [gauben]        108-13: dormers (outline in the top storey)
 * @property {Array<object>|null} [vordaecher]    W-1118-29: canopies (outline in their storey)
 * @property {any} [geschosse]                     storey table for the stair heights
 * @property {string} [unit] Längeneinheit (m | cm | mm)
 * @property {boolean} [fuellen] 75-16: viewBox folgt der Fläche (Füllmodus)
 * @property {object} [focus] Zoom-auf-Auswahl {bbox, nonce} | {reset, nonce}
 * @property {boolean} [readOnly]
 * @property {(args: object) => any} [overlay]
 * @property {Array<{x:number,z:number}>} [overlayBounds]
 * @property {number} [height] Container-Höhe in px
 * @property {{strukturdarstellung?: string, optionen?: Partial<Record<string, boolean>>|null, regeln?: any[]|null}|null} [ansicht] 107-12: view state of an applied
 *   view (structure display, options, rules; plan/ansichtszustand.js), null = the plan as before; floor plan AND section read it
 * @property {number|null} [detailMassstab] review 107-12: scale denominator of the level of detail (the studio's chosen scale, the same
 *   value the PDF and the option boxes use); null = the lens's scale as before
 * @property {any} [dach] 108-01: global roof form (globalesDach of dachGeometrie.js) — the section draws the cut roof plate and the
 *   eaves / ridge marks; null = the section as before
 * @property {"x"|"z"|null} [achse] 108-01: section axis, "x" = A-A (line z = 0, as before), "z" = B-B (line x = 0)
 * @property {{bestand?: Array<{s_m: number, h_m: number}>|null, neu?: Array<{s_m: number, h_m: number}>|null, annahme?: boolean}|null} [gelaendeSchnitt]
 *   108-10: terrain profiles along the section line (m along the line, m relative to ±0,00) — existing ground dashed, new ground solid;
 *   annahme = the existing ground comes from the public elevation model. Without it the flat ground line at ±0,00 as before.
 * @property {object|null} [eingang] 108-01: the effective automatic entrance (autoOpenings.entranceOpening) or null when it is off
 *   (D-EFH-04); undefined = drawn as before
 * @property {Array<{x: number, z: number}>|null} [baufeldUmriss] 108-01: building envelope of the site planning in model metres,
 *   drawn dashed with the label "Baufeld"; null = nothing
 * @property {boolean} [baufeldMittig] 108-01 review: the envelope has no position reference to the model (no footprint area, or an
 *   outline from another source) and is centred on the model origin; the label says so
 * @property {number|null} [massstab] 75-09: Maßstabs-Nenner (z. B. 50 für 1:50);
 *   null/undefined = kein Maßstabsmodus (Bestandsverhalten byte-gleich)
 * @property {{customWalls?: Array<object>, customColumns?: Array<object>, customWindows?: Array<object>}} [elements]
 * @property {number} [drehung] 115-04: rotation of the FLOOR PLAN on the screen in degrees counter-clockwise as seen (0 | 90 | 180 |
 *   270; other values are rounded to a quarter turn) — display only, the model and every reported point stay in model metres; the
 *   section is never turned. 0 / absent = the plan as before
 */

/**
 * 2D-Plan aus dem gemeinsamen Gebäudemodell — seit Phase 34 die gemeinsame
 * Viewport-Engine der Fachplaner-Reiter („Plan-Werkstatt").
 *
 * @param {BimPlan2DProps} props (typisiert, Phase 43 — vorher las tsc alle Props ohne Default als Pflicht)
 * @param mode "grundriss" | "schnitt"
 * @param edit optionale Editier-Props { tool, draft, hover, customWalls, customColumns, selected, onPoint, onHover, onFinish, onPick }
 * @param readOnly PW-01: erzwingt den reinen Anzeige-Modus — edit wird komplett
 *   ignoriert (kein Hit-Testing, keine Cursor-Änderung, kein Marquee); Zoom,
 *   Pan und Koordinatenanzeige bleiben aktiv. Für Fachplaner-Reiter, die den
 *   Grundriss nur als Hintergrund brauchen.
 * @param overlay PW-01: Render-Prop für Fachlayer — wird ÜBER allen Plan-Layern
 *   (unter Maßstab/Nordpfeil) gerendert und bekommt LIVE-Transformatoren:
 *   overlay({ X, Z, SCALE, level, mode, toMeters, rawMeters, bounds, zoom,
 *   px, pxJeM, massstab, sicht }).
 *   X(x)/Z(z): Meter → SVG-Einheiten; SCALE: SVG-Einheiten je Meter (BBox-
 *   dynamisch — NIE cachen!); toMeters/rawMeters: Maus-Event → Meter (mit/ohne
 *   0,25-m-Snap); bounds: Modell-BBox in Metern; zoom: aktueller Viewport-Zoom
 *   (für zoombewusste Fang-/Trefferradien). Nur im Grundriss-Modus.
 *   75-09 (additiv): px(n) = n Bildschirm-Pixel → viewBox-Einheiten LETTERBOX-
 *   korrekt (MSB-16 — im höhenbegrenzten SVG exakt, im breitenbegrenzten
 *   identisch zu vp.px); pxJeM = CSS-Pixel je Meter auf dem Bildschirm;
 *   massstab = Maßstabs-Nenner oder null; sicht = {x, y, w, h} des aktuellen
 *   ViewBox-Ausschnitts (viewBox-Einheiten) für an die Sicht geheftete Deko.
 * @param overlayBounds optionale {x,z}-Punkte (Meter), die in die BBox-
 *   Berechnung einfließen, damit Overlay-Inhalte außerhalb des Footprints
 *   nicht abgeschnitten werden.
 * @param height Container-Höhe in px (Default 520 wie bisher). Der SVG-Deckel
 *   folgt gekoppelt (height − 60 — beim Default exakt der alte Wert 460),
 *   damit die Prop den Plan wirklich skaliert und kleine Höhen nicht überlaufen.
 * @param fuellen 75-16: true ⇒ der Plan füllt die ganze Fläche (Breite ×
 *   height − 60 px): die viewBox übernimmt das Seitenverhältnis der Fläche,
 *   der Maßstab bleibt (1:50 exakt), nur der sichtbare Ausschnitt wächst —
 *   statt Leerstreifen neben/über einem breitengebundenen Grundriss.
 *   Default false ⇒ byte-gleich.
 * @param massstab 75-09: Maßstabsmodus (Detailgrad-Nenner; 50 ⇒ 1:50 =
 *   pxJeMeter(50) ≈ 75,59 Bildschirm-px je Meter, 75-08-Konvention). Der Plan
 *   fährt beim Setzen/Zurückkehren (focus.nonce) den Zielzoom an und zentriert
 *   die Fokus-BBox (ohne BBox die Modellmitte); Nutzer-Zoom danach frei.
 *   null/undefined (Default) ⇒ Verhalten für alle Bestandsaufrufer byte-gleich.
 * @param elements Phase 43: gezeichnete Elemente für den readOnly-Modus —
 *   { customWalls, customColumns, customWindows } (Format wie in BitBimStudio,
 *   customWindows.wallIdx → customWalls._idx). Werden gezeichnet, aber nicht
 *   angeklickt/gezogen; im Edit-Modus ohne Wirkung (dort liefert `edit` die
 *   Elemente). Quelle für Fachplaner: usePlanModel(project).customWalls usw.
 *
 * Hinweis für Overlay-Autoren: rein dekorative Overlay-Elemente sollten selbst
 * pointer-events:none setzen, sonst schlucken sie Klicks auf Plan-Elemente
 * darunter; interaktive Overlay-Elemente (z.B. Sketch-Handles) dürfen Events
 * bewusst behalten.
 */
export default function BimPlan2D({ model, mode, level = 0, storeyHeight = 3, edit, layerVis, envOpenings, customZones, customSlabs, customRoofs, unit = "m", focus, readOnly = false, overlay, overlayBounds, height = 520, elements, massstab = null, fuellen = false, brille = null, huelleStatus = null, sw = false, werkstattWaende = null, schichtFlaechen = null, schnittFlaechen = null, ansicht = null, detailMassstab = null, dach = null, achse = null, gelaendeSchnitt = null, eingang = undefined, baufeldUmriss = null, baufeldMittig = false, customStairs = null, gauben = null, vordaecher = null, geschosse = null, drehung = 0 }) {
  // 107-13: clamped between the lowest (basement) and the highest storey of the model; the old clamp only bounded the top by the
  // list LENGTH, which is wrong once basements are appended to the list. A model WITHOUT basements keeps the old behaviour for a
  // negative level (planEbene: no clamp downwards) - callers such as WohnungsFokus pass the level of a cellar zone (−1) and draw its
  // rooms there (107-13 review: "without basements the output is unchanged for every existing caller")
  const lvl = useMemo(() => planEbene(model, level), [level, model]);
  if (!model) return null;
  // readOnly: kein Werkzeug, keine Hit-Tests — aber die gezeichneten Innenwände/Stützen/
  // Öffnungen dürfen sichtbar sein (Phase 43). Alle Interaktionspfade im Grundriss hängen an
  // edit.tool === "arrow" bzw. an Callbacks, die hier fehlen.
  const editEff = readOnly
    ? (elements ? { customWalls: elements.customWalls || [], customColumns: elements.customColumns || [], customWindows: elements.customWindows || [] } : undefined)
    : edit;
  const maxSvgH = Math.max(120, height - 60); // 60 px Luft für Zoom-/Koordinaten-Chrome
  return (
    <div className="w-full bg-slate-50 flex items-center justify-center overflow-hidden" style={{ height }} data-bim-plan2d>
      {mode === "schnitt"
        ? <Schnitt model={model} storeyHeight={storeyHeight} layerVis={layerVis} unit={unit} maxSvgH={maxSvgH} brille={brille} huelleStatus={huelleStatus} sw={sw} schnittFlaechen={schnittFlaechen} ansicht={ansicht} dach={dach} achse={achse} gelaende={gelaendeSchnitt} />
        : <Grundriss model={model} level={lvl} edit={editEff} layerVis={layerVis} envOpenings={envOpenings} customZones={customZones} customSlabs={customSlabs} customRoofs={customRoofs} unit={unit} focus={focus} overlay={overlay} overlayBounds={overlayBounds} maxSvgH={maxSvgH} readOnly={readOnly} massstab={massstab} fuellen={fuellen} brille={brille} huelleStatus={huelleStatus} sw={sw} werkstattWaende={werkstattWaende} schichtFlaechen={schichtFlaechen} ansicht={ansicht} detailMassstab={detailMassstab} eingang={eingang} baufeldUmriss={baufeldUmriss} baufeldMittig={baufeldMittig} customStairs={customStairs} gauben={gauben} vordaecher={vordaecher} geschosse={geschosse} dach={dach} drehung={drehung} />}
    </div>
  );
}
