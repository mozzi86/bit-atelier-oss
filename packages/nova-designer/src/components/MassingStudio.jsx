import React, { useRef, useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Sun, Building2, Maximize2, Ruler, Layers, Car, Home, Info, Users } from "lucide-react";
import BimModelViewer from "@ifc/components/BimModelViewer";
import MassingView3D from "@designer/components/MassingView3D";
import { useBuildingProgram, rectFootprint, polygonAreaM } from "@core/lib/useBuildingProgram";
import { useProject } from "@core/lib/ProjectContext";
import { useOsmBuildings } from "@designer/lib/useOsmBuildings";
import { metersPerPixel } from "@core/lib/geo";
import { kennzahlenJeTyp } from "@designer/lib/kennzahlen";
import { usePlanViewport } from "@core/lib/usePlanViewport";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { FADENKREUZ_CURSOR, ECKE_CURSOR, PLUS_CURSOR, kantenCursor } from "@core/lib/planCursor";
import { phiSnap, proportionHinweis, istAchsparallelesRechteck } from "@core/lib/proportion";
import { kantenNormale, projektionAufNormale, verschiebeKante, kantenLaenge, kantenWinkelGrad, himmelsrichtung } from "@core/lib/polygonKante";
import { snapKette, grenzSnap, abstandSnap, rasterSnap } from "@core/lib/snapKette";
import LehrlingPalette from "@designer/components/LehrlingPalette";
import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";
import { useNavigate } from "react-router-dom";
import { ScaleBar } from "@designer/components/BimPlan2D";
import { MASSING_MASSSTAEBE, autoMassstab, lodFuer, roemisch, weGruppen, labelKollision, weLabelText, weLabelZeilen } from "@designer/lib/massstab";
// 75-06 Task 3/5 (MS-06): convex hull approximates the parcel union for the
// Grundstueck level; containment geometry for the envelope checks.
import { konvexeHuelle, flaecheAusserhalb, istKonvex, clipSutherlandHodgman, laengsteKante } from "@core/lib/polygonInnen";
// 75-06 Task 6 (D-P75-05): ONE north angle — layer wins when set. The layer
// is READ ONLY here (WohnungsWerkstatt owns the writer).
import { useFachlayer } from "@designer/lib/useFachlayer";
import { WERKSTATT_DEFAULT, einheitenAnreichern } from "@designer/lib/werkstattDefaults";
// 75-13: escape-route paths (red line) come from the SAME solver as the workshop.
import { tesseliere, RETTUNGSWEG_INNEN_NAEHERUNG } from "@designer/lib/tesselierung";
import { nordwinkelFuer } from "@designer/lib/nordwinkel";
import { useI18n } from "@core/lib/i18n";
// 75-08 Task 5 (MSB-1): the app's ONE solar formula — the local copy lived
// here since Phase 3 and was removed. Additive exports: presets, plan azimuth
// conversion (geographic = plan + north angle) for shadow and north arrow.
import { sunPosition, SONNEN_PRESETS, planAzimut } from "@designer/lib/sonnenstand";

// 75-16: compact tile (p-2, text-base) for the fixed 280–320 px key-figure column.
const KPI = ({ icon: Icon, label, value, sub, tint, testid }) => (
  <div className="rounded-lg bg-slate-50 px-2 py-1.5 min-w-0" data-testid={testid}>
    <div className="flex items-center gap-1.5 text-slate-500 text-[11px] mb-0.5"><Icon className={`w-3 h-3 shrink-0 ${tint}`} /> <span className="truncate">{label}</span></div>
    <div className="text-base font-bold text-slate-800 leading-tight break-words">{value}</div>
    {sub && <div className="text-[10px] leading-snug text-slate-400">{sub}</div>}
  </div>
);

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// 75-08 Task 5 I: ONE referentially-stable empty list. Without it a bare `[]`
// at a render site is a NEW reference every render → MassingView3D would
// rebuild the setbacks/neighbours meshes on every drag frame (silent rebuild
// storm under render-on-demand). NOT Object.freeze: a frozen array is typed
// `readonly any[]`, which would NOT satisfy MassingView3D's `nachbarn: any[]`
// prop (3 new tsc errors). Stability here comes from module identity — the
// list is never reassigned or mutated — not from immutability.
const KEINE = [];

// Spacio-style massing studio: drag the footprint on the site, tune storeys,
// see GRZ/GFZ/BGF and the shadow update live, plus a 3D massing preview.
// `parcel` (optional): site_parcel aus der Baufeld-Planung (Canvas-Pixel) —
// wird als gestrichelte blaue read-only Referenzlinie im 2D-Plan gezeigt.
// 75-06 Task 3 (MSB-3): `baufelder` (designated_areas), `grundstueck`
// ({ flurstuecke }) and `nordwinkel` (degrees) arrive additively — every
// default keeps an existing caller rendering exactly as before.
// `onBaufeldChange`/`onGrundstueckChange` receive canvas-px polygons back.
export default function MassingStudio({
  lat = 50.1,
  projectName = "",
  parcel = null,
  baufelder = [],
  grundstueck = null,
  nordwinkel = 0,
  onBaufeldChange = null,
  onGrundstueckChange = null,
  onNordwinkelChange = null,
}) {
  // --- Gemeinsamer Store (eine Quelle der Wahrheit) ---
  const store = useBuildingProgram();
  const { project } = useProject();
  const { t } = useI18n();

  // --- Freier Polygon-Footprint (Gestaltungsfreiheit) ------------------------
  // Der Store hält das Polygon ZENTRIERT um den Ursprung ({x,z}); lokal liegt es
  // in Grundstücks-Koordinaten ({x,y}, Meter). Rechteck ist nur der Startfall —
  // Ecken sind frei ziehbar, auf Kantenmitten lassen sich neue Ecken einfügen.
  const polyBBox = (pts) => {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const fromStore = (fp, center) =>
    (fp && fp.length >= 3 ? fp : rectFootprint(40, 26)).map((p) => ({ x: +(center.x + p.x).toFixed(2), y: +(center.y + p.z).toFixed(2) }));
  const toStore = (pts) => {
    const b = polyBBox(pts); const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return pts.map((p) => ({ x: +(p.x - cx).toFixed(2), z: +(p.y - cy).toFixed(2) }));
  };
  const shoelace = (pts) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.y - q.x * p.y); }, 0) / 2);
  // Punkt-in-Polygon (Ray-Casting) — für die Außenseiten-Erkennung der Abstandsflächen.
  const pointInPoly = (x, y, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  const initFloors = store.storeys || 6;
  // 72-01 A-4 (Befund N-04): EINE Parzellen-Quelle — das Zeichenfeld kommt aus
  // dem site_parcel der Baufeld-Planung (Bbox in Metern), die zwei
  // „Zeichenfeld"-Slider entfallen. Fallback ohne Parzelle: 70 × 50 m
  // [ASSUMED] Werkzeugmaß, im KPI sichtbar als Annahme gekennzeichnet.
  const site = useMemo(() => {
    const pts = parcel?.points;
    if (!Array.isArray(pts) || pts.length < 3) return { w: 70, d: 50, hatParzelle: false };
    const mpp = metersPerPixel(parcel);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      w: Math.max(20, (Math.max(...xs) - Math.min(...xs)) * mpp),
      d: Math.max(20, (Math.max(...ys) - Math.min(...ys)) * mpp),
      hatParzelle: true,
    };
  }, [parcel]);
  const [poly, setPoly] = useState(() => fromStore(store.footprintM, { x: 35, y: 25 }));
  const [floors, setFloors] = useState(initFloors);
  const [floorH, setFloorH] = useState(store.storeyHeight || 3.2);
  const [month, setMonth] = useState(6);
  const [hour, setHour] = useState(15);
  // 75-08 Task 5 B: explicit day-of-year override for the sun presets
  // (21.03./21.06./21.12.) — UI state only, no store field. null = the month
  // approximation path (byte-identical to before, sunPosition pinned tests).
  const [tagImJahr, setTagImJahr] = useState(null);
  const [showShadow, setShowShadow] = useState(true);

  // --- Abstandsflächen (LBO): Tiefe = Faktor x H, mindestens Mindesttiefe ----
  const [abstandFaktor, setAbstandFaktor] = useState(0.4); // 0,4 H (z.B. BayBO) … 1,0 H
  const [abstandMin, setAbstandMin] = useState(3);         // Mindesttiefe in m
  const [showAbstand, setShowAbstand] = useState(true);

  // --- Viewport: 2D-Plan oder großes 3D — beide auf demselben Polygon-State --
  const [viewMode, setViewMode] = useState("2d");

  // 75-06 Task 3 (MSB-3): which of the three site levels is editable —
  // UI state only (like the working scale, D-P75-D), NOT a store or layer
  // field. "baukoerper" = the existing behaviour. (The derived polygons below
  // live AFTER the baufeld/grundstueck memos — JS TDZ.)
  const [ebene, setEbene] = useState("baukoerper");

  // 75-06 Task 6 (D-P75-05): grid reference — "nord" is today's behaviour
  // (axis-parallel 10-m grid), "grundstueck" rotates the GRID GROUP ONLY to
  // the longest parcel/plot edge. UI state, no store field.
  const [rasterBezug, setRasterBezug] = useState("nord");

  // 75-05 (MS-05): working scale = level of detail, NOT zoom. UI state only (no store field):
  // it changes nothing in the model. Auto from the site diagonal until the user picks one.
  const [massstab, setMassstab] = useState(/** @returns {number} */ () => autoMassstab(Math.hypot(site.w, site.d)));
  const massstabManuell = useRef(false);
  useEffect(() => {
    if (!massstabManuell.current) setMassstab((m) => { const a = autoMassstab(Math.hypot(site.w, site.d)); return MASSING_MASSSTAEBE.includes(a) ? a : (a === 1000 ? 500 : m); });
  }, [site.w, site.d]);
  const lod = lodFuer(massstab);
  const navigate = useNavigate();

  // --- OSM-Nachbargebäude (read-only Kontext im 2D-Plan) ---------------------
  const [showNeighbors, setShowNeighbors] = useState(true);
  const { buildings: osmBuildings } = useOsmBuildings(project?.location, 300);
  const neighbors = useMemo(() => (osmBuildings || []).slice(0, 80), [osmBuildings]);

  // --- Baufeld (site_parcel) → Site-Koordinaten (Meter) ----------------------
  // 72-01 A-4: site.w/site.d SIND die Parzellen-Bbox — die blaue Referenzlinie
  // fällt daher mit dem Grundstücksrand zusammen (eine Quelle, eine Wahrheit).
  const parcelPts = useMemo(() => {
    const pts = parcel?.points;
    if (!Array.isArray(pts) || pts.length < 3) return null;
    const mpp = metersPerPixel(parcel);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return pts.map((p) => ({ x: site.w / 2 + (p.x - cx) * mpp, y: site.d / 2 + (p.y - cy) * mpp }));
  }, [parcel, site.w, site.d]);

  // 75-06 Task 3 (MSB-3): canvas-px <-> site-metre conversions. ONE common
  // reference: the PARCEL centroid maps to the site centre (site.w/2, site.d/2)
  // — the same convention parcelPts uses for the parcel itself, so
  // envelope/parcel levels keep their true OFFSET inside the drawing field.
  // (Referencing each polygon's own centroid instead would silently centre
  // every level — an off-centre envelope would look "inside" forever.)
  const mppPx = useMemo(() => metersPerPixel(parcel), [parcel]);
  const pxReferenz = useMemo(() => {
    const pts = parcel?.points;
    if (Array.isArray(pts) && pts.length >= 3) {
      return {
        cx: pts.reduce((s, p) => s + (Number(p.x) || 0), 0) / pts.length,
        cy: pts.reduce((s, p) => s + (Number(p.y) || 0), 0) / pts.length,
      };
    }
    // Without a parcel fall back to the canvas-centre convention (600/400,
    // maplibreStyles CANVAS_CENTER) — levels are then centred like the site.
    return { cx: 600, cy: 400 };
  }, [parcel]);
  /** Canvas px {x,y} -> site metres {x,y} (parcel-centroid reference). */
  const pxZuSiteM = (pts) => {
    if (!Array.isArray(pts) || pts.length < 3) return null;
    return pts.map((p) => ({
      x: +(site.w / 2 + ((Number(p.x) || 0) - pxReferenz.cx) * mppPx).toFixed(2),
      y: +(site.d / 2 + ((Number(p.y) || 0) - pxReferenz.cy) * mppPx).toFixed(2),
    }));
  };
  /** Site metres {x,y} -> canvas px {x,y}, rounded like the drawing tools. */
  const siteMzuPx = (pts) => {
    if (!Array.isArray(pts) || pts.length < 3) return null;
    return pts.map((p) => ({
      x: Math.round(pxReferenz.cx + ((Number(p.x) || 0) - site.w / 2) / mppPx),
      y: Math.round(pxReferenz.cy + ((Number(p.y) || 0) - site.d / 2) / mppPx),
    }));
  };

  // Baufeld (MSB-3): the FIRST designated_areas polygon with type "baufeld" is
  // the check reference. Several envelopes are drawn, but only the first is
  // used for containment/snap — a documented limit (75-06 Task 3).
  const baufeldPolyPx = useMemo(() => {
    const liste = Array.isArray(baufelder) ? baufelder : [];
    const bf = liste.find((a) => a?.type === "baufeld" && Array.isArray(a?.points) && a.points.length >= 3);
    return bf || null;
  }, [baufelder]);
  const baufeldPts = useMemo(() => (baufeldPolyPx ? pxZuSiteM(baufeldPolyPx.points) : null), [baufeldPolyPx, site.w, site.d, mppPx]);
  const baufeldBekannt = Array.isArray(baufeldPts) && baufeldPts.length >= 3;

  // Grundstueck (MS-06): each parcel (Flurstueck) drawn individually; for area
  // and containment the CONVEX HULL of all parcel points approximates the union
  // ([ASSUMED] — a true polygon union needs a boolean library = new dependency).
  const flurstuecke = useMemo(() => (Array.isArray(grundstueck?.flurstuecke) ? grundstueck.flurstuecke : []), [grundstueck]);
  const grundstueckPolygons = useMemo(
    () => flurstuecke.map((f) => pxZuSiteM(f?.polygon)).filter((p) => Array.isArray(p)),
    [flurstuecke, site.w, site.d, mppPx]
  );
  const grundstueckHuellePx = useMemo(() => {
    const alle = flurstuecke.flatMap((f) => (Array.isArray(f?.polygon) ? f.polygon : []));
    return alle.length >= 3 ? konvexeHuelle(alle) : null;
  }, [flurstuecke]);
  const grundstueckPts = useMemo(() => (grundstueckHuellePx ? pxZuSiteM(grundstueckHuellePx) : null), [grundstueckHuellePx, site.w, site.d, mppPx]);

  // The level polygons in site metres. grundstueck level: the SINGLE parcel is
  // editable as itself (editing the hull of a concave parcel would silently
  // rewrite the parcel); with several parcels the hull is display-only
  // (documented limit, 75-06 SUMMARY).
  const grundstueckEditPts = useMemo(
    () => (flurstuecke.length === 1 ? pxZuSiteM(flurstuecke[0]?.polygon) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flurstuecke, site.w, site.d, mppPx]
  );
  /** @type {{x:number,y:number}[]|null} polygon of the ACTIVE level (site metres) */
  const aktivePoly = ebene === "baukoerper" ? poly : ebene === "baufeld" ? baufeldPts : grundstueckEditPts;
  const aktivEditierbar = Array.isArray(aktivePoly) && aktivePoly.length >= 3;
  // ONE handle render path (75-06 Task 3): edges/corners/midpoints render for
  // the ACTIVE level only — the others are dimmed and pointer-events none.
  // No polygon data on the chosen level → no handles (nothing to edit yet).
  /** @type {{x:number,y:number}[]|null} */
  const griffPoly = aktivEditierbar ? aktivePoly : null;

  // ONE write path per level (75-06 Task 3): the massing body writes the store
  // (unchanged effect below), baufeld/grundstueck write complexData back
  // through the callbacks — site metres to canvas px with the SAME
  // metersPerPixel scale so px↔m round-trips stay clean.
  const setAktivePoly = (next) => {
    if (ebene === "baukoerper") { setPoly(next); return; }
    const pxPts = siteMzuPx(next);
    if (!pxPts) return;
    if (ebene === "baufeld") onBaufeldChange?.(pxPts);
    else onGrundstueckChange?.(pxPts);
  };

  // 75-06 Task 6 (D-P75-05): effective north angle — the workshop layer value
  // wins when SET (0 counts as set), else the project value, else 0. The
  // raumklima/schallschutz layers keep their own northAngle fields untouched
  // in their planners; in the Massing the werkstatt_layer is the layer source
  // (it is the layer that generates the rooms shown here). READ-ONLY.
  const [wtLayer] = useFachlayer(project?.id, "werkstatt_layer", WERKSTATT_DEFAULT);
  const { winkel: nordWinkel, quelle: nordQuelle } = nordwinkelFuer({ projekt: nordwinkel, layer: wtLayer?.nordwinkel ?? null });

  // Grid rotation from the LONGEST EDGE of the plot (parcels) or, without
  // parcels, the drawn parcel polygon (laengsteKante, 75-06 Task 1). The
  // rotated grid spans the site diagonal around the site centre so no corner
  // stays empty after the turn.
  const laengste = useMemo(() => laengsteKante(grundstueckPts ?? parcelPts), [grundstueckPts, parcelPts]);
  const rasterDrehung = rasterBezug === "grundstueck" && laengste !== null;
  const rasterWinkel = laengste ? laengste.winkelGrad : 0; // degrees against +x, [0,180)
  const rasterDiag = Math.ceil(Math.hypot(site.w, site.d) / 10) * 10; // m
  const rasterStartX = site.w / 2 - rasterDiag / 2; // m
  const rasterStartY = site.d / 2 - rasterDiag / 2; // m

  // Abgeleitete BBox (für Label, Skalier-Griffe, Zonen-Offset)
  const bb = polyBBox(poly);
  const foot = { x: bb.minX, y: bb.minY, w: +(bb.maxX - bb.minX).toFixed(1), d: +(bb.maxY - bb.minY).toFixed(1) };

  // Ref um Ping-Pong-Schleifen zu vermeiden: wenn wir selbst in den Store schreiben,
  // ignorieren wir die darauffolgende externe Änderung.
  const writingToStore = useRef(false);

  // --- Store → Lokalen State synchronisieren (externe Änderungen, z.B. aus Gebäudemodell) ---
  useEffect(() => {
    if (writingToStore.current) return; // eigene Schreiboperation, ignorieren
    if (store.footprintM && store.footprintM.length >= 3) {
      setPoly((cur) => {
        if (JSON.stringify(toStore(cur)) === JSON.stringify(store.footprintM.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) })))) return cur;
        const b = polyBBox(cur);
        return fromStore(store.footprintM, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
      });
    }
    setFloors((prev) => (prev === store.storeys ? prev : store.storeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.footprintM, store.storeys]);

  // --- Lokale Änderungen → Store schreiben (Polygon bleibt Polygon!) ---------
  useEffect(() => {
    writingToStore.current = true;
    store.set({ footprintM: toStore(poly), storeys: floors });
    const t = setTimeout(() => { writingToStore.current = false; }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poly, floors]);

  const CANVAS_W = 560, CANVAS_H = 430, PAD = 26;
  const scale = Math.min((CANVAS_W - 2 * PAD) / site.w, (CANVAS_H - 2 * PAD) / site.d);
  const offX = (CANVAS_W - site.w * scale) / 2;
  const offY = (CANVAS_H - site.d * scale) / 2;
  const mx = (x) => offX + x * scale;
  const my = (y) => offY + y * scale;

  const svgRef = useRef(null);

  // Zoom/Pan über den gemeinsamen Plan-Werkstatt-Viewport (Phase 34, PW-02b) —
  // vorher hatte der Lageplan gar kein Zoom. attachKey: der 2D/3D-Umschalter
  // remountet das <svg>, sonst hinge der Wheel-Listener am alten Element.
  // 75-16: fill mode outside split view — the plan fills the column at a
  // window-high height; the viewBox follows the box aspect (no side bands).
  const fuellen = viewMode !== "split";
  const vp = usePlanViewport({ svgRef, W: CANVAS_W, H: CANVAS_H, minZoom: 1, maxZoom: 8, attachKey: viewMode, fuellen });
  // 75-01 (MS-01): screen pixels → viewBox units. Handles, hit areas, strokes
  // and labels use px() so they measure the same on screen at every zoom.
  const px = vp.px;
  // Hover target ({ art: "ecke"|"mitte"|"kante", idx }) and keyboard focus (corner index).
  const [hover, setHover] = useState(null);
  const [fokus, setFokus] = useState(null);
  // 75-06 Task 3: hover highlights run over the ACTIVE level's edges.
  const hoverKanten = !hover ? [] : hover.art === "kante" ? [hover.idx] : hover.art === "ecke" ? [(hover.idx - 1 + (griffPoly?.length || 0)) % (griffPoly?.length || 1), hover.idx] : [];

  const clampPt = (p) => ({ x: +Math.max(0, Math.min(site.w, p.x)).toFixed(1), y: +Math.max(0, Math.min(site.d, p.y)).toFixed(1) });

  // Client-Pixel-Delta → Meter. Der alte Code teilte nur durch `scale` und
  // ignorierte gerenderte Breite (w-full!) und Zoom — der Griff lief dem
  // Cursor davon bzw. hinterher. Faktor: px → viewBox-Einheiten → Meter.
  const deltaToMeters = (dxPx, dyPx) => {
    // 75-16: vp.px(1) = viewBox units per screen px (fill-mode aware; outside
    // fill mode identical to the old CANVAS_W / zoom / renderedW).
    const f = vp.px(1) / scale;
    return { dxm: dxPx * f, dym: dyPx * f };
  };

  // 75-02 (MS-02): φ-Magnet. Only for axis-parallel rectangles (free polygons
  // stay free — the KPI then says "Bbox-Näherung"). Alt bypasses. The moved
  // side snaps so the bbox reaches other·φ or other/φ when within ±3 %.
  const [phiLinie, setPhiLinie] = useState(null); // { achse: "w"|"d", wert: m } while snapped
  const EPS = 1e-6;
  const phiMagnet = (next, start, alt) => {
    if (alt || !istAchsparallelesRechteck(next)) { setPhiLinie(null); return next; }
    const b0 = polyBBox(start);
    let out = next;
    let linie = null;
    for (const achse of /** @type {("w"|"d")[]} */ (["w", "d"])) {
      const b = polyBBox(out);
      const ist = achse === "w" ? b.maxX - b.minX : b.maxY - b.minY;
      const war = achse === "w" ? b0.maxX - b0.minX : b0.maxY - b0.minY;
      if (Math.abs(ist - war) < EPS) continue; // this dimension did not change
      const ziel = phiSnap({ w: b.maxX - b.minX, d: b.maxY - b.minY }, achse);
      if (ziel === null) continue;
      if (achse === "w") {
        const maxBewegt = Math.abs(b.maxX - b0.maxX) > EPS; // which side did the user move?
        const neu = maxBewegt ? b.minX + ziel : b.maxX - ziel;
        out = out.map((p) => (Math.abs(p.x - (maxBewegt ? b.maxX : b.minX)) < EPS ? { ...p, x: +neu.toFixed(2) } : p));
        linie = { achse, wert: neu };
      } else {
        const maxBewegt = Math.abs(b.maxY - b0.maxY) > EPS;
        const neu = maxBewegt ? b.minY + ziel : b.maxY - ziel;
        out = out.map((p) => (Math.abs(p.y - (maxBewegt ? b.maxY : b.minY)) < EPS ? { ...p, y: +neu.toFixed(2) } : p));
        linie = { achse, wert: neu };
      }
    }
    setPhiLinie(linie);
    return out;
  };

  // 75-03 (MS-03): edge drag state — shown as measure text and, from 75-04, in the palette.
  // { art:"kante", idx, d (m, + = outward), ziel, laenge (m), quer (m), richtung N/O/S/W }
  const [dragInfo, setDragInfo] = useState(null);
  const dragStartRef = useRef(null);       // polygon at pointerdown (Esc restores it)
  const [tabEingabe, setTabEingabe] = useState(null); // { idx, wert } while the Tab input is open
  const clampRaw = (p) => ({ x: +Math.max(0, Math.min(site.w, p.x)).toFixed(2), y: +Math.max(0, Math.min(site.d, p.y)).toFixed(2) });
  // Snap chain for an edge: phi -> parcel boundary -> setback depth -> 0.5 m grid (first hit wins).
  // 75-06 Task 3: the phi/grenze/abstand targets belong to the MASSING BODY
  // (setback law judges the building, not the parcel or the envelope) — when
  // another level is being edited only the 0.5 m grid remains.
  const kantenZiele = (start, idx, n) => {
    const a = start[idx], b = start[(idx + 1) % start.length];
    const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const tiefe = Math.max(abstandMin, abstandFaktor * height);
    const raster = Object.assign((dd) => rasterSnap(dd, 0.5), { zielName: "raster" });
    if (ebene !== "baukoerper") return [raster];
    const phi = Object.assign((dd) => {
      if (!istAchsparallelesRechteck(start)) return null;
      const bx = polyBBox(verschiebeKante(start, idx, dd));
      const achse = Math.abs(n.nx) > Math.abs(n.ny) ? "w" : "d";
      const ist = achse === "w" ? bx.maxX - bx.minX : bx.maxY - bx.minY;
      const ziel = phiSnap({ w: bx.maxX - bx.minX, d: bx.maxY - bx.minY }, achse);
      return ziel === null ? null : +(dd + (ziel - ist)).toFixed(2);
    }, { zielName: "phi" });
    // MSB-4 (75-06 Task 4): the envelope is the TIGHTER boundary — who knows it
    // wants to snap there, not at the parcel border. Chain order: phi → baufeld
    // → grenze → abstand → raster.
    const baufeld = Object.assign((dd) => (baufeldBekannt ? grenzSnap(mitte, n, dd, baufeldPts) : null), { zielName: "baufeld" });
    const grenze = Object.assign((dd) => (boundaryKnown ? grenzSnap(mitte, n, dd, parcelPts) : null), { zielName: "grenze" });
    const abstand = Object.assign((dd) => (boundaryKnown ? abstandSnap(mitte, n, dd, parcelPts, tiefe) : null), { zielName: "abstand" });
    return [phi, baufeld, grenze, abstand, raster];
  };
  const kanteAnwenden = (start, idx, dd) => {
    const next = verschiebeKante(start, idx, dd).map(clampRaw);
    const n = kantenNormale(start, idx);
    const bx = polyBBox(next);
    const quer = Math.abs(n.nx) > Math.abs(n.ny) ? bx.maxX - bx.minX : bx.maxY - bx.minY;
    setAktivePoly(next);
    setDragInfo({ art: "kante", idx, d: dd, ziel: null, laenge: kantenLaenge(next, idx), quer, richtung: himmelsrichtung(n) });
    return next;
  };

  // Drag über den gemeinsamen Hook (Pointer-Capture, rAF, pointercancel).
  const { startDrag, cancelDrag, isDragging } = useSvgDrag({
    onDrag: (d, e, { dx, dy }) => {
      const { dxm, dym } = deltaToMeters(dx, dy);
      const start = d.poly;
      if (d.mode === "edge") {
        // 75-03: push/pull the side along its outward normal, snap chain, Alt = free.
        const n = kantenNormale(start, d.idx);
        const dRoh = projektionAufNormale({ x: dxm, y: dym }, n);
        const res = snapKette(dRoh, kantenZiele(start, d.idx, n), { alt: !!e?.altKey });
        kanteAnwenden(start, d.idx, res.d);
        setDragInfo((info) => (info ? { ...info, ziel: res.ziel } : info));
        setPhiLinie(null);
      } else if (d.mode === "vert") {
        const next = start.map((p, k) => (k === d.idx ? clampPt({ x: p.x + dxm, y: p.y + dym }) : p));
        // φ is a massing-body design rule (75-02) — parcel/envelope vertices stay free.
        setAktivePoly(ebene === "baukoerper" ? phiMagnet(next, start, e?.altKey) : next);
      } else if (d.mode === "move") {
        // Move the whole polygon, keep its bbox inside the drawing field.
        // MSB-4 (75-06 Task 4): the hard bbox clamp stays the LAST STOP of the
        // drawing area — the boundary itself is handled by the snap chain, and
        // the moved body additionally MAGNETS onto an envelope edge when the
        // shifted bbox comes within FANG_M of it (per axis; Alt releases like
        // everywhere else).
        const b0 = polyBBox(start);
        let ox = Math.max(-b0.minX, Math.min(site.w - b0.maxX, dxm));
        let oy = Math.max(-b0.minY, Math.min(site.d - b0.maxY, dym));
        if (ebene === "baukoerper" && baufeldBekannt && !e?.altKey) {
          const FANG_M = 0.5; // capture distance in metres, same as the snap chain
          // Candidate positions of the moved bbox edges (site metres).
          const kanten = { x: [b0.minX + ox, b0.maxX + ox], y: [b0.minY + oy, b0.maxY + oy] };
          // Envelope edge lines: axis-parallel candidates only (orthogonal plans
          // per the user drawing rule); each within FANG_M pulls the body onto it.
          const bfB = polyBBox(baufeldPts);
          const achsen = { x: [bfB.minX, bfB.maxX], y: [bfB.minY, bfB.maxY] };
          for (const achse of /** @type {("x"|"y")[]} */ (["x", "y"])) {
            for (const ziel of achsen[achse]) {
              let best = null;
              for (const k of kanten[achse]) {
                const dist = Math.abs(k - ziel);
                if (dist <= FANG_M && (best === null || dist < best.dist)) best = { dist, delta: ziel - k };
              }
              if (best) {
                if (achse === "x") ox = Math.max(-b0.minX, Math.min(site.w - b0.maxX, ox + best.delta));
                else oy = Math.max(-b0.minY, Math.min(site.d - b0.maxY, oy + best.delta));
              }
            }
          }
        }
        setAktivePoly(start.map((p) => ({ x: +(p.x + ox).toFixed(1), y: +(p.y + oy).toFixed(1) })));
      } else if (d.mode === "se" || d.mode === "nw") {
        // Scale around the opposite bbox corner (shape preserved) — massing-body
        // only: the bbox handles belong to the body, never to parcel/envelope.
        const b0 = polyBBox(start);
        const w0 = b0.maxX - b0.minX || 1, d0 = b0.maxY - b0.minY || 1;
        const fx = d.mode === "se" ? Math.max(5, w0 + dxm) / w0 : Math.max(5, w0 - dxm) / w0;
        const fy = d.mode === "se" ? Math.max(5, d0 + dym) / d0 : Math.max(5, d0 - dym) / d0;
        const fixX = d.mode === "se" ? b0.minX : b0.maxX; // fix point
        const fixY = d.mode === "se" ? b0.minY : b0.maxY;
        const next = start.map((p) => clampPt({ x: fixX + (p.x - fixX) * fx, y: fixY + (p.y - fixY) * fy }));
        setAktivePoly(ebene === "baukoerper" ? phiMagnet(next, start, e?.altKey) : next);
      }
    },
    onDragEnd: () => { setPhiLinie(null); setDragInfo(null); merkeDragEnde(); },
    // A drag below the 10-px tap tolerance still runs onDrag (rAF flushes) but ends as a tap —
    // transient drag state must be cleared on both paths (MSB-7).
    onTap: () => { setPhiLinie(null); setDragInfo(null); merkeDragEnde(); },
  });
  // Keyboard during a drag: Alt alone would focus the browser menu bar on keyup (Windows) —
  // swallow it; Esc restores the polygon from pointerdown; Tab opens the number input (75-03).
  const dragInfoRef = useRef(null);
  dragInfoRef.current = dragInfo;
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z): not while typing in a field, not during a drag.
      const inFeld = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "");
      if ((e.ctrlKey || e.metaKey) && !inFeld && !isDragging()) {
        if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
      }
      if (!isDragging()) return;
      if (e.key === "Alt") { e.preventDefault(); return; }
      if (e.key === "Escape") {
        e.preventDefault();
        // 75-06 Task 3: Esc restores the ACTIVE level's polygon from pointerdown.
        if (dragStartRef.current) setAktivePoly(dragStartRef.current);
        cancelDrag();
      } else if (e.key === "Tab" && dragInfoRef.current?.art === "kante") {
        e.preventDefault();
        const info = dragInfoRef.current;
        cancelDrag();
        setTabEingabe({ idx: info.idx, wert: +info.d.toFixed(2) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tab input: Enter applies the exact displacement (no snap) to the polygon from pointerdown.
  const tabBestaetigen = () => {
    if (!tabEingabe || !dragStartRef.current) { setTabEingabe(null); return; }
    const wert = Number(tabEingabe.wert);
    if (Number.isFinite(wert)) { merkePoly(dragStartRef.current); kanteAnwenden(dragStartRef.current, tabEingabe.idx, wert); }
    setDragInfo(null);
    setTabEingabe(null);
  };
  const tabAbbrechen = () => {
    // 75-06 Task 3: restores the active level (Esc path of the Tab input).
    if (dragStartRef.current) setAktivePoly(dragStartRef.current);
    setDragInfo(null);
    setTabEingabe(null);
  };

  // Undo/redo over polygon snapshots (MSB-11, quick task 260921). Snapshots are taken BEFORE a
  // change; a drag is remembered at its end only if it changed something.
  const undoRef = useRef(leererStack());
  const polyNow = useRef(poly);
  polyNow.current = poly;
  const [undoStand, setUndoStand] = useState({ p: 0, f: 0 });
  const undoSync = () => setUndoStand({ p: undoRef.current.past.length, f: undoRef.current.future.length });
  const merkePoly = (snap) => { undoRef.current = merke(undoRef.current, snap); undoSync(); };
  const undo = () => { const r = zurueck(undoRef.current, polyNow.current); if (!r) return; undoRef.current = r.stack; setPoly(r.snapshot); undoSync(); };
  const redo = () => { const r = vor(undoRef.current, polyNow.current); if (!r) return; undoRef.current = r.stack; setPoly(r.snapshot); undoSync(); };
  const merkeDragEnde = () => {
    const start = dragStartRef.current;
    if (start && JSON.stringify(start) !== JSON.stringify(polyNow.current)) merkePoly(start);
  };

  const onDown = (mode, idx) => (e) => {
    if (e.button !== 0) return; // Mitteltaste gehört dem Pan
    // 75-06 Task 3: drags always start from the ACTIVE level's polygon.
    const quelle = griffPoly || [];
    dragStartRef.current = quelle.map((p) => ({ ...p }));
    startDrag(e, { mode, idx, poly: quelle.map((p) => ({ ...p })) });
  };

  // 75-04 (MS-04): Lehrling-Palette — pointer position and the polygon bbox in container px.
  const containerRef = useRef(null);
  const polyRef = useRef(null);
  const [cursorPx, setCursorPx] = useState(null);
  const [meideBox, setMeideBox] = useState(null);
  const [viewportPx, setViewportPx] = useState(null);
  const onContainerMove = (e) => {
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    setCursorPx({ x: e.clientX - c.left, y: e.clientY - c.top });
    setViewportPx({ w: c.width, h: c.height });
    const pb = polyRef.current?.getBoundingClientRect();
    setMeideBox(pb ? { x0: pb.left - c.left, y0: pb.top - c.top, x1: pb.right - c.left, y1: pb.bottom - c.top } : null);
  };
  const fmt2 = (v) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (v) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // 75-06 Task 3: hover/insert/delete work on the ACTIVE level's polygon.
  const griff = () => griffPoly || [];
  const innenwinkel = (i) => {
    const g = griff();
    const p = g[i], a = g[(i - 1 + g.length) % g.length], b = g[(i + 1) % g.length];
    if (!p || !a || !b) return null;
    const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  };
  const einfuegen = (i) => {
    const g = griff();
    const a = g[i], b = g[(i + 1) % g.length];
    if (!a || !b) return;
    const mid = { x: +((a.x + b.x) / 2).toFixed(1), y: +((a.y + b.y) / 2).toFixed(1) };
    setHover(null);
    // Undo covers the massing body only (documented limit, UNDO-01 is its own line).
    if (ebene === "baukoerper") merkePoly(poly);
    setAktivePoly([...g.slice(0, i + 1), mid, ...g.slice(i + 1)]);
  };
  const zielText = (z) => ({ phi: "φ", baufeld: t("Baufeldgrenze"), grenze: t("Grenze"), abstand: t("Abstandsfläche"), raster: t("Raster 0,5 m") }[z] || t("frei"));
  // Content per target — never more than four lines (Blatt 04). Called right before render,
  // after footArea/proportion exist (they are declared further down).
  const paletteZeilenBerechnen = () => {
    if (dragInfo?.art === "kante") {
      const nordSued = dragInfo.richtung === "N" || dragInfo.richtung === "S";
      return [
        { text: `${dragInfo.richtung}-${t("Kante")} · ${dragInfo.d >= 0 ? "+" : "−"}${fmt2(Math.abs(dragInfo.d))} m · ${nordSued ? t("Tiefe") : t("Breite")} ${fmt2(dragInfo.quer)} m` },
        { text: `${t("Einrasten")}: ${zielText(dragInfo.ziel)}`, ton: dragInfo.ziel === "phi" ? "gold" : undefined },
        { text: t("Alt = frei · Tab = Zahl · Esc = zurück"), ton: "muted" },
      ];
    }
    if (hover?.art === "kante") {
      const i = hover.idx;
      const g = griff();
      if (!g[i]) return [];
      const n = kantenNormale(g, i);
      return [
        { text: `${himmelsrichtung(n)}-${t("Kante")} · ${t("Länge")} ${fmt2(kantenLaenge(g, i))} m` },
        { text: t("Ziehen: Seite senkrecht schieben"), ton: "muted" },
      ];
    }
    if (hover?.art === "ecke") {
      const g = griff();
      const p = g[hover.idx];
      if (!p) return [];
      const w = innenwinkel(hover.idx);
      return [
        { text: `${t("Ecke")} ${hover.idx + 1} · ${fmt1(p.x)} / ${fmt1(p.y)} m` },
        { text: `${t("Winkel")} ${w === null ? "—" : Math.round(w)}°` },
        ...(g.length > 3 ? [{ knopf: t("Ecke löschen"), onClick: () => deleteVert(hover.idx) }] : []),
      ];
    }
    if (hover?.art === "mitte") {
      return [{ knopf: t("Ecke einfügen"), onClick: () => einfuegen(hover.idx) }];
    }
    if (hover?.art === "flaeche") {
      // The area/proportion line belongs to the massing body — on the other
      // levels show the level's own polygon area instead (one source: shoelace).
      if (ebene !== "baukoerper") {
        const g = griff();
        return [{ text: `${Math.round(shoelace(g)).toLocaleString("de-DE")} m² · ${ebene === "baufeld" ? t("Baufeld") : t("Grundstück")}` }];
      }
      return [
        { text: `${Math.round(footArea).toLocaleString("de-DE")} m² · ${floors} OG` },
        { text: `${t("Proportion")} ${proportion.status === "offen" ? "—" : proportion.text}`, ton: proportion.status === "gruen" ? "gold" : undefined },
      ];
    }
    return [];
  };
  // Neue Ecke auf Kantenmitte einfügen und sofort ziehen (Gestaltungsfreiheit).
  const onInsertDown = (i) => (e) => {
    if (e.button !== 0) return;
    const g = griff();
    const a = g[i], b = g[(i + 1) % g.length];
    const mid = { x: +((a.x + b.x) / 2).toFixed(1), y: +((a.y + b.y) / 2).toFixed(1) };
    const next = [...g.slice(0, i + 1), mid, ...g.slice(i + 1)];
    if (ebene === "baukoerper") merkePoly(poly); // undo: massing body only
    setAktivePoly(next);
    startDrag(e, { mode: "vert", idx: i + 1, poly: next.map((p) => ({ ...p })) });
  };
  // Doppelklick auf Eckgriff entfernt die Ecke (min. 3 bleiben).
  const deleteVert = (i) => {
    // The removed handle never fires pointerleave — clear hover/focus, or the hover lines index past the end.
    setHover(null);
    setFokus(null);
    const g = griff();
    if (g.length <= 3) return;
    if (ebene === "baukoerper") merkePoly(polyNow.current); // undo: massing body only
    setAktivePoly(g.filter((_, k) => k !== i));
  };
  const onDeleteVert = (i) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteVert(i);
  };
  // 75-01: keyboard on a focused corner — arrows 0.10 m, Shift 1.00 m, Delete removes.
  // 75-06 Task 3: moves the ACTIVE level's corner.
  const KEY_STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const onVertKey = (i) => (e) => {
    const dir = KEY_STEP[e.key];
    if (dir) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.1; // metres
      if (ebene === "baukoerper") merkePoly(polyNow.current);
      setAktivePoly(griff().map((p, k) => (k === i ? clampPt({ x: p.x + dir[0] * step, y: p.y + dir[1] * step }) : p)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteVert(i);
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  // --- KPIs ---
  // MSB-2 (75-06 Task 5): GRZ/GFZ compute on the POLYGON area of the plot,
  // not on the parcel bbox. Precedence: 1. parcels (Grundstueck, union
  // approximation = convex hull [ASSUMED]), 2. drawn parcel polygon,
  // 3. drawing field site.w * site.d (as before). Every KPI names its source.
  const grundstueckFlaecheM2 = grundstueckPts ? shoelace(grundstueckPts) : 0;
  const parzellenFlaecheM2 = parcelPts ? shoelace(parcelPts) : 0;
  /** @type {"flurstuecke"|"parzelle"|"zeichenfeld"} */
  const flaechenQuelle = grundstueckFlaecheM2 > 0 ? "flurstuecke" : parzellenFlaecheM2 > 0 ? "parzelle" : "zeichenfeld";
  const siteArea = flaechenQuelle === "flurstuecke"
    ? grundstueckFlaecheM2
    : flaechenQuelle === "parzelle"
      ? parzellenFlaecheM2
      : site.w * site.d;
  // ONE wording source for the KPI subtitle AND the sentence above the plan
  // (no second text block, 75-06 Task 5).
  const flaechenQuelleText = flaechenQuelle === "flurstuecke"
    ? t("Flurstücke")
    : flaechenQuelle === "parzelle"
      ? t("gezeichnete Parzelle")
      : t("Zeichenfeld [ASSUMED]");
  const footArea = shoelace(poly); // echte Polygonfläche (freie Form)
  const grz = footArea / siteArea;
  const bgf = footArea * floors;
  const gfz = bgf / siteArea;
  // 75-08 Task 5 H/I: camera state survives the 2D ↔ Iso ↔ Split remounts
  // (the iso mounts at different tree positions per mode). isoInfo feeds the
  // hover tooltip: `bgf` is EXACTLY the KPI tile value (one computation path,
  // MS-03) — NOT programMetrics, which lags during a drag (Objective note 6).
  const isoKameraRef = useRef(null);
  const isoInfo = useMemo(
    () => ({ name: projectName || t("Baukörper"), geschosse: floors, bgfM2: bgf }),
    [projectName, floors, bgf, t]
  );
  // 75-06 Task 5 (MS-06): part of the body OUTSIDE the envelope — visible
  // (red hatch / dashed border) and quantified (KPI), never silently corrected.
  // Convex envelope: real m² via Sutherland-Hodgman difference; concave:
  // "Anteil außerhalb" WITHOUT a number (honest limit, [ASSUMED]).
  const ausserhalb = useMemo(
    () => (baufeldBekannt ? flaecheAusserhalb(poly, baufeldPts) : null),
    [poly, baufeldPts, baufeldBekannt]
  );
  const height = floors * floorH;
  const nuf = bgf * 0.8;
  // 72-01 A-5 (Befund N-05): Kennzahlen je Projekttyp — Gewerbe zeigt
  // Arbeitsplätze + BGF-Stellplätze, Wohnen zeigt WE + Schlüssel 1,0.
  const dichteKpis = kennzahlenJeTyp(project?.type ?? null, { nuf, bgf });
  // 75-02: proportion KPI (Bürostandard φ [ASSUMED]); free polygons are judged by their bbox.
  const istRechteck = istAchsparallelesRechteck(poly);
  // Unrounded bbox — `foot` rounds to 0.1 m for labels, which would turn an exact phi snap into "1 : 1,61".
  const proportion = proportionHinweis({ w: bb.maxX - bb.minX, d: bb.maxY - bb.minY }, { istRechteck });

  // --- Räume/Zonen aus der gemeinsamen Quelle (Gebäudemodell) ---
  const zones = Array.isArray(store.zones) ? store.zones : [];
  // 75-13: balconies are outside the envelope — not part of the room area KPI.
  const zonesArea = zones.reduce((sum, z) => sum + (Array.isArray(z?.points) && z?.raumart !== "balkon" ? polygonAreaM(z.points) : 0), 0);
  // 75-13: "Rettungsweg zeigen" — UI state; the paths are recomputed from the
  // workshop layer (same inputs as useWerkstattRehydrate) ONLY while the toggle
  // and the layer's rettungsweg rule are on. Red thin lines per unit, storey 0.
  const [showRettungsweg, setShowRettungsweg] = useState(false);
  const rettungswegAktiv = showRettungsweg && wtLayer?.regeln?.rettungsweg === true;
  const rettungswege = useMemo(() => {
    if (!rettungswegAktiv) return [];
    const layer = wtLayer || {};
    const r = tesseliere({
      footprintM: store.footprintM, storeys: store.storeys, typ: layer.typ || WERKSTATT_DEFAULT.typ,
      einheiten: einheitenAnreichern(layer.einheiten), gesperrteGrenzen: layer.gesperrteGrenzen || [], raumzonen: true,
      anordnung: layer.anordnung && typeof layer.anordnung === "object" ? layer.anordnung : {},
      grenzenPositionen: layer.grenzenPositionen && typeof layer.grenzenPositionen === "object" ? layer.grenzenPositionen : {},
      regeln: layer.regeln && typeof layer.regeln === "object" ? layer.regeln : {},
      nordwinkel: Number.isFinite(Number(layer.nordwinkel)) ? Number(layer.nordwinkel) : 0,
      tuerAufschlaege: layer.tuerAufschlaege && typeof layer.tuerAufschlaege === "object" ? layer.tuerAufschlaege : {},
      okf_m: (Math.max(1, Math.round(store.storeys || 1)) - 1) * (store.storeyHeight || 3),
    });
    const warnJeWe = new Map((r.rettungswegWarnungen || []).map((w) => [w.we, w]));
    // any: the escape-route fields (rettungsweg_*) are only present while the rule is on.
    return /** @type {Array<any>} */ (r.weListe)
      .filter((w) => w.level === 0 && Array.isArray(w.rettungsweg_pfad) && w.rettungsweg_pfad.length >= 2)
      .map((w) => ({
        we: w.we, laenge_m: w.rettungsweg_m, pfad: w.rettungsweg_pfad, warn: warnJeWe.has(w.we), naeherung: w.rettungsweg_naeherung === true,
        // 75-17: door sequence of the inner leg + why it is an approximation (if it is).
        tuerpunkte: Array.isArray(w.rettungsweg_tuerpunkte) ? w.rettungsweg_tuerpunkte : [],
        innenArt: w.rettungsweg_innen_art, innenNaeherung: w.rettungsweg_innen_naeherung === true,
      }));
  }, [rettungswegAktiv, wtLayer, store.footprintM, store.storeys, store.storeyHeight]);
  // Footprint-Mittelpunkt im Lageplan (Site-Meter) — Zonenpunkte sind um den Ursprung zentriert.
  const cxM = foot.x + foot.w / 2;
  const cyM = foot.y + foot.d / 2;

  // --- Shadow ---
  // 75-08 Task 5 B: the day-of-year override feeds the app's ONE sunPosition
  // (MSB-1 — the local formula copy is gone; month path byte-identical).
  const sun = useMemo(
    () => sunPosition(lat, month, hour, tagImJahr ? { tagImJahr } : undefined),
    [lat, month, hour, tagImJahr]
  );
  const shadow = useMemo(() => {
    if (sun.elevation <= 3) return null;
    const rad = Math.PI / 180;
    // 75-08 Task 5 D: the 2D shadow honours the project north angle via the
    // same convention as the 3D light (geographic = plan + north angle). At
    // north angle 0 planAzimut returns the input UNCHANGED → byte-identical
    // shadow polygon (plan acceptance).
    const shadowAz = (planAzimut(sun.azimuth, nordWinkel) + 180) % 360;
    const Lm = Math.min(height / Math.tan(sun.elevation * rad), site.w + site.d); // cap
    const dx = Math.sin(shadowAz * rad) * Lm;
    const dy = -Math.cos(shadowAz * rad) * Lm;
    // Freie Form: das versetzte Polygon als Schattenfläche (Näherung)
    return poly.map((p) => `${mx(p.x + dx)},${my(p.y + dy)}`).join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sun, height, poly, site, scale, offX, offY, nordWinkel]);

  // --- Abstandsflächen je Fassade: Streifen mit Tiefe max(Faktor x H, Min) ---
  // Außenseite per Punkt-in-Polygon-Test (robust auch für konkave Formen).
  //
  // Grenzbezug (KD-05): Geprüft wird ausschließlich gegen die ECHTE Parzelle
  // (`site_parcel` aus der Baufeld-Planung, hier als `parcelPts` in Meter).
  // 72-01 A-4: das Zeichenfeld IST die Parzellen-Bbox (eine Quelle); ohne
  // Parzelle ist es ein [ASSUMED]-Werkzeugmaß ohne Grenzbezug. Ohne Parzelle
  // bleibt `conflict === null` („nicht prüfbar"); es darf dann kein grünes
  // „ok" erscheinen.
  const boundaryPts = parcelPts;          // echte Parzelle in Site-Metern oder null
  const boundaryKnown = Array.isArray(boundaryPts) && boundaryPts.length >= 3;
  const setbacks = useMemo(() => {
    const T = Math.max(abstandMin, abstandFaktor * height);
    return poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len; // Normale (Kandidat)
      const mxp = (a.x + b.x) / 2 + nx * 0.2, myp = (a.y + b.y) / 2 + ny * 0.2;
      if (pointInPoly(mxp, myp, poly)) { nx = -nx; ny = -ny; } // nach außen drehen
      const pts = [a, b, { x: b.x + nx * T, y: b.y + ny * T }, { x: a.x + nx * T, y: a.y + ny * T }];
      // Näherung: Eckpunkte des Streifens gegen die Parzelle testen. Für stark
      // konkave Parzellen kann eine Kante die Grenze schneiden, ohne dass eine
      // Ecke außerhalb liegt — deshalb ist auch das Ergebnis nur eine Studie.
      const conflict = boundaryKnown
        ? pts.some((p) => !pointInPoly(p.x, p.y, boundaryPts))
        : null; // nicht prüfbar
      return { pts, conflict, depth: T };
    });
  }, [poly, height, abstandFaktor, abstandMin, boundaryPts, boundaryKnown]);
  const conflictCount = boundaryKnown ? setbacks.filter((s) => s.conflict).length : 0;

  const Slider = ({ label, value, min, max, step, set, unit }) => (
    <div>
      <div className="flex justify-between text-xs text-slate-500 mb-1"><span>{label}</span><span className="font-medium text-slate-700">{value}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full" />
    </div>
  );

  const paletteZeilen = paletteZeilenBerechnen();

  // 75-05: unit labels — one per group, collision-checked in SCREEN pixels (not world units).
  // Screen px per viewBox unit = 1 / vp.px(1) (75-16: fill-mode aware); label box ≈ 0.6 · font · chars × font.
  const weLabels = (() => {
    if (!lod.weLabel) return [];
    const gruppen = [...weGruppen(zones).entries()].filter(([k]) => k !== null);
    const pxProU = 1 / vp.px(1);
    const fontPx = 11;
    const kandidaten = gruppen.map(([we, g]) => {
      // Two short lines ("WE 3" / "78 m²") instead of one long one: eight units on a
      // 30 × 20 m body leave ~80 px per unit — a 130-px single line would hide most labels.
      const zeilen = weLabelZeilen(g, t);
      const text = weLabelText(g, t);
      const x = mx(cxM + g.mitte.x), y = my(cyM + g.mitte.z);
      const sx = (x - vp.sicht.x) * pxProU, sy = (y - vp.sicht.y) * pxProU;
      const w = 0.6 * fontPx * Math.max(...zeilen.map((z) => z.length)), h = fontPx * zeilen.length;
      return { we, typ: g.typ, text, zeilen, x, y, rect: { x0: sx - w / 2, y0: sy - h / 2, x1: sx + w / 2, y1: sy + h / 2 } };
    }); // input order = priority for the collision check
    const sichtbar = labelKollision(kandidaten.map((k) => k.rect));
    return sichtbar.map((i) => kandidaten[i]);
  })();

  // 75-08 Task 5 I: ONE props object for every MassingView3D render site
  // (large iso, split iso). Identical across sites; the referentially-stable
  // KEINE list keeps the setback/neighbour mesh effects quiet while idle.
  const isoProps = {
    poly,
    siteW: site.w,
    siteD: site.d,
    height,
    setbacks: showAbstand ? setbacks : KEINE,
    sonne: sun,
    schatten: showShadow,
    nordwinkel: nordWinkel,
    nachbarn: showNeighbors ? neighbors : KEINE,
    massstab,
    info: isoInfo,
    kameraRef: isoKameraRef,
  };

  return (
    // 75-16: plan column flexible, key-figure column fixed 280/320 px
    // (was 2/3 : 1/3 — the figures took a third of every wide screen).
    <div className="grid lg:grid-cols-[minmax(0,1fr)_17.5rem] 2xl:grid-cols-[minmax(0,1fr)_20rem] gap-4">
      {/* Plan + sun */}
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Maximize2 className="w-4 h-4" /> {t("Lageplan & Baukörper")}
              {viewMode !== "3d" && (
                <span className="text-sm font-normal text-slate-500">— {t("Fläche ziehen · Ecken formen · Kante schieben · + fügt Ecken ein · Doppelklick löscht · Tab = Zahl · Alt = frei · Esc = zurück")}</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                {/* 75-08 Task 5 F: neighbours AND scale stay visible in every
                    mode — both also drive the iso (grey bodies, zoom ladder). */}
                <label className="flex items-center gap-1.5 text-xs font-normal text-slate-600 cursor-pointer" title={t("OSM-Nachbargebäude als graue Referenz einblenden")}>
                  <input type="checkbox" checked={showNeighbors} onChange={(e) => setShowNeighbors(e.target.checked)} className="accent-slate-500" />
                  {t("Nachbarn")}
                </label>
                {/* 75-06 Task 3 (MSB-3): Ebene waehlen — UI-Zustand, kein Store-Feld.
                    75-08 Task 5 F: visible in 2D AND split (both edit the 2D plan). */}
                {viewMode !== "3d" && (
                  <span className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium" role="group" aria-label={t("Ebene")}>
                    {/** @type {const} */ ([["grundstueck", "Grundstück"], ["baufeld", "Baufeld"], ["baukoerper", "Baukörper"]]).map(([key, label], ki) => (
                      <button
                        key={key}
                        type="button"
                        data-ebene={key}
                        onClick={() => setEbene(key)}
                        className={`px-2.5 py-1 transition-colors ${ki > 0 ? "border-l border-slate-200" : ""} ${ebene === key ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </span>
                )}
                {/* 75-06 Task 6: Raster-Chip — "Nord" = heutiges achsparalleles
                    10-m-Raster; "Grundstueck" dreht NUR die Rastergruppe auf die
                    laengste Grundstueckskante (Darstellung, nie Geometrie). */}
                {viewMode !== "3d" && (
                  <select
                    aria-label={t("Raster-Bezug")}
                    title={t("Raster am Grundstück ausrichten — dreht nur die Darstellung, nie die Geometrie")}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                    value={rasterBezug}
                    onChange={(e) => setRasterBezug(e.target.value)}
                    data-testid="ms-raster"
                  >
                    <option value="nord">{t("Raster: Nord")}</option>
                    <option value="grundstueck">{t("Raster: Grundstück")}</option>
                  </select>
                )}
                {/* 75-06 Task 6 (D-P75-05): project north angle — the layer value
                    wins when set, which is shown as a hint, never overwritten. */}
                {viewMode !== "3d" && (
                  <label className="flex items-center gap-1 text-xs font-normal text-slate-600" title={nordQuelle === "layer" ? t("Werkstatt-Layer-Wert gewinnt (D-P75-05)") : t("Nordwinkel des Projekts, Grad im Uhrzeigersinn")}>
                    {t("Nord")}
                    <input
                      type="number" min={0} max={359} step={1}
                      value={nordWinkel}
                      disabled={nordQuelle === "layer"}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) onNordwinkelChange?.(((Math.round(v) % 360) + 360) % 360);
                      }}
                      data-testid="ms-nordwinkel"
                      className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs tabular-nums disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    °
                  </label>
                )}
                {/* 75-05: Arbeitsmaßstab (Detailgrad) — 1:1000 gehört dem Standort, 1:50 dem WohnungsFokus.
                    75-08 Task 5 F: visible in ALL modes — the chip also zooms the iso
                    (massstab prop, tween to the ladder level; zoom stays free). */}
                <select
                    aria-label={t("Arbeitsmaßstab")}
                    title={t("Detailgrad je Maßstab — der Zoom bleibt frei")}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                    value={massstab}
                    onChange={(e) => { massstabManuell.current = true; setMassstab(Number(e.target.value)); }}
                    data-massstab
                  >
                    <option value={1000} disabled>1:1000 → {t("Standort")}</option>
                    <option value={500}>1:500</option>
                    <option value={200}>1:200</option>
                    <option value={50} disabled>1:50 → {t("Wohnung")}</option>
                </select>
                {/* 75-08 Task 5 F: THREE modes — 2D, Iso and Split (2D | Iso)
                    on the SAME polygon state. data-ansicht carries the state
                    value ("3d" stays; only the label reads "Iso"). */}
                <span className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium" role="group" aria-label={t("Ansicht umschalten")}>
                  <button
                    type="button"
                    data-ansicht="2d"
                    aria-pressed={viewMode === "2d"}
                    onClick={() => setViewMode("2d")}
                    className={`px-3 py-1 transition-colors ${viewMode === "2d" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    2D
                  </button>
                  <button
                    type="button"
                    data-ansicht="3d"
                    aria-pressed={viewMode === "3d"}
                    onClick={() => setViewMode("3d")}
                    className={`px-3 py-1 border-l border-slate-200 transition-colors ${viewMode === "3d" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    Iso
                  </button>
                  <button
                    type="button"
                    data-ansicht="split"
                    aria-pressed={viewMode === "split"}
                    onClick={() => setViewMode("split")}
                    className={`px-3 py-1 border-l border-slate-200 transition-colors ${viewMode === "split" ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {t("2D | Iso")}
                  </button>
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {viewMode === "3d" ? (
              /* Großer 3D-Viewport — gleicher Polygon-State wie der 2D-Plan */
              <div className="space-y-1">
                <div className="w-full rounded-lg overflow-hidden border bg-slate-50" style={{ height: 520 }}>
                  <MassingView3D {...isoProps} />
                </div>
                {showAbstand && !boundaryKnown && (
                  <p className="text-[11px] text-amber-700">
                    {t("Abstandsflächen ohne Grenzbezug — kein Grundstück gezeichnet. Die grüne Einfärbung im 3D bedeutet hier")} <strong>{t("nicht")}</strong> {t("„eingehalten\".")}
                  </p>
                )}
              </div>
            ) : (
            /* 75-08 Task 5 G: outer wrapper ALWAYS rendered (2D and split) so
               the mode switch 2D ↔ split does NOT remount the SVG — the split
               class only changes the layout; usePlanViewport keeps its px()
               via its own ResizeObserver (75-01). The inner 2D block below is
               unchanged; nothing between the anchors moved. */
            <div className={viewMode === "split" ? "grid grid-cols-2 gap-2 items-start" : undefined}>
            <div className="relative" ref={containerRef} onPointerMove={onContainerMove} onPointerLeave={() => setHover(null)}>
            {lod.zonen && zones.length === 0 && wtLayer?.angewendet !== true && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/95 px-2 py-1 text-[11px] text-amber-800" role="status" data-msb9-hinweis>
                <span>{t("Keine Raeume im Modell: Wohnungs-Werkstatt einmal oeffnen, dann erscheinen die WEs hier.")}</span>
                <button type="button" onClick={() => navigate("/ComplexDesigner?tab=werkstatt")} className="rounded bg-amber-700 px-2 py-0.5 text-white">{t("Werkstatt oeffnen")}</button>
              </div>
            )}
            {/* 75-16: fill mode — full column width; height from the content aspect
                CANVAS_W : CANVAS_H, capped by the window (min. the old 430 px). On a
                flat window the cap bites and the viewBox widens (no side bands); on
                a tall one the plan never grows taller than the content needs. */}
            <svg ref={svgRef} viewBox={vp.viewBox} className={`w-full ${fuellen ? "" : "h-auto "}bg-slate-50 rounded-lg border select-none`}
              style={fuellen ? { touchAction: "none", aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, minHeight: CANVAS_H, maxHeight: `max(${CANVAS_H}px, calc(100vh - 160px))` } : { touchAction: "none" }}
              onPointerDown={(e) => { if (e.button === 1) { e.preventDefault(); vp.beginPan(e); } }}
              onPointerMove={(e) => vp.panMove(e)}
              onPointerUp={vp.endPan}
              onPointerLeave={vp.endPan}>
              {/* 75-13: hatch for balcony zones (thin diagonal lines, screen-constant). */}
              <defs>
                <pattern id="ms-balkon-schraffur" width={px(6)} height={px(6)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2={px(6)} stroke="#0369a1" strokeWidth={px(0.7)} />
                </pattern>
              </defs>
              {/* grid — 75-06 Task 6 (D-P75-05 + HANDOFF §10): wrapped in one
                  <g data-raster> so the "Raster: Grundstueck" chip can rotate
                  the GRID ONLY. Polygon, zones, handles, setbacks and the
                  store are NEVER rotated — rotation is display, never geometry
                  (user drawing rule, binding). Unrotated the grid spans
                  exactly 0..w / 0..d as before (the e2e fixtures read the
                  first grid line as the site origin); rotated it is drawn on
                  the full diagonal around the site centre so no corner stays
                  empty after the turn. */}
              <g data-raster transform={rasterDrehung ? `rotate(${rasterWinkel} ${mx(site.w / 2)} ${my(site.d / 2)})` : undefined}>
                {rasterDrehung ? (
                  <>
                    {Array.from({ length: Math.floor(rasterDiag / 10) + 1 }).map((_, i) => (
                      <line key={`gx${i}`} x1={mx(rasterStartX + i * 10)} y1={my(rasterStartY)} x2={mx(rasterStartX + i * 10)} y2={my(rasterStartY + rasterDiag)} stroke="#e2e8f0" strokeWidth="0.5" />
                    ))}
                    {Array.from({ length: Math.floor(rasterDiag / 10) + 1 }).map((_, i) => (
                      <line key={`gy${i}`} x1={mx(rasterStartX)} y1={my(rasterStartY + i * 10)} x2={mx(rasterStartX + rasterDiag)} y2={my(rasterStartY + i * 10)} stroke="#e2e8f0" strokeWidth="0.5" />
                    ))}
                  </>
                ) : (
                  <>
                    {Array.from({ length: Math.floor(site.w / 10) + 1 }).map((_, i) => (
                      <line key={`gx${i}`} x1={mx(i * 10)} y1={my(0)} x2={mx(i * 10)} y2={my(site.d)} stroke="#e2e8f0" strokeWidth="0.5" />
                    ))}
                    {Array.from({ length: Math.floor(site.d / 10) + 1 }).map((_, i) => (
                      <line key={`gy${i}`} x1={mx(0)} y1={my(i * 10)} x2={mx(site.w)} y2={my(i * 10)} stroke="#e2e8f0" strokeWidth="0.5" />
                    ))}
                  </>
                )}
              </g>
              {/* OSM-Nachbargebäude (read-only) — HINTER dem Grundstück gerendert */}
              {showNeighbors && neighbors.map((b, i) => (
                <polygon
                  key={`nb${i}`}
                  points={b.points.map((p) => `${mx(site.w / 2 + p.x)},${my(site.d / 2 + p.z)}`).join(" ")}
                  fill="#94a3b8" opacity="0.35" pointerEvents="none"
                />
              ))}
              {/* Baufeld (site_parcel) — gestrichelte blaue read-only Referenzlinie.
                  75-06 Task 3: labelled — the line is the PARCEL reference; the
                  envelope (designated_areas type "baufeld") is its own polygon. */}
              {parcelPts && (
                <g pointerEvents="none">
                  <polygon
                    points={parcelPts.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                    fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="7 4" vectorEffect="non-scaling-stroke"
                    opacity="0.8"
                  />
                  <text x={mx(parcelPts[0].x)} y={my(parcelPts[0].y) - px(4)} fontSize={px(9)} fill="#2563eb">
                    {flurstuecke.length ? t("Grundstück") : t("Baufeld")}
                  </text>
                </g>
              )}
              {/* 75-06 Task 3 (MSB-3/MS-06): the THREE site levels. Grundstueck =
                  dark solid line per parcel + numbers at the centroids (visible
                  from 1:500); Baufeld = blue dashed envelope polygon; Baukoerper
                  = the interactive footprint below. The level NOT being edited
                  stays visible; only the active one carries handles. */}
              {grundstueckPolygons.map((gpts, gi) => (
                <g key={`flst${gi}`} pointerEvents="none" data-grundstueck>
                  <polygon
                    points={gpts.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                    fill="#0f172a" fillOpacity="0.03" stroke="#0f172a" strokeWidth="1.8" vectorEffect="non-scaling-stroke"
                  />
                  {massstab <= 500 && flurstuecke[gi]?.nummer && (() => {
                    const c = gpts.reduce((s, p) => ({ x: s.x + p.x / gpts.length, y: s.y + p.y / gpts.length }), { x: 0, y: 0 });
                    return (
                      <text x={mx(c.x)} y={my(c.y)} fontSize={px(10)} fill="#0f172a" textAnchor="middle" fontWeight="600">
                        {flurstuecke[gi].nummer}
                      </text>
                    );
                  })()}
                </g>
              ))}
              {baufeldPts && (
                <polygon
                  data-baufeld
                  points={baufeldPts.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                  fill="#2563eb" fillOpacity="0.04" stroke="#2563eb" strokeWidth="1.6" strokeDasharray="9 5" vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              {/* site boundary */}
              <rect x={mx(0)} y={my(0)} width={site.w * scale} height={site.d * scale} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
              {/* shadow */}
              {showShadow && shadow && <polygon points={shadow} fill="#1e293b" opacity="0.14" />}
              {/* Abstandsflächen (Studie): grün = innerhalb der Parzelle, rot = ragt
                  über die Parzellengrenze, grau = ohne Parzelle nicht prüfbar */}
              {showAbstand && setbacks.map((sb, i) => (
                <polygon key={`sb${i}`} points={sb.pts.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                  fill={sb.conflict === null ? "#94a3b8" : sb.conflict ? "#ef4444" : "#10b981"}
                  fillOpacity={sb.conflict ? 0.28 : 0.16}
                  stroke={sb.conflict === null ? "#64748b" : sb.conflict ? "#dc2626" : "#059669"}
                  strokeWidth={sb.conflict ? 1.5 : 0.8} vectorEffect="non-scaling-stroke"
                  strokeDasharray="4 3" pointerEvents="none" />
              ))}
              {/* footprint — freies Polygon: Fläche verschieben, Ecken ziehen.
                  75-01: Fadenkreuz-Cursor (Hotspot auf dem Punkt), Strich in Bildschirm-px.
                  75-06 Task 3: when another level is active the body is dimmed and
                  inert — the interactive polygon is the active level's (below). */}
              <polygon ref={polyRef} points={poly.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                fill="#3b82f6" fillOpacity={ebene === "baukoerper" ? 0.5 : 0.18} stroke="#1d4ed8" strokeWidth="2" vectorEffect="non-scaling-stroke"
                data-griff={ebene === "baukoerper" ? "flaeche" : undefined} style={{ cursor: ebene === "baukoerper" ? FADENKREUZ_CURSOR : "default" }}
                onPointerDown={ebene === "baukoerper" ? onDown("move") : undefined}
                onPointerEnter={() => { if (ebene === "baukoerper") setHover({ art: "flaeche", idx: -1 }); }} onPointerLeave={() => setHover(null)} />
              {/* 75-06 Task 5 (MS-06): body outside the envelope — visible, never
                  silently corrected. Convex envelope: true hatch via an SVG mask
                  (body white, clipped inside black → only the outside part shows
                  the 45° red pattern). Concave: honest fallback — red dashed
                  border + markers at the border crossings, NO fabricated area. */}
              {ausserhalb?.hatAnteilAusserhalb && (
                <g data-ausserhalb pointerEvents="none">
                  {baufeldBekannt && istKonvex(baufeldPts) ? (
                    <>
                      <defs>
                        <pattern id="ausserhalb-muster" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <line x1="0" y1="0" x2="0" y2={px(8)} stroke="#dc2626" strokeWidth={px(2)} vectorEffect="non-scaling-stroke" />
                        </pattern>
                        <mask id="ausserhalb-maske">
                          <polygon points={poly.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")} fill="#fff" />
                          <polygon points={clipSutherlandHodgman(poly, baufeldPts).map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")} fill="#000" />
                        </mask>
                      </defs>
                      <rect x={mx(0)} y={my(0)} width={site.w * scale} height={site.d * scale} fill="url(#ausserhalb-muster)" mask="url(#ausserhalb-maske)" />
                    </>
                  ) : (
                    <>
                      <polygon points={poly.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                        fill="none" stroke="#dc2626" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                      {ausserhalb.punkte.map((s, si) => (
                        <circle key={`xs${si}`} cx={mx(s.x)} cy={my(s.y)} r={px(3.5)} fill="#dc2626" />
                      ))}
                    </>
                  )}
                </g>
              )}
              {/* 75-06 Task 3: interactive polygon of the ACTIVE level (baufeld/
                  grundstueck) — same drag modes, ONE render path for the handles. */}
              {ebene !== "baukoerper" && griffPoly && (
                <polygon data-griff="flaeche" data-ebene-aktiv={ebene}
                  points={griffPoly.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
                  fill={ebene === "baufeld" ? "#2563eb" : "#0f172a"} fillOpacity="0.10"
                  stroke={ebene === "baufeld" ? "#2563eb" : "#0f172a"} strokeWidth="2" strokeDasharray={ebene === "baufeld" ? "9 5" : undefined}
                  vectorEffect="non-scaling-stroke" style={{ cursor: FADENKREUZ_CURSOR }}
                  onPointerDown={onDown("move")}
                  onPointerEnter={() => setHover({ art: "flaeche", idx: -1 })} onPointerLeave={() => setHover(null)} />
              )}
              {/* Baukörper-Label: bei 1:500 Name · Geschosse (römisch), sonst Fläche · OG */}
              <text data-baukoerper-label x={mx(foot.x + foot.w / 2)} y={my(foot.y + foot.d / 2)} fontSize={px(11)} fill="#1e3a8a" textAnchor="middle" pointerEvents="none">
                {lod.zonen
                  ? `${Math.round(footArea).toLocaleString("de-DE")} m² · ${floors} OG`
                  : `${projectName || "A"} · ${roemisch(floors)}`}
              </text>
              {/* 75-05: Zonen nur ab 1:200; nie Raumnamen im Massing (die gehören dem WohnungsFokus, 1:50) */}
              {lod.zonen && zones.map((z, zi) => {
                const pts = Array.isArray(z?.points) ? z.points : [];
                if (pts.length < 3) return null;
                const zp = pts.map((p) => `${mx(cxM + p.x)},${my(cyM + p.z)}`).join(" ");
                // Circulation (core, corridor, gallery, 75-13: stair enclosure + lift) is what
                // the architect looks for first — grey and named; units stay blue
                // (Nutzer 21.09.: "wo ist das Treppenhaus").
                const erschliessung = z?.raumart === "flur" || z?.raumart === "treppenraum" || z?.raumart === "aufzug";
                // 75-13: balcony = thin outline + hatch in front of the facade.
                if (z?.raumart === "balkon") {
                  return (
                    <polygon key={`zone${zi}`} points={zp} fill="url(#ms-balkon-schraffur)" stroke="#0369a1" strokeWidth="0.8" vectorEffect="non-scaling-stroke" pointerEvents="none" data-balkon={z.we || ""} />
                  );
                }
                if (!erschliessung) return <polygon key={`zone${zi}`} points={zp} fill="#0ea5e9" fillOpacity="0.25" stroke="#0284c7" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
                const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
                const name = String(z?.name || "").replace(/ ·WT?$/, "");
                // 75-13: extension ends of the stair enclosure are fire walls (thick line).
                const brandwaende = Array.isArray(z?.brandwaende) ? z.brandwaende : [];
                return (
                  <g key={`zone${zi}`} pointerEvents="none" data-erschliessung data-raumart={z?.raumart || "flur"}>
                    <polygon points={zp} fill={z?.raumart === "aufzug" ? "#94a3b8" : "#64748b"} fillOpacity="0.45" stroke="#334155" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    {brandwaende.map((bi) => {
                      const a = pts[bi], b = pts[(bi + 1) % pts.length];
                      if (!a || !b) return null;
                      return <line key={`bw${bi}`} x1={mx(cxM + a.x)} y1={my(cyM + a.z)} x2={mx(cxM + b.x)} y2={my(cyM + b.z)} stroke="#b91c1c" strokeWidth="3" vectorEffect="non-scaling-stroke" data-brandwand />;
                    })}
                    <text x={mx(cxM + cx)} y={my(cyM + cz)} fontSize={px(9)} fill="#0f172a" textAnchor="middle" fontWeight="600">{name}</text>
                  </g>
                );
              })}
              {/* 75-13: escape routes as thin red lines (toggle "Rettungsweg zeigen"), warn = dashed + label. */}
              {lod.zonen && rettungswegAktiv && (
                <g data-rettungswege={rettungswege.length} pointerEvents="none">
                  {rettungswege.map((r) => {
                    const d = r.pfad.map((p, i) => `${i ? "L" : "M"}${mx(cxM + p.x)},${my(cyM + p.z)}`).join(" ");
                    const e = r.pfad[r.pfad.length - 1];
                    return (
                      <g key={`rw-${r.we}`} data-rettungsweg={r.we} data-laenge={r.laenge_m} data-warn={r.warn ? "1" : "0"}>
                        <path d={d} fill="none" stroke="#dc2626" strokeWidth={r.warn ? 1.6 : 1} strokeDasharray={r.naeherung || r.innenNaeherung ? "3 2" : undefined} vectorEffect="non-scaling-stroke" />
                        <circle cx={mx(cxM + r.pfad[0].x)} cy={my(cyM + r.pfad[0].z)} r={px(2)} fill="#dc2626" />
                        {/* 75-17: the doors the line passes (room door … apartment door) as open rings. */}
                        {r.tuerpunkte.map((q, qi) => (
                          <circle key={qi} data-rettungsweg-tuer cx={mx(cxM + q.x)} cy={my(cyM + q.z)} r={px(2.5)} fill="#fff" stroke="#dc2626" strokeWidth={px(1)} />
                        ))}
                        {r.warn && <text x={mx(cxM + e.x)} y={my(cyM + e.z) - px(3)} fontSize={px(8)} fill="#b91c1c" textAnchor="middle" fontWeight="600">{`${r.we} ${String(r.laenge_m).replace(".", ",")} m`}</text>}
                      </g>
                    );
                  })}
                </g>
              )}
              {/* 75-05: ein Label je Wohneinheit, Kollision in Bildschirm-Pixeln; Doppelklick → WohnungsFokus */}
              {lod.weLabel && weLabels.map((l) => (
                <text key={`wl${l.we}`} data-we-label={l.we} x={l.x} y={l.y} fontSize={px(11)} fontWeight="600" fill="#075985" textAnchor="middle"
                  style={{ cursor: l.typ === "wt" ? "pointer" : "default" }}
                  onDoubleClick={l.typ === "wt" ? () => navigate(`/ComplexDesigner?tab=werkstatt&we=${encodeURIComponent(l.we)}`) : undefined}>
                  {l.zeilen.map((z, zi) => (
                    <tspan key={zi} x={l.x} dy={zi === 0 ? -px(1.5) : px(12)} fontWeight={zi === 0 ? "600" : "400"} fontSize={zi === 0 ? px(11) : px(9.5)}>{z}</tspan>
                  ))}
                  <title>{l.typ === "wt" ? `${l.text} — ${t("Doppelklick: Wohnung im Fokus (1:50) öffnen")}` : l.text}</title>
                </text>
              ))}
              {/* 75-01: Kanten-Trefferlinien (Hover + Cursor senkrecht zur Kante; Drag folgt in 75-03).
                  Liegen im DOM VOR den Griffen, damit Ecke und Mitte gewinnen.
                  75-06 Task 3: rendern für die AKTIVE Ebene — ein Pfad, keine Kopie. */}
              {(griffPoly || []).map((p, i) => {
                const q = griffPoly[(i + 1) % griffPoly.length];
                const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
                return (
                  <line key={`k${i}`} x1={mx(p.x)} y1={my(p.y)} x2={mx(q.x)} y2={my(q.y)} stroke="transparent" strokeWidth={px(12)}
                    data-griff="kante" data-idx={i} style={{ cursor: kantenCursor(ang) }}
                    onPointerDown={onDown("edge", i)}
                    onPointerEnter={() => setHover({ art: "kante", idx: i })} onPointerLeave={() => setHover(null)} />
                );
              })}
              {/* 75-02: φ-Hilfslinie, solange die gezogene Kante im Goldenen Schnitt rastet */}
              {phiLinie && (
                <g data-phi-linie pointerEvents="none">
                  {phiLinie.achse === "w"
                    ? <line x1={mx(phiLinie.wert)} y1={my(0)} x2={mx(phiLinie.wert)} y2={my(site.d)} stroke="#A8701B" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    : <line x1={mx(0)} y1={my(phiLinie.wert)} x2={mx(site.w)} y2={my(phiLinie.wert)} stroke="#A8701B" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                  <text x={phiLinie.achse === "w" ? mx(phiLinie.wert) + px(4) : mx(site.w) - px(12)} y={phiLinie.achse === "w" ? my(0) + px(12) : my(phiLinie.wert) - px(4)} fontSize={px(10)} fill="#A8701B">φ</text>
                </g>
              )}
              {/* 75-03: Maßtext an der gezogenen Kante — immer waagerecht lesbar (Gegendrehung) */}
              {dragInfo?.art === "kante" && (() => {
                const i = dragInfo.idx, a = griffPoly?.[i], b = griffPoly?.[(i + 1) % griffPoly.length];
                if (!a || !b) return null;
                const cx = mx((a.x + b.x) / 2), cy = my((a.y + b.y) / 2);
                let rot = kantenWinkelGrad(griffPoly, i);
                if (rot > 90) rot -= 180;
                const nordSued = dragInfo.richtung === "N" || dragInfo.richtung === "S";
                const txt = `${dragInfo.d >= 0 ? "+" : "−"}${Math.abs(dragInfo.d).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m · ${nordSued ? t("Tiefe") : t("Breite")} ${dragInfo.quer.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
                const w = px(6.5) * txt.length, h = px(16);
                return (
                  <g data-masstext transform={`rotate(${rot} ${cx} ${cy})`} pointerEvents="none">
                    <rect x={cx - w / 2} y={cy - h - px(6)} width={w} height={h} rx={px(3)} fill="#fff" stroke="#1d4ed8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <text x={cx} y={cy - px(10)} fontSize={px(12)} fill="#1e3a8a" textAnchor="middle" className="tabular-nums">{txt}</text>
                  </g>
                );
              })()}
              {/* Hover-Hervorhebung: betroffene Kante(n) 2 px blau — aktive Ebene */}
              {hoverKanten.map((i) => {
                const p = griffPoly?.[i], q = griffPoly?.[(i + 1) % griffPoly.length];
                if (!p || !q) return null; // stale hover index after a vertex was removed
                return <line key={`hk${i}`} x1={mx(p.x)} y1={my(p.y)} x2={mx(q.x)} y2={my(q.y)} stroke="#1d4ed8" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
              })}
              {/* Ecken-Griffe: sichtbar 10 px (Hover 12 px, gefüllt), Trefferfläche 16 px,
                  fokussierbar (Tab), Pfeile 0,1 m / Shift 1 m, Entf löscht, Doppelklick löscht.
                  75-06 Task 3: rendern für die AKTIVE Ebene (ein Pfad). */}
              {(griffPoly || []).map((p, i) => {
                const aktiv = hover?.art === "ecke" && hover.idx === i;
                return (
                  <g key={`v${i}`}>
                    {fokus === i && (
                      <circle cx={mx(p.x)} cy={my(p.y)} r={px(9)} fill="none" stroke="#1d4ed8" strokeWidth={px(1.5)} strokeDasharray={`${px(2)} ${px(2)}`} pointerEvents="none" />
                    )}
                    <circle data-sicht="ecke" cx={mx(p.x)} cy={my(p.y)} r={px(aktiv ? 6 : 5)} fill={aktiv ? "#1d4ed8" : "#fff"} stroke="#1d4ed8" strokeWidth={px(1.5)}
                      pointerEvents="none" className="transition-colors duration-100 motion-reduce:transition-none" />
                    <circle data-griff="ecke" data-idx={i} cx={mx(p.x)} cy={my(p.y)} r={px(8)} fill="transparent" stroke="none"
                      tabIndex={0} role="button" aria-label={`${t("Ecke")} ${i + 1}`} style={{ cursor: ECKE_CURSOR, outline: "none" }}
                      onPointerDown={onDown("vert", i)} onDoubleClick={onDeleteVert(i)}
                      onPointerEnter={() => setHover({ art: "ecke", idx: i })} onPointerLeave={() => setHover(null)}
                      onFocus={() => setFokus(i)} onBlur={() => setFokus(null)} onKeyDown={onVertKey(i)}>
                      <title>{t("Ziehen: Ecke verschieben · Doppelklick/Entf: Ecke löschen · Pfeile: 0,1 m, Shift 1 m")}</title>
                    </circle>
                  </g>
                );
              })}
              {/* Einfüge-Griffe auf Kantenmitten (+ neue Ecke, sofort ziehbar): sichtbar 8 px, Treffer 16 px */}
              {(griffPoly || []).map((p, i) => {
                const q = griffPoly[(i + 1) % griffPoly.length];
                const cxm = mx((p.x + q.x) / 2), cym = my((p.y + q.y) / 2);
                const aktiv = hover?.art === "mitte" && hover.idx === i;
                return (
                  <g key={`e${i}`}>
                    <circle data-sicht="mitte" cx={cxm} cy={cym} r={px(aktiv ? 5 : 4)} fill={aktiv ? "#1d4ed8" : "#dbeafe"} stroke="#1d4ed8" strokeWidth={px(1)} pointerEvents="none" className="transition-colors duration-100 motion-reduce:transition-none" />
                    <text x={cxm} y={cym + px(2.5)} fontSize={px(8)} fill={aktiv ? "#fff" : "#1d4ed8"} textAnchor="middle" pointerEvents="none">+</text>
                    <circle data-griff="mitte" data-idx={i} cx={cxm} cy={cym} r={px(8)} fill="transparent" stroke="none" style={{ cursor: PLUS_CURSOR }}
                      onPointerDown={onInsertDown(i)}
                      onPointerEnter={() => setHover({ art: "mitte", idx: i })} onPointerLeave={() => setHover(null)}>
                      <title>{t("Klicken: neue Ecke einfügen")}</title>
                    </circle>
                  </g>
                );
              })}
              {/* BBox-Skalier-Griffe (Form proportional skalieren) — 9 px auf dem
                  Bildschirm. 75-06 Task 3: massing body only. */}
              {ebene === "baukoerper" && (
                <>
                  <rect data-griff="skala" x={mx(foot.x) - px(11)} y={my(foot.y) - px(11)} width={px(9)} height={px(9)} fill="#fff" stroke="#64748b" strokeWidth={px(1.5)} style={{ cursor: "nwse-resize" }} onPointerDown={onDown("nw")} />
                  <rect data-griff="skala" x={mx(foot.x + foot.w) + px(2)} y={my(foot.y + foot.d) + px(2)} width={px(9)} height={px(9)} fill="#fff" stroke="#64748b" strokeWidth={px(1.5)} style={{ cursor: "nwse-resize" }} onPointerDown={onDown("se")} />
                </>
              )}
              {/* 75-05: Maßstabsbalken (geteilt mit BimPlan2D), Länge je Maßstab */}
              <ScaleBar x={12} y={CANVAS_H - 14} scale={scale} laengeM={lod.balkenM} />
              {/* north arrow — 75-06 Task 6 (D-P75-05), sign CORRECTED by 75-08
                  Task 5: project convention geographic = plan + north angle
                  (raumklima.azimutFromNormal, tesselierung.orientierungFuerBand)
                  ⇒ geographic north lies at PLAN azimuth −northAngle. 75-06
                  rotated +northAngle, which would contradict light/shadow in
                  the split view. Display only, like every rotation here. */}
              <g transform={`translate(${CANVAS_W - 26} 26)`} data-nordpfeil>
                <g transform={`rotate(${-nordWinkel})`}>
                  <line x1="0" y1="10" x2="0" y2="-10" stroke="#0f172a" strokeWidth="1.3" />
                  <path d="M0 -10 L3.5 -3 L-3.5 -3 Z" fill="#0f172a" />
                </g>
                <text x="0" y="22" fontSize="9" textAnchor="middle" fill="#0f172a">N</text>
              </g>
            </svg>
            {/* 75-04: Lehrling-Palette — folgt dem Zeiger mit Abstand, meidet Polygon und Rand */}
            <LehrlingPalette
              anker={cursorPx}
              meide={meideBox}
              viewport={viewportPx}
              zeilen={paletteZeilen}
              sichtbar={!!(hover || dragInfo) && !tabEingabe && paletteZeilen.length > 0}
            />
            {/* 75-03: Tab-Eingabe — exakte Verschiebung der Kante in Metern (Enter setzt, Esc stellt zurück) */}
            {tabEingabe && (
              <form
                className="absolute top-2 left-2 flex items-center gap-2 rounded-md border border-blue-300 bg-white/95 px-2 py-1 text-xs shadow"
                onSubmit={(e) => { e.preventDefault(); tabBestaetigen(); }}
              >
                <label className="text-slate-600" htmlFor="kante-eingabe">{t("Kante")} {tabEingabe.idx + 1} · {t("Verschiebung in Metern")}</label>
                <input
                  id="kante-eingabe" data-kante-eingabe type="number" step="0.01" autoFocus
                  className="w-24 rounded border border-slate-300 px-1.5 py-0.5 tabular-nums"
                  value={tabEingabe.wert}
                  onChange={(e) => setTabEingabe((v) => ({ ...v, wert: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); tabAbbrechen(); } }}
                />
                <button type="submit" className="rounded bg-slate-800 px-2 py-0.5 text-white">{t("Setzen")}</button>
                <button type="button" onClick={tabAbbrechen} className="rounded border border-slate-300 px-2 py-0.5">{t("Zurück")}</button>
              </form>
            )}
            {/* Zoom-Steuerung (Plan-Werkstatt-Viewport) — Chrome wie BimPlan2D */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[11px]">
              <button onClick={() => vp.zoomBy(1 / 1.2)} className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Verkleinern" title="Verkleinern">−</button>
              <span className="px-1 tabular-nums text-slate-500 select-none" title="Zoom-Stufe">{Math.round(vp.viewT.zoom * 100)}%</span>
              <button onClick={() => vp.zoomBy(1.2)} className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Vergrößern" title="Vergrößern">+</button>
              <button onClick={vp.resetView} className="h-6 px-1.5 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100" aria-label="Ansicht zurücksetzen" title="Zoom/Verschiebung zurücksetzen">⌖</button>
              <span className="w-2" />
              <button type="button" onClick={undo} disabled={!undoStand.p} data-undo className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100 disabled:opacity-40" aria-label={t("Rueckgaengig")} title={t("Rueckgaengig (Strg+Z)")}>↶</button>
              <button type="button" onClick={redo} disabled={!undoStand.f} data-redo className="w-6 h-6 rounded border border-slate-300 bg-white/90 text-slate-600 hover:bg-slate-100 disabled:opacity-40" aria-label={t("Wiederholen")} title={t("Wiederholen (Strg+Y)")}>↷</button>
            </div>
            </div>
            {/* 75-08 Task 5 G: split shows the iso RIGHT NEXT to the plan on
                the same state — dragging a corner updates the iso live. Same
                frame classes as the large 3D branch; aspectRatio keeps the
                height proportional in the narrow column. */}
            {viewMode === "split" && (
              <div className="w-full rounded-lg overflow-hidden border bg-slate-50" style={{ aspectRatio: "560 / 430" }}>
                <MassingView3D {...isoProps} />
              </div>
            )}
            </div>
            )}
          </CardContent>
        </Card>

        <div className="grid sm:grid-cols-2 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Ruler className="w-4 h-4" /> Baukörper</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {/* 72-01 A-4: Zeichenfeld-Slider entfallen — die Fläche kommt aus
                  dem site_parcel (eine Quelle). Hinweis, woher sie stammt. */}
              <div className="text-xs text-slate-500 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                {flaechenQuelle === "zeichenfeld"
                  ? <>Kein Grundstück übernommen — Zeichenfeld {site.w} × {site.d} m [ASSUMED]. Standort im Baufeld-Reiter übernehmen.</>
                  : <>Grundstücksfläche ({flaechenQuelleText}): <b>{Math.round(siteArea).toLocaleString("de-DE")} m²</b> — GRZ/GFZ rechnen auf dieser Fläche.</>}
              </div>
              <Slider label="Geschosse" value={floors} min={1} max={25} step={1} unit=" OG" set={setFloors} />
              <Slider label="Geschosshöhe" value={floorH} min={2.5} max={4.5} step={0.1} unit=" m" set={(v) => { setFloorH(v); store.set({ storeyHeight: v }); }} />
              <div className="border-t pt-2 mt-1 space-y-3">
                {/* 75-13: escape-route paths from the workshop solver — only meaningful
                    while the workshop rule "Rettungsweg" is on (the label says so). */}
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600" title={t("Lauflinie vom tiefsten Punkt jeder WE durch Zimmertür und Diele bis zur Treppenraum-Tür (MBO §35 Abs. 2); Ringe = Türen; rot gestrichelt = Näherung")}>
                  <input type="checkbox" checked={showRettungsweg} onChange={(e) => setShowRettungsweg(e.target.checked)} className="accent-red-600" data-testid="ms-rettungsweg" />
                  {t("Rettungsweg zeigen")}
                  {showRettungsweg && wtLayer?.regeln?.rettungsweg !== true && (
                    <span className="text-[11px] font-normal text-amber-700">— {t("Werkstatt-Regel „Rettungsweg“ ist aus")}</span>
                  )}
                  {rettungswegAktiv && rettungswege.some((r) => r.warn) && (
                    <span className="text-[11px] font-normal text-red-700" data-testid="ms-rettungsweg-warn">{rettungswege.filter((r) => r.warn).length} × &gt; 35 m</span>
                  )}
                </label>
                {/* 75-17: plain-text reason when the inner leg is not walked through real doors. */}
                {rettungswegAktiv && (() => {
                  const art = rettungswege.find((r) => r.innenNaeherung)?.innenArt;
                  return art && RETTUNGSWEG_INNEN_NAEHERUNG[art] ? (
                    <div className="text-[11px] text-amber-800" data-testid="ms-rettungsweg-naeherung">
                      {t("Näherung innen")}: {t(RETTUNGSWEG_INNEN_NAEHERUNG[art])}
                    </div>
                  ) : null;
                })()}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input type="checkbox" checked={showAbstand} onChange={(e) => setShowAbstand(e.target.checked)} className="accent-emerald-600" />
                    Abstandsflächen (Studie)
                  </label>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full border ${
                      !boundaryKnown
                        ? "text-amber-700 border-amber-200 bg-amber-50"
                        : conflictCount
                        ? "text-rose-600 border-rose-200 bg-rose-50"
                        : "text-emerald-600 border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    {!boundaryKnown
                      ? "nicht prüfbar: kein Grundstück gezeichnet"
                      : conflictCount
                      ? `${conflictCount} Konflikt(e) mit Parzellengrenze`
                      : "innerhalb der Parzelle"}
                  </span>
                </div>
                <Slider label={`Faktor (x H) — Tiefe ${Math.max(abstandMin, abstandFaktor * height).toFixed(1)} m`} value={abstandFaktor} min={0.2} max={1} step={0.05} unit=" H" set={setAbstandFaktor} />
                <Slider label="Mindesttiefe" value={abstandMin} min={2.5} max={6} step={0.5} unit=" m" set={setAbstandMin} />
                {/* Persistenter Hinweis: Studie, kein bauordnungsrechtlicher Nachweis (KD-05) */}
                <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] leading-snug text-amber-800">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    <strong>Studie, kein Abstandsflächen-Nachweis.</strong> Dargestellt wird ein frei
                    gewählter Streifen der Tiefe max({abstandFaktor.toFixed(2)}&nbsp;H; {abstandMin.toLocaleString("de-DE")}&nbsp;m)
                    vor jeder Fassade. Nicht berücksichtigt sind unter anderem das Schmalseitenprivileg,
                    die 16-m-Regel, die landesspezifischen Faktoren und Mindesttiefen der jeweiligen LBO,
                    Überdeckungsverbote, Grenzbebauung nach Planrecht sowie untergeordnete Bauteile.
                    Maßgeblich sind die Landesbauordnung und der Bebauungsplan.
                    {boundaryKnown
                      ? " Der Grenzbezug wird gegen die Parzelle aus der Baufeld-Planung geprüft; deren Katasterrichtigkeit ist Voraussetzung."
                      : " Ohne gezeichnete Parzelle gibt es keinen Grenzbezug — die Streifen sind grau und ohne Aussage zur Grenze."}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Sun className="w-4 h-4 text-amber-500" /> {t("Sonne & Verschattung")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input type="checkbox" checked={showShadow} onChange={(e) => setShowShadow(e.target.checked)} className="accent-slate-700" />
                {t("Schatten anzeigen")}
              </label>
              <Slider label={`${t("Monat")} (${MONTHS[month - 1]})`} value={month} min={1} max={12} step={1} unit="" set={(v) => { setMonth(v); setTagImJahr(null); }} />
              <Slider label={t("Uhrzeit")} value={hour} min={4} max={21} step={0.5} unit=":00" set={setHour} />
              {/* 75-08 Task 5 C: reference-day + hour presets (Blatt 08). The
                  day buttons set month AND tagImJahr (the explicit day-of-year
                  path); the hour buttons set the true-local-solar-time hour.
                  Native buttons (each new shadcn instance counts as tsc debt). */}
              <div className="pt-1">
                <div className="text-[10px] font-medium text-slate-500 mb-1">{t("Stichtage")}</div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Stichtage")}>
                  {SONNEN_PRESETS.tage.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      data-testid="ms-sonne-preset"
                      data-tag={p.tagImJahr}
                      aria-pressed={tagImJahr === p.tagImJahr}
                      onClick={() => { setMonth(p.monat); setTagImJahr(p.tagImJahr); }}
                      className={`rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors ${tagImJahr === p.tagImJahr ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-1">
                <div className="text-[10px] font-medium text-slate-500 mb-1">{t("Uhrzeit (wahre Ortszeit)")}</div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Uhrzeit (wahre Ortszeit)")}>
                  {SONNEN_PRESETS.stunden.map((h) => (
                    <button
                      key={h}
                      type="button"
                      data-testid="ms-sonne-preset"
                      data-stunde={h}
                      aria-pressed={hour === h}
                      onClick={() => setHour(h)}
                      className={`rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors ${hour === h ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {String(h).padStart(2, "0")}:00
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded bg-amber-50 p-2 text-center" data-testid="ms-sonne-hoehe"><div className="text-sm font-bold text-amber-700">{sun.elevation.toFixed(0)}°</div><div className="text-[10px] text-slate-500">{t("Sonnenhöhe")}</div></div>
                <div className="rounded bg-amber-50 p-2 text-center" data-testid="ms-sonne-azimut"><div className="text-sm font-bold text-amber-700">{sun.azimuth.toFixed(0)}°</div><div className="text-[10px] text-slate-500">{t("Azimut (v. N)")}</div></div>
              </div>
              <p className="text-[11px] text-slate-400">{sun.elevation <= 3 ? t("Sonne unter dem Horizont — kein Schattenwurf.") : `${t("Schattenlänge")} ≈ ${(height / Math.tan(sun.elevation * Math.PI / 180)).toFixed(0)} m`}</p>
            </CardContent>
          </Card>
        </div>

        {/* Drittes Fenster: echtes 3D des freien Baukörpers + Abstandsflächen */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="w-4 h-4" /> Massing 3D & Abstandsflächen
              <span className="text-sm font-normal text-slate-500">— freie Form extrudiert, Abstandsflächen am Boden (Studie)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* 75-08 Task 5 H: ONE iso instance in every mode. The lower card
                renders the iso ONLY in 2D mode; in Iso/split the large window
                above already shows it — a second WebGL context here would be
                the pre-existing double-instance bug. A hint sentence (i18n)
                replaces it. Kamera state travels via isoKameraRef. */}
            {viewMode === "2d" ? (
              <div className="h-80 rounded-lg overflow-hidden">
                <MassingView3D {...isoProps} />
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500" data-testid="ms-iso-hinweis">
                {t("Die Iso-Ansicht läuft oben im großen Fenster.")}
              </p>
            )}
            {showAbstand && !boundaryKnown && (
              <p className="px-4 py-2 text-[11px] text-amber-700 border-t">
                {t("Abstandsflächen ohne Grenzbezug — kein Grundstück gezeichnet. Die grüne Einfärbung im 3D bedeutet hier")} <strong>{t("nicht")}</strong> {t("„eingehalten\".")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* KPIs + 3D */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4" /> Kennzahlen <span className="text-xs font-normal text-slate-400 ml-auto">[{store.unit}]</span></CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5">
            <KPI icon={Maximize2} label="Grundstück" value={`${Math.round(siteArea).toLocaleString("de-DE")} m²`} sub={flaechenQuelleText} tint="text-slate-500" testid="ms-kpi-grundstueck" />
            <KPI icon={Building2} label="Bebaut (BF)" value={`${Math.round(footArea).toLocaleString("de-DE")} m²`} tint="text-blue-500" />
            <KPI icon={Layers} label="GRZ" value={grz.toFixed(2)} sub={`${grz > 0.4 ? "über Regelwert 0,4" : "≤ 0,4 ok"} · auf ${flaechenQuelleText}`} tint="text-violet-500" />
            <KPI icon={Layers} label="GFZ" value={gfz.toFixed(2)} sub={`${gfz > 1.2 ? "hoch" : "moderat"} · auf ${flaechenQuelleText}`} tint="text-violet-500" />
            {/* 75-06 Task 5 (MS-06): envelope violation as a number — only when
                an envelope exists; concave envelopes honestly without m². */}
            {baufeldBekannt && (
              <KPI
                icon={Maximize2}
                label={t("außerhalb")}
                testid="ms-kpi-ausserhalb"
                value={ausserhalb?.m2 == null ? t("Anteil außerhalb") : `${Math.round(ausserhalb.m2).toLocaleString("de-DE")} m²`}
                sub={ausserhalb?.m2 == null
                  ? t("Baufeld nicht konvex — Fläche nicht berechenbar [ASSUMED]")
                  : ausserhalb?.hatAnteilAusserhalb ? t("Baukörper ragt über das Baufeld") : t("innerhalb des Baufelds")}
                tint={ausserhalb?.hatAnteilAusserhalb ? "text-rose-500" : "text-emerald-500"}
              />
            )}
            {/* 75-02 (MS-02): Proportion nach der φ-Hausregel — Bürostandard, kein Normbezug */}
            <KPI
              icon={Ruler}
              label={t("Proportion")}
              value={proportion.status === "offen" ? "—" : proportion.status === "gruen" ? `${proportion.text} ✓` : `1 : ${proportion.verhaeltnis.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              sub={`${proportion.status === "gelb" ? proportion.text : t("Bürostandard φ [ASSUMED]")}${proportion.naeherung ? ` · ${t("Bbox-Näherung")}` : ""}`}
              tint={proportion.status === "gruen" ? "text-emerald-500" : "text-amber-500"}
            />
            <KPI icon={Building2} label="BGF" value={`${Math.round(bgf).toLocaleString("de-DE")} m²`} tint="text-emerald-500" testid="ms-kpi-bgf" />
            <KPI icon={Ruler} label="Höhe" value={`${height.toFixed(1)} m`} tint="text-slate-500" />
            {/* 72-01 A-5: Dichte-Kennzahlen je Projekttyp — bei Gewerbe stehen
                hier Arbeitsplätze statt „Wohneinheiten" (Befund N-05). */}
            {dichteKpis.map((kpi) => (
              <KPI
                key={kpi.key}
                icon={kpi.icon === "home" ? Home : kpi.icon === "car" ? Car : Users}
                label={kpi.label}
                value={`~${kpi.value}`}
                sub={kpi.sub}
                tint={kpi.icon === "car" ? "text-slate-500" : "text-amber-500"}
              />
            ))}
            <KPI icon={Home} label="Räume" value={zones.length} sub={`Σ ${Math.round(zonesArea).toLocaleString("de-DE")} m²`} tint="text-sky-500" />
            <KPI
              icon={Maximize2}
              label="Abstandsflächen (Studie)"
              value={!boundaryKnown ? "nicht prüfbar" : conflictCount ? `${conflictCount} ⚠` : "in Parzelle"}
              sub={
                !boundaryKnown
                  ? "kein Grundstück gezeichnet"
                  : `Tiefe ${Math.max(abstandMin, abstandFaktor * height).toFixed(1)} m (${abstandFaktor.toFixed(2)} H)`
              }
              tint={!boundaryKnown ? "text-amber-500" : conflictCount ? "text-rose-500" : "text-emerald-500"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4" /> 3D-Massenmodell</CardTitle></CardHeader>
          <CardContent className="h-72 p-0 rounded-lg overflow-hidden">
            <BimModelViewer building={{ floors, area_net: footArea }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
