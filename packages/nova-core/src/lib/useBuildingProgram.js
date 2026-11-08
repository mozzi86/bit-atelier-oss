// Gemeinsame Quelle der Wahrheit für das Bauprogramm: Footprint, Geschosse,
// Geschosshöhe und Einheit. Massing-Studio, Gebäudemodell (BIT-BIM), Kennzahlen,
// Raumprogramm, Machbarkeit und Kosten lesen/schreiben hier — „alles ist verbunden".
import { useSyncExternalStore } from "react";
import { footprintQuelleGezeichnet } from "./footprintQuelle.js";
import { elevationOf, geschosseAus, okfObersterGeschoss, patchAlleGeschosshoehen, patchGeschosshoehe } from "./bauteil/hoehen.js";

// footprintM: zentriertes Meter-Polygon [{x,z}] oder null (=> Default 20×14).
// zones: gespiegelte Räume aus dem Gebäudemodell [{points:[{x,z}],level,name}].
// costEstimate: Kostenschätzung aus dem Kosten-Tab { total, bgf, perM2 } oder null
//   — wird von der AVA-Kostenkontrolle als Budget-Referenz gelesen.
// footprintQuelle (73-05): provenance of footprintM ({ art: "gemessen"|"gezeichnet", … }, footprintQuelle.js)
//   or null (unknown, legacy). A change of footprintM WITHOUT its own provenance is a drawing edit and turns
//   it into "gezeichnet" — a measured outline that someone moved is no longer measured.
// achseM (86-07): user-drawn centre line of the building as a polyline [{x,z}] in the SAME centred
//   metres as footprintM (origin = footprint bbox centre), or null (no axis). Drawn in the massing
//   studio, read by the workshop tessellation (bars along the axis); persisted with the programme.
// geschosse (107-02, D-BK-05): optional storey table [{level, name?, hoehe_m}] (m) or null. null = every storey has
//   `storeyHeight` (all old projects); with a table the heights are read through @core/lib/bauteil/hoehen.js. `storeyHeight`
//   stays the uniform value for the readers that only need one number.
// untergeschosse (107-13, D-BK-20): number of basement storeys 0 … 3 [ASSUMED] (bauteil/ebenen.js MAX_UNTERGESCHOSSE) on the levels
//   −1 … −U. `storeys` stays the number of storeys above ground. 0 = no basement in the model (all old projects); the record of a
//   project that never had a basement never gets the field written (useBimModelSync). Kept out of programMetrics (BGF, GFZ base,
//   height stay above ground; the basement area belongs to the DIN 277 chain of 107-11).
// footprintLageM (108-08, D-EFH-09): position of the massing body on the site, {x, z} in m or null (not placed yet, all old projects).
//   Offset of the ORIGIN of footprintM from the vertex mean of the site parcel (site metres, x east, z south); without a parcel from
//   the centre of the 70 x 50-m stand-in field. Written by the massing studio only when the body is moved (or the field already
//   exists); read by @core/lib/massing/lage.js startLageSite. The axis achseM stays relative to the footprint origin.
let state = { footprintM: null, footprintQuelle: null, achseM: null, storeys: 4, storeyHeight: 3, geschosse: null, untergeschosse: 0, footprintLageM: null, unit: "m", zones: [], costEstimate: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const buildingProgram = {
  get: () => state,
  set: (patch) => {
    let p = patch;
    if (p && "footprintM" in p && !("footprintQuelle" in p) && JSON.stringify(p.footprintM) !== JSON.stringify(state.footprintM)) {
      p = { ...p, footprintQuelle: p.footprintM ? footprintQuelleGezeichnet() : null };
    }
    state = { ...state, ...p }; emit();
  },
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  /**
   * The ONE writer for "all storeys get this height" (107-02 review fix): sets `storeyHeight` and, when a storey table exists,
   * every table row, so every studio (BIT-BIM, Massing) keeps number and table in step.
   * @param {number} hoehe_m storey height in m (> 0)
   */
  setAlleGeschosshoehen: (hoehe_m) => { if (hoehe_m > 0) buildingProgram.set(patchAlleGeschosshoehen(state, hoehe_m)); },
  /**
   * Height of ONE storey in m. Creates the table from `storeys × storeyHeight` on the first call and adds a row for a storey that
   * is not in the table yet (see patchGeschosshoehe).
   * @param {number} level storey index (integer)
   * @param {number} hoehe_m height in m (> 0; anything else is ignored)
   */
  setGeschosshoehe: (level, hoehe_m) => { const p = patchGeschosshoehe(state, level, hoehe_m); if (p) buildingProgram.set(p); },
};

export function useBuildingProgram() {
  const s = useSyncExternalStore(buildingProgram.subscribe, buildingProgram.get, buildingProgram.get);
  return { ...s, set: buildingProgram.set, setAlleGeschosshoehen: buildingProgram.setAlleGeschosshoehen, setGeschosshoehe: buildingProgram.setGeschosshoehe };
}

// Rechteck-Footprint (zentriert) aus Breite/Tiefe in Metern.
export function rectFootprint(w, d) {
  const hw = w / 2, hd = d / 2;
  return [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }];
}

// Bounding-Box (Breite/Tiefe in m) eines Footprint-Polygons.
export function footprintWD(fp) {
  if (!fp || fp.length < 2) return { w: 20, d: 14 };
  const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
}

// Fläche eines (zentrierten) Meter-Polygons [{x,z}] in m² (Shoelace).
export function polygonAreaM(pts) {
  if (!pts || pts.length < 3) return 0;
  return Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
}
// Grundfläche (Footprint) in m²; 0 wenn kein Footprint gesetzt.
export function footprintAreaM(fp) { return polygonAreaM(fp); }

// Abgeleitete Kennzahlen aus dem Bauprogramm — EINE Quelle für Kennzahlen,
// Raumprogramm, Machbarkeit und Kosten. footArea=0 => kein Footprint gesetzt.
export function programMetrics(s) {
  const footArea = footprintAreaM(s?.footprintM);
  const storeys = Math.max(0, Math.round(s?.storeys || 0));
  const storeyHeight = s?.storeyHeight || 3;
  // gross floor area of the storeys ABOVE GROUND only (footprint × storeys), m² - basements (`untergeschosse`) are NOT included, so this is
  // not the BGF after DIN 277 (the massing studio shows that one with basements, massing/flaechenKennzahlen.js, 108-12). The cost
  // calculator and the planners read this value; switching them to the DIN 277 BGF is an open decision (108-12 review, golden 86-05a).
  const bgf = footArea * storeys;
  // Nettogrundfläche ~80 % BGF [ASSUMED] — ALWAYS the flat value, above ground, also when zones exist (107-11 review): every planner
  // that reads pm.ngf (apartment, building services, landscape, drainage, accessibility) keeps the flat rate. The zone-aware DIN 277
  // areas (bauteil/raeume.js din277Flaechen) are used only by the massing studio's NUF (kennzahlen.js nufFuerKennzahlen) and the DIN 277
  // table of the BIM studio; switching programMetrics/bebauungsvorschlaege to them is an open decision (golden 86-05a).
  const ngf = bgf * 0.8;
  // Gebäudehöhe (m); 107-02: with a storey table the sum of its heights, else storeys × one height as before
  const height = Array.isArray(s?.geschosse) && s.geschosse.length ? elevationOf(storeys, geschosseAus(s)) : storeys * storeyHeight;
  // OKF of the top storey (m): 107-02 review fix, was `(storeys − 1) × storeyHeight` inline in the planners and ignored the table
  const okf_m = okfObersterGeschoss(storeys, geschosseAus(s));
  return { footArea, storeys, storeyHeight, bgf, ngf, height, okf_m };
}

// Einheiten (Längen). Faktor von Metern + Nachkommastellen + Suffix.
export const LENGTH_UNITS = {
  m: { factor: 1, decimals: 2, suffix: "m" },
  cm: { factor: 100, decimals: 0, suffix: "cm" },
  mm: { factor: 1000, decimals: 0, suffix: "mm" },
};
// Meter -> formatierter String in der gewählten Einheit.
export function fmtLen(meters, unit = "m", withSuffix = true) {
  const u = LENGTH_UNITS[unit] || LENGTH_UNITS.m;
  const v = (meters * u.factor).toFixed(u.decimals);
  return withSuffix ? `${v} ${u.suffix}` : v;
}
