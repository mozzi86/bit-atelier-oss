// 108-13: dormers (Schleppgauben) on the GLOBAL roof form of the BIM studio — the data form of `gauben`, their faces in 3D, the plan
// outline, the window in the dormer front and the checks a development plan asks for (distance to the gable, distance below the ridge).
// Pure mathematics, no three.js, no React: the studio (3D, inspector, "Gaube einfügen"), the plan (BimPlan2D, PDF), the IFC export
// and the quantities read the SAME faces from here. The dormer is placed ON the roof faces of dachGeometrie.globalesDach — no second
// roof computation (D-BK-25 style: one slope derivation).
//
// Record (`gauben[]`, all lengths in m): {_idx, edge, u_von_m, u_bis_m, typ: "schlepp", neigung_grad, ruecksprung_m, front_hoehe_m,
//   wand_dicke_m?, fenster?: {b, h, bruestung_m}, guid?}
//   edge         hull edge (index into model.footprint, same as envOpenings.edge) whose eave the dormer sits above — a GABLE edge is refused
//   u_von/u_bis  position along that edge from its start point (the same u as the hull openings), m
//   ruecksprung  distance of the dormer front behind the outer face of the hull wall, m (the front stands on the roof, not on the wall)
//   front_hoehe  top of the dormer front above the floor of the top storey, m
//   neigung      slope of the dormer roof, degrees; it must be flatter than the main roof (else the two never meet)
//   fenster      window in the front, b × h with sill above the top-storey floor
//
// Geometry of a Schleppgaube (all heights absolute, m above ±0.00):
//   front line = eave edge moved `ruecksprung` inwards; y_dach = height of the main roof face there (same along the line);
//   front top y_front = floor + front_hoehe; dormer roof rises inwards at `neigung` from the front top until it meets the main roof:
//   d* = (y_front − y_dach) / (tan β − tan α) with β = main slope, α = dormer slope; dormer ridge at y_front + tan α · d*.
//   Faces: front (rectangle y_dach…y_front), two cheeks (triangles), dormer roof (quad). The main roof is NOT cut (overlay, no CSG).
//
// In:  dormer record, built model (footprint, storeys), DachErgebnis of the global roof, storey table.
// Out: gaubeBerechnen (faces, window, dimensions, checks), neueGaube, gaubenDreiecke.

import { dachEbenen, ebeneHoeheAn } from "./dachGeometrie.js";
import { elevationOf } from "./hoehen.js";

/** Defaults of a new dormer in m / degrees. [ASSUMED] usual EFH values: 2.30 m wide, 20° shed, 1.00 m behind the wall, front top 2.50 m over the floor, window 1.40 × 1.10 on a 1.15 m sill. */
export const GAUBE_STANDARD = Object.freeze({ breite_m: 2.3, neigung_grad: 20, ruecksprung_m: 1.0, front_hoehe_m: 2.5, wand_dicke_m: 0.2, fenster: Object.freeze({ b: 1.4, h: 1.1, bruestung_m: 1.15 }) });

const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{x: number, y: number, z: number}} Pkt3
 * @typedef {object} Gaube
 * @property {number} [_idx]
 * @property {number} edge
 * @property {number} u_von_m
 * @property {number} u_bis_m
 * @property {"schlepp"} [typ]
 * @property {number} [neigung_grad]
 * @property {number} [ruecksprung_m]
 * @property {number} [front_hoehe_m]
 * @property {number} [wand_dicke_m]
 * @property {{b: number, h: number, bruestung_m: number}|null} [fenster]
 * @property {string} [guid]
 * @typedef {object} GaubenErgebnis
 * @property {true} ok
 * @property {number} level                    top storey level
 * @property {number} breite_m
 * @property {number} tiefe_m                  front line to dormer ridge (d*), m
 * @property {number} front_m                  visible front height y_front − y_dach, m
 * @property {number} y_boden_m                floor of the top storey, m
 * @property {number} y_dach_m                 main roof at the front line, m
 * @property {number} y_front_m
 * @property {number} y_first_m                dormer ridge, m
 * @property {Array<{id: "front"|"wange-1"|"wange-2"|"dach", punkte3d: Pkt3[]}>} flaechen
 * @property {{punkte3d: Pkt3[], b: number, h: number, bruestung_m: number}|null} fenster
 * @property {PktXZ[]} grundriss               plan outline (front line to ridge line), m
 * @property {PktXZ[]} frontLinie              the two plan points of the front, m
 * @property {{abstandGiebel_m: number, abstandFirstHorizontal_m: number, abstandFirstVertikal_m: number}} masse
 * @property {Array<{code: string, text: string, wert: number}>} warnungen
 * @typedef {{ok: false, grund: "kein-dach"|"giebelseite"|"kante"|"front-im-dach"|"neigung"|"fenster", text: string}} GaubenFehler
 */

/**
 * Hull edge `i` of a footprint: start, unit vector along it, length and the OUTWARD unit normal.
 * @param {PktXZ[]} fp footprint in m
 * @param {number} i
 * @returns {{a: PktXZ, b: PktXZ, e: PktXZ, len: number, aussen: PktXZ}|null}
 */
export function huellKante(fp, i) {
  if (!Array.isArray(fp) || fp.length < 3) return null;
  const n = fp.length, k = ((Math.round(i) % n) + n) % n;
  const a = fp[k], b = fp[(k + 1) % n];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-6) return null;
  const e = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  const c = fp.reduce((s, p) => ({ x: s.x + p.x / n, z: s.z + p.z / n }), { x: 0, z: 0 });
  let aussen = { x: e.z + 0, z: -e.x + 0 }; // + 0: no −0 in the output
  const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (aussen.x * (m.x - c.x) + aussen.z * (m.z - c.z) < 0) aussen = { x: -aussen.x + 0, z: -aussen.z + 0 };
  return { a, b, e, len, aussen };
}

/**
 * Faces, window and checks of a dormer on the global roof (see file head).
 * @param {Gaube} g
 * @param {any} model built model (footprint, storeys; createBuildingModel)
 * @param {import("./dachGeometrie.js").DachErgebnis|import("./dachGeometrie.js").DachFehler|null|undefined} dach globalesDach
 * @param {import("./hoehen.js").Geschosse} [gs]
 * @returns {GaubenErgebnis|GaubenFehler}
 */
export function gaubeBerechnen(g, model, dach, gs) {
  if (!dach || !dach.ok || dach.form === "flach") return { ok: false, grund: "kein-dach", text: "Gauben brauchen ein geneigtes Gebäudedach" };
  const kante = huellKante(model?.footprint, Number(g?.edge) || 0);
  if (!kante) return { ok: false, grund: "kante", text: "Hüllkante nicht gefunden" };
  // the roof face that falls towards this eave: its upward normal leans outwards over the edge
  const ebenen = dachEbenen(dach);
  const ebene = ebenen.filter((e) => e.normale.x * kante.aussen.x + e.normale.z * kante.aussen.z > 1e-6)
    .sort((p, q) => (q.normale.x * kante.aussen.x + q.normale.z * kante.aussen.z) - (p.normale.x * kante.aussen.x + p.normale.z * kante.aussen.z))[0];
  if (!ebene) return { ok: false, grund: "giebelseite", text: "Diese Kante ist eine Giebelseite — Gauben sitzen auf der Traufseite" };
  const tanB = Math.hypot(ebene.normale.x, ebene.normale.z) / ebene.normale.y; // main slope
  const alpha = ((Number(g?.neigung_grad) > 0 ? Number(g.neigung_grad) : GAUBE_STANDARD.neigung_grad) * Math.PI) / 180;
  const tanA = Math.tan(alpha);
  if (!(tanB > tanA + 1e-6)) return { ok: false, grund: "neigung", text: "Gaubendach muss flacher sein als das Hauptdach" };
  const oben = Math.max(0, ...(model.storeys || []).map((s) => Number(s.level)).filter((l) => Number.isFinite(l) && l >= 0));
  const yBoden = elevationOf(oben, gs);
  const r = Number(g?.ruecksprung_m) >= 0 ? Number(g.ruecksprung_m) : GAUBE_STANDARD.ruecksprung_m;
  const u0 = Math.max(0, Math.min(Number(g?.u_von_m) || 0, Number(g?.u_bis_m) || 0));
  const u1 = Math.min(kante.len, Math.max(Number(g?.u_von_m) || 0, Number(g?.u_bis_m) || 0));
  if (u1 - u0 < 0.3) return { ok: false, grund: "kante", text: "Gaube zu schmal (unter 0,30 m)" };
  const P = (/** @type {number} */ u, /** @type {number} */ d) => ({ x: kante.a.x + kante.e.x * u - kante.aussen.x * d, z: kante.a.z + kante.e.z * u - kante.aussen.z * d });
  const f0 = P(u0, r), f1 = P(u1, r);
  const yDach = ebeneHoeheAn(ebene, (f0.x + f1.x) / 2, (f0.z + f1.z) / 2);
  const yFront = yBoden + (Number(g?.front_hoehe_m) > 0 ? Number(g.front_hoehe_m) : GAUBE_STANDARD.front_hoehe_m);
  if (yFront <= yDach + 0.05) return { ok: false, grund: "front-im-dach", text: "Gaubenfront liegt unter dem Hauptdach — Front höher oder weiter nach außen" };
  const tiefe = (yFront - yDach) / (tanB - tanA);
  const yFirst = yFront + tanA * tiefe;
  const g0 = P(u0, r + tiefe), g1 = P(u1, r + tiefe);
  const p3 = (/** @type {PktXZ} */ p, /** @type {number} */ y) => ({ x: r3(p.x), y: r3(y), z: r3(p.z) });
  /** @type {GaubenErgebnis["flaechen"]} */
  const flaechen = [
    { id: "front", punkte3d: [p3(f0, yDach), p3(f1, yDach), p3(f1, yFront), p3(f0, yFront)] },
    { id: "wange-1", punkte3d: [p3(f0, yDach), p3(f0, yFront), p3(g0, yFirst)] },
    { id: "wange-2", punkte3d: [p3(f1, yDach), p3(f1, yFront), p3(g1, yFirst)] },
    { id: "dach", punkte3d: [p3(f0, yFront), p3(f1, yFront), p3(g1, yFirst), p3(g0, yFirst)] },
  ];
  /** @type {GaubenErgebnis["warnungen"]} */
  const warnungen = [];
  /** @type {GaubenErgebnis["fenster"]} */
  let fenster = null;
  const fw = g?.fenster === null ? null : { ...GAUBE_STANDARD.fenster, ...(g?.fenster || {}) };
  if (fw) {
    const b = Math.min(Number(fw.b) || GAUBE_STANDARD.fenster.b, u1 - u0 - 0.2);
    const h = Number(fw.h) || GAUBE_STANDARD.fenster.h;
    const sill = Number(fw.bruestung_m) >= 0 ? Number(fw.bruestung_m) : GAUBE_STANDARD.fenster.bruestung_m;
    const yu = yBoden + sill, yo = yu + h;
    const um = (u0 + u1) / 2;
    const w0 = P(um - b / 2, r), w1 = P(um + b / 2, r);
    if (yu < yDach - 1e-6) warnungen.push({ code: "fenster_im_dach", text: "Fensterbrüstung liegt unter dem Hauptdach an der Gaubenfront", wert: r3(yDach - yu) });
    if (yo > yFront - 0.1) warnungen.push({ code: "fenster_sturz", text: "Fenster reicht bis unter 10 cm an die Gaubenoberkante", wert: r3(yFront - yo) });
    fenster = { punkte3d: [p3(w0, yu), p3(w1, yu), p3(w1, yo), p3(w0, yo)], b: r3(b), h: r3(h), bruestung_m: r3(sill) };
  }
  // checks a development plan usually asks for: distance to the gable (edge ends) and below the main ridge
  const abstandGiebel = r3(Math.min(u0, kante.len - u1));
  const first = dach.traufhoehe_m + dach.anstieg_m;
  const halbB = dach.rahmen.halbB_m;
  return {
    ok: true, level: oben, breite_m: r3(u1 - u0), tiefe_m: r3(tiefe), front_m: r3(yFront - yDach), y_boden_m: r3(yBoden), y_dach_m: r3(yDach), y_front_m: r3(yFront), y_first_m: r3(yFirst),
    flaechen, fenster,
    grundriss: [{ x: r3(f0.x), z: r3(f0.z) }, { x: r3(f1.x), z: r3(f1.z) }, { x: r3(g1.x), z: r3(g1.z) }, { x: r3(g0.x), z: r3(g0.z) }],
    frontLinie: [{ x: r3(f0.x), z: r3(f0.z) }, { x: r3(f1.x), z: r3(f1.z) }],
    masse: { abstandGiebel_m: abstandGiebel, abstandFirstHorizontal_m: r3(halbB - r - tiefe), abstandFirstVertikal_m: r3(first - yFirst) },
    warnungen,
  };
}

/**
 * Triangle list of the dormer faces for a three.js BufferGeometry (9 numbers per triangle), fan per face.
 * @param {GaubenErgebnis} erg
 * @returns {number[]}
 */
export function gaubenDreiecke(erg) {
  /** @type {number[]} */
  const pos = [];
  for (const f of erg.flaechen) {
    const p = f.punkte3d;
    for (let i = 1; i + 1 < p.length; i += 1) pos.push(p[0].x, p[0].y, p[0].z, p[i].x, p[i].y, p[i].z, p[i + 1].x, p[i + 1].y, p[i + 1].z);
  }
  return pos;
}

/**
 * A new dormer for "Gaube einfügen": on `edge`, GAUBE_STANDARD wide and centred on the edge (or at `u_mitte_m`).
 * @param {PktXZ[]} fp footprint in m
 * @param {number} edge
 * @param {number} idx
 * @param {number|null} [u_mitte_m]
 * @returns {Gaube}
 */
export function neueGaube(fp, edge, idx, u_mitte_m = null) {
  const k = huellKante(fp, edge);
  const len = k ? k.len : GAUBE_STANDARD.breite_m * 2;
  const m = u_mitte_m != null ? Number(u_mitte_m) : len / 2;
  const hb = GAUBE_STANDARD.breite_m / 2;
  return { _idx: idx, edge, u_von_m: r3(Math.max(0, m - hb)), u_bis_m: r3(Math.min(len, m + hb)), typ: "schlepp", neigung_grad: GAUBE_STANDARD.neigung_grad, ruecksprung_m: GAUBE_STANDARD.ruecksprung_m, front_hoehe_m: GAUBE_STANDARD.front_hoehe_m, fenster: { ...GAUBE_STANDARD.fenster } };
}
