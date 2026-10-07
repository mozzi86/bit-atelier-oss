// Gemeinsames Gebäudemodell (Meter-Einheiten) — Single Source of Truth für
// 3D-Darstellung, später 2D-Schnitt und IFC-Export. Koordinaten in der XZ-Ebene
// (y = oben). Footprint-Polygon zentriert um den Ursprung.

import { metersPerPixel } from "@core/lib/geo";

// ---- Wand-Aufbauten (Composites, mehrschichtig) ---------------------------
// Schichten von außen (oben in der Liste) nach innen. thickness in mm.
// material = Id im MATERIAL_KATALOG (@designer/lib/bauteilAufbau — Phase 44,
// gemeinsame Kennwert-Quelle für Bauphysik/Schallschutz). rw = bewertetes
// Schalldämm-Maß R'w in dB, [ASSUMED]-Richtwert je Aufbau (Phase 39).
export const WALL_COMPOSITES = [
  { id: "single24", name: "Stahlbeton 24 cm", rw: 57, skins: [
    { name: "Stahlbeton", material: "beton", thickness: 240, color: "#9aa6b2", hatch: "concrete" },
  ] },
  { id: "cavity", name: "Klinker + Dämmung + KS (39 cm)", rw: 55, skins: [
    { name: "Klinker", material: "klinker", thickness: 100, color: "#b45309", hatch: "brick" },
    // Zweischalige Luftschicht ist über Lüftungsöffnungen belüftet (DIN-1053-
    // Muster) — bauphysikalisch endet der Querschnitt hier (luftbel, Phase 44).
    { name: "Luftschicht", material: "luftbel", thickness: 50, color: "#f1f5f9", hatch: "none" },
    { name: "Dämmung", material: "mw035", thickness: 120, color: "#fde68a", hatch: "insul" },
    { name: "Kalksandstein", material: "ks", thickness: 175, color: "#94a3b8", hatch: "block" },
    { name: "Innenputz", material: "gipsputz", thickness: 15, color: "#e2e8f0", hatch: "none" },
  ] },
  { id: "timber", name: "Holzrahmen (30 cm)", rw: 44, skins: [
    { name: "Fassade Holz", material: "holz", thickness: 24, color: "#92400e", hatch: "wood" },
    { name: "Hinterlüftung", material: "luftbel", thickness: 40, color: "#f1f5f9", hatch: "none" },
    { name: "Dämmung", material: "mw035", thickness: 200, color: "#fde68a", hatch: "insul" },
    { name: "OSB", material: "osb", thickness: 18, color: "#d6b38a", hatch: "wood" },
    { name: "GK-Beplankung", material: "gk", thickness: 18, color: "#e2e8f0", hatch: "none" },
  ] },
];
export const compositeById = (id) => WALL_COMPOSITES.find((c) => c.id === id) || null;

// ---- Fenster-Bibliothek (Typen mit Flügeln/Sprossen) ----------------------
// w/h/sill in m; cols = Flügel nebeneinander, rows = Felder übereinander.
// g/ug seit Phase 45 (KLIMA-03): [ASSUMED] Verglasungs-Richtwerte 2-Scheiben-
// Wärmeschutzverglasung (g⊥ 0,60 nach EN 410, Ug 1,1 W/(m²K)); gemeinsame
// Quelle für Raumklima (45) und Bauphysik. Der 0,9-Faktor auf g gehört NUR zum
// Heizfall (DIN V 4108-6/18599), nicht ins Sonneneintragskennwert-Verfahren.
// Kein Produktnachweis — bei bekannter Verglasung überschreiben.
export const WINDOW_TYPES = [
  { id: "single", name: "Einflügelig", w: 1.0, h: 1.4, sill: 0.9, cols: 1, rows: 2, g: 0.6, ug: 1.1 },
  { id: "double", name: "Zweiflügelig", w: 1.8, h: 1.4, sill: 0.9, cols: 2, rows: 2, g: 0.6, ug: 1.1 },
  { id: "triple", name: "Dreiflügelig", w: 2.7, h: 1.4, sill: 0.9, cols: 3, rows: 2, g: 0.6, ug: 1.1 },
  { id: "hung", name: "Doppel-Hung", w: 1.0, h: 1.6, sill: 0.8, cols: 1, rows: 2, g: 0.6, ug: 1.1 },
  { id: "hungDouble", name: "Doppel-Hung 2", w: 1.8, h: 1.6, sill: 0.8, cols: 2, rows: 2, g: 0.6, ug: 1.1 },
  { id: "french", name: "Boden-Fenster", w: 1.6, h: 2.1, sill: 0.0, cols: 2, rows: 3, g: 0.6, ug: 1.1 },
];
export const windowTypeById = (id) => WINDOW_TYPES.find((w) => w.id === id) || WINDOW_TYPES[0];

// ---- Tür-Bibliothek (sill = 0, mit Türblatt) ------------------------------
export const DOOR_TYPES = [
  { id: "single", name: "Tür einflügelig", w: 1.0, h: 2.1, sill: 0, cols: 1, rows: 1, glass: false },
  { id: "doubleLeaf", name: "Tür zweiflügelig", w: 1.8, h: 2.1, sill: 0, cols: 2, rows: 1, glass: false },
  { id: "glassDoor", name: "Glastür", w: 1.0, h: 2.1, sill: 0, cols: 1, rows: 3, glass: true },
  { id: "sliding", name: "Schiebetür", w: 2.0, h: 2.2, sill: 0, cols: 2, rows: 1, glass: true },
  { id: "entrance", name: "Haustür", w: 1.2, h: 2.2, sill: 0, cols: 1, rows: 2, glass: false },
];
export const doorTypeById = (id) => DOOR_TYPES.find((d) => d.id === id) || DOOR_TYPES[0];
// Einheitlicher Zugriff nach Art.
export const openingTypeById = (kind, id) => (kind === "door" ? doorTypeById(id) : windowTypeById(id));
export const compositeTotalM = (id) => {
  const c = compositeById(id);
  return c ? c.skins.reduce((s, k) => s + k.thickness, 0) / 1000 : null;
};

// px-Polygon (designated_areas) → Meter-Polygon [{x,z}], zentriert auf den Schwerpunkt.
export function footprintToMeters(points, parcel) {
  if (!points || points.length < 3) return null;
  const mpp = metersPerPixel(parcel);
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => ({ x: (p.x - cx) * mpp, z: (p.y - cy) * mpp }));
}

export const DEFAULT_FOOTPRINT = [
  { x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 },
];

// Erzeugt das Gebäudemodell aus Footprint + Geschossparametern.
export function createBuildingModel({ footprintM, storeys = 4, storeyHeight = 3, wallThickness = 0.3, wallComposite = null, parapet = { enabled: true, height: 1.0 } } = {}) {
  const fp = (footprintM && footprintM.length >= 3) ? footprintM : DEFAULT_FOOTPRINT;
  const n = Math.max(1, Math.round(storeys));
  const sh = storeyHeight;
  const wt = compositeTotalM(wallComposite) || wallThickness;

  const storeyList = [];
  const walls = [];
  const slabs = [];
  const spaces = [];
  const parapets = [];

  for (let lvl = 0; lvl < n; lvl++) {
    const elevation = lvl * sh;
    storeyList.push({ level: lvl, elevation, name: lvl === 0 ? "EG" : `${lvl}. OG` });
    // Wände entlang jeder Footprint-Kante
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % fp.length];
      walls.push({ a, b, height: sh, thickness: wt, composite: wallComposite, level: lvl, elevation, edge: i });
    }
    // Decke (Slab) als Footprint-Polygon auf Geschossdecke
    slabs.push({ level: lvl, elevation: elevation + sh, polygon: fp });
    // Ein Raum (Space) je Geschoss
    spaces.push({ level: lvl, polygon: fp, name: lvl === 0 ? "EG" : `${lvl}. OG`, elevation });
  }
  // Bodenplatte
  slabs.unshift({ level: -1, elevation: 0, polygon: fp });

  // Attika (Brüstung) entlang des Footprints auf der obersten Decke
  const parapetH = parapet?.enabled ? (parapet.height ?? 1.0) : 0;
  if (parapetH > 0) {
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      parapets.push({ a, b, height: parapetH, thickness: wallThickness, elevation: n * sh });
    }
  }

  return { footprint: fp, storeys: storeyList, walls, slabs, spaces, parapets, parapetHeight: parapetH, storeyHeight: sh, totalHeight: n * sh };
}

// Bounding-Box (Meter) für Kamera-Fokus.
export function modelBBox(model) {
  const fp = model?.footprint || DEFAULT_FOOTPRINT;
  const xs = fp.map((p) => p.x);
  const zs = fp.map((p) => p.z);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    height: model?.totalHeight || 12,
  };
}

// Hilfsfunktion: Polygon-Schwerpunkt in Metern.
export function footprintCentroid(fp) {
  const s = fp.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / fp.length, z: s.z / fp.length };
}
