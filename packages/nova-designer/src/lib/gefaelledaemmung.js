// Tapered roof insulation on a flat roof (Phase 63, ENTW-03).
//
// A flat roof is never flat: the insulation is laid in wedges so the water reaches the drains.
// This module turns "roof outline + drain positions" into the plan a designer needs — which
// cell drains where, how thick the insulation gets, where the ridges run, how much material it
// takes, and what the build-up is worth thermally at its thinnest and thickest point.
//
// In:  footprint (plan polygon in metres, x/z), drains as points {id, x, z}, slope in %,
//      minimum thickness at the drain in m.
// Out: pure data — cells, ridges, flow arrows, per-drain figures, thickness bands, volume,
//      U-values, checks (pass | warn | offen, never fail) and quantities for the AVA hand-over.
//
// The cell assignment is the SAME raster idea as the load take-down of Phase 40
// (tragwerkPlan.lasteinzug): walk a grid over the outline, give every cell to its nearest
// point. One mechanism, two uses — a second grid implementation would drift apart.
//
// Everything marked [ASSUMED] is a rule of thumb after the Flachdachrichtlinie / DIN 18531;
// a roofing designer replaces it. Units: m, m², m³, %, W/(m²K), mm for layer thicknesses.

import { punktImPolygon } from "@designer/lib/moebel";
import { polygonAreaM } from "@core/lib/useBuildingProgram";
import { uWert } from "@designer/lib/bauteilAufbau";

const num = (v, d = 0) => (v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const rnd = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;
const isPt = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z));

// ---- Kennwerte -------------------------------------------------------------------------------

/** Slope of a tapered roof in % — 2 % is the value the Flachdachrichtlinie recommends. */
export const GEFAELLE_DEFAULT_PCT = 2;
/** [ASSUMED] Insulation thickness at the drain (m): thinnest point, still frost- and load-safe. */
export const DMIN_DEFAULT_M = 0.12;
/** Grid step of the cell assignment (m) — same as the load take-down of Phase 40. */
export const RASTER_M = 0.5;
/** [ASSUMED] Longest acceptable flow path to a drain (m); beyond it the water stands too long. */
export const FLIESSWEG_MAX_M = 15;
/** [ASSUMED] Largest roof area one drain should take (m²), after DIN 1986-100 practice. */
export const FLAECHE_JE_ABLAUF_MAX_M2 = 300;
/** [ASSUMED] Above this thickness the build-up fights the parapet and the door sills (m). */
export const DMAX_WARN_M = 0.4;
/** Thickness gradation of the wedge boards (m) — 20 mm is what the trade delivers. [ASSUMED] */
export const STAFFEL_M = 0.02;

/**
 * [ASSUMED] Warm roof build-up, outside → inside. Only the insulation thickness varies; it is
 * the layer this module computes. Thicknesses in mm (the unit bauteilAufbau expects).
 * @type {Array<{material: string, d: number}>}
 */
export const DACH_AUFBAU = [
  { material: "bitumenbahn", d: 8 },   // Abdichtung
  { material: "eps032", d: 120 },      // Gefälledämmung — d wird je Punkt ersetzt
  { material: "bitumenbahn", d: 4 },   // Dampfsperre
  { material: "beton", d: 200 },       // Tragschale
];

// ---- Gefälleplan -----------------------------------------------------------------------------

/**
 * Distance of a point to the nearest drain.
 * @param {{x:number,z:number}} p
 * @param {Array<{x:number,z:number}>} ablaeufe
 * @returns {{ dist: number, idx: number }} idx = index in `ablaeufe`, −1 without drains
 */
function naechsterAblauf(p, ablaeufe) {
  let idx = -1, best = Infinity;
  for (let i = 0; i < ablaeufe.length; i++) {
    const d = Math.hypot(ablaeufe[i].x - p.x, ablaeufe[i].z - p.z);
    if (d < best) { best = d; idx = i; }
  }
  return { dist: best, idx };
}

/**
 * The tapered-insulation plan of one flat roof.
 *
 * The thickness at a point is `dmin + slope · distance to its drain` — the wedge rises away from
 * the drain. `dmax_m` is measured at the outline CORNERS, not at a cell centre: the corner is the
 * physically thickest point, and only that makes the number reproducible by hand.
 *
 * @param {Array<{x:number,z:number}>} footprint roof outline in metres
 * @param {Array<{id?:string,x:number,z:number}>} ablaeufe roof drains
 * @param {{ gefaelle_pct?: number, dmin_m?: number, raster?: number }} [opts] slope in %, thickness at the drain in m, grid step in m
 * @returns {{ zellen: Array<{x:number,z:number,idx:number,d_m:number}>, grate: Array<{a:{x:number,z:number},b:{x:number,z:number}}>, pfeile: Array<{x:number,z:number,dx:number,dz:number}>, jeAblauf: Array<{id:string,idx:number,x:number,z:number,flaeche_m2:number,fliessweg_m:number,dmax_m:number}>, dmin_m: number, dmax_m: number, dMittel_m: number, volumen_m3: number, flaeche_m2: number, staffeln: Array<{von:number,bis:number,m2:number}> }}
 */
export function gefaelleplan(footprint, ablaeufe, { gefaelle_pct = GEFAELLE_DEFAULT_PCT, dmin_m = DMIN_DEFAULT_M, raster = RASTER_M } = {}) {
  const rand = (Array.isArray(footprint) ? footprint : []).filter(isPt);
  const drains = (Array.isArray(ablaeufe) ? ablaeufe : []).filter(isPt);
  const flaeche_m2 = rnd(polygonAreaM(rand), 1);
  const gef = Math.max(0, num(gefaelle_pct, GEFAELLE_DEFAULT_PCT)) / 100;
  const dmin = Math.max(0, num(dmin_m, DMIN_DEFAULT_M));
  const schritt = num(raster, RASTER_M) > 0 ? num(raster, RASTER_M) : RASTER_M;
  const leer = { zellen: [], grate: [], pfeile: [], jeAblauf: [], dmin_m: rnd(dmin), dmax_m: rnd(dmin), dMittel_m: rnd(dmin), volumen_m3: 0, flaeche_m2, staffeln: [] };
  if (rand.length < 3 || drains.length === 0) return leer;

  const xs = rand.map((p) => p.x), zs = rand.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);

  // Zellen: gleiche Rasterlogik wie tragwerkPlan.lasteinzug — Mitte der Zelle entscheidet.
  const zellen = [];
  const proAblauf = drains.map(() => ({ zellen: 0, fliessweg: 0 }));
  for (let x = minX + schritt / 2; x < maxX; x += schritt) {
    for (let z = minZ + schritt / 2; z < maxZ; z += schritt) {
      if (!punktImPolygon(x, z, rand)) continue;
      const { dist, idx } = naechsterAblauf({ x, z }, drains);
      proAblauf[idx].zellen += 1;
      if (dist > proAblauf[idx].fliessweg) proAblauf[idx].fliessweg = dist;
      zellen.push({ x: rnd(x), z: rnd(z), idx, d_m: rnd(dmin + gef * dist, 3) });
    }
  }

  // Grate: zwischen zwei Nachbarzellen mit verschiedenen Abläufen läuft der First.
  const schluessel = (x, z) => `${x.toFixed(2)}|${z.toFixed(2)}`;
  const karte = new Map(zellen.map((c) => [schluessel(c.x, c.z), c]));
  const grate = [];
  for (const c of zellen) {
    const rechts = karte.get(schluessel(rnd(c.x + schritt), c.z));
    if (rechts && rechts.idx !== c.idx) {
      const mx = rnd((c.x + rechts.x) / 2);
      grate.push({ a: { x: mx, z: rnd(c.z - schritt / 2) }, b: { x: mx, z: rnd(c.z + schritt / 2) } });
    }
    const unten = karte.get(schluessel(c.x, rnd(c.z + schritt)));
    if (unten && unten.idx !== c.idx) {
      const mz = rnd((c.z + unten.z) / 2);
      grate.push({ a: { x: rnd(c.x - schritt / 2), z: mz }, b: { x: rnd(c.x + schritt / 2), z: mz } });
    }
  }

  // Pfeile: Fließrichtung, ausgedünnt auf jede vierte Zelle — sonst ist der Plan schwarz.
  const pfeile = [];
  for (const c of zellen) {
    if (Math.round(c.x / schritt) % 4 !== 0 || Math.round(c.z / schritt) % 4 !== 0) continue;
    const ziel = drains[c.idx];
    const dx = ziel.x - c.x, dz = ziel.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    pfeile.push({ x: c.x, z: c.z, dx: rnd(dx / len), dz: rnd(dz / len) });
  }

  // dmax an den Ecken des Umrisses, nicht an einer Zellmitte — der Eckpunkt ist der dickste
  // Punkt und die einzige Stelle, die sich von Hand nachrechnen lässt.
  let dmax = dmin;
  for (const p of rand) {
    const d = dmin + gef * naechsterAblauf(p, drains).dist;
    if (d > dmax) dmax = d;
  }

  const zellFlaeche = schritt * schritt;
  const summe = zellen.reduce((s, c) => s + c.d_m, 0);
  const volumen_m3 = rnd(summe * zellFlaeche, 2);
  const dMittel = zellen.length ? summe / zellen.length : dmin;

  // Staffeln: Plattendicken in 2-cm-Stufen ab dmin. Die Summe ist die gerasterte Dachfläche,
  // die bei einem Rechteck der Polygonfläche entspricht und bei schrägen Rändern leicht darunter
  // liegt — deshalb wird sie aus den Zellen gebildet und nicht aus flaeche_m2 hochgerechnet.
  const staffelKarte = new Map();
  for (const c of zellen) {
    const stufe = Math.floor((c.d_m - dmin) / STAFFEL_M);
    const von = rnd(dmin + stufe * STAFFEL_M, 3);
    staffelKarte.set(von, (staffelKarte.get(von) || 0) + zellFlaeche);
  }
  const staffeln = [...staffelKarte.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([von, m2]) => ({ von, bis: rnd(von + STAFFEL_M, 3), m2: rnd(m2, 1) }));

  const jeAblauf = drains.map((a, i) => ({
    id: a.id || `ab_${i + 1}`,
    idx: i,
    x: rnd(a.x),
    z: rnd(a.z),
    flaeche_m2: rnd(proAblauf[i].zellen * zellFlaeche, 1),
    fliessweg_m: rnd(proAblauf[i].fliessweg),
    dmax_m: rnd(dmin + gef * proAblauf[i].fliessweg, 3),
  }));

  return { zellen, grate, pfeile, jeAblauf, dmin_m: rnd(dmin, 3), dmax_m: rnd(dmax, 3), dMittel_m: rnd(dMittel, 3), volumen_m3, flaeche_m2, staffeln };
}

// ---- Bauphysik --------------------------------------------------------------------------------

/**
 * U-value of the roof build-up at its thinnest and thickest point.
 * More insulation means a LOWER U — `uMin` therefore belongs to `dmax_m`.
 * @param {{ dmin_m?: number, dmax_m?: number, aufbau?: Array<{material:string,d:number}> }} p thicknesses in m
 * @returns {{ uMin: number, uMax: number, aufbau: string }} U in W/(m²K), `aufbau` as a readable layer list
 */
export function uWerteDach({ dmin_m = DMIN_DEFAULT_M, dmax_m = DMIN_DEFAULT_M, aufbau = DACH_AUFBAU } = {}) {
  const mitDicke = (d_m) => aufbau.map((l) => (l.material === "eps032" ? { ...l, d: Math.max(1, Math.round(num(d_m) * 1000)) } : l));
  const uDuenn = uWert(mitDicke(dmin_m)).U;
  const uDick = uWert(mitDicke(dmax_m)).U;
  return {
    uMin: rnd(Math.min(uDuenn, uDick), 3),
    uMax: rnd(Math.max(uDuenn, uDick), 3),
    aufbau: aufbau.map((l) => `${l.material} ${l.d} mm`).join(" · "),
  };
}

// ---- Checks und Mengen -------------------------------------------------------------------------

/**
 * Concept checks — pass | warn | offen, never fail: whether a flow path is acceptable is the
 * roofing designer's call, this is the pre-check (T-17-04 rule).
 * @param {ReturnType<typeof gefaelleplan>|null} plan
 * @param {{ dachform?: string, nNot?: number }} [p] roof shape and number of emergency overflows
 * @returns {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>}
 */
export function gefaelleChecks(plan, { dachform = "flach", nNot = 0 } = {}) {
  const items = [];
  if (dachform !== "flach") {
    items.push({ key: "dachform", label: "Dachform", status: "offen", detail: `Dachform „${dachform}“ — die Gefälledämmung gilt für Flachdächer` });
    return items;
  }
  if (!plan || !plan.jeAblauf.length) {
    items.push({ key: "ablaeufe", label: "Dachabläufe", status: "offen", detail: "Keine Abläufe gesetzt — im Dach-Grundriss platzieren" });
    return items;
  }

  const zuWeit = plan.jeAblauf.filter((a) => a.fliessweg_m > FLIESSWEG_MAX_M);
  items.push(zuWeit.length
    ? { key: "fliessweg", label: "Fließwege", status: "warn", detail: `${zuWeit.length} Ablauf/Abläufe mit Fließweg über ${FLIESSWEG_MAX_M} m (längster ${Math.max(...plan.jeAblauf.map((a) => a.fliessweg_m))} m)` }
    : { key: "fliessweg", label: "Fließwege", status: "pass", detail: `längster Fließweg ${Math.max(...plan.jeAblauf.map((a) => a.fliessweg_m))} m ≤ ${FLIESSWEG_MAX_M} m` });

  const zuGross = plan.jeAblauf.filter((a) => a.flaeche_m2 > FLAECHE_JE_ABLAUF_MAX_M2);
  items.push(zuGross.length
    ? { key: "flaeche", label: "Fläche je Ablauf", status: "warn", detail: `${zuGross.length} Ablauf/Abläufe über ${FLAECHE_JE_ABLAUF_MAX_M2} m² — weiteren Ablauf setzen` }
    : { key: "flaeche", label: "Fläche je Ablauf", status: "pass", detail: `größte Teilfläche ${Math.max(...plan.jeAblauf.map((a) => a.flaeche_m2))} m²` });

  items.push(plan.dmax_m > DMAX_WARN_M
    ? { key: "aufbauhoehe", label: "Aufbauhöhe", status: "warn", detail: `${plan.dmax_m} m am Hochpunkt — Attika, Türanschlüsse und Lasten prüfen` }
    : { key: "aufbauhoehe", label: "Aufbauhöhe", status: "pass", detail: `${plan.dmin_m} m am Ablauf bis ${plan.dmax_m} m am Hochpunkt` });

  // Jeder Tiefpunkt braucht seinen Notüberlauf (DIN 1986-100 § 14.2.6) — hier nur gezählt.
  items.push(num(nNot) >= plan.jeAblauf.length
    ? { key: "notueberlaeufe", label: "Notüberläufe", status: "pass", detail: `${num(nNot)} Notüberläufe für ${plan.jeAblauf.length} Abläufe` }
    : { key: "notueberlaeufe", label: "Notüberläufe", status: "warn", detail: `${num(nNot)} Notüberläufe für ${plan.jeAblauf.length} Abläufe — je Tiefpunkt einen vorsehen` });

  return items;
}

/**
 * Quantities for the AVA hand-over: one line per thickness band, the total volume, the drains.
 * @param {ReturnType<typeof gefaelleplan>|null} plan
 * @returns {Array<{key:string,label:string,menge:number,einheit:string}>}
 */
export function gefaelleMengen(plan) {
  if (!plan || !plan.staffeln.length) return [];
  const out = plan.staffeln.map((s) => ({
    key: `staffel_${Math.round(s.von * 1000)}`,
    label: `Gefälledämmung ${Math.round(s.von * 1000)}–${Math.round(s.bis * 1000)} mm`,
    menge: s.m2,
    einheit: "m²",
  }));
  out.push({ key: "daemmung_volumen", label: "Gefälledämmung gesamt", menge: plan.volumen_m3, einheit: "m³" });
  if (plan.jeAblauf.length) out.push({ key: "ablaeufe", label: "Dachabläufe", menge: plan.jeAblauf.length, einheit: "Stk." });
  return out;
}
