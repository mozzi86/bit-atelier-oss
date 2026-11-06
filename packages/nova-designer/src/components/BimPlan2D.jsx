import React, { useMemo, useRef, useState, useEffect } from "react";
import { oeffnungsMasse, oeffnungsTyp, oeffnungMitte_m } from "@core/lib/bauteil/oeffnungen.js";
import { wandGeometrie, wandDicke_m, huellSchnittWaende, ugSchnittWaende, schnittErsetzt, modellImSchnitt } from "@core/lib/bauteil/referenz.js"; // 107-01: the one reference-line derivation; 108-01: section B-B
import { dachSchnittLinie, GLOBAL_DACH_DICKE_M, umrissSpanneBeiZ } from "@core/lib/bauteil/dachGeometrie.js"; // 108-01: roof triangle in the section; 108-02: collar-beam floor
import { planEbene, globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js"; // 107-13: storey levels incl. basements; 108-02: eaves
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_EFH_108 } from "@core/lib/i18nTeile/efh-108.js"; // 108-01: lazy part (section marks)
import { deckenLage, geschossHoeheAusModell } from "@core/lib/bauteil/hoehen.js"; // 107-02: the one slab thickness/side (was the literal 0.25)
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
import { seiteVon } from "@designer/lib/masskette"; // 75-15: architectural dimension chains
import { regelfensterPasst, AUTO_WINDOW } from "@designer/lib/autoOpenings"; // 108-02: the one rule-window guard (basement, knee wall)
import Masskette from "./Masskette";
englischErgaenzen(EN_EFH_108);

// 75-09: max zoom in fixed-scale mode. [ASSUMED] 48 — with the default view
// (maxZoom 12) even 1:50 on large sites would clamp before reaching the scale;
// 48 keeps 1:50 reachable for buildings up to ≈ 400 m edge length. Only used
// when the `massstab` prop is set; every other caller keeps the hook default.
const MASSSTAB_MAX_ZOOM = 48;

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
 * @param {{groesse: number}} props
 */
function MaterialSchraffuren({ groesse }) {
  const g = Math.max(1.5, groesse);
  const linie = { stroke: "#27272a", strokeWidth: Math.max(0.25, g / 14) };
  return (
    <defs>
      <pattern id="iso-concrete" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2={g} {...linie} /><circle cx={g * 0.55} cy={g * 0.4} r={g / 16} fill="#27272a" />
      </pattern>
      <pattern id="iso-brick" width={g / 2} height={g / 2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2={g / 2} {...linie} />
      </pattern>
      <pattern id="iso-block" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2={g} {...linie} />
      </pattern>
      <pattern id="iso-insul" width={g} height={g / 2} patternUnits="userSpaceOnUse">
        <polyline points={`0,0 ${g / 4},${g / 2} ${g / 2},0 ${(3 * g) / 4},${g / 2} ${g},0`} fill="none" {...linie} />
      </pattern>
      <pattern id="iso-wood" width={g} height={g} patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2={g} y2={g} {...linie} /><line x1={g} y1="0" x2="0" y2={g} {...linie} />
      </pattern>
    </defs>
  );
}

function Grundriss({ model, level, edit, layerVis, envOpenings, customZones, customSlabs, customRoofs, unit = "m", focus, overlay, overlayBounds, maxSvgH = 460, readOnly = false, massstab = null, fuellen = false, brille = null, huelleStatus = null, sw = false, werkstattWaende = null, schichtFlaechen = null, ansicht = null, detailMassstab = null, eingang = undefined, baufeldUmriss = null, baufeldMittig = false }) {
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
  const bb = bboxXZ(all.length >= 3 ? all : fp);
  const PAD = 4;
  const wM = bb.maxX - bb.minX, hM = bb.maxZ - bb.minZ;
  const SCALE = Math.min(620 / (wM + PAD * 2), 360 / (hM + PAD * 2));
  const W = (wM + PAD * 2) * SCALE, H = (hM + PAD * 2) * SCALE;
  const X = (x) => (x - bb.minX + PAD) * SCALE;
  const Z = (z) => (z - bb.minZ + PAD) * SCALE;

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
    const loc = vp.clientToLocal(e); if (!loc) return null;
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
    vp.zoomToBBox({ x0: X(b.minX), x1: X(b.maxX), y0: Z(b.minZ), y1: Z(b.maxZ) }, 30);
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
      ? { x: (X(b.minX) + X(b.maxX)) / 2, y: (Z(b.minZ) + Z(b.maxZ)) / 2 }
      : { x: W / 2, y: H / 2 };
    vp.zoomZentriert(planZoomFuerMassstab(massstab, SCALE, s0), zentrum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [massstab, focus?.nonce, massstabBereit]);

  const dragRef = useRef(null);
  const startDrag = (e, d) => {
    e.stopPropagation(); e.preventDefault();
    if (!dragRef.current) edit?.onGriffStart?.(); // one undo step for the whole grip drag
    dragRef.current = d;
  };

  // Markierungsrahmen auswerten → Liste betroffener Custom-Elemente (umschließend vs. berührend).
  const finalizeMarquee = (m) => {
    const r = { minX: Math.min(m.sx, m.cx), maxX: Math.max(m.sx, m.cx), minZ: Math.min(m.sz, m.cz), maxZ: Math.max(m.sz, m.cz) };
    const crossing = m.cx < m.sx; // von rechts nach links gezogen = berührend (crossing), sonst umschließend
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
    edit?.onMarquee?.(list, { crossing });
  };

  const handleDown = (e) => {
    if (dragRef.current) return; // Griff-Drag hat Vorrang (pointerdown feuert vor mousedown)
    if (e.button === 1 || (e.button === 0 && vp.leertaste())) { e.preventDefault(); vp.beginPan(e); return; } // Mittel-Taste oder Leertaste+Ziehen (95-03) = verschieben
    if (e.button === 0 && edit?.tool === "arrow") { const p = rawMeters(e); if (p) marqRef.current = { sx: p.x, sz: p.z, cx: p.x, cz: p.z, moved: false }; }
  };
  const handleClick = (e) => {
    if (suppressClick.current) { suppressClick.current = false; return; } // nach Rahmen/Drag keinen Klick auswerten
    if (dragRef.current) return;
    if (edit?.tool === "arrow") { if (!e.shiftKey) edit.onClear?.(); return; } // Klick ins Leere hebt Auswahl auf (nicht bei Shift)
    if (edit?.onPoint) edit.onPoint(toMeters(e), e, rawMeters(e)); // 107-07: raw point for the snap core of the studio
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
    if (d) {
      const p = toMeters(e); if (!p) return;
      if (d.kind === "wallA") edit.onMoveWallPt?.(d.idx, "a", p);
      else if (d.kind === "wallB") edit.onMoveWallPt?.(d.idx, "b", p);
      else if (d.kind === "wallMid") { edit.onMoveWall?.(d.idx, { x: p.x - d.last.x, z: p.z - d.last.z }); d.last = p; }
      else if (d.kind === "col") edit.onMoveColumn?.(d.idx, p);
      else if (d.kind === "opening") edit.onMoveOpening?.(d.idx, p);
      else if (d.kind === "polyVert") edit.onMovePolyVert?.(d.which, d.idx, d.vi, p);
      else if (d.kind === "footVert") edit.onMoveFootVert?.(d.vi, p);
      else if (d.kind === "footEdge") { edit.onMoveFootEdge?.(d.edge, { x: p.x - d.last.x, z: p.z - d.last.z }); d.last = p; }
      return;
    }
    if (edit?.onHover) edit.onHover(toMeters(e), rawMeters(e), e); // review 107-07: the event too (Alt = free, as the click)
  };
  const endDrag = () => {
    vp.endPan();
    if (marqRef.current) {
      const m = marqRef.current; marqRef.current = null;
      if (m.moved) { finalizeMarquee(m); suppressClick.current = true; }
      setMarquee(null);
    }
    if (dragRef.current) { suppressClick.current = true; edit?.onGriffEnde?.(); } // nach Griff-Drag kein versehentliches Deselektieren
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
          daten={{ "data-plan-mass": String(wi) }}
        />,
      );
    });
    (customWalls || []).forEach((w, i) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z); if (len < 0.3) return;
      const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
      const ang = screenAngle(w.a, w.b);
      const tx = X(mx), ty = Z(mz) - 3;
      els.push(<text key={`cwl${i}`} x={tx} y={ty} textAnchor="middle" fontSize="6.5" fill="#0f766e" transform={`rotate(${ang} ${tx} ${ty})`} style={{ pointerEvents: "none" }}>{fmtLen(len, unit, false)}</text>);
    });
    return els;
  };

  return (
    <div className="relative w-full flex items-center justify-center">
    {/* 75-16: fill mode — fixed SVG height, the viewBox takes the box aspect (usePlanViewport fuellen). */}
    <svg ref={svgRef} viewBox={vp.viewBox} className="w-full" style={fuellen ? { height: maxSvgH, cursor } : { maxHeight: maxSvgH, cursor }}
      /* review 107-07: plan frame for tests and agents — local unit = (metre − x0|z0) × skala (the inverse of rawMeters) */
      data-plan-skala={SCALE} data-plan-x0={bb.minX - PAD} data-plan-z0={bb.minZ - PAD}
      onMouseDown={handleDown} onClick={handleClick} onMouseMove={handleMove} onDoubleClick={handleDbl} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {fuellen
        ? <rect x={vp.sicht.x} y={vp.sicht.y} width={vp.sicht.w} height={vp.sicht.h} fill="#f8fafc" />
        : <rect x="0" y="0" width={W} height={H} fill="#f8fafc" />}
      {schichtTiefe && <MaterialSchraffuren groesse={(2 * (brille?.massstab || 50) / 1000) * SCALE} />}

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
          const sx = (X(cxm) - vp.sicht.x) * bildPxProU, sy = (Z(czm) - vp.sicht.y) * bildPxProU;
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
            <g key={`zone${k.i}`} onClick={onClick} style={{ cursor: edit?.tool === "arrow" ? "pointer" : "inherit" }}>
              <path d={d} fill={sel ? "#7dd3fc" : "#bae6fd"} fillOpacity={sel ? 0.55 : 0.35} stroke={sel ? "#0284c7" : "#38bdf8"} strokeWidth={sel ? "1.2" : "0.6"} />
              {show("labels") && sichtbar.has(k.i) && (
                <text data-plan-label x={X(cxm)} y={Z(czm)} textAnchor="middle" fontSize={px(fontPx)} fontWeight="600" className="fill-sky-800" style={{ pointerEvents: "none" }}>
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
          <text x={X(Math.min(...baufeld.map((p) => p.x)))} y={Z(Math.min(...baufeld.map((p) => p.z))) - px(4)} fontSize={px(10)} className="fill-warnung">{baufeldMittig ? t("Baufeld (mittig, ohne Lagebezug)") : t("Baufeld")}</text>
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
        const hingeX = mittePx - dx * door, hingeZ = pz - dz * door;
        const openX = hingeX + nx * door, openZ = hingeZ + nz * door;
        return (
          <g stroke="#0f766e" strokeWidth="1" fill="none" style={{ pointerEvents: "none" }} data-tuer-aufschlag={opt?.tuerAufschlag === false ? "aus" : undefined}>
            <line x1={X(hingeX)} y1={Z(hingeZ)} x2={X(opt?.tuerAufschlag === false ? mittePx : openX)} y2={Z(opt?.tuerAufschlag === false ? pz : openZ)} />
            {opt?.tuerAufschlag !== false && <path d={`M${X(openX)},${Z(openZ)} A ${door * SCALE} ${door * SCALE} 0 0 1 ${X(mittePx)} ${Z(pz)}`} strokeDasharray="2 2" />}
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
            <g key={`cw${i}`} onClick={onClick} style={style} data-wand={w._idx} data-status={w.status || undefined} opacity={lk?.opacity} data-verschneidung={vf?.quelle}>
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
        if (verborgen(w, tragend)) return <path key={`cw${i}`} d={d} fill="transparent" stroke="none" onClick={onClick} style={style} data-wand={w._idx} data-struktur-verborgen="1" />;
        return <path key={`cw${i}`} d={d} fill={sel ? "#0ea5a4" : lr ? lr.fill : "#0f766e"} stroke={sel ? "#0d9488" : lr ? lr.stroke : "#134e4a"} strokeWidth={lr ? lr.strokeWidth : "0.6"}
          strokeDasharray={lr?.dash} opacity={lr?.opacity} onClick={onClick} style={style} data-wand={w._idx} data-status={w.status || undefined} data-sw={lr?.schraffur ? "schraffur" : lr?.leer ? "leer" : undefined} data-regel={/** @type {any} */ (lr)?.regel ?? undefined} />;
      })}

      {/* 97-04b: hatch of S/W new-build walls (45°, 2 mm on paper at the lens scale [ASSUMED]) */}
      {show("walls") && sw && customWalls.map((w) => {
        const lk = look(w.status);
        if (!lk?.schraffur || opt?.schraffurStatus === false) return null;
        const abst = (2 * (brille?.massstab || 100)) / 1000;
        return <g key={`sch${w._idx}`} style={{ pointerEvents: "none" }} data-schraffur={w._idx}>
          {schraffur45(wallRectXZ(w), abst).map(([p, q], k) => <line key={k} x1={X(p.x)} y1={Z(p.z)} x2={X(q.x)} y2={Z(q.z)} stroke="#18181b" strokeWidth="0.4" />)}
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
            {(e.kind === "oeffnung" ? opt?.durchbruchSymbol !== false : opt?.fensterSymbol !== false) && <line x1={X(ax)} y1={Z(az)} x2={X(bx)} y2={Z(bz)} stroke="#3b82f6" strokeWidth="0.9" />}
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
        if (cw.kind === "door" && opt?.tuerAufschlag !== false) {
          const ox = cxm - dx * hw, oz = czm - dz * hw;
          const sw = 2 * hw; const endX = ox + nx * sw, endZ = oz + nz * sw;
          return (
            <g key={`cop${i}`} onClick={onClick} style={style}>
              <g stroke={sel ? "#0d9488" : "#0f766e"} strokeWidth={sel ? "1.4" : "1"} fill="none">
                <line x1={X(ox)} y1={Z(oz)} x2={X(endX)} y2={Z(endZ)} />
                <path d={`M${X(endX)},${Z(endZ)} A ${sw * SCALE} ${sw * SCALE} 0 0 1 ${X(bx)} ${Z(bz)}`} strokeDasharray="2 2" />
              </g>
              {handle}
            </g>
          );
        }
        return (
          <g key={`cop${i}`} onClick={onClick} style={style}>
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
            return <text x={X((a.x + hover.x) / 2)} y={Z((a.z + hover.z) / 2) - 4} textAnchor="middle" fontSize="9" className="fill-teal-700">{len.toFixed(2)} m</text>;
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
        <text data-plan-label x={X(cx)} y={Z(cz)} textAnchor="middle" className="fill-slate-700" fontSize={px(11)} fontWeight="600" style={{ pointerEvents: "none" }}>
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
        const crossing = marquee.x1 < marquee.x0;
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
          })}
        </g>
      )}
      <ScaleBar x={12} y={H - 14} scale={SCALE} />
      <NorthArrow x={W - 26} y={26} />
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
function Schnitt({ model: modellRoh, storeyHeight, layerVis, unit = "m", maxSvgH = 460, brille = null, huelleStatus = null, sw = false, schnittFlaechen = null, ansicht = null, dach = null, achse = null }) {
  // 97-04b: the cut hull walls take the status look of the lens (null = today's hatch).
  const lk = planDarstellung(brille, huelleStatus, { sw });
  const { t } = useI18n();
  // 108-01: section B-B (`achse` "z") turns the model so everything below keeps cutting at z = 0 (referenz.modellImSchnitt); "x" or
  // none = the model itself. `dach` (globalesDach of the studio) adds the cut roof plate along the same line: its underside is the
  // roof surface, its top the IFC plate thickness above it (dachSchnittLinie). Without `dach` the output is the same as before.
  const model = modellImSchnitt(modellRoh, achse);
  const dachUnten = dach ? dachSchnittLinie(dach, achse === "z" ? "z" : "x", 0) : null;
  const dachOben = dachUnten ? dachSchnittLinie(dach, achse === "z" ? "z" : "x", 0, { dicke_m: GLOBAL_DACH_DICKE_M }) : null;
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
  const SCALE = Math.min(620 / (wM + PAD * 2), 360 / (topH + untiefe + PAD * 2));
  const W = (wM + PAD * 2) * SCALE, H = (topH + untiefe + PAD * 3) * SCALE;
  const X = (x) => (x - bb.minX + PAD) * SCALE;
  const Y = (y) => H - (PAD + untiefe) * SCALE - y * SCALE;
  // 107-13: cut basement walls from ±0.00 down to the lowest basement (build-up of the basement walls, bauteil/referenz.js)
  const ugWaende = ugSchnittWaende(model);
  // 107-01: cut side walls from the one derivation of @core (follows the hull reference line `huelle_bezug`)
  const sideWalls = huellSchnittWaende(model);
  // 107-02 review fix: the storey dimension is the real height of the ground floor (level marks come from the same model),
  // not the one number `storeyHeight`, which differs as soon as a storey table has another height for the ground floor
  const egHoehe = geschossHoeheAusModell(model) || storeyHeight;
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
      <line x1="0" y1={Y(0)} x2={W} y2={Y(0)} stroke="#94a3b8" strokeWidth="1.5" />
      <rect x="0" y={Y(0)} width={W} height={H - Y(0)} fill="#eef2f4" />
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
        <rect key={`sw${i}`} x={X(sw.von_m)} y={Y(wandOben)} width={sw.dicke_m * SCALE} height={wandOben * SCALE} fill={lk ? (lk.leer ? "none" : lk.fill) : "url(#hatch)"} stroke={lk ? lk.stroke : "#1e293b"} strokeWidth={lk ? lk.strokeWidth : "0.6"} strokeDasharray={lk?.dash} opacity={lk?.opacity} data-schnittwand={i} data-status={huelleStatus || undefined} />
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
      {show("labels") && untiefe > 0 && <text x={X(bb.minX) - 10} y={Y(0) + 11} textAnchor="end" fontSize="9" className="fill-muted-foreground" data-gelaende-label>{t("Gelände ±0,00")}</text>}
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
        <g key={`lvl${st.level}`}>
          <line x1={X(bb.minX) - 6} y1={Y(st.elevation)} x2={X(bb.maxX)} y2={Y(st.elevation)} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="3 3" />
          <text x={X(bb.minX) - 10} y={Y(st.elevation) - 3} textAnchor="end" fontSize="9" className="fill-slate-500">{st.name} · {st.elevation >= 0 ? "+" : ""}{st.elevation.toFixed(2)}</text>
        </g>
      ))}
      {show("labels") && !dachUnten && <text x={X(bb.minX) - 10} y={Y(totalH) - 3} textAnchor="end" fontSize="9" className="fill-slate-600" fontWeight="600">OK Dach +{totalH.toFixed(2)}</text>}
      {/* 108-01: with a pitched roof the marks are eaves and ridge (the old "OK Dach" was the eaves of a pitched roof) */}
      {show("labels") && dachUnten && <>
        <text x={X(bb.minX) - 10} y={Y(dachUnten.traufe_m) - 3} textAnchor="end" fontSize="9" className="fill-foreground" fontWeight="600" data-kote="traufe">{t("Traufe")} +{dachUnten.traufe_m.toFixed(2)}</text>
        <text x={X(bb.minX) - 10} y={Y(dachUnten.first_m) - 3} textAnchor="end" fontSize="9" className="fill-foreground" fontWeight="600" data-kote="first">{t("First")} +{dachUnten.first_m.toFixed(2)}</text>
      </>}
      {show("labels") && paraH > 0 && <text x={X(bb.minX) - 10} y={Y(attikaOK) - 3} textAnchor="end" fontSize="9" className="fill-slate-600" fontWeight="600">OK Attika +{attikaOK.toFixed(2)}</text>}
      {show("dimensions") && <>
        <DimLine x1={X(bb.maxX) + 16} y1={Y(0)} x2={X(bb.maxX) + 16} y2={Y(egHoehe)} vertical label={fmtLen(egHoehe, unit)} />
        {/* 108-02: knee wall = top of the structural slab under the top storey up to the eaves */}
        {knie != null && <g data-kote="kniestock"><DimLine x1={X(bb.maxX) + 16} y1={Y(wandOben - knie)} x2={X(bb.maxX) + 16} y2={Y(wandOben)} vertical label={t("Kniestock {{wert}}").replace("{{wert}}", fmtLen(knie, unit))} /></g>}
        <DimLine x1={X(bb.minX)} y1={Y(-untiefe) + 22} x2={X(bb.maxX)} y2={Y(-untiefe) + 22} label={fmtLen(wM, unit)} />
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
/** @param {{x1: number, y1: number, x2: number, y2: number, label: string, vertical?: boolean}} props viewBox units */
function DimLine({ x1, y1, x2, y2, label, vertical }) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return (
    <g stroke="#0f766e" strokeWidth="0.8" className="fill-teal-700" style={{ pointerEvents: "none" }}>
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

function NorthArrow({ x, y }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <path d={`M${x},${y - 10} L${x + 4},${y + 4} L${x},${y + 1} L${x - 4},${y + 4} Z`} fill="#0f172a" />
      <text x={x} y={y + 14} textAnchor="middle" fontSize="8" className="fill-slate-500">N</text>
    </g>
  );
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
 * @property {object|null} [eingang] 108-01: the effective automatic entrance (autoOpenings.entranceOpening) or null when it is off
 *   (D-EFH-04); undefined = drawn as before
 * @property {Array<{x: number, z: number}>|null} [baufeldUmriss] 108-01: building envelope of the site planning in model metres,
 *   drawn dashed with the label "Baufeld"; null = nothing
 * @property {boolean} [baufeldMittig] 108-01 review: the envelope has no position reference to the model (no footprint area, or an
 *   outline from another source) and is centred on the model origin; the label says so
 * @property {number|null} [massstab] 75-09: Maßstabs-Nenner (z. B. 50 für 1:50);
 *   null/undefined = kein Maßstabsmodus (Bestandsverhalten byte-gleich)
 * @property {{customWalls?: Array<object>, customColumns?: Array<object>, customWindows?: Array<object>}} [elements]
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
export default function BimPlan2D({ model, mode, level = 0, storeyHeight = 3, edit, layerVis, envOpenings, customZones, customSlabs, customRoofs, unit = "m", focus, readOnly = false, overlay, overlayBounds, height = 520, elements, massstab = null, fuellen = false, brille = null, huelleStatus = null, sw = false, werkstattWaende = null, schichtFlaechen = null, schnittFlaechen = null, ansicht = null, detailMassstab = null, dach = null, achse = null, eingang = undefined, baufeldUmriss = null, baufeldMittig = false }) {
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
        ? <Schnitt model={model} storeyHeight={storeyHeight} layerVis={layerVis} unit={unit} maxSvgH={maxSvgH} brille={brille} huelleStatus={huelleStatus} sw={sw} schnittFlaechen={schnittFlaechen} ansicht={ansicht} dach={dach} achse={achse} />
        : <Grundriss model={model} level={lvl} edit={editEff} layerVis={layerVis} envOpenings={envOpenings} customZones={customZones} customSlabs={customSlabs} customRoofs={customRoofs} unit={unit} focus={focus} overlay={overlay} overlayBounds={overlayBounds} maxSvgH={maxSvgH} readOnly={readOnly} massstab={massstab} fuellen={fuellen} brille={brille} huelleStatus={huelleStatus} sw={sw} werkstattWaende={werkstattWaende} schichtFlaechen={schichtFlaechen} ansicht={ansicht} detailMassstab={detailMassstab} eingang={eingang} baufeldUmriss={baufeldUmriss} baufeldMittig={baufeldMittig} />}
    </div>
  );
}
