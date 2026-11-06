// 107-14 (D-BK-08a/08b): solids of components from their BASE geometry — the derivation 107-09 (intersections) and 107-10
// (roof, solid relations, basement) build on. The base inputs stay leading and parametric: reference line a→b and position
// (bauteil/referenz.js, 107-01), height and lower edge (bauteil/hoehen.js, 107-02), layers and materials (aufbauVon,
// bauteil/aufbauten.js, 107-03), opening sizes (oeffnungsMasse, bauteil/oeffnungen.js, 107-04). Nothing is written back.
//
// A wall: one box per layer in the wall's LOCAL frame (x along the wall from a, y up from the wall bottom, z across with
// +z = the wall normal n; layer 1 lies on the +n side and the layers run along −n, the convention of plan and 3D), every
// opening subtracted from every layer (holes through all layers, as in the 3D build-up), the layers kept as separate closed
// solids side by side (one group per layer, material index = layer index), each layer checked watertight, then the volume
// comparison per layer and in total against the analytic rule (analytischWand). The result is placed by `platzierung`
// (world position of the local origin and rotation about y, the same as the BIM studio's wall meshes) — computed locally
// first, placed afterwards (Float32 accuracy far from the origin).
// A slab: platteSolid() for the callers of 107-09/10, so they do not compute past the core. It computes locally as well:
// profile and holes are moved by the middle of their bounding box (and the bottom y0) before the extrusion, the offset is
// the `platzierung` (review 107-14: in world coordinates a slab at x = 3 000 m failed the watertight check).
//
// The wall result is NOT one closed body: the layers touch with their inner faces twice (that is what keeps volume and
// cut per layer). istWasserdicht() of the whole geometry is therefore false for two or more layers, and a further boolean
// on it is refused as "offen". Callers of 107-09/10 run every further boolean PER LAYER: geometrieJeGruppe(geometrie)
// (dreiecke.js) splits the result into one closed solid per material index; `ok` of this result means "every layer is
// closed and the volumes agree", not "the glued body is closed".
//
// Every opening is a rectangle here (like the IFC void); a round penetration is drawn as a circle in 3D but cut as its
// bounding rectangle — a caller that needs the circle builds its own body. [ASSUMED] enough for phase 107: the 3D build-up
// and the IFC void cut rectangles as well; a round core drilling in a quantity is a finding of the calling plan.
//
// In: element records (m) and a context. Out: {ok, geometrie, platzierung, volumen, menge_m3, quelle, warnung, basis}.

import { wandGeometrie, wandDicke_m } from "../bauteil/referenz.js";
import { wandHoehe, unterkante } from "../bauteil/hoehen.js";
import { aufbauVon } from "../bauteil/aufbauten.js";
import { oeffnungsMasse } from "../bauteil/oeffnungen.js";
import { flaecheSigniert } from "../formGeometrie.js";
import { quaderKoerper, profilKoerper, oeffnungKoerper, OEFFNUNG_UEBERSTAND_M } from "./koerper.js";
import { geometrienZusammenfuegen } from "./dreiecke.js";
import { istWasserdicht } from "./wasserdicht.js";
import { volumenJeGruppe, analytischWand, analytischPlatte, volumenAbgleich } from "./volumen.js";
import { csgLaden } from "./laden.js";

/**
 * @typedef {import("three").BufferGeometry} Geo
 * @typedef {import("./volumen.js").VolumenWarnung} VolumenWarnung
 * @typedef {object} Platzierung
 * @property {{x: number, y: number, z: number}} ursprung  world position of the local origin, m
 * @property {number} drehung_y                           rotation about +y in rad (mesh.rotation.y)
 * @typedef {object} SolidErgebnis
 * @property {boolean} ok                  the solid exists and its volume agrees with the analytic rule
 * @property {Geo|null} geometrie          local geometry (groups per layer) or null when no solid could be built
 * @property {Platzierung} platzierung
 * @property {{solid_m3: number|null, analytisch_m3: number, jeSchicht: Array<{index: number, material: string|null, dicke_m: number, solid_m3: number|null, analytisch_m3: number}>, abgleich: ReturnType<typeof volumenAbgleich>}} volumen
 * @property {number} menge_m3             the quantity to use (solid when it agrees, otherwise analytic), m³
 * @property {"solid"|"analytisch"} quelle
 * @property {VolumenWarnung|null} warnung for the component (text: csgWarnungText)
 * @property {any} basis                   every base input of the derivation (for basisHash)
 */

/**
 * Warning of a degenerate input (no solid can exist). A code of its own instead of a text, so the German UI text comes
 * from csgWarnungText through i18n (review 107-14: an English text used to land inside the German warning).
 * @param {"wand"|"platte"} art
 * @param {number} analytisch_m3
 * @returns {VolumenWarnung}
 */
function ungueltig(art, analytisch_m3) {
  return { code: "csg-ungueltig", art, analytisch_m3 };
}

/**
 * Warning of a component from a refused boolean.
 * @param {import("./backend.js").BooleschNein} r
 * @param {number} analytisch_m3
 * @returns {VolumenWarnung}
 */
function ablehnungAlsWarnung(r, analytisch_m3) {
  return r.grund === "fehler"
    ? { code: "csg-fehler", text: r.text || "", analytisch_m3 }
    : { code: "csg-offen", eingabe: r.eingabe || "a", analytisch_m3 };
}

/**
 * Base inputs of a wall solid, resolved (layers from the build-up, heights from the storey table, opening sizes from the
 * type table) — exactly what the derivation reads; the cache hash is taken over this (basisHash(wandBasis(…))).
 * @param {any} wand wall record (a, b in m, composite/thickness, refLine, level, height …)
 * @param {any[]} [oeffnungen] opening records of this wall (u, width/height/sill or typeId, bruestung_bezug)
 * @param {{geschosse?: any, anker?: any}} [ctx] geschosse: storey table (hoehen.js); anker: height anchors of the wall (ankerFuerWand)
 * @returns {{a: {x: number, z: number}, b: {x: number, z: number}, laenge_m: number, hoehe_m: number, unterkante_m: number, versatz_m: number, schichten: Array<{dicke_m: number, material: string|null}>, oeffnungen: Array<{u: number|null, width: number, height: number, sill: number}>}}
 */
export function wandBasis(wand, oeffnungen = [], ctx = {}) {
  const auf = aufbauVon(wand);
  const schichten = auf.schichten.length
    ? auf.schichten.map((s) => ({ dicke_m: s.dicke_m, material: s.material ?? null }))
    : [{ dicke_m: wandDicke_m(wand), material: null }];
  const dicke = schichten.reduce((s, x) => s + x.dicke_m, 0);
  const g = wandGeometrie(wand, { dicke_m: dicke });
  return {
    a: { x: wand.a.x, z: wand.a.z }, b: { x: wand.b.x, z: wand.b.z },
    laenge_m: g.laenge_m, hoehe_m: wandHoehe(wand, ctx.geschosse), unterkante_m: unterkante(wand, ctx.geschosse), versatz_m: g.versatz_m,
    schichten,
    oeffnungen: oeffnungen.map((o) => {
      const m = oeffnungsMasse(o, ctx.anker || null);
      return { u: o?.u ?? null, width: m.w, height: m.h, sill: m.sill };
    }),
  };
}

/**
 * Solid of a straight (layered) wall with its openings, see file head.
 * @param {any} wand wall record
 * @param {any[]} [oeffnungen] opening records of this wall
 * @param {{geschosse?: any, anker?: any, kern?: typeof import("./kern.js")}} [ctx] kern: an already loaded backend module (tests); default csgLaden()
 * @returns {Promise<SolidErgebnis>}
 */
export async function wandSolid(wand, oeffnungen = [], ctx = {}) {
  const basis = wandBasis(wand, oeffnungen, ctx);
  const { laenge_m: L, hoehe_m: H, schichten } = basis;
  const D = schichten.reduce((s, x) => s + x.dicke_m, 0);
  const dx = (basis.b.x - basis.a.x) / (L || 1), dz = (basis.b.z - basis.a.z) / (L || 1);
  const platzierung = {
    ursprung: { x: basis.a.x - dz * basis.versatz_m, y: basis.unterkante_m, z: basis.a.z + dx * basis.versatz_m },
    drehung_y: -Math.atan2(dz, dx),
  };
  const ana = analytischWand({ laenge_m: L, hoehe_m: H, schichten_m: schichten.map((s) => s.dicke_m), oeffnungen: basis.oeffnungen });
  /** @param {VolumenWarnung} warnung @returns {SolidErgebnis} */
  const ohneSolid = (warnung) => ({
    ok: false, geometrie: null, platzierung,
    volumen: {
      solid_m3: null, analytisch_m3: ana.gesamt_m3,
      jeSchicht: schichten.map((s, i) => ({ index: i, material: s.material, dicke_m: s.dicke_m, solid_m3: null, analytisch_m3: ana.jeSchicht_m3[i] })),
      abgleich: volumenAbgleich({ solid_m3: null, analytisch_m3: ana.gesamt_m3 }),
    },
    menge_m3: ana.gesamt_m3, quelle: "analytisch", warnung, basis,
  });
  if (!(L > 0 && H > 0 && D > 0)) return ohneSolid(ungueltig("wand", ana.gesamt_m3));
  let kern;
  try {
    kern = ctx.kern || (await csgLaden());
  } catch (e) {
    return ohneSolid({ code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e), analytisch_m3: ana.gesamt_m3 });
  }
  /** @type {Geo[]} */
  const teile = [];
  /** @type {VolumenWarnung|null} */
  let fehler = null;
  let z = D / 2;
  for (let i = 0; i < schichten.length && !fehler; i += 1) {
    const z1 = z, z0 = z - schichten[i].dicke_m;
    z = z0;
    let k = quaderKoerper({ x0_m: 0, x1_m: L, y0_m: 0, y1_m: H, z0_m: z0, z1_m: z1, materialIndex: i });
    // the reveal faces of a hole come from the opening body: it carries the layer's material index, so they belong to this
    // layer's group (otherwise the per-layer volume would mix layers)
    const bohrer = /** @type {Geo[]} */ (basis.oeffnungen.map((o) => oeffnungKoerper(o, { laenge_m: L, hoehe_m: H, z0_m: -D / 2, z1_m: D / 2, materialIndex: i })).filter(Boolean));
    for (const b of bohrer) {
      const r = kern.boolesch(k, b, "subtract");
      if (!r.ok) {
        fehler = ablehnungAlsWarnung(/** @type {import("./backend.js").BooleschNein} */ (r), ana.gesamt_m3);
        break;
      }
      k.dispose();
      k = r.geometrie;
    }
    // the result of the last boolean is the input of the next caller (107-09/10, per layer): it must be closed as well
    if (!fehler && !istWasserdicht(k).ok) fehler = { code: "csg-offen", eingabe: "ergebnis", analytisch_m3: ana.gesamt_m3 };
    teile.push(k);
    for (const b of bohrer) b.dispose();
  }
  if (fehler) {
    for (const t of teile) t.dispose();
    return ohneSolid(fehler);
  }
  const geometrie = geometrienZusammenfuegen(teile);
  for (const t of teile) if (t !== geometrie) t.dispose();
  const jeGruppe = volumenJeGruppe(geometrie);
  const solid_m3 = Object.values(jeGruppe).reduce((s, x) => s + x, 0);
  const abgleich = volumenAbgleich({ solid_m3, analytisch_m3: ana.gesamt_m3 });
  // a layer that deviates is a warning even when the total agrees (two errors may cancel out)
  const jeSchicht = schichten.map((s, i) => ({ index: i, material: s.material, dicke_m: s.dicke_m, solid_m3: jeGruppe[i] ?? 0, analytisch_m3: ana.jeSchicht_m3[i] }));
  const schichtAbgleich = jeSchicht.map((s) => volumenAbgleich({ solid_m3: s.solid_m3, analytisch_m3: s.analytisch_m3 }));
  const schlecht = abgleich.ok ? schichtAbgleich.find((x) => !x.ok) : abgleich;
  const ok = !schlecht;
  return {
    ok, geometrie, platzierung,
    volumen: { solid_m3, analytisch_m3: ana.gesamt_m3, jeSchicht, abgleich },
    menge_m3: ok ? solid_m3 : ana.gesamt_m3, quelle: ok ? "solid" : "analytisch",
    warnung: ok ? null : /** @type {VolumenWarnung} */ (schlecht?.warnung || abgleich.warnung), basis,
  };
}

/**
 * Solid of a flat slab (or any prism): profile extruded by the thickness, every hole cut out as a prism with
 * OEFFNUNG_UEBERSTAND_M overhang at top and bottom (a real boolean, so 107-09/10 can cut what an extrusion cannot), checked
 * watertight and compared with (area − holes) × thickness. Computed in a LOCAL frame (see file head): the geometry has its
 * origin at the middle of the profile's bounding box at the bottom y0; `platzierung.ursprung` is that point in world
 * coordinates (no rotation).
 * @param {Array<{x: number, z: number}>} profil outer ring in m (any orientation, world coordinates)
 * @param {number} dicke_m thickness in m
 * @param {Array<Array<{x: number, z: number}>>} [loecher] hole rings in m, inside the profile, not overlapping
 * @param {{y0_m?: number, materialIndex?: number, kern?: typeof import("./kern.js")}} [opt] y0_m: bottom in m (default 0)
 * @returns {Promise<SolidErgebnis>}
 */
export async function platteSolid(profil, dicke_m, loecher = [], opt = {}) {
  const y0 = opt.y0_m ?? 0, mi = opt.materialIndex ?? 0;
  // materialIndex is an input of the mesh (its group), so it belongs to the hash basis as well
  const basis = { profil, dicke_m, loecher, y0_m: y0, materialIndex: mi };
  const analytisch_m3 = analytischPlatte({ flaeche_m2: Math.abs(flaecheSigniert(profil)), dicke_m, loecher_m2: loecher.map((l) => Math.abs(flaecheSigniert(l))) });
  const xs = profil.map((p) => p.x), zs = profil.map((p) => p.z);
  const bx = profil.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const bz = profil.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
  const platzierung = { ursprung: { x: bx, y: y0, z: bz }, drehung_y: 0 };
  // subtraction in double precision; the Float32 positions of the bodies then stay small
  const lokal = (/** @type {Array<{x: number, z: number}>} */ ring) => ring.map((p) => ({ x: p.x - bx, z: p.z - bz }));
  /** @param {VolumenWarnung} warnung @returns {SolidErgebnis} */
  const ohneSolid = (warnung) => ({
    ok: false, geometrie: null, platzierung,
    volumen: { solid_m3: null, analytisch_m3, jeSchicht: [{ index: mi, material: null, dicke_m, solid_m3: null, analytisch_m3 }], abgleich: volumenAbgleich({ solid_m3: null, analytisch_m3 }) },
    menge_m3: analytisch_m3, quelle: "analytisch", warnung, basis,
  });
  if (!(dicke_m > 0) || profil.length < 3) return ohneSolid(ungueltig("platte", analytisch_m3));
  let kern;
  try {
    kern = opt.kern || (await csgLaden());
  } catch (e) {
    return ohneSolid({ code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e), analytisch_m3 });
  }
  let k = profilKoerper({ ring: lokal(profil), y0_m: 0, y1_m: dicke_m, materialIndex: mi });
  for (const l of loecher) {
    const b = profilKoerper({ ring: lokal(l), y0_m: -OEFFNUNG_UEBERSTAND_M, y1_m: dicke_m + OEFFNUNG_UEBERSTAND_M, materialIndex: mi });
    const r = kern.boolesch(k, b, "subtract");
    b.dispose();
    if (!r.ok) {
      k.dispose();
      return ohneSolid(ablehnungAlsWarnung(/** @type {import("./backend.js").BooleschNein} */ (r), analytisch_m3));
    }
    k.dispose();
    k = r.geometrie;
  }
  if (!istWasserdicht(k).ok) {
    k.dispose();
    return ohneSolid({ code: "csg-offen", eingabe: "ergebnis", analytisch_m3 });
  }
  const solid_m3 = Object.values(volumenJeGruppe(k)).reduce((s, x) => s + x, 0);
  const abgleich = volumenAbgleich({ solid_m3, analytisch_m3 });
  return {
    ok: abgleich.ok, geometrie: k, platzierung,
    volumen: { solid_m3, analytisch_m3, jeSchicht: [{ index: mi, material: null, dicke_m, solid_m3, analytisch_m3 }], abgleich },
    menge_m3: abgleich.menge_m3, quelle: abgleich.quelle, warnung: abgleich.warnung, basis,
  };
}
