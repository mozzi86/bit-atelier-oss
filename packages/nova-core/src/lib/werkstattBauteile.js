// 89-02 / 89-03 (BW-02, BW-04, BW-05, BW-08): the workshop's rooms, walls and doors as BIM
// components — classified (DIN 276 cost group, trade, material, status), with stable GUIDs over
// re-tessellation, readable by every planner tab, the IFC export and the AVA quantities.
//
// Why in @core: the AVA (@ava) and the IFC viewer may not import @designer, and the workshop
// zones live in the shared store (useBuildingProgram) — so the derivation from zones to components
// is a pure @core function every package can call.
//
// D-BW-02 (user decision 12.10.2026): zones stay CLEAR dimensions (lichte Maße), the wall lies
// outside them — the living area after WoFlV stays stable, the building grows by the wall
// thickness. So a wall component carries its clear length (the shared zone edge) AND its shell
// length (Rohbaumaß = clear length + one wall thickness for the two half-joints into the crossing
// walls [ASSUMED]), and `rohbauZuschlag` reports how much the shell grows per storey.
// D-BW-03: no status default — a workshop component has status null ("ohne Status").
//
// What becomes a component:
//   - interior walls = every collinear, opposite-facing overlap of two zone edges on one storey
//     (≥ 5 cm): between rooms of the SAME unit → "leicht" (non-load-bearing partition, KS 11,5 cm,
//     KG 342), else → "tragend" (unit separating / stair wall, KS 24 cm, KG 341);
//   - exterior walls (zone edges no other zone touches) are listed with `huelle: true` — they ARE
//     the envelope (model.walls / synthHull); exporters and quantities skip them (no double count);
//   - doors = the zones' `tueren` records (wall = edge `wand` of the zone, offset `u_m`, width =
//     shell width after DIN 18100 in the workshop); entrance doors on the facade are envelope doors;
//   - rooms = every zone of a unit (IfcSpace), clear area.
// Thicknesses/materials are [ASSUMED] rule build-ups (same values as tesselierung WANDSTAERKEN and
// massordnung WANDDICKEN: 36,5 / 24 / 11,5 cm).
//
// In:  zones (store / tesseliere shape: points [{x,z}] m, level, name, we, raumart, art, tueren),
//      storey height m. Out: plain component objects. Pure, deterministic, node-testable.
//
// 89-07 (BW-09, one door system): the zone door IS the door component. `tuerLage` is the ONE door
// geometry (hinge, closed/open leaf end, swing arc, normal) — designer's tuerGeometrie (plan symbol,
// quality list, escape route) delegates here, the component carries the same swing, and the focus
// furniture reads the component's swing instead of placing its own catalogue doors. `tuerGuid`
// derives the GUID from the same key the swing overrides use (werkstatt_layer.tuerAufschlaege).

import { WAND_KLASSEN } from "./bauteil/aufbauten.js";

/** Wall classes of the workshop — 97-02a: defined in the ONE build-up table (bauteil/aufbauten.js). */
export { WAND_KLASSEN };

/** Door cost groups (DIN 276): interior doors 344, exterior doors 334. */
export const TUER_KG = Object.freeze({ innen: "344", aussen: "334" });

/** Workshop zone marker (tesselierung WT_MARKER — duplicated here, @core must not import @designer). */
export const WT_MARKER = " ·WT";

const EPS = 1e-6;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const IFC_B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** FNV-1a 32 bit with a seed. @param {string} text @param {number} seed @returns {number} */
function fnv(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * Stable IFC GlobalId (22 characters, IFC base-64) from a semantic key — the same key gives the
 * same GUID in every run (re-tessellation keeps room names, so walls/doors/rooms keep their id).
 * 128 bits from four seeded FNV-1a passes (not cryptographic; collision-poor for ids).
 * @param {string} schluessel semantic key
 * @returns {string}
 */
export function stabileGuid(schluessel) {
  const t = String(schluessel);
  let n = 0n;
  for (const seed of [2166136261, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]) n = (n << 32n) | BigInt(fnv(t, seed));
  let s = "";
  for (let i = 0; i < 22; i++) { s = IFC_B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}

/** @param {any} z @returns {boolean} zone of the workshop (name carries the marker) */
export const istWerkstattZone = (z) => typeof z?.name === "string" && z.name.endsWith(WT_MARKER);

/** Edges of a zone as {a, b, i}. */
const kanten = (z) => {
  const p = Array.isArray(z?.points) ? z.points : [];
  return p.map((a, i) => ({ a: { x: num(a.x), z: num(a.z) }, b: { x: num(p[(i + 1) % p.length].x), z: num(p[(i + 1) % p.length].z) }, i }));
};
const bbox = (z) => {
  const p = Array.isArray(z?.points) ? z.points : [];
  return { x0: Math.min(...p.map((q) => num(q.x))), x1: Math.max(...p.map((q) => num(q.x))), z0: Math.min(...p.map((q) => num(q.z))), z1: Math.max(...p.map((q) => num(q.z))) };
};

/**
 * Overlap of two edges that lie on one line (two zones sharing a wall),
 * as the common segment, or null.
 */
function gemeinsam(e, f) {
  const dx = e.b.x - e.a.x, dz = e.b.z - e.a.z, l = Math.hypot(dx, dz);
  if (l < EPS) return null;
  const ux = dx / l, uz = dz / l;
  const gx = f.b.x - f.a.x, gz = f.b.z - f.a.z, lg = Math.hypot(gx, gz);
  if (lg < EPS) return null;
  // Parallel either way: the generators do not share one ring orientation (corridor vs. hall).
  if (Math.abs((ux * gx + uz * gz) / lg) < 1 - 1e-6) return null;
  const abst = (p) => Math.abs((p.x - e.a.x) * uz - (p.z - e.a.z) * ux);
  if (abst(f.a) > 1e-3 || abst(f.b) > 1e-3) return null; // not collinear (1 mm)
  const s = (p) => (p.x - e.a.x) * ux + (p.z - e.a.z) * uz;
  const s0 = Math.max(0, Math.min(s(f.a), s(f.b))), s1 = Math.min(l, Math.max(s(f.a), s(f.b)));
  if (s1 - s0 < 0.05) return null;
  return { a: { x: e.a.x + ux * s0, z: e.a.z + uz * s0 }, b: { x: e.a.x + ux * s1, z: e.a.z + uz * s1 }, s0, s1 };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Walls of the workshop zones (see file head). Walls are found per storey; exterior walls are the
 * remaining pieces of every zone edge not covered by a neighbour.
 * @param {Array<any>} zonen zones (only workshop zones are used)
 * @param {{storeyHeight?: number}} [opts] storey height m (wall height = storey height [ASSUMED shell height])
 * @returns {Array<{guid: string, typ: "wand", klasse: "aussen"|"tragend"|"leicht", huelle: boolean, level: number, a: {x:number,z:number}, b: {x:number,z:number}, dicke_m: number, hoehe_m: number, lichteLaenge_m: number, rohbauLaenge_m: number, flaeche_m2: number, volumen_m3: number, kg: string, gewerk: string, material: string, tragend: boolean, status: null, bauabschnitt: null, zonen: string[], we: Array<string|null>}>}
 */
export function werkstattWaende(zonen, opts = {}) {
  const h = num(opts.storeyHeight, 3) > 0 ? num(opts.storeyHeight, 3) : 3;
  const liste = (Array.isArray(zonen) ? zonen : []).filter((z) => istWerkstattZone(z) && z.raumart !== "balkon" && Array.isArray(z.points) && z.points.length >= 3);
  const proLevel = new Map();
  for (const z of liste) { const l = Math.round(num(z.level)); if (!proLevel.has(l)) proLevel.set(l, []); proLevel.get(l).push(z); }
  const out = [];
  const baue = (klasseKey, level, seg, namen, wes, schluessel) => {
    const k = WAND_KLASSEN[klasseKey];
    const l = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
    out.push({
      guid: stabileGuid(schluessel), typ: "wand", klasse: klasseKey, huelle: klasseKey === "aussen", level,
      a: { x: r3(seg.a.x), z: r3(seg.a.z) }, b: { x: r3(seg.b.x), z: r3(seg.b.z) },
      dicke_m: k.dicke_m, hoehe_m: h, lichteLaenge_m: r3(l), rohbauLaenge_m: r3(l + k.dicke_m),
      flaeche_m2: r3(l * h), volumen_m3: r3(l * h * k.dicke_m), kg: k.kg, gewerk: k.gewerk, material: k.material, tragend: k.tragend,
      status: null, bauabschnitt: null, zonen: namen, we: wes,
    });
  };
  for (const [level, zs] of [...proLevel.entries()].sort((p, q) => p[0] - q[0])) {
    const boxen = zs.map(bbox);
    /** covered parameter intervals per zone edge (for the exterior remainder) */
    const belegt = zs.map((z) => kanten(z).map(() => /** @type {Array<[number, number]>} */ ([])));
    const paare = new Map();
    for (let i = 0; i < zs.length; i++) {
      for (let j = i + 1; j < zs.length; j++) {
        const bi = boxen[i], bj = boxen[j];
        if (bi.x1 < bj.x0 - 1e-3 || bj.x1 < bi.x0 - 1e-3 || bi.z1 < bj.z0 - 1e-3 || bj.z1 < bi.z0 - 1e-3) continue;
        const ki = kanten(zs[i]), kj = kanten(zs[j]);
        for (const e of ki) {
          for (const f of kj) {
            const g = gemeinsam(e, f);
            if (!g) continue;
            belegt[i][e.i].push([g.s0, g.s1]);
            const lf = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z), ufx = (f.b.x - f.a.x) / lf, ufz = (f.b.z - f.a.z) / lf;
            const sf = (p) => (p.x - f.a.x) * ufx + (p.z - f.a.z) * ufz;
            belegt[j][f.i].push([Math.min(sf(g.a), sf(g.b)), Math.max(sf(g.a), sf(g.b))]);
            const [n1, n2] = [String(zs[i].name), String(zs[j].name)].sort();
            const pk = `${level}|${n1}|${n2}`;
            const idx = paare.get(pk) || 0;
            paare.set(pk, idx + 1);
            const gleicheWe = zs[i].we && zs[i].we === zs[j].we;
            baue(gleicheWe ? "leicht" : "tragend", level, g, [n1, n2], [zs[i].we ?? null, zs[j].we ?? null], `wand|${pk}|${idx}`);
          }
        }
      }
    }
    // Exterior remainder of every edge (envelope walls of the workshop).
    zs.forEach((z, zi) => {
      kanten(z).forEach((e) => {
        const l = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
        if (l < 0.05) return;
        const iv = belegt[zi][e.i].sort((p, q) => p[0] - q[0]);
        let s = 0, n = 0;
        const frei = [];
        for (const [u, v] of iv) { if (u - s > 0.05) frei.push([s, u]); s = Math.max(s, v); }
        if (l - s > 0.05) frei.push([s, l]);
        for (const [u, v] of frei) {
          const ux = (e.b.x - e.a.x) / l, uz = (e.b.z - e.a.z) / l;
          baue("aussen", level, { a: { x: e.a.x + ux * u, z: e.a.z + uz * u }, b: { x: e.a.x + ux * v, z: e.a.z + uz * v } }, [String(z.name)], [z.we ?? null], `aussen|${level}|${z.name}|${e.i}|${n++}`);
        }
      });
    });
  }
  return out;
}

/**
 * Key of one zone door: "<level>|<zone name>|<index in zone.tueren>" — the SAME key the focus
 * writes into werkstatt_layer.tuerAufschlaege (75-14), so swing override and GUID share one id.
 * @param {number} level storey
 * @param {string} zoneName zone name (with the " ·WT" marker)
 * @param {number} idx index in zone.tueren
 * @returns {string}
 */
export const tuerSchluessel = (level, zoneName, idx) => `${Math.round(num(level))}|${zoneName}|${idx}`;

/**
 * Stable GUID of a zone door (89-02 key `tuer|<level>|<zone>|<idx>` — unchanged since 89-02).
 * @param {number} level @param {string} zoneName @param {number} idx
 * @returns {string} 22-character IFC GlobalId
 */
export const tuerGuid = (level, zoneName, idx) => stabileGuid(`tuer|${tuerSchluessel(level, zoneName, idx)}`);

/** Signed polygon area (shoelace, x/z) — the sign gives the ring orientation. */
function vorzeichenFlaeche(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += num(p.x) * num(q.z) - num(q.x) * num(p.z);
  }
  return a / 2;
}

/**
 * The ONE door geometry of a zone door record (75-14 maths, moved here unchanged from
 * wohnungsErschliessung.tuerGeometrie in 89-07): the leaf sits on edge `tuer.wand` at offset u_m
 * (clamped into the edge), hinge at the start ("links") or end ("rechts"), swing 90° into the zone —
 * or out of it for `nachAussen` (bath, store room). All lengths in metres (plan x/z).
 * @param {{points: Array<{x:number,z:number}>}} zone
 * @param {{wand?: number, u_m?: number, breite_m?: number, aufschlag?: string, nachAussen?: boolean}} tuer
 * @param {number} [standardBreite=0.885] width when the record carries none, m
 * @returns {null|{scharnier:{x:number,z:number}, geschlossen:{x:number,z:number}, offen:{x:number,z:number}, bogen:Array<{x:number,z:number}>, normale:{x:number,z:number}, richtung:{x:number,z:number}, breite:number, aabb:{x0:number,z0:number,x1:number,z1:number}}}
 */
export function tuerLage(zone, tuer, standardBreite = 0.885) {
  const pts = Array.isArray(zone?.points) ? zone.points : [];
  const wand = num(tuer?.wand, -1);
  let kante = null;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!a || !b || i !== wand) continue;
    const laenge = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z));
    if (laenge < 1e-9) continue;
    kante = { a: { x: num(a.x), z: num(a.z) }, b: { x: num(b.x), z: num(b.z) }, laenge };
  }
  if (!kante) return null;
  const b = Math.max(0.1, num(tuer.breite_m, standardBreite));
  const richtung = { x: (kante.b.x - kante.a.x) / kante.laenge, z: (kante.b.z - kante.a.z) / kante.laenge };
  // Left normal of the edge direction; for a positive signed area the interior lies on the left.
  const dx = (kante.b.x - kante.a.x) / kante.laenge;
  const dz = (kante.b.z - kante.a.z) / kante.laenge;
  const innen = vorzeichenFlaeche(pts) > 0 ? { x: -dz, z: dx } : { x: dz, z: -dx };
  // 84-08: `nachAussen` doors (bath, store room) swing out of the zone into the hall.
  const normale = tuer.nachAussen ? { x: -innen.x, z: -innen.z } : innen;
  const u0 = Math.max(0, Math.min(kante.laenge - b, num(tuer.u_m)));
  const p0 = { x: kante.a.x + richtung.x * u0, z: kante.a.z + richtung.z * u0 };
  const p1 = { x: p0.x + richtung.x * b, z: p0.z + richtung.z * b };
  const rechts = tuer.aufschlag === "rechts";
  const scharnier = rechts ? p1 : p0;
  const geschlossen = rechts ? p0 : p1;
  const offen = { x: scharnier.x + normale.x * b, z: scharnier.z + normale.z * b };
  const a0 = Math.atan2(geschlossen.z - scharnier.z, geschlossen.x - scharnier.x);
  const a1 = Math.atan2(offen.z - scharnier.z, offen.x - scharnier.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const bogen = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = a0 + (delta * i) / 8;
    bogen.push({ x: scharnier.x + Math.cos(a) * b, z: scharnier.z + Math.sin(a) * b });
  }
  const xs = [scharnier.x, geschlossen.x, offen.x], zs = [scharnier.z, geschlossen.z, offen.z];
  return {
    scharnier, geschlossen, offen, bogen, normale, richtung, breite: b,
    aabb: { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) },
  };
}

/**
 * Doors of the workshop zones: one component per `tueren` record (89-07: the ONE door — the plan
 * symbol, the IFC door and the focus furniture all read it). Position a/b = the leaf line from
 * `tuerLage` (offset clamped into the edge like the plan symbol), `schwenk` = hinge, open leaf end
 * and swing normal (m). Entrance doors (typ "hauseingang") are envelope doors (`huelle: true`).
 * @param {Array<any>} zonen
 * @returns {Array<{guid: string, schluessel: string, typ: "tuer", art: string, huelle: boolean, level: number, zone: string, nach: string|null, we: string|null, wand: number, aufschlag: "links"|"rechts", nachAussen: boolean, a: {x:number,z:number}, b: {x:number,z:number}, breite_m: number, schwenk: {scharnier: {x:number,z:number}, offen: {x:number,z:number}, normale: {x:number,z:number}}, kg: string, gewerk: string, material: string, status: null, bauabschnitt: null}>}
 */
export function werkstattTueren(zonen) {
  const out = [];
  for (const z of (Array.isArray(zonen) ? zonen : []).filter(istWerkstattZone)) {
    (Array.isArray(z.tueren) ? z.tueren : []).forEach((t, idx) => {
      const g = tuerLage(z, t, 0.885);
      if (!g) return;
      const w = num(t?.breite_m, 0.885);
      const aussen = t.typ === "hauseingang";
      const level = Math.round(num(z.level));
      const rechts = t.aufschlag === "rechts";
      // Leaf line in edge direction (start → end), independent of the hinge side.
      const p0 = rechts ? g.geschlossen : g.scharnier;
      const p1 = rechts ? g.scharnier : g.geschlossen;
      out.push({
        guid: tuerGuid(level, String(z.name), idx), schluessel: tuerSchluessel(level, String(z.name), idx),
        typ: "tuer", art: String(t.typ || "zimmer"), huelle: aussen,
        level, zone: String(z.name), nach: t.nach ?? null, we: z.we ?? null,
        wand: Math.round(num(t.wand, -1)), aufschlag: rechts ? "rechts" : "links", nachAussen: t.nachAussen === true,
        a: { x: r3(p0.x), z: r3(p0.z) }, b: { x: r3(p1.x), z: r3(p1.z) },
        breite_m: w,
        schwenk: {
          scharnier: { x: r3(g.scharnier.x), z: r3(g.scharnier.z) }, offen: { x: r3(g.offen.x), z: r3(g.offen.z) },
          normale: { x: r3(g.normale.x), z: r3(g.normale.z) },
        },
        kg: aussen ? TUER_KG.aussen : TUER_KG.innen, gewerk: "Ausbau",
        material: t.typ === "T30-RS" ? "Stahltür T30-RS (Treppenraum)" : t.typ === "wohnung" ? "Wohnungseingangstür (Holz, Schallschutz)" : "Innentür Holz, Zarge Stahl [ASSUMED]",
        status: null, bauabschnitt: null,
      });
    });
  }
  return out;
}

/**
 * Rooms of the workshop (IfcSpace): every zone of a unit plus corridors/cores, clear area m².
 * @param {Array<any>} zonen
 * @returns {Array<{guid: string, typ: "raum", level: number, name: string, we: string|null, raumart: string|null, flaeche_m2: number, points: Array<{x:number,z:number}>, status: null}>}
 */
export function werkstattRaeume(zonen) {
  return (Array.isArray(zonen) ? zonen : []).filter((z) => istWerkstattZone(z) && z.raumart !== "balkon" && Array.isArray(z.points) && z.points.length >= 3).map((z) => {
    const p = z.points;
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += num(a.x) * num(b.z) - num(b.x) * num(a.z); }
    return {
      guid: stabileGuid(`raum|${Math.round(num(z.level))}|${z.name}`), typ: "raum", level: Math.round(num(z.level)), name: String(z.name),
      we: z.we ?? null, raumart: z.raumart ?? null, flaeche_m2: r3(Math.abs(s) / 2), points: p.map((q) => ({ x: num(q.x), z: num(q.z) })), status: null,
    };
  });
}

/**
 * D-BW-02 bookkeeping: zones stay clear, walls lie outside → per storey the clear area and how
 * much the shell grows (exterior ring + interior walls), m². WoFlV living area is NOT changed.
 * @param {ReturnType<typeof werkstattWaende>} waende
 * @param {ReturnType<typeof werkstattRaeume>} raeume
 * @returns {Array<{level: number, licht_m2: number, aussenwand_m2: number, innenwand_m2: number, rohbau_m2: number}>}
 */
export function rohbauZuschlag(waende, raeume) {
  const levels = [...new Set([...(raeume || []).map((r) => r.level), ...(waende || []).map((w) => w.level)])].sort((a, b) => a - b);
  return levels.map((level) => {
    const licht = (raeume || []).filter((r) => r.level === level).reduce((s, r) => s + r.flaeche_m2, 0);
    const aussen = (waende || []).filter((w) => w.level === level && w.huelle).reduce((s, w) => s + w.rohbauLaenge_m * w.dicke_m, 0);
    const innen = (waende || []).filter((w) => w.level === level && !w.huelle).reduce((s, w) => s + w.lichteLaenge_m * w.dicke_m, 0);
    return { level, licht_m2: r3(licht), aussenwand_m2: r3(aussen), innenwand_m2: r3(innen), rohbau_m2: r3(licht + aussen + innen) };
  });
}

/**
 * All workshop components of a zone list (one call for plan, IFC and AVA).
 * @param {Array<any>} zonen
 * @param {{storeyHeight?: number}} [opts]
 */
export function werkstattBauteile(zonen, opts = {}) {
  const waende = werkstattWaende(zonen, opts);
  const raeume = werkstattRaeume(zonen);
  return { waende, tueren: werkstattTueren(zonen), raeume, rohbau: rohbauZuschlag(waende, raeume) };
}
