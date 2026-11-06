// Massing modeller core (phase 98-01, user brief 17.10.2026: SketchUp-like tools in the Massing
// Studio). Until now the studio held ONE body (footprintM + storeys × storeyHeight). The model
// here holds many bodies in a new layer `massing_layer`; the old single body is body 0
// (migration `ausEinzelkoerper`), so existing projects read unchanged.
//
// Groups work like SketchUp components: a group NUMBER is a definition (profile + height); every
// body carrying that number is an instance with its own position. Changing the geometry of one
// instance changes the definition → all instances with the same number change together.
// "Eindeutig machen" gives an instance a new number with a copy of the definition.
//
// Rule (phase 107-01, spec VI.3): the store holds the BASE GEOMETRY of a body (profile, height, base, position,
// rotation, group); mesh, plan, section and IFC are derived from it; a computed mesh lies at most as a discardable
// intermediate store with a hash of the base inputs (csg_cache_layer, 107-14, D-BK-08a), never as the source. Derivations must never write back
// into profile or height.
//
// Units: metres in plan coordinates of the studio, angles in degrees. Frame (107-05, the same as massing/koordinaten.js):
// x grows to the right (east), y grows DOWNWARDS on the screen (the plan stores screen-down y; typed north-up values are
// flipped in koordinaten.js). A rotation `drehung` "counter-clockwise" is the mathematical sense in the x/y numbers; in this
// y-down frame it turns CLOCKWISE on the screen.
//
// Orientation convention (107-05, profilNormieren): the OUTER ring has a POSITIVE shoelace area in this x/y frame (= clockwise
// on the screen, = counter-clockwise in the IFC profile plane, where the export writes (x, y) unchanged); inner rings (`loecher`)
// run the other way (negative area). The stored points keep the click order; geometrie() normalises on reading, so nothing in a
// saved project is rewritten. The sign is the one of formGeometrie.flaecheSigniert. (The plan text proposed the opposite sign;
// the positive one keeps every body of the IFC golden byte-identical, see 107-05-SUMMARY.)
// A profile is valid when profilGueltig() says so (no self-intersection, no double point, an area); invalid bodies are never
// stored as such — the marker is derived on every read (spec field `is_manifold_solid` = not stored, research §3.2).
// 107-06: push/pull works on every face, not only the top: flaecheWaehlen() turns a 3D hit (point + normal) into a face of
// flaechen() (top, bottom, side k of a ring), seiteVerschieben() moves a side edge along its outward normal (neighbour edges
// follow, corners re-intersected), pushPull(…, {flaeche: "unten"}) moves the bottom with the top kept. A part rectangle of a
// side face pushed through to the opposite face of a wall-like body becomes an entry of the optional `oeffnungen` list
// (massing_layer v3) instead of a geometry change — no 3D boolean before the CSG core (107-14).
// 107-07: copies of every kind (move, rotate, site plan blocks, BIM studio duplicate) share one array core reihenFaktoren()
// for typed "*n" / "/n"; drehen()/drehKopien() know rotated copies; guide lines and points live in the optional list
// `hilfslinien` (massing_layer v4) — snap targets only, never printed or exported (D-BK-16).
// 107-08 (massing_layer v5): a body may carry a stored `guid` (written lazily, guidSichern; a copy never takes it along — every
// copy path strips it, so no two bodies share a GlobalId), the instance transform `spiegel` / `massstab` (applied by geometrie()
// before position and rotation; instanzMatrix() derives the 4×4 matrix, never stored; skalieren(…, {instanz: true}) scales the
// instance instead of the definition) and a type: `bauteil_typ`, `bauteil_typ_quelle` and `status`. The box automatic
// (typAutomatik, D-BK-09) sets the type from the proportions when a body is created or changes its form, as long as nobody set
// or took back the type; typZuruecknehmen() leaves "Bauteiltyp offen" and keeps the automatic away until typAutomatikZulassen().
// Pure functions, every edit returns a NEW layer (undo via @core/lib/undoStack).
//
// In: layer objects, edit parameters. Out: new layers, resolved geometry, validity, derived faces, parsed typed input.

import { gesamtHoehe, geschosseAus, elevationOf } from "../bauteil/hoehen.js"; // 107-02: building height from the storey table (ausEinzelkoerper); 107-08 review: storey planes of the takeover
import { STANDARD_DICKE_M } from "../bauteil/referenz.js"; // 107-08 review: envelope wall thickness of the takeover without a build-up
import { flaecheSigniert } from "../formGeometrie.js"; // 107-05: shoelace area (moved to @core in this plan)
import { kantenSchnitte, punktInnen } from "../polygonInnen.js"; // 107-05: edge crossings and point-in-polygon for profilGueltig
import { oeffnungsMasse, oeffnungPasst, oeffnungMitte_m, OEFFNUNG_RAND_M } from "../bauteil/oeffnungen.js"; // 107-06: sizes and fit of a body opening (107-04 rules)
import { bauteilVorschlag, bauteilGuid, rechteckSeiten, BAUTEIL_TYPEN } from "../bauteil/steckbrief.js"; // 107-08: box automatic, stored GUID
import { normalisiereStatus } from "../kataloge.js"; // 107-08: status of a body

/** Golden ratio φ (proportion suggestion while drawing, like the studio's φ magnet). */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * @typedef {{x: number, y: number}} Pkt  site metres
 * @typedef {object} Koerper
 * @property {string} id
 * @property {string} [name]
 * @property {Pkt[]} [profil]      own profile (relative to the position) — absent for group instances
 * @property {number} [hoehe]      own height in m — absent for group instances
 * @property {number} basis        bottom level in m above ±0
 * @property {Pkt} pos             position of the profile origin (m)
 * @property {number} drehung      rotation about the origin in degrees (mathematically counter-clockwise in x/y = clockwise on
 *                                 the y-down screen)
 * @property {string|null} gruppe  group number ("1", "2" …) — instance of that definition
 * @property {Pkt[][]} [loecher]   107-05: optional inner rings (courtyards), same frame as `profil`; absent for group instances
 *                                 (the definition carries them) and for bodies without holes (massing_layer v2)
 * @property {KoerperOeffnung[]} [oeffnungen] 107-06: optional openings through a wall-like body (massing_layer v3); absent for
 *                                 group instances (the definition carries them) and for bodies without openings
 * @property {string} [guid]       107-08: stored IFC GlobalId (22 characters), written lazily; never copied
 * @property {boolean} [spiegel]   107-08: instance mirrored about its local y axis (x → −x) before scale, rotation and position
 * @property {{x: number, y: number, z: number}} [massstab] 107-08: instance scale (dimensionless, default 1 each), applied to the
 *                                 profile (x, y) and the height (z) of the body or its definition
 * @property {string} [bauteil_typ] 107-08: key of BAUTEIL_TYPEN (wall, slab, column …); absent = untyped study body (D-BK-10)
 * @property {'automatisch'|'nutzer'|'zurueckgenommen'} [bauteil_typ_quelle] 107-08: who set the type (D-BK-09); absent = never typed
 * @property {string} [status]     107-08: renovation status bestand/neubau/abbruch/temporaer; absent = "ohne Status"
 * @property {{form: string, neigung_grad?: number, firstrichtung?: "laengs"|"quer"}} [dach] 107-10: optional roof on top of the body
 *                                 (massing_layer v6, faces from bauteil/dachGeometrie.js); absent for group instances (the definition
 *                                 carries it) and for bodies without a roof
 * @typedef {{kante: number, u: number, width: number, height: number, sill: number}} KoerperOeffnung  opening of a body:
 *   kante = edge index in the STORED outer ring (edge i runs from profil[i] to profil[i+1], click order — like wallIdx of a wall
 *   opening), u = middle along that edge from profil[i] (m, like `u` of a wall opening), width/height (m) and sill (m above the
 *   body bottom `basis`) — the field names of the wall openings (107-04), read through oeffnungsMasse(). Review 107-06: the stored
 *   order does not depend on the orientation convention (D-BK-28 still open), so flipping that sign never renumbers saved
 *   openings; geometrie() hands them over translated into the normalised order (oeffnungWenden).
 * @typedef {{profil: Pkt[], hoehe: number, loecher?: Pkt[][], oeffnungen?: KoerperOeffnung[], dach?: {form: string, neigung_grad?: number, firstrichtung?: "laengs"|"quer"}}} GruppenDefinition  profile/holes
 *   in group coordinates, height m; 107-06: openings of every instance; 107-10: optional roof of every instance
 * @typedef {{v?: number, koerper: Koerper[], gruppen: Record<string, GruppenDefinition>, naechsteId: number, parametrik?: {knoten: any[], kanten: any[]}, gelaende?: import('./gelaende.js').Gelaende, bezug?: Pkt, riegel?: Array<{id: string, pfad: Pkt[], opt: Record<string, any>}>, hilfslinien?: Hilfslinie[]}} MassingLayer
 *   hilfslinien (107-07, v4): optional guide lines / points of the modeller (snap targets, never printed or exported)
 *   parametrik (98-07): node graph of the parametric editor (@core/lib/massing/knoten.js), optional
 *   gelaende (98-06): sandbox height grid (./gelaende.js), optional
 *   bezug (98-05): site point of the main body's centre = building model origin (IFC placement)
 *   riegel (98-09): residential bars along a path (./riegel.js), units derived, not stored
 */

/** @returns {MassingLayer} */
export function leererLayer() {
  return { koerper: [], gruppen: {}, naechsteId: 1 };
}

const runde = (v) => Math.round(v * 1e6) / 1e6;
const kopiePkt = (p) => ({ x: runde(p.x), y: runde(p.y) });

// ---- 107-05: orientation, validity, inner rings ------------------------------------------------------------------------

/** Two consecutive profile points closer than this are a double point, m (1 mm, the tolerance of formGeometrie.bereinigen). */
export const PROFIL_DOPPELPUNKT_M = 1e-3;
/** Smallest profile area that still counts as a face, m² [ASSUMED 1 cm²: below that a body is a drawing slip, not a volume;
 *  a sourced value would come from the smallest element a planner models, e.g. a 10 × 10 cm column = 100 cm²]. */
export const PROFIL_MIN_FLAECHE_M2 = 1e-4;

/**
 * Reasons of profilGueltig() with their German text (key of @core/lib/i18n, EN in i18nTeile/bauteilkern-107.js).
 * @type {Readonly<Record<'punkte'|'zahl'|'doppelpunkt'|'flaeche'|'selbstschnitt'|'loch', string>>}
 */
export const PROFIL_GRUND_TEXT = Object.freeze({
  punkte: "Profil braucht mindestens 3 Punkte",
  zahl: "Profil hat ungültige Koordinaten",
  doppelpunkt: "Profil hat doppelte Punkte",
  flaeche: "Profil hat keine Fläche",
  selbstschnitt: "Profil schneidet sich selbst",
  loch: "Innenring liegt nicht frei im Profil",
});

/** Shoelace area of a ring in the x/y frame, m² (sign = orientation, see the file head). */
const flaecheXY = (/** @type {Pkt[]} */ ring) => flaecheSigniert((ring || []).map((p) => ({ x: p.x, z: p.y })));

/** Reverse a ring but keep its first point first ([p0, pn-1, …, p1]) — corner 0 stays corner 0. */
const umkehren = (/** @type {Pkt[]} */ ring) => (ring.length ? [ring[0], ...ring.slice(1).reverse()] : []);

/**
 * Bring a ring into the orientation convention (file head) and round to 1e-6 m. Pure: the input is not changed, the stored
 * points of a body are never rewritten — geometrie() calls this on reading.
 * @param {Pkt[]} profil ring in m (any orientation; no repeated closing point)
 * @param {'aussen'|'innen'} [rolle] outer ring (positive area) or inner ring (negative area)
 * @returns {Pkt[]} new array; a ring without area keeps its order
 */
export function profilNormieren(profil, rolle = "aussen") {
  const ring = Array.isArray(profil) ? profil.map(kopiePkt) : [];
  const f = flaecheXY(ring);
  const falsch = rolle === "innen" ? f > 0 : f < 0;
  return falsch ? umkehren(ring) : ring;
}

/**
 * Index of a corner in the STORED profile from its index in the resolved (normalised) profile of geometrie().
 * @param {number} n number of corners
 * @param {number} i index in the resolved profile
 * @param {boolean} [umgekehrt] geometrie(...).umgekehrt
 * @returns {number}
 */
export function gespeicherterEckIndex(n, i, umgekehrt = false) {
  return umgekehrt && i > 0 ? n - i : i;
}

/** Do the two segments overlap on a common line (collinear, sharing more than a point)? Parallel pairs are skipped by kantenSchnitte. */
function kollinearUeberlappend(/** @type {Pkt} */ p1, /** @type {Pkt} */ p2, /** @type {Pkt} */ q1, /** @type {Pkt} */ q2) {
  const rx = p2.x - p1.x, ry = p2.y - p1.y, l2 = rx * rx + ry * ry;
  if (l2 < 1e-18) return false;
  const quer = (/** @type {Pkt} */ q) => Math.abs(rx * (q.y - p1.y) - ry * (q.x - p1.x)) / Math.sqrt(l2);
  if (quer(q1) > 1e-6 || quer(q2) > 1e-6) return false;
  const t1 = ((q1.x - p1.x) * rx + (q1.y - p1.y) * ry) / l2, t2 = ((q2.x - p1.x) * rx + (q2.y - p1.y) * ry) / l2;
  const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
  return hi - lo > 1e-9;
}

/**
 * Check of ONE ring: enough finite points, no double point, an area, no self-intersection (also a spike that runs back on
 * its own edge, and two non-neighbouring edges that touch or overlap).
 * @param {Pkt[]} ring m
 * @returns {null | 'punkte'|'zahl'|'doppelpunkt'|'flaeche'|'selbstschnitt'} null = fine
 */
function ringFehler(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return "punkte";
  if (ring.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "zahl";
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) < PROFIL_DOPPELPUNKT_M) return "doppelpunkt";
  }
  // non-neighbouring edges must neither cross nor touch (polygonInnen.kantenSchnitte, segment-segment incl. end points);
  // checked before the area, because a symmetric bow-tie has a signed area of 0 and is a crossing, not a missing face
  const nachbar = (/** @type {number} */ i, /** @type {number} */ j) => j === i || j === (i + 1) % n || i === (j + 1) % n;
  for (const s of kantenSchnitte(ring, ring)) if (!nachbar(s.i, s.j)) return "selbstschnitt";
  if (Math.abs(flaecheXY(ring)) < PROFIL_MIN_FLAECHE_M2) return "flaeche";
  // spike: two neighbouring edges on one line pointing back (the corner folds the edge onto itself)
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const kreuz = ux * vy - uy * vx, skalar = ux * vx + uy * vy;
    if (Math.abs(kreuz) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) < 1e-9 && skalar < 0) return "selbstschnitt";
  }
  // collinear overlap of non-neighbouring edges (parallel pairs are skipped by kantenSchnitte)
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (nachbar(i, j)) continue;
    if (kollinearUeberlappend(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return "selbstschnitt";
  }
  return null;
}

/**
 * @typedef {{ok: boolean, grund?: 'punkte'|'zahl'|'doppelpunkt'|'flaeche'|'selbstschnitt'|'loch'|'instanz', text?: string, ring?: 'aussen'|number}} ProfilPruefung
 *   ok true: nothing else is set. ok false: grund, text (German reason, i18n key) and ring (the outer ring or the index of
 *   the inner ring that failed) are set.
 */

/**
 * Is a profile (outer ring plus optional inner rings) a clean face to extrude? The outer ring and every inner ring must pass
 * the ring check; every inner ring must lie inside the outer ring without touching it, and inner rings must not touch or
 * contain each other. Orientation does not matter (geometrie normalises it).
 * @param {Pkt[]} profil outer ring, m
 * @param {{loecher?: Pkt[][]|null}} [opt] inner rings, m
 * @returns {ProfilPruefung}
 */
export function profilGueltig(profil, { loecher = null } = {}) {
  const f = ringFehler(profil);
  if (f) return { ok: false, grund: f, text: PROFIL_GRUND_TEXT[f], ring: "aussen" };
  const innen = Array.isArray(loecher) ? loecher : [];
  for (let k = 0; k < innen.length; k++) {
    const r = innen[k];
    const fi = ringFehler(r);
    if (fi) return { ok: false, grund: fi, text: fi === "selbstschnitt" ? "Innenring schneidet sich selbst" : PROFIL_GRUND_TEXT.loch, ring: k };
    const frei = r.every((p) => punktInnen(profil, p)) && kantenSchnitte(r, profil).length === 0;
    if (!frei) return { ok: false, grund: "loch", text: PROFIL_GRUND_TEXT.loch, ring: k };
    for (let j = 0; j < k; j++) {
      const o = innen[j];
      if (kantenSchnitte(r, o).length || punktInnen(o, r[0]) || punktInnen(r, o[0])) return { ok: false, grund: "loch", text: "Innenringe überschneiden sich", ring: k };
    }
  }
  return { ok: true };
}

/**
 * Count the faults of ONE ring per reason (unlike ringFehler, which stops at the first). Used to tell whether an edit of an
 * already-invalid profile adds a fault or only removes some (repair step by step).
 * @param {Pkt[]} ring m
 * @param {Record<string, number>} z counters to add to (reason → number of faults)
 */
function ringMaengelZaehlen(ring, z) {
  const plus = (/** @type {string} */ g, n = 1) => { z[g] = (z[g] || 0) + n; };
  if (!Array.isArray(ring) || ring.length < 3) { plus("punkte"); return; }
  if (ring.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) { plus("zahl"); return; }
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) < PROFIL_DOPPELPUNKT_M) plus("doppelpunkt");
  }
  const nachbar = (/** @type {number} */ i, /** @type {number} */ j) => j === i || j === (i + 1) % n || i === (j + 1) % n;
  for (const s of kantenSchnitte(ring, ring)) if (!nachbar(s.i, s.j)) plus("selbstschnitt");
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const lu = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (lu > 0 && Math.abs(ux * vy - uy * vx) / lu < 1e-9 && ux * vx + uy * vy < 0) plus("selbstschnitt");
  }
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (!nachbar(i, j) && kollinearUeberlappend(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) plus("selbstschnitt");
  }
  if (Math.abs(flaecheXY(ring)) < PROFIL_MIN_FLAECHE_M2) plus("flaeche");
}

/**
 * Faults of a profile counted per reason (outer ring, inner rings, inner rings not free) — 0 everywhere for a valid profile.
 * Derived, never stored.
 * @param {Pkt[]} profil outer ring, m
 * @param {{loecher?: Pkt[][]|null}} [opt] inner rings, m
 * @returns {Record<string, number>} reason (keys of PROFIL_GRUND_TEXT) → number of faults; absent key = none
 */
export function profilMaengel(profil, { loecher = null } = {}) {
  /** @type {Record<string, number>} */
  const z = {};
  ringMaengelZaehlen(profil, z);
  const innen = Array.isArray(loecher) ? loecher : [];
  const aussenOk = !ringFehler(profil);
  for (let k = 0; k < innen.length; k++) {
    const r = innen[k];
    /** @type {Record<string, number>} */
    const zi = {};
    ringMaengelZaehlen(r, zi);
    for (const [g, n] of Object.entries(zi)) z[g === "selbstschnitt" ? "selbstschnitt" : "loch"] = (z[g === "selbstschnitt" ? "selbstschnitt" : "loch"] || 0) + n;
    if (!aussenOk || ringFehler(r)) continue;
    if (!(r.every((p) => punktInnen(profil, p)) && kantenSchnitte(r, profil).length === 0)) z.loch = (z.loch || 0) + 1;
    for (let j = 0; j < k; j++) {
      const o = innen[j];
      if (kantenSchnitte(r, o).length || punktInnen(o, r[0]) || punktInnen(r, o[0])) z.loch = (z.loch || 0) + 1;
    }
  }
  return z;
}

/**
 * Shared refusal rule of every edit of an existing profile (eckeVerschieben, gruppeAendern, skalieren; review 107-05): an
 * edit is refused when its result is invalid AND either the profile was valid before, or the edit adds a fault (some reason
 * counts more faults than before). So a body that was already invalid (stored before 107-05, or baked with pruefen:false)
 * can be repaired one step at a time — each step may remove a fault while another one is still there — but no step may
 * make it worse. The body stays marked invalid (koerperGueltig) until the last fault is gone.
 * @param {{profil: Pkt[], loecher?: Pkt[][]|null}} vorher profile before the edit, m
 * @param {{profil: Pkt[], loecher?: Pkt[][]|null}} nachher profile after the edit, m
 * @returns {ProfilPruefung|null} the reason to refuse, or null = the edit may go through
 */
export function aenderungAblehnen(vorher, nachher) {
  const pn = profilGueltig(nachher.profil, { loecher: nachher.loecher || null });
  if (pn.ok) return null;
  if (profilGueltig(vorher.profil, { loecher: vorher.loecher || null }).ok) return pn;
  const zv = profilMaengel(vorher.profil, { loecher: vorher.loecher || null });
  const zn = profilMaengel(nachher.profil, { loecher: nachher.loecher || null });
  const schlimmer = Object.keys(zn).find((g) => zn[g] > (zv[g] || 0));
  if (!schlimmer) return null;
  const grund = /** @type {'punkte'|'zahl'|'doppelpunkt'|'flaeche'|'selbstschnitt'|'loch'} */ (schlimmer);
  return { ok: false, grund, text: PROFIL_GRUND_TEXT[grund], ring: pn.ring };
}

/**
 * Error for an edit that refuses an invalid profile; `grund` and `pruefung` say why.
 * @param {ProfilPruefung} pr
 * @returns {Error & {grund?: string, pruefung?: ProfilPruefung}}
 */
function profilFehler(pr) {
  const e = /** @type {Error & {grund?: string, pruefung?: ProfilPruefung}} */ (new Error(pr.text || "Profil ungültig"));
  e.grund = pr.grund;
  e.pruefung = pr;
  return e;
}

/** Copy of inner rings (rounded), or undefined when there are none — absent field = no holes (old projects unchanged). */
const kopieLoecher = (/** @type {Pkt[][]|null|undefined} */ l) => (Array.isArray(l) && l.length ? l.map((r) => r.map(kopiePkt)) : undefined);
/** 107-06: copy of body openings (rounded), or undefined when there are none — absent field = no openings (old projects unchanged). */
const kopieOeffnungen = (/** @type {KoerperOeffnung[]|null|undefined} */ l) => (Array.isArray(l) && l.length
  ? l.map((o) => ({ kante: o.kante, u: runde(o.u), width: runde(o.width), height: runde(o.height), sill: runde(o.sill) })) : undefined);

/**
 * Body 0 from the studio's single body (migration, nothing changes for old projects).
 * @param {Pkt[]|null} footprint site metres (the studio's `poly`)
 * @param {number} storeys
 * @param {number} storeyHeight m
 * @param {Array<{level: number, name?: string, hoehe_m: number}>|null} [geschosse] optional storey table (programme field `geschosse`, 107-02):
 *   with it the body is as high as the sum of the table heights (the same total as `model.totalHeight`), without it `storeys × storeyHeight` as before
 * @returns {MassingLayer}
 */
export function ausEinzelkoerper(footprint, storeys, storeyHeight, geschosse = null) {
  const l = leererLayer();
  if (!Array.isArray(footprint) || footprint.length < 3) return l;
  l.koerper.push({ id: "k0", name: "Baukörper", profil: footprint.map(kopiePkt), hoehe: runde(gesamtHoehe(storeys || 1, Array.isArray(geschosse) && geschosse.length ? geschosseAus({ geschosse, storeyHeight }) : storeyHeight || 3)), basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null });
  return l;
}

/**
 * Profile and height of a body, resolved through its group definition, in site coordinates. 107-05: the rings come out in
 * the orientation convention (profilNormieren — outer ring positive, inner rings negative); the stored data stays as it is.
 * `loecher` is present only when the body (or its definition) has inner rings, `umgekehrt` only when the outer ring had to
 * be reversed (then corner i of this profile is corner gespeicherterEckIndex(n, i, true) of the stored one) — a body
 * without either reads exactly as before 107-05.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * 107-06: `oeffnungen` (body or definition) is passed through only when there are some.
 * 107-10: `dach` (body or definition) is passed through only when set.
 * @returns {{profil: Pkt[], hoehe: number, basis: number, loecher?: Pkt[][], umgekehrt?: true, oeffnungen?: KoerperOeffnung[], dach?: {form: string, neigung_grad?: number, firstrichtung?: "laengs"|"quer"}}}
 */
export function geometrie(layer, k) {
  const def = k.gruppe != null ? layer.gruppen[k.gruppe] : null;
  const ms = instanzMassstab(k);
  // 107-08: the instance transform (mirror, then scale) works in the local frame of the body BEFORE rotation and position; a body
  // without `spiegel`/`massstab` reads exactly as before (the local ring is the stored one, same object)
  const neutral = instanzNeutral(k);
  const lokal = (/** @type {Pkt} */ p) => ({ x: p.x * ms.x * (k.spiegel ? -1 : 1), y: p.y * ms.y });
  const roh = neutral ? (def ? def.profil : k.profil || []) : (def ? def.profil : k.profil || []).map(lokal);
  const lochRoh = ((def ? def.loecher : k.loecher) || []).map((r) => (neutral ? r : r.map(lokal)));
  const hoehe = neutral ? (def ? def.hoehe : k.hoehe || 0) : runde((def ? def.hoehe : k.hoehe || 0) * ms.z);
  const w = ((k.drehung || 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const welt = (/** @type {Pkt} */ p) => ({ x: runde(k.pos.x + p.x * c - p.y * s), y: runde(k.pos.y + p.x * s + p.y * c) });
  // a rotation keeps the orientation, so normalising before the transform is enough (a mirror flips it — normalised here too)
  const umgekehrt = flaecheXY(roh) < 0;
  /** @type {{profil: Pkt[], hoehe: number, basis: number, loecher?: Pkt[][], umgekehrt?: true, oeffnungen?: KoerperOeffnung[], dach?: any}} */
  const g = { profil: (umgekehrt ? umkehren(roh) : roh).map(welt), hoehe, basis: k.basis || 0 };
  if (Array.isArray(lochRoh) && lochRoh.length) g.loecher = lochRoh.map((r) => profilNormieren(r, "innen").map(welt));
  if (umgekehrt) g.umgekehrt = true;
  let oe = def ? def.oeffnungen : k.oeffnungen;
  // 107-08: an instance scale stretches an opening's place along its edge (u by the edge's length ratio, mirrored edges keep their
  // index), its own size stays [ASSUMED: a window keeps its size when a component instance is stretched]
  if (!neutral && Array.isArray(oe) && oe.length) {
    const vor = def ? def.profil : k.profil || [];
    oe = oe.map((o) => {
      const a = vor[o.kante], b = vor[(o.kante + 1) % vor.length];
      if (!a || !b) return o;
      const l0 = Math.hypot(b.x - a.x, b.y - a.y), la = lokal(a), lb = lokal(b), l1 = Math.hypot(lb.x - la.x, lb.y - la.y);
      return l0 > 1e-9 ? { ...o, u: runde((o.u * l1) / l0) } : o;
    });
  }
  // stored edge order → order of the normalised ring (identity unless the outer ring had to be reversed)
  if (Array.isArray(oe) && oe.length) g.oeffnungen = umgekehrt ? oe.map((o) => oeffnungWenden(o, roh)) : oe;
  // 107-10: an optional roof (body or definition) is passed through only when set — a body without it reads as before
  const dach = def ? def.dach : k.dach;
  if (dach && typeof dach === "object") g.dach = dach;
  return g;
}

/**
 * 107-10 (massing_layer v6): sets or removes the optional roof of bodies — `dach {form, neigung_grad, firstrichtung}` (form
 * "flach" | "sattel" | "walm" | "pult", slope in degrees, ridge "laengs" | "quer" to the longest side; the faces come from
 * @core/lib/bauteil/dachGeometrie.js). Like every change of form, a group instance changes its DEFINITION (all instances of
 * the number get the roof). `null` or form "" removes the field; the profile and the height never change (the roof sits on
 * top of the body, derived).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {{form: string, neigung_grad?: number, firstrichtung?: "laengs"|"quer"}|null} dach
 * @returns {MassingLayer}
 */
export function dachSetzen(layer, ids, dach) {
  const wert = dach && dach.form ? {
    form: String(dach.form),
    ...(dach.form !== "flach" && Number.isFinite(Number(dach.neigung_grad)) ? { neigung_grad: Number(dach.neigung_grad) } : {}),
    ...(dach.firstrichtung === "quer" ? { firstrichtung: "quer" } : {}),
  } : null;
  const mit = (/** @type {any} */ o) => {
    const { dach: _d, ...rest } = o;
    return wert ? { ...rest, dach: wert } : rest;
  };
  const gruppen = { ...layer.gruppen };
  const koerper = layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    if (k.gruppe != null && gruppen[k.gruppe]) {
      gruppen[k.gruppe] = /** @type {GruppenDefinition} */ (mit(gruppen[k.gruppe]));
      return k;
    }
    return /** @type {Koerper} */ (mit(k));
  });
  return { ...layer, koerper, gruppen };
}

/**
 * 107-08: instance scale of a body (stored `massstab`, missing axes = 1; non-positive or non-numeric values count as 1).
 * @param {Koerper} k
 * @returns {{x: number, y: number, z: number}} dimensionless
 */
export function instanzMassstab(k) {
  const m = k?.massstab;
  const ax = (/** @type {any} */ v) => (Number(v) > 0 ? Number(v) : 1);
  return { x: ax(m?.x), y: ax(m?.y), z: ax(m?.z) };
}

/**
 * 107-08: true when the body has no instance transform of its own (no mirror, scale 1 on every axis) — then it reads, edits and
 * exports exactly as before 107-08.
 * @param {Koerper} k
 * @returns {boolean}
 */
export function instanzNeutral(k) {
  const m = instanzMassstab(k);
  return !k?.spiegel && m.x === 1 && m.y === 1 && m.z === 1;
}

/**
 * 107-08 (spec V container.transformation_matrix, D-BK-17): the 4×4 matrix of a body instance, derived from `pos`, `basis`,
 * `drehung`, `massstab` and `spiegel` — NEVER stored. It maps a point of the local frame (profile / definition coordinates in m,
 * z up from the body bottom) into the site frame of the studio (x right, y down on the screen, z up in m):
 * M = T(pos.x, pos.y, basis) · Rz(drehung) · S(±massstab.x, massstab.y, massstab.z), the mirror being the minus on x.
 * @param {Koerper} k
 * @returns {number[]} 16 numbers, column by column (column-major, the order the 3D view uses for its 4×4 matrices)
 */
export function instanzMatrix(k) {
  const m = instanzMassstab(k);
  const sx = m.x * (k?.spiegel ? -1 : 1);
  const w = ((k?.drehung || 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const r = (/** @type {number} */ v) => (Math.abs(v) < 1e-12 ? 0 : runde(v));
  return [
    r(c * sx), r(s * sx), 0, 0,
    r(-s * m.y), r(c * m.y), 0, 0,
    0, 0, r(m.z), 0,
    r(k?.pos?.x || 0), r(k?.pos?.y || 0), r(k?.basis || 0), 1,
  ];
}

/**
 * 107-08: mirror bodies (toggle `spiegel`, the instance's own transform — group definitions stay untouched, D-BK-17). The field
 * disappears again when the mirror is switched off, so an unmirrored body is stored as before.
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @returns {MassingLayer}
 */
export function spiegeln(layer, ids) {
  return { ...layer, koerper: layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    if (k.spiegel) { const { spiegel: _s, ...rest } = k; return rest; }
    return { ...k, spiegel: true };
  }) };
}

/** Refusal of a form edit on an instance with its own mirror/scale (the local edit tools work in the unscaled definition frame). */
/** @type {ProfilPruefung} */
const INSTANZ_ABGELEHNT = Object.freeze({ ok: false, grund: /** @type {'instanz'} */ ("instanz"), text: "Instanz ist gespiegelt oder skaliert — erst Spiegelung/Maßstab zurücksetzen" });

/**
 * 107-08: copy of a body for a NEW body (copy, rotated copy, array): without the stored `guid` — the copy gets its own GlobalId
 * (derived from its new id) and no two bodies ever share one (spec IV "*5 → five instances with new GUIDs").
 * Also used for the blocks of the site plan (bloecke.js) and any other record with an optional `guid`.
 * @template T
 * @param {T} q record (body, block …)
 * @returns {T} a shallow copy without `guid`
 */
export function ohneGuid(q) {
  const { guid: _g, ...rest } = /** @type {any} */ (q);
  return /** @type {T} */ (rest);
}

/**
 * Translate an opening between the stored and the normalised edge order of a REVERSED outer ring (umkehren keeps corner 0 first:
 * normalised edge i is stored edge n − 1 − i run backwards, so u becomes L − u). The mapping is its own inverse.
 * @param {KoerperOeffnung} o
 * @param {Pkt[]} ring the ring the index of `o` refers to (stored ring for stored → normalised and the other way round)
 * @returns {KoerperOeffnung} a new object; an edge index outside the ring is left as it is (reported later as "kante")
 */
export function oeffnungWenden(o, ring) {
  const n = ring.length;
  if (!(Number.isInteger(o?.kante) && o.kante >= 0 && o.kante < n)) return o;
  const a = ring[o.kante], b = ring[(o.kante + 1) % n];
  return { ...o, kante: n - 1 - o.kante, u: runde(Math.hypot(b.x - a.x, b.y - a.y) - o.u) };
}

/**
 * Validity of a body as it is drawn (resolved through its group, with inner rings) — derived on every call, never stored.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {ProfilPruefung}
 */
export function koerperGueltig(layer, k) {
  const g = geometrie(layer, k);
  return profilGueltig(g.profil, { loecher: g.loecher || null });
}

/**
 * @typedef {{art: 'deckel'|'boden', z: number, ring: Pkt[], loecher: Pkt[][]}} DeckFlaeche  top or bottom face (z in m)
 * @typedef {{art: 'seite', ring: 'aussen'|number, kante: number, a: Pkt, b: Pkt, z0: number, z1: number, normale: Pkt}} SeitenFlaeche
 *   one side face per ring edge a→b, from z0 to z1 (m); normale = unit vector in plan pointing out of the material
 */

/**
 * Derived faces of a body (spec VI.3: faces are derived, never stored): top, bottom and one side face per edge of the outer
 * ring and of every inner ring. The side normal points out of the material (for an inner ring into the courtyard), which
 * the orientation convention makes the same formula for both rings.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {Array<DeckFlaeche|SeitenFlaeche>}
 */
export function flaechen(layer, k) {
  const g = geometrie(layer, k);
  const z0 = g.basis, z1 = runde(g.basis + g.hoehe);
  const loecher = g.loecher || [];
  /** @type {Array<DeckFlaeche|SeitenFlaeche>} */
  const out = [{ art: "deckel", z: z1, ring: g.profil, loecher }, { art: "boden", z: z0, ring: g.profil, loecher }];
  const seiten = (/** @type {Pkt[]} */ ring, /** @type {'aussen'|number} */ name) => ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.push({ art: "seite", ring: name, kante: i, a, b, z0, z1, normale: { x: runde((b.y - a.y) / l), y: runde(-(b.x - a.x) / l) } });
  });
  seiten(g.profil, "aussen");
  loecher.forEach((r, i) => seiten(r, i));
  return out;
}

/** Next free body id and the layer with the counter advanced. */
function neueId(layer) {
  return [`k${layer.naechsteId}`, { ...layer, naechsteId: layer.naechsteId + 1 }];
}

/**
 * New body from a closed profile (site metres) extruded by `hoehe`.
 * 107-05: the profile (with its inner rings) is checked with profilGueltig; an invalid one is REFUSED (thrown Error with
 * `grund`) — that is the path of every typed or drawn input. Import and the node graph ("Backen") pass `pruefen: false`:
 * the body is created and shows as invalid (derived marker, koerperGueltig), so nothing the planner made gets lost.
 * @param {MassingLayer} layer
 * @param {Pkt[]} profil at least 3 points, m
 * @param {number} hoehe m (> 0)
 * @param {{basis?: number, name?: string, loecher?: Pkt[][]|null, pruefen?: boolean}} [opt] basis m above ±0; loecher = inner
 *   rings in the same frame (stored only when there are some); pruefen = refuse an invalid profile (default true)
 * @returns {{layer: MassingLayer, id: string}}
 */
export function koerperAnlegen(layer, profil, hoehe, { basis = 0, name = "", loecher = null, pruefen = true } = {}) {
  if (!Array.isArray(profil) || profil.length < 3) throw new Error("Fläche braucht mindestens 3 Punkte");
  if (pruefen) {
    const pr = profilGueltig(profil, { loecher });
    if (!pr.ok) throw profilFehler(pr);
  }
  const [id, l] = neueId(layer);
  const lo = kopieLoecher(loecher);
  /** @type {Koerper} */
  const k = { id, name, profil: profil.map(kopiePkt), hoehe: runde(Math.max(0.01, hoehe)), basis, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null };
  if (lo) k.loecher = lo;
  return { id, layer: { ...l, koerper: [...l.koerper, k] } };
}

/**
 * Push/pull the top face: height changes by `delta` m (never below 1 cm). For a group instance
 * the definition changes — all instances of that number follow.
 * 107-06: `flaeche: "unten"` pushes the BOTTOM face instead: `delta` > 0 moves it down (outwards), `basis` follows and `hoehe`
 * grows by the same amount so the top edge stays (clamp 1 cm). For a group the definition height changes and EVERY instance of
 * that number moves its base by the same amount (the face of the definition moved, component rule); openings keep their place
 * in space (their sill grows with the new height below them). Review 107-06: a bottom pushed up past the sill of an opening is
 * refused (`oeffnungImWeg`) — the sill would turn negative.
 * @param {MassingLayer} layer
 * @param {string} id
 * @param {number} delta m (outwards along the face normal: up for the top, down for the bottom)
 * @param {{flaeche?: 'oben'|'unten', abgelehnt?: ((pr: {grund: string, text: string}) => void)|null}} [opt] abgelehnt hears a
 *   refusal of the bottom variant
 * @returns {MassingLayer} unchanged when refused
 */
export function pushPull(layer, id, delta, { flaeche = "oben", abgelehnt = null } = {}) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k) return layer;
  if (flaeche === "unten") {
    if (!instanzNeutral(k)) { if (abgelehnt) abgelehnt({ grund: "instanz", text: FLAECHE_TEXT.instanz }); return layer; }
    return basisZiehen(layer, k, delta, abgelehnt);
  }
  // 107-08: an instance scaled in z shows height × massstab.z — the stored height grows by delta / massstab.z, so the face moves by delta
  if (!instanzNeutral(k)) delta = delta / instanzMassstab(k).z;
  if (k.gruppe != null) {
    const d = layer.gruppen[k.gruppe];
    return { ...layer, gruppen: { ...layer.gruppen, [k.gruppe]: { ...d, hoehe: runde(Math.max(0.01, d.hoehe + delta)) } } };
  }
  return { ...layer, koerper: layer.koerper.map((x) => (x.id === id ? { ...x, hoehe: runde(Math.max(0.01, (x.hoehe || 0) + delta)) } : x)) };
}

/**
 * Move bodies by a vector (m).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} delta
 * @returns {MassingLayer}
 */
export function verschieben(layer, ids, delta) {
  const set = new Set(ids);
  return { ...layer, koerper: layer.koerper.map((k) => (set.has(k.id) ? { ...k, pos: { x: runde(k.pos.x + delta.x), y: runde(k.pos.y + delta.y) } } : k)) };
}

/** Largest number of copies of one typed array ("*n" / "/n"), a guard against a typo like "*5000". */
export const REIHE_MAX = 500;

/**
 * 107-07: the shared array core of every copy command — typed "*n" (multiplying) and "/n" (dividing) in the modeller
 * (move and rotate), the site plan blocks and the BIM studio's duplicate. Factor i means "i times the step".
 *  - `mal`:    1, 2 … n   (n copies, each one step further);
 *  - `teilen`: 1/n, 2/n … 1 (n copies dividing the one step).
 * @param {number} anzahl number of copies (rounded, clamped to 1 … REIHE_MAX)
 * @param {'mal'|'teilen'} [modus]
 * @returns {number[]} factors of the step, dimensionless
 */
export function reihenFaktoren(anzahl, modus = "mal") {
  const n = Math.max(1, Math.min(REIHE_MAX, Math.round(Number(anzahl) || 1)));
  return Array.from({ length: n }, (_, k) => (modus === "teilen" ? (k + 1) / n : k + 1));
}

/**
 * Copy bodies (Move + Ctrl), optionally as an array like SketchUp's typed "*n" / "/n":
 *  - `mal`:    n copies at delta, 2·delta … n·delta;
 *  - `teilen`: n copies evenly between original and delta (delta/n, 2·delta/n … delta).
 * Group instances stay instances of the same number (a copy of a component is the component).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} delta m
 * @param {{anzahl?: number, modus?: 'mal'|'teilen'}} [opt]
 * @returns {{layer: MassingLayer, neu: string[]}}
 */
export function kopieren(layer, ids, delta, { anzahl = 1, modus = "mal" } = {}) {
  let l = layer;
  const neu = [];
  const quellen = layer.koerper.filter((k) => ids.includes(k.id));
  // 107-07: the factors come from the shared array core (also used by rotate, site plan blocks and the BIM studio)
  for (const f of reihenFaktoren(anzahl, modus)) {
    for (const q of quellen) {
      const [id, l2] = neueId(l);
      // 107-08: a copy never takes the stored guid along (ohneGuid) — it gets its own GlobalId from its new id
      l = { ...l2, koerper: [...l2.koerper, { ...ohneGuid(q), id, pos: { x: runde(q.pos.x + delta.x * f), y: runde(q.pos.y + delta.y * f) } }] };
      neu.push(id);
    }
  }
  return { layer: l, neu };
}

/**
 * Make bodies instances of a group number. Without `nr` the next free number. The definition is
 * taken from the first body (its profile relative to its own position) — the others become
 * instances of it, keeping their position.
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {string} [nr]
 * @returns {{layer: MassingLayer, nr: string}}
 */
export function gruppeBilden(layer, ids, nr) {
  const erste = layer.koerper.find((k) => ids.includes(k.id));
  if (!erste) throw new Error("Nichts ausgewählt");
  const nummer = String(nr ?? (Math.max(0, ...Object.keys(layer.gruppen).map(Number).filter(Number.isFinite)) + 1));
  const vorhanden = layer.gruppen[nummer];
  /** @type {GruppenDefinition} */
  let def = vorhanden || (erste.gruppe != null ? layer.gruppen[erste.gruppe] : { profil: (erste.profil || []).map(kopiePkt), hoehe: erste.hoehe || 0 });
  // 107-05: a free body's inner rings move into the new definition (absent = none, so old layers stay identical)
  const lo = !vorhanden && erste.gruppe == null ? kopieLoecher(erste.loecher) : undefined;
  if (lo) def = { ...def, loecher: lo };
  const oe = !vorhanden && erste.gruppe == null ? kopieOeffnungen(erste.oeffnungen) : undefined; // 107-06: openings move along
  if (oe) def = { ...def, oeffnungen: oe };
  return {
    nr: nummer,
    layer: {
      ...layer,
      gruppen: { ...layer.gruppen, [nummer]: def },
      koerper: layer.koerper.map((k) => (ids.includes(k.id) ? (({ profil: _p, hoehe: _h, loecher: _l, oeffnungen: _o, ...rest }) => ({ ...rest, gruppe: nummer }))(k) : k)),
    },
  };
}

/**
 * Change the definition of a group number (profile in group coordinates and/or height) — every
 * instance of that number changes. 107-05: a new profile or new inner rings are checked with the shared refusal rule
 * (aenderungAblehnen: a valid definition may not become invalid, an invalid one may be repaired step by step but not made
 * worse); a refused change leaves the layer unchanged and `abgelehnt` hears why.
 * @param {MassingLayer} layer
 * @param {string} nr
 * @param {{profil?: Pkt[], hoehe?: number, loecher?: Pkt[][]|null, oeffnungen?: KoerperOeffnung[]|null}} patch loecher: null/[]
 *   removes the inner rings; oeffnungen (107-06): null/[] removes the openings, absent keeps them
 * @param {{abgelehnt?: ((pr: ProfilPruefung) => void)|null}} [opt]
 * @returns {MassingLayer}
 */
export function gruppeAendern(layer, nr, patch, { abgelehnt = null } = {}) {
  const d = layer.gruppen[nr];
  if (!d) return layer;
  const profil = (patch.profil || d.profil).map(kopiePkt);
  const lo = kopieLoecher(patch.loecher !== undefined ? patch.loecher : d.loecher);
  if (patch.profil || patch.loecher !== undefined) {
    const pr = aenderungAblehnen({ profil: d.profil, loecher: d.loecher || null }, { profil, loecher: lo || null });
    if (pr) { if (abgelehnt) abgelehnt(pr); return layer; }
  }
  /** @type {GruppenDefinition} */
  const neu = { profil, hoehe: runde(patch.hoehe ?? d.hoehe) };
  if (lo) neu.loecher = lo;
  const oe = kopieOeffnungen(patch.oeffnungen !== undefined ? patch.oeffnungen : d.oeffnungen); // 107-06
  if (oe) neu.oeffnungen = oe;
  return { ...layer, gruppen: { ...layer.gruppen, [nr]: neu } };
}

/**
 * "Eindeutig machen": the instance gets its own new group number with a copy of the definition,
 * so later changes affect only it (and copies made from it).
 * @param {MassingLayer} layer
 * @param {string} id
 * @returns {{layer: MassingLayer, nr: string|null}}
 */
export function eindeutigMachen(layer, id) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k || k.gruppe == null) return { layer, nr: null };
  const nr = String(Math.max(0, ...Object.keys(layer.gruppen).map(Number).filter(Number.isFinite)) + 1);
  const alt = layer.gruppen[k.gruppe];
  /** @type {GruppenDefinition} */
  const def = { ...alt, profil: alt.profil.map(kopiePkt) };
  const lo = kopieLoecher(alt.loecher);
  if (lo) def.loecher = lo; // 107-05: deep copy, the new number must not share the rings
  const oe = kopieOeffnungen(alt.oeffnungen);
  if (oe) def.oeffnungen = oe; // 107-06: likewise for the openings
  return { nr, layer: { ...layer, gruppen: { ...layer.gruppen, [nr]: def }, koerper: layer.koerper.map((x) => (x.id === id ? { ...x, gruppe: nr } : x)) } };
}

/**
 * Typed input after a tool step (SketchUp "VCB"): a length ("5,40", "5.4", "5,4m", "540cm"),
 * an array "*3" / "3x" / "x3", a division "/3", or two values "4;3" (x;y).
 * @param {string} text
 * @returns {{art: 'laenge', wert: number} | {art: 'mal'|'teilen', n: number} | {art: 'xy', x: number, y: number} | null}
 */
export function eingabeLesen(text) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let m = /^(?:\*|x)(\d+)$/.exec(t) || /^(\d+)x$/.exec(t);
  if (m) return { art: "mal", n: Math.max(1, Number(m[1])) };
  m = /^\/(\d+)$/.exec(t);
  if (m) return { art: "teilen", n: Math.max(1, Number(m[1])) };
  const zahl = (s) => {
    const k = /^(-?\d+(?:[.,]\d+)?)(mm|cm|m)?$/.exec(s);
    if (!k) return null;
    const v = Number(k[1].replace(",", "."));
    return k[2] === "mm" ? v / 1000 : k[2] === "cm" ? v / 100 : v;
  };
  m = /^([^;]+);([^;]+)$/.exec(t);
  if (m) { const x = zahl(m[1]), y = zahl(m[2]); return x != null && y != null ? { art: "xy", x, y } : null; }
  const v = zahl(t);
  return v != null ? { art: "laenge", wert: v } : null;
}

/**
 * A drawn line chain closes into a face when its last point comes back to its first
 * (within `fang` m) — SketchUp's "close the loop".
 * @param {Pkt[]} punkte clicked points in order
 * @param {number} [fang] snap distance in m
 * @returns {Pkt[]|null} the face polygon (without the repeated closing point) or null
 */
export function flaecheSchliessen(punkte, fang = 0.3) {
  if (!Array.isArray(punkte) || punkte.length < 4) return null;
  const a = punkte[0], z = punkte[punkte.length - 1];
  if (Math.hypot(a.x - z.x, a.y - z.y) > fang) return null;
  const poly = punkte.slice(0, -1);
  let f = 0;
  for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; f += poly[i].x * q.y - q.x * poly[i].y; }
  return Math.abs(f) / 2 > 1e-6 ? poly.map(kopiePkt) : null;
}

/**
 * Golden-ratio suggestion while drawing a rectangle-like face: given the first edge a→b and the
 * cursor, the point at distance |ab|/φ or |ab|·φ perpendicular to ab on the cursor's side,
 * whichever is closer to the cursor. Shown as a guide; the planner accepts it by snapping.
 * @param {Pkt} a
 * @param {Pkt} b
 * @param {Pkt} cursor
 * @returns {{punkt: Pkt, verhaeltnis: string}|null}
 */
export function goldenerSchnittVorschlag(a, b, cursor) {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-6) return null;
  const nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
  const seite = Math.sign((cursor.x - b.x) * nx + (cursor.y - b.y) * ny) || 1;
  /** @type {Array<[number, string]>} */
  const abstaende = [[l / PHI, "1 : φ"], [l * PHI, "φ : 1"]];
  const kandidaten = abstaende.map(([d, v]) => ({ punkt: { x: runde(b.x + nx * d * seite), y: runde(b.y + ny * d * seite) }, verhaeltnis: v }));
  return kandidaten.sort((p, q) => Math.hypot(p.punkt.x - cursor.x, p.punkt.y - cursor.y) - Math.hypot(q.punkt.x - cursor.x, q.punkt.y - cursor.y))[0];
}

/** Centroid of the resolved profiles of some bodies (m). */
export function schwerpunkt(layer, ids) {
  const pts = layer.koerper.filter((k) => ids.includes(k.id)).flatMap((k) => geometrie(layer, k).profil);
  if (!pts.length) return { x: 0, y: 0 };
  return { x: runde(pts.reduce((s, p) => s + p.x, 0) / pts.length), y: runde(pts.reduce((s, p) => s + p.y, 0) / pts.length) };
}

/**
 * Rotate bodies about a centre by `winkel` degrees (mathematically counter-clockwise in x/y = CLOCKWISE on the y-down
 * screen, see the file head and massing/koordinaten.js). The position turns about
 * the centre and the body's own rotation grows — group definitions stay untouched (an instance
 * may stand at any angle, like a SketchUp component).
 * 107-07: with `kopie: true` the bodies stay and rotated copies are added instead (Rotate + Ctrl), `anzahl`/`modus` make an
 * array like a typed "*n" / "/n": copy i turns by f_i · winkel (reihenFaktoren). Use drehKopien() for the ids of the copies.
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} zentrum site m
 * @param {number} winkel degrees
 * @param {{kopie?: boolean, anzahl?: number, modus?: 'mal'|'teilen'}} [opt]
 * @returns {MassingLayer}
 */
export function drehen(layer, ids, zentrum, winkel, { kopie = false, anzahl = 1, modus = "mal" } = {}) {
  if (kopie) return drehKopien(layer, ids, zentrum, winkel, { anzahl, modus }).layer;
  return { ...layer, koerper: layer.koerper.map((k) => (ids.includes(k.id) ? gedreht(k, zentrum, winkel) : k)) };
}

/** One body turned about `zentrum` by `winkel` degrees (position and own rotation; group definitions untouched). */
function gedreht(/** @type {Koerper} */ k, /** @type {Pkt} */ zentrum, /** @type {number} */ winkel) {
  const w = (winkel * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const dx = k.pos.x - zentrum.x, dy = k.pos.y - zentrum.y;
  return { ...k, pos: { x: runde(zentrum.x + dx * c - dy * s), y: runde(zentrum.y + dx * s + dy * c) }, drehung: runde(((k.drehung || 0) + winkel) % 360) };
}

/**
 * 107-07: rotated copies (Rotate + Ctrl, typed "*n" / "/n"): the selected bodies stay, copy i is turned by f_i · winkel about
 * `zentrum` (f from reihenFaktoren: `mal` 1, 2 … n, `teilen` 1/n … 1). Group instances stay instances of their number.
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} zentrum site m
 * @param {number} winkel degrees per step (mal) or in total (teilen)
 * @param {{anzahl?: number, modus?: 'mal'|'teilen'}} [opt]
 * @returns {{layer: MassingLayer, neu: string[]}} neu = ids of all copies, row by row
 */
export function drehKopien(layer, ids, zentrum, winkel, { anzahl = 1, modus = "mal" } = {}) {
  let l = layer;
  const neu = [];
  const quellen = layer.koerper.filter((k) => ids.includes(k.id));
  for (const f of reihenFaktoren(anzahl, modus)) {
    for (const q of quellen) {
      const [id, l2] = neueId(l);
      l = { ...l2, koerper: [...l2.koerper, { ...gedreht(ohneGuid(q), zentrum, winkel * f), id }] }; // 107-08: without the stored guid
      neu.push(id);
    }
  }
  return { layer: l, neu };
}

/**
 * Scale bodies in plan about a centre by `faktor` (> 0). Own profiles are scaled; for group
 * instances the DEFINITION is scaled — every instance of that number changes (component rule).
 * Height is not changed (that is push/pull). 107-05: inner rings scale with the profile; a scale that makes any profile
 * invalid (points closer than 1 mm, area under PROFIL_MIN_FLAECHE_M2) is refused as a whole — layer unchanged, `abgelehnt`
 * hears the first reason. Same rule as the other edits (aenderungAblehnen): a profile that was invalid before the scale does
 * not block it, unless the scale adds a fault (e.g. shrinks an edge into a double point).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} zentrum
 * @param {number} faktor
 * 107-08 (D-BK-17): with `instanz: true` only the selected INSTANCES are scaled — their `massstab` x/y grow by `faktor` and
 * their position moves about the centre; group definitions and other instances stay (default: the definition, as before).
 * @param {{abgelehnt?: ((pr: ProfilPruefung) => void)|null, instanz?: boolean}} [opt]
 * @returns {MassingLayer}
 */
export function skalieren(layer, ids, zentrum, faktor, { abgelehnt = null, instanz = false } = {}) {
  if (!(faktor > 0)) throw new Error("Faktor muss größer als 0 sein");
  if (instanz) {
    return { ...layer, koerper: layer.koerper.map((k) => {
      if (!ids.includes(k.id)) return k;
      const pos = { x: runde(zentrum.x + (k.pos.x - zentrum.x) * faktor), y: runde(zentrum.y + (k.pos.y - zentrum.y) * faktor) };
      const m = instanzMassstab(k);
      const neu = { x: runde(m.x * faktor), y: runde(m.y * faktor), z: m.z };
      const { massstab: _m, ...rest } = k;
      // scale 1 on every axis = no field (the body is stored as before 107-08)
      return neu.x === 1 && neu.y === 1 && neu.z === 1 ? { ...rest, pos } : { ...rest, pos, massstab: neu };
    }) };
  }
  const skal = (p) => ({ x: runde(p.x * faktor), y: runde(p.y * faktor) });
  const skalLoecher = (/** @type {Pkt[][]|undefined} */ l) => (Array.isArray(l) && l.length ? l.map((r) => r.map(skal)) : undefined);
  // 107-06: an opening keeps its size and its relative place on the scaled edge (u scales, width/height/sill stay)
  const skalOeffnungen = (/** @type {KoerperOeffnung[]|undefined} */ l) => (Array.isArray(l) && l.length ? l.map((o) => ({ ...o, u: runde(o.u * faktor) })) : undefined);
  const gruppen = { ...layer.gruppen };
  const erledigt = new Set();
  /** @type {ProfilPruefung|null} */
  let fehler = null;
  const pruefe = (/** @type {Pkt[]} */ vorher, /** @type {Pkt[][]|undefined} */ lv, /** @type {Pkt[]} */ nachher, /** @type {Pkt[][]|undefined} */ ln) => {
    if (fehler) return;
    fehler = aenderungAblehnen({ profil: vorher, loecher: lv || null }, { profil: nachher, loecher: ln || null });
  };
  const koerper = layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    const pos = { x: runde(zentrum.x + (k.pos.x - zentrum.x) * faktor), y: runde(zentrum.y + (k.pos.y - zentrum.y) * faktor) };
    if (k.gruppe != null) {
      if (!erledigt.has(k.gruppe) && gruppen[k.gruppe]) {
        const d = gruppen[k.gruppe];
        /** @type {GruppenDefinition} */
        const neu = { ...d, profil: d.profil.map(skal) };
        const lo = skalLoecher(d.loecher);
        if (lo) neu.loecher = lo;
        const oe = skalOeffnungen(d.oeffnungen);
        if (oe) neu.oeffnungen = oe;
        pruefe(d.profil, d.loecher, neu.profil, lo);
        gruppen[k.gruppe] = neu; erledigt.add(k.gruppe);
      }
      return { ...k, pos };
    }
    const profil = (k.profil || []).map(skal), lo = skalLoecher(k.loecher), oe = skalOeffnungen(k.oeffnungen);
    pruefe(k.profil || [], k.loecher, profil, lo);
    /** @type {Koerper} */
    const neu = lo ? { ...k, pos, profil, loecher: lo } : { ...k, pos, profil };
    if (oe) neu.oeffnungen = oe;
    return neu;
  });
  if (fehler) { if (abgelehnt) abgelehnt(fehler); return layer; }
  return { ...layer, gruppen, koerper };
}

/** Mitre limit of every path offset (pfadUmriss, ringVersatz, pfadVersatz): the offset of a corner is at most
 *  1 / 0.25 = 4 × the distance [ASSUMED, as in 98-03: keeps sharp corners from spiking; no standard behind the factor]. */
const GEHRUNG_MIN_COS = 0.25;

/**
 * "Folge mir": a rectangular cross-section (breite × hoehe, m) swept along a plan path — the
 * result is one body whose footprint is the path offset by breite/2 to both sides (mitred joins,
 * mitre limited by GEHRUNG_MIN_COS so sharp corners do not spike).
 * @param {Pkt[]} pfad at least 2 points
 * @param {number} breite m (> 0)
 * @returns {Pkt[]} footprint polygon
 */
export function pfadUmriss(pfad, breite) {
  if (!Array.isArray(pfad) || pfad.length < 2 || !(breite > 0)) throw new Error("Pfad braucht mindestens 2 Punkte und eine Breite");
  const h = breite / 2;
  const normale = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  const versatz = (seite) => pfad.map((p, i) => {
    const n1 = i > 0 ? normale(pfad[i - 1], p) : null, n2 = i < pfad.length - 1 ? normale(p, pfad[i + 1]) : null;
    const n = n1 && n2 ? { x: n1.x + n2.x, y: n1.y + n2.y } : n1 || n2;
    const l = Math.hypot(n.x, n.y) || 1;
    const cos = n1 && n2 ? Math.max(GEHRUNG_MIN_COS, (n.x / l) * n1.x + (n.y / l) * n1.y) : 1;
    const d = (h / cos) * seite;
    return { x: runde(p.x + (n.x / l) * d), y: runde(p.y + (n.y / l) * d) };
  });
  return [...versatz(1), ...versatz(-1).reverse()];
}

/**
 * Closed path without a repeated closing point (the last point dropped when it lies on the first, within 1 mm).
 * @param {Pkt[]} pfad m
 * @returns {Pkt[]}
 */
function ohneSchlusspunkt(pfad) {
  const a = pfad[0], z = pfad[pfad.length - 1];
  return pfad.length > 3 && Math.hypot(a.x - z.x, a.y - z.y) < PROFIL_DOPPELPUNKT_M ? pfad.slice(0, -1) : pfad;
}

/**
 * Offset a CLOSED path (ring) by `d` m to its left (+, the side of the normal (-dy, dx) of every edge) with mitred joins —
 * the ring logic of riegel.js (every vertex has a joint at both ends), the mitre limit of pfadUmriss.
 * @param {Pkt[]} ring m, at least 3 points
 * @param {number} d m (negative = right side)
 * @returns {Pkt[]}
 */
function ringVersatz(ring, d) {
  const n = ring.length;
  const normale = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  return ring.map((p, i) => {
    const n1 = normale(ring[(i - 1 + n) % n], p), n2 = normale(p, ring[(i + 1) % n]);
    const s = { x: n1.x + n2.x, y: n1.y + n2.y }, l = Math.hypot(s.x, s.y) || 1;
    const cos = Math.max(GEHRUNG_MIN_COS, (s.x / l) * n1.x + (s.y / l) * n1.y);
    return { x: runde(p.x + (s.x / l) * (d / cos)), y: runde(p.y + (s.y / l) * (d / cos)) };
  });
}

/**
 * Offset an OPEN path by `d` m to its left (+) — the centre line of a set-back profile step (98-03 mitre logic).
 * @param {Pkt[]} pfad m
 * @param {number} d m
 * @returns {Pkt[]}
 */
function pfadVersatz(pfad, d) {
  if (!d) return pfad.map(kopiePkt);
  const normale = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  return pfad.map((p, i) => {
    const n1 = i > 0 ? normale(pfad[i - 1], p) : null, n2 = i < pfad.length - 1 ? normale(p, pfad[i + 1]) : null;
    const s = n1 && n2 ? { x: n1.x + n2.x, y: n1.y + n2.y } : n1 || n2;
    const l = Math.hypot(s.x, s.y) || 1;
    const cos = n1 && n2 ? Math.max(GEHRUNG_MIN_COS, (s.x / l) * n1.x + (s.y / l) * n1.y) : 1;
    return { x: runde(p.x + (s.x / l) * (d / cos)), y: runde(p.y + (s.y / l) * (d / cos)) };
  });
}

/**
 * "Folge mir" along a CLOSED path (107-05): the cross-section breite runs around the ring, the result is an outer ring and
 * an inner ring (the courtyard) — one body with `loecher`. At sharp corners the inner offset folds over itself; that is
 * reported by profilGueltig on the result (grund "selbstschnitt" of the inner ring or "loch"), not hidden; a section wider
 * than the courtyard turns the inner ring inside out (an inner edge runs against its path edge; grund "selbstschnitt", ring 0).
 * @param {Pkt[]} pfad ring in m (at least 3 points; a repeated closing point is dropped)
 * @param {number} breite cross-section width in m (> 0)
 * @returns {{aussen: Pkt[], innen: Pkt[], pruefung: ProfilPruefung}} rings in m (in path order), validity of the pair
 */
export function pfadRing(pfad, breite) {
  if (!Array.isArray(pfad) || !(breite > 0)) throw new Error("Pfad braucht mindestens 3 Punkte und eine Breite");
  const ring = ohneSchlusspunkt(pfad);
  if (ring.length < 3) throw new Error("Geschlossener Pfad braucht mindestens 3 Punkte");
  const links = ringVersatz(ring, breite / 2), rechts = ringVersatz(ring, -breite / 2);
  const [aussen, innen] = Math.abs(flaecheXY(links)) >= Math.abs(flaecheXY(rechts)) ? [links, rechts] : [rechts, links];
  // every offset edge keeps the direction of its path edge; an inner edge that runs backwards has passed through the middle
  // (section wider than the courtyard) — the ring can still look clean (a square turns by 180°), so it is reported
  const n = ring.length;
  const umgeklappt = innen.some((p, i) => {
    const q = innen[(i + 1) % n], a = ring[i], b = ring[(i + 1) % n];
    return (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) <= 0;
  });
  if (umgeklappt) {
    return { aussen, innen, pruefung: { ok: false, grund: "selbstschnitt", text: "Innenring klappt um (Querschnitt breiter als der Hof)", ring: 0 } };
  }
  return { aussen, innen, pruefung: profilGueltig(aussen, { loecher: [innen] }) };
}

/** Default dimensions of the profile steps, m [ASSUMED construction rules of thumb, no standard: plinth 0.50 m high and 5 cm
 *  proud on each side, cornice 0.20 m high and 15 cm proud on each side, parapet 0.90 m high (fall protection height of most
 *  German state building codes for drops up to 12 m, the source to check is the state code of the project)]. */
export const PROFIL_STUFEN_MASSE = Object.freeze({ sockelHoehe: 0.5, sockelUeberstand: 0.05, gesimsHoehe: 0.2, gesimsUeberstand: 0.15, attikaHoehe: 0.9 });

/** Profile step templates of the Follow-me tool (id → German label, i18n key). */
export const PROFIL_VORLAGEN = Object.freeze([
  ["einfach", "Einfaches Profil"],
  ["sockel", "Sockel + Wand"],
  ["gesims", "Wand + Gesims"],
  ["attika", "Wand + Attika"],
  ["sockel-gesims", "Sockel + Wand + Gesims"],
  // review 107-05: one-sided steps — plinth and cornice project only to the outside (closed path) or to the left of the
  // path direction (open path), the inner face stays flush with the wall
  ["gesims-aussen", "Wand + Gesims (nur außen)"],
  ["sockel-gesims-aussen", "Sockel + Wand + Gesims (nur außen)"],
]);

/**
 * @typedef {{name: string, breite: number, hoehe: number, versatz?: number, basis?: number}} ProfilStufe
 *   one rectangle of a stepped Follow-me profile: width and height in m, versatz = sideways shift of its centre line in m
 *   (open path: + = left of the path direction; closed path: + = OUTWARDS, whatever the click direction — folgeMir
 *   normalises the ring first), basis = own bottom level in m (absent = stacked on the step below)
 */

/**
 * Steps of a profile template for a wall cross-section breite × hoehe (m). The total height stays `hoehe`: plinth, cornice
 * and parapet take their height from the wall, so typing "Breite;Höhe" still sets the overall size.
 * @param {string} vorlage id of PROFIL_VORLAGEN
 * @param {number} breite m
 * @param {number} hoehe m
 * @returns {ProfilStufe[]} bottom to top
 */
export function profilStufen(vorlage, breite, hoehe) {
  const M = PROFIL_STUFEN_MASSE;
  const wand = (/** @type {number} */ h) => ({ name: "Wand", breite, hoehe: runde(h) });
  const sockel = { name: "Sockel", breite: runde(breite + 2 * M.sockelUeberstand), hoehe: M.sockelHoehe };
  const gesims = { name: "Gesims", breite: runde(breite + 2 * M.gesimsUeberstand), hoehe: M.gesimsHoehe };
  // one-sided: the step is wider by ONE projection and its centre line moves by half of it to the outside (+versatz), so its
  // inner face lies on the wall's inner face: inner = -(b + Ü)/2 + Ü/2 = -b/2, outer = b/2 + Ü
  const sockelAussen = { name: "Sockel", breite: runde(breite + M.sockelUeberstand), hoehe: M.sockelHoehe, versatz: runde(M.sockelUeberstand / 2) };
  const gesimsAussen = { name: "Gesims", breite: runde(breite + M.gesimsUeberstand), hoehe: M.gesimsHoehe, versatz: runde(M.gesimsUeberstand / 2) };
  if (vorlage === "gesims-aussen") return [wand(hoehe - M.gesimsHoehe), gesimsAussen];
  if (vorlage === "sockel-gesims-aussen") return [sockelAussen, wand(hoehe - M.sockelHoehe - M.gesimsHoehe), gesimsAussen];
  if (vorlage === "sockel") return [sockel, wand(hoehe - M.sockelHoehe)];
  if (vorlage === "gesims") return [wand(hoehe - M.gesimsHoehe), gesims];
  if (vorlage === "attika") return [wand(hoehe - M.attikaHoehe), { name: "Attika", breite, hoehe: M.attikaHoehe }];
  if (vorlage === "sockel-gesims") return [sockel, wand(hoehe - M.sockelHoehe - M.gesimsHoehe), gesims];
  return [{ name: "Folge mir", breite, hoehe }];
}

/**
 * Body (or bodies) from a swept cross-section ("Folge mir").
 * 107-05: `geschlossen` sweeps around a ring (one body with an inner ring, pfadRing); `stufen` builds a stepped profile as
 * SEVERAL bodies, each one rectangle of the section stacked on the previous (basis) or set sideways (versatz) — plinth,
 * cornice, parapet. A free 3D profile along any path is not built (it needs faces, research §5). An invalid result (self-
 * intersecting outline at a sharp corner, folded inner ring) is refused with the reason (thrown Error with `grund`).
 * @param {MassingLayer} layer
 * @param {Pkt[]} pfad m
 * @param {number} breite m (single step)
 * @param {number} hoehe m (single step)
 * @param {{geschlossen?: boolean, stufen?: ProfilStufe[]|null, basis?: number}} [opt] basis = bottom of the first step, m
 * @returns {{layer: MassingLayer, id: string, ids: string[]}} id = first new body
 */
export function folgeMir(layer, pfad, breite, hoehe, { geschlossen = false, stufen = null, basis = 0 } = {}) {
  const liste = Array.isArray(stufen) && stufen.length ? stufen : [{ name: "Folge mir", breite, hoehe }];
  if (liste.some((s) => !(s.breite > 0) || !(s.hoehe > 0))) throw new Error("Höhe oder Breite reicht nicht für das Profil");
  let l = layer, z = basis;
  /** @type {string[]} */
  const ids = [];
  for (const s of liste) {
    const unten = s.basis ?? z;
    let r;
    if (geschlossen) {
      const ring = ohneSchlusspunkt(pfad);
      // review 107-05: +versatz = outwards on a closed path. ringVersatz shifts to the LEFT normal, which is the inside of a
      // ring with positive area (the outer-ring convention), so the ring is normalised first and the sign flipped — the
      // result no longer depends on the click direction. Without versatz the ring is used as clicked (unchanged result).
      const ringRoh = s.versatz ? ringVersatz(profilNormieren(ring, "aussen"), -s.versatz) : ring;
      const pr = pfadRing(ringRoh, s.breite);
      if (!pr.pruefung.ok) throw profilFehler(pr.pruefung);
      r = koerperAnlegen(l, pr.aussen, s.hoehe, { basis: runde(unten), name: s.name || "Folge mir", loecher: [pr.innen] });
    } else {
      r = koerperAnlegen(l, pfadUmriss(pfadVersatz(pfad, s.versatz || 0), s.breite), s.hoehe, { basis: runde(unten), name: s.name || "Folge mir" });
    }
    l = r.layer; ids.push(r.id);
    z = unten + s.hoehe;
  }
  return { layer: l, id: ids[0], ids };
}

/**
 * Move one corner of a body to a new site point. For a group instance the point is turned back
 * into the group's own coordinates (position and rotation undone) and the DEFINITION changes —
 * every instance of that number follows (component rule).
 * @param {MassingLayer} layer
 * @param {string} id
 * @param {number} index corner index in the STORED profile (from a resolved profile: gespeicherterEckIndex)
 * @param {Pkt} ziel site metres
 * @param {{abgelehnt?: ((pr: ProfilPruefung) => void)|null}} [opt] 107-05: called with the reason when the drag is refused
 * @returns {MassingLayer} unchanged when refused
 */
export function eckeVerschieben(layer, id, index, ziel, { abgelehnt = null } = {}) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k) return layer;
  if (!instanzNeutral(k)) { if (abgelehnt) abgelehnt(INSTANZ_ABGELEHNT); return layer; } // 107-08: corner drag works in the unscaled frame
  const w = (-(k.drehung || 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const dx = ziel.x - k.pos.x, dy = ziel.y - k.pos.y;
  const lokal = { x: runde(dx * c - dy * s), y: runde(dx * s + dy * c) };
  if (k.gruppe != null) {
    const d = layer.gruppen[k.gruppe];
    if (!d.profil[index]) return layer;
    return gruppeAendern(layer, k.gruppe, { profil: d.profil.map((p, i) => (i === index ? lokal : p)) }, { abgelehnt });
  }
  if (!k.profil?.[index]) return layer;
  // 107-05: a drag that makes a valid profile self-intersecting (or folds a corner onto a neighbour) is refused; on an
  // already-invalid profile only a drag that adds a fault is refused (repair step by step, aenderungAblehnen)
  const profil = (k.profil || []).map((p, i) => (i === index ? lokal : p));
  const pr = aenderungAblehnen({ profil: k.profil || [], loecher: k.loecher || null }, { profil, loecher: k.loecher || null });
  if (pr) { if (abgelehnt) abgelehnt(pr); return layer; }
  return { ...layer, koerper: layer.koerper.map((x) => (x.id === id ? { ...x, profil } : x)) };
}

/**
 * Ctrl + Push/Pull (SketchUp "create new starting face"): instead of stretching, a NEW body with
 * the same footprint is stacked on top (base = top of the source) — e.g. a set-back storey.
 * The new body owns its profile (also when the source is a group instance).
 * @param {MassingLayer} layer
 * @param {string} id source body
 * @param {number} hoehe height of the new body in m (> 0)
 * @returns {{layer: MassingLayer, id: string|null}}
 */
export function aufstocken(layer, id, hoehe) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k || !(hoehe > 0)) return { layer, id: null };
  const g = geometrie(layer, k);
  // 107-05: the new storey takes the courtyard along; it copies the source as it is (an invalid source stays visible as such)
  return koerperAnlegen(layer, g.profil, hoehe, { basis: runde(g.basis + g.hoehe), name: "Aufstockung", loecher: g.loecher || null, pruefen: false });
}

// ---- 107-06: faces, side push/pull, base, openings through wall-like bodies -------------------------------------------

/** |vertical component| of a 3D hit normal from which the hit is the top or the bottom face; a side face must point within the
 *  same margin of the hit's horizontal normal [ASSUMED 0.9 ≈ 25°: the faces of an extruded body are exactly vertical or
 *  horizontal, the margin only absorbs the float noise of the 3D mesh]. */
export const FLAECHE_NORMAL_SCHWELLE = 0.9;
/** Rest thickness that still counts as "pushed through" to the opposite face, m [ASSUMED 1 cm: a drag is rounded to 5 cm and
 *  typed values to the mm; a skin thinner than 1 cm left behind is a mis-measurement, not a wall]. Overshoot counts as through. */
export const DURCHBRUCH_TOL_M = 0.01;
/** How far a 3D hit may lie off the face it picks, m (review 107-06) [ASSUMED 1 cm: a hit on a real body face lies on it up to the
 *  float32 noise of the mesh (well below 1 mm at site coordinates of some hundred metres); the reveals, sill and lintel of a body
 *  opening lie at least 2 cm (lochImWand) and mostly metres away from the body face with the same normal — such a hit must not pick
 *  that face]. */
export const FLAECHE_TREFFER_TOL_M = 0.01;
/** Two depth samples of a part rectangle that differ by at most this belong to one parallel opposite face, m (1 mm = the
 *  double-point tolerance of the profile). */
const DICKE_GLEICH_M = PROFIL_DOPPELPUNKT_M;
/** Two edge directions with |sin| below this are parallel: the neighbour of a moved edge then gets a new corner (a step). */
const PARALLEL_SIN = 1e-6;

/**
 * Reasons and notes of the 107-06 face edits with their German text (key of @core/lib/i18n, EN in i18nTeile/bauteilkern-107.js).
 * `csg` is the plan's refusal of a part cut into a volume: it needs the 3D boolean of the CSG core (decision D-BK-08, plan 107-14).
 * Review 107-06: `ueberlappt` (a new opening would share area with an existing one on its entry or exit face), `oeffnungImWeg` (an
 * edit would cut through an existing opening: a step across it, the bottom pushed above its sill) and `oeffnungRaus` (note: after
 * the edit an opening no longer fits its face; it stays in the data and is marked, never moved).
 * @type {Readonly<Record<'csg'|'nichtWandartig'|'teilt'|'flach'|'umgeklappt'|'passtNicht'|'kante'|'schief'|'ueberlappt'|'oeffnungImWeg'|'oeffnungRaus'|'instanz', string>>}
 */
export const FLAECHE_TEXT = Object.freeze({
  csg: "Teil-Durchbruch im Volumen nicht verfügbar: folgt mit dem CSG-Kern (107-14, Relation „abzug“ in 107-10)",
  nichtWandartig: "Durchbruch nur durch wandartige Körper (Gegenfläche parallel zur Fläche)",
  teilt: "Durchbruch über die ganze Höhe würde den Körper teilen",
  flach: "Nachbarkante zu flach — die Ecke liefe zu weit",
  umgeklappt: "Fläche liefe über die Gegenseite hinaus",
  passtNicht: "Öffnung passt nicht in die Fläche",
  kante: "Fläche gibt es nicht mehr",
  schief: "Nachbarkante schief: Ecke neu geschnitten",
  ueberlappt: "Öffnung überschneidet eine vorhandene Öffnung",
  oeffnungImWeg: "Änderung schneidet eine vorhandene Öffnung",
  oeffnungRaus: "Eine Öffnung passt danach nicht mehr in ihre Fläche (markiert)",
  // 107-08: the face edits work in the unscaled frame of the body/definition; on a mirrored or scaled instance they are refused
  instanz: "Instanz ist gespiegelt oder skaliert — erst Spiegelung/Maßstab zurücksetzen",
});

/**
 * @typedef {{koerperId: string, art: 'oben'|'unten', z: number}} DeckWahl  top or bottom face picked (z = its height, m)
 * @typedef {{koerperId: string, art: 'seite', ring: 'aussen'|number, kante: number, a: Pkt, b: Pkt, z0: number, z1: number, normale: Pkt,
 *   u: number, v: number}} SeitenWahl  side `kante` of `ring` (index in the normalised order of flaechen()); u = hit along a→b
 *   from a (m), v = hit height above the body bottom (m), normale = outward unit vector in plan
 * @typedef {DeckWahl|SeitenWahl} FlaechenWahl
 */

/** Distance of a plan point to the segment a→b, m. */
function abstandStrecke(/** @type {Pkt} */ p, /** @type {Pkt} */ a, /** @type {Pkt} */ b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Face of a body under a 3D hit (spec I.2 push/pull along the face normal). The hit normal decides top/bottom (vertical part
 * ≥ FLAECHE_NORMAL_SCHWELLE) or side; a side is the face of flaechen() whose outward normal matches and whose edge lies nearest
 * to the hit point — the derived faces of 107-05 are the only face model (no second one).
 * Review 107-06: the hit point must LIE on the face (within FLAECHE_TREFFER_TOL_M: a side by its distance to the edge and its
 * height between z0 and z1, top/bottom by its height). A hit on a reveal, sill or lintel of a body opening belongs to no face of
 * flaechen() and gives null — before, the reveal picked the end face and the sill the top face of the whole body.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @param {{x: number, y: number, z: number}} punkt hit in site metres (x/y plan, z height above ±0)
 * @param {{x: number, y: number, z: number}} normale hit normal (any length; x/y plan, z up), pointing out of the body
 * @returns {FlaechenWahl|null} null when no face carries the hit
 */
export function flaecheWaehlen(layer, k, punkt, normale) {
  if (!k || !punkt || !normale) return null;
  const fl = flaechen(layer, k);
  const laenge = Math.hypot(Number(normale.x) || 0, Number(normale.y) || 0, Number(normale.z) || 0) || 1;
  const nz = (Number(normale.z) || 0) / laenge;
  const pz = Number(punkt.z) || 0;
  if (Math.abs(nz) >= FLAECHE_NORMAL_SCHWELLE) {
    const f = /** @type {DeckFlaeche} */ (fl.find((x) => x.art === (nz > 0 ? "deckel" : "boden")));
    if (Math.abs(pz - f.z) > FLAECHE_TREFFER_TOL_M) return null;
    return { koerperId: k.id, art: nz > 0 ? "oben" : "unten", z: f.z };
  }
  const h = Math.hypot(normale.x, normale.y) || 1, n = { x: normale.x / h, y: normale.y / h };
  /** @type {SeitenFlaeche|null} */
  let best = null;
  let bestD = Infinity;
  for (const f of fl) {
    if (f.art !== "seite" || f.normale.x * n.x + f.normale.y * n.y < FLAECHE_NORMAL_SCHWELLE) continue;
    if (pz < f.z0 - FLAECHE_TREFFER_TOL_M || pz > f.z1 + FLAECHE_TREFFER_TOL_M) continue;
    const d = abstandStrecke(punkt, f.a, f.b);
    if (d <= FLAECHE_TREFFER_TOL_M && d < bestD - 1e-9) { bestD = d; best = f; }
  }
  if (!best) return null;
  const L = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y) || 1;
  const u = Math.min(L, Math.max(0, ((punkt.x - best.a.x) * (best.b.x - best.a.x) + (punkt.y - best.a.y) * (best.b.y - best.a.y)) / L));
  const v = Math.min(best.z1 - best.z0, Math.max(0, (Number(punkt.z) || 0) - best.z0));
  return { koerperId: k.id, art: "seite", ring: best.ring, kante: best.kante, a: best.a, b: best.b, z0: best.z0, z1: best.z1, normale: best.normale, u: runde(u), v: runde(v) };
}

/** The object that holds profile, holes and openings of a body: its group definition or the body itself (null: missing definition). */
function quelleVon(/** @type {MassingLayer} */ layer, /** @type {Koerper} */ k) {
  return k.gruppe != null ? layer.gruppen[k.gruppe] || null : k;
}

/**
 * A ring of the source in the orientation convention (outer positive, inner negative — the order of geometrie()/flaechen(),
 * without the instance transform) and the way back to the stored order (umkehren is its own inverse and keeps corner 0 first).
 * @param {{profil?: Pkt[], loecher?: Pkt[][]}} quelle
 * @param {'aussen'|number} ring
 * @returns {{ring: Pkt[], zurueck: (r: Pkt[]) => Pkt[], roh: Pkt[], umgekehrt: boolean}|null} roh = the stored ring
 */
function ringLokal(quelle, ring) {
  const roh = ring === "aussen" ? quelle.profil || [] : (quelle.loecher || [])[ring];
  if (!Array.isArray(roh) || roh.length < 3) return null;
  const f = flaecheXY(roh);
  const umgekehrt = ring === "aussen" ? f < 0 : f > 0;
  return { ring: umgekehrt ? umkehren(roh) : roh.slice(), zurueck: (r) => (umgekehrt ? umkehren(r) : r), roh, umgekehrt };
}

/**
 * Change the STORED openings of a source with a function that works in the normalised edge order (review 107-06: openings are
 * stored in the stored order, the edits work on the normalised ring).
 * @param {KoerperOeffnung[]|undefined} liste stored openings
 * @param {{roh: Pkt[], umgekehrt: boolean}} lok ringLokal() of the outer ring BEFORE the edit
 * @param {Pkt[]} nachher normalised outer ring AFTER the edit (the ring the new indices refer to)
 * @param {(l: KoerperOeffnung[]) => KoerperOeffnung[]|undefined} fn renumbering in the normalised order
 * @returns {KoerperOeffnung[]|undefined}
 */
function oeffnungenNormiertAendern(liste, lok, nachher, fn) {
  if (!Array.isArray(liste) || !liste.length) return liste;
  const neu = fn(lok.umgekehrt ? liste.map((o) => oeffnungWenden(o, lok.roh)) : liste) || [];
  return lok.umgekehrt ? neu.map((o) => oeffnungWenden(o, nachher)) : neu;
}

/**
 * True when an opening of body `id` that fitted before the edit no longer fits after it (oeffnungenPruefen) — the edit stays, the
 * opening stays in the data and is marked; the caller hears the note `oeffnungRaus`.
 * @param {MassingLayer} vorher
 * @param {MassingLayer} nachher
 * @param {string} id
 * @returns {boolean}
 */
function oeffnungVerloren(vorher, nachher, id) {
  const k0 = vorher.koerper.find((x) => x.id === id), k1 = nachher.koerper.find((x) => x.id === id);
  if (!k0 || !k1) return false;
  const alt = oeffnungenPruefen(vorher, k0), neu = oeffnungenPruefen(nachher, k1);
  return alt.some((p, i) => p.ok && neu[i] && !neu[i].ok);
}

/**
 * Write profile, holes and openings back to the source of a body (definition or own fields); empty lists drop the field so a
 * body without holes/openings keeps its old shape.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @param {{profil: Pkt[], loecher?: Pkt[][]|null, oeffnungen?: KoerperOeffnung[]|null}} teile
 * @returns {MassingLayer}
 */
function quelleSchreiben(layer, k, { profil, loecher, oeffnungen }) {
  const setze = (/** @type {any} */ alt) => {
    const neu = { ...alt, profil };
    if (Array.isArray(loecher) && loecher.length) neu.loecher = loecher; else delete neu.loecher;
    if (Array.isArray(oeffnungen) && oeffnungen.length) neu.oeffnungen = oeffnungen; else delete neu.oeffnungen;
    return neu;
  };
  if (k.gruppe != null) return { ...layer, gruppen: { ...layer.gruppen, [k.gruppe]: setze(layer.gruppen[k.gruppe]) } };
  return { ...layer, koerper: layer.koerper.map((x) => (x.id === k.id ? setze(x) : x)) };
}

/**
 * @typedef {{ring: Pkt[], kanten: Array<number|null>, schief: boolean, versatzA: number, versatzB: number}} KantenVersatz
 *   kanten[j] = index of the old edge that new edge j continues (null = a new step edge); versatzA = how far the start corner of the
 *   moved edge slid along it (m), versatzB = how far its end corner slid along the following edge (m) — both keep openings in place
 */

/**
 * Move edge i of a normalised ring by d along its outward normal (logic of polygonKante.verschiebeKante, 75-03, plus the
 * intersection mode left open there): a neighbour edge keeps its direction and the shared corner is re-intersected with it; a
 * neighbour parallel to the edge (a split edge) keeps its corner and a new corner makes a step. A neighbour flatter than the
 * mitre limit (|sin| < GEHRUNG_MIN_COS, the corner would travel more than 4 × d) is refused.
 * @param {Pkt[]} ring normalised (outer positive or inner negative), m
 * @param {number} i edge index
 * @param {number} d m, positive = outwards
 * @returns {KantenVersatz|{fehler: 'kante'|'flach'}}
 */
function kanteVersetzen(ring, i, d) {
  const n = ring.length, j = (i + 1) % n;
  const A = ring[i], B = ring[j], P = ring[(i - 1 + n) % n], Q = ring[(j + 1) % n];
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  if (!(L > PROFIL_DOPPELPUNKT_M)) return { fehler: "kante" };
  const e = { x: (B.x - A.x) / L, y: (B.y - A.y) / L }, nr = { x: e.y, y: -e.x }; // nr = outward normal (same formula as flaechen)
  const einheit = (/** @type {Pkt} */ p, /** @type {Pkt} */ q) => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; };
  const ep = einheit(P, A), en = einheit(B, Q);
  const weiter = (/** @type {Pkt} */ p) => ({ x: p.x + nr.x * d, y: p.y + nr.y * d });
  const sinA = ep.x * nr.x + ep.y * nr.y, sinB = en.x * nr.x + en.y * nr.y; // component along the normal = ± sin of the corner angle
  const parA = Math.abs(sinA) < PARALLEL_SIN, parB = Math.abs(sinB) < PARALLEL_SIN;
  if ((!parA && Math.abs(sinA) < GEHRUNG_MIN_COS) || (!parB && Math.abs(sinB) < GEHRUNG_MIN_COS)) return { fehler: "flach" };
  const sA = parA ? 0 : d / sinA, sB = parB ? 0 : d / sinB;
  const neuA = { x: A.x + ep.x * sA, y: A.y + ep.y * sA }, neuB = { x: B.x + en.x * sB, y: B.y + en.y * sB };
  /** @type {Array<{p: Pkt, k: number|null}>} */
  const out = [];
  /** @type {{p: Pkt, k: number|null}|null} */
  let anhang = null;
  for (let k = 0; k < n; k++) {
    if (k === i) {
      if (parA) out.push({ p: A, k: null }, { p: weiter(A), k: i }); else out.push({ p: neuA, k: i });
    } else if (k === j) {
      if (parB) {
        // the step edge B'→B comes before B; for B = corner 0 it goes to the end so corner 0 stays first
        if (j === 0) { out.push({ p: B, k: j }); anhang = { p: weiter(B), k: null }; } else out.push({ p: weiter(B), k: null }, { p: B, k: j });
      } else out.push({ p: neuB, k: j });
    } else out.push({ p: ring[k], k });
  }
  if (anhang) out.push(anhang);
  const schief = (!parA && Math.abs(ep.x * e.x + ep.y * e.y) > PARALLEL_SIN) || (!parB && Math.abs(en.x * e.x + en.y * e.y) > PARALLEL_SIN);
  return { ring: out.map((x) => x.p), kanten: out.map((x) => x.k), schief, versatzA: sA * (ep.x * e.x + ep.y * e.y), versatzB: sB };
}

/**
 * True when a moved ring turned inside out (a face pushed past its opposite face: the ring is still simple, but its orientation
 * flipped — profilGueltig would accept it, because the orientation is normalised on reading).
 * @param {Pkt[]} ring normalised ring after the move
 * @param {'aussen'|number} rolle outer ring (must stay positive) or inner ring (must stay negative)
 * @returns {boolean}
 */
function ringUmgeklappt(ring, rolle) {
  const f = flaecheXY(ring);
  return rolle === "aussen" ? !(f > 0) : !(f < 0);
}

/**
 * Renumber openings after kanteVersetzen: an opening follows its edge to the new index and keeps its place in space (the moved
 * edge loses versatzA at its start, the following edge versatzB).
 * @param {KoerperOeffnung[]|undefined} liste
 * @param {KantenVersatz} r
 * @param {number} kante index of the moved edge before the move
 * @returns {KoerperOeffnung[]|undefined}
 */
function oeffnungenUmnummern(liste, r, kante) {
  if (!Array.isArray(liste) || !liste.length) return liste;
  const nAlt = r.kanten.filter((x) => x != null).length;
  return liste.map((o) => {
    const neu = r.kanten.indexOf(o.kante);
    if (neu < 0) return o;
    const u = o.kante === kante ? o.u - r.versatzA : o.kante === (kante + 1) % nAlt ? o.u - r.versatzB : o.u;
    return { ...o, kante: neu, u: runde(u) };
  });
}

/**
 * Split edge i of a ring at the given distances from its start corner (no change of shape); openings on the edge move to the
 * part their middle lies on (teilflaecheDruecken refuses a cut through an opening before it gets here).
 * @param {Pkt[]} ring
 * @param {number} i
 * @param {number[]} schnitte ascending, strictly inside the edge, m
 * @returns {{ring: Pkt[], umnummern: (o: KoerperOeffnung) => KoerperOeffnung}}
 */
function kanteTeilen(ring, i, schnitte) {
  const n = ring.length, A = ring[i], B = ring[(i + 1) % n];
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1, e = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const pkt = schnitte.map((u) => ({ x: A.x + e.x * u, y: A.y + e.y * u }));
  const s = schnitte.length;
  return {
    ring: [...ring.slice(0, i + 1), ...pkt, ...ring.slice(i + 1)],
    umnummern: (o) => {
      if (o.kante > i) return { ...o, kante: o.kante + s };
      if (o.kante < i) return o;
      let teil = 0, start = 0;
      schnitte.forEach((u, t) => { if (o.u > u) { teil = t + 1; start = u; } });
      return { ...o, kante: i + teil, u: runde(o.u - start) };
    },
  };
}

/**
 * Push/pull a SIDE face (spec I.2, BK-04): edge `kante` of a ring moves by `d` along its outward normal; neighbour edges keep
 * their direction (corners re-intersected), a parallel neighbour gets a step. Works in the body's own frame, so a rotated
 * instance moves the face along its own normal; for a group instance the DEFINITION changes (all instances follow). The new
 * profile goes through the shared refusal rule of 107-05 (aenderungAblehnen); openings follow their edges.
 * @param {MassingLayer} layer
 * @param {string} id body
 * @param {number} kante edge index in the normalised ring (flaechen()/flaecheWaehlen())
 * @param {number} d m, positive = outwards (the body grows)
 * @param {{ring?: 'aussen'|number, abgelehnt?: ((pr: {grund?: string, text?: string}) => void)|null, hinweis?: ((h: {grund: string, text: string}) => void)|null}} [opt]
 *   ring: outer ring or the index of an inner ring (a courtyard face); abgelehnt hears the reason of a refusal; hinweis hears
 *   "schief" when a skew neighbour corner was re-intersected (the neighbour keeps its direction, its length changes) and
 *   "oeffnungRaus" when an opening no longer fits its shortened face (review 107-06: reported, not moved)
 * @returns {MassingLayer} unchanged when refused
 */
export function seiteVerschieben(layer, id, kante, d, { ring = "aussen", abgelehnt = null, hinweis = null } = {}) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k || !Number.isFinite(d) || d === 0) return layer;
  const q = quelleVon(layer, k);
  const lok = q ? ringLokal(q, ring) : null;
  /** @param {'kante'|'flach'|'umgeklappt'} grund */
  const melde = (grund) => { if (abgelehnt) abgelehnt({ grund, text: FLAECHE_TEXT[grund] }); return layer; };
  if (!q || !lok || !(kante >= 0 && kante < lok.ring.length)) return melde("kante");
  if (!instanzNeutral(k)) { if (abgelehnt) abgelehnt({ grund: "instanz", text: FLAECHE_TEXT.instanz }); return layer; } // 107-08
  const r = kanteVersetzen(lok.ring, kante, d);
  if ("fehler" in r) return melde(r.fehler);
  if (ringUmgeklappt(r.ring, ring)) return melde("umgeklappt");
  const neuRing = lok.zurueck(r.ring.map(kopiePkt));
  const profil = ring === "aussen" ? neuRing : q.profil || [];
  const loecher = ring === "aussen" ? q.loecher : (q.loecher || []).map((x, i) => (i === ring ? neuRing : x));
  const pr = aenderungAblehnen({ profil: q.profil || [], loecher: q.loecher || null }, { profil, loecher: loecher || null });
  if (pr) { if (abgelehnt) abgelehnt(pr); return layer; }
  if (r.schief && hinweis) hinweis({ grund: "schief", text: FLAECHE_TEXT.schief });
  const oeffnungen = ring === "aussen" ? oeffnungenNormiertAendern(q.oeffnungen, lok, r.ring, (l) => oeffnungenUmnummern(l, r, kante)) : q.oeffnungen;
  const neu = quelleSchreiben(layer, k, { profil, loecher, oeffnungen });
  if (hinweis && oeffnungVerloren(layer, neu, id)) hinweis({ grund: "oeffnungRaus", text: FLAECHE_TEXT.oeffnungRaus });
  return neu;
}

/**
 * Bottom variant of pushPull (107-06): base down by the clamped delta, height up by the same, sill of openings with it.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @param {number} delta m, positive = down
 * @param {((pr: {grund: string, text: string}) => void)|null} [abgelehnt]
 * @returns {MassingLayer}
 */
function basisZiehen(layer, k, delta, abgelehnt = null) {
  const def = k.gruppe != null ? layer.gruppen[k.gruppe] : null;
  if (k.gruppe != null && !def) return layer;
  const h0 = def ? def.hoehe : k.hoehe || 0;
  const h1 = runde(Math.max(0.01, h0 + delta));
  const dd = runde(h1 - h0); // what really happens after the 1 cm clamp
  if (!dd) return layer;
  const liste = def ? def.oeffnungen : k.oeffnungen;
  if (Array.isArray(liste) && liste.some((o) => (Number(o.sill) || 0) + dd < -1e-6)) {
    if (abgelehnt) abgelehnt({ grund: "oeffnungImWeg", text: FLAECHE_TEXT.oeffnungImWeg });
    return layer;
  }
  const oe = (/** @type {KoerperOeffnung[]|undefined} */ l) => (Array.isArray(l) && l.length ? l.map((o) => ({ ...o, sill: runde(o.sill + dd) })) : undefined);
  if (def) {
    /** @type {GruppenDefinition} */
    const nd = { ...def, hoehe: h1 };
    const o = oe(def.oeffnungen);
    if (o) nd.oeffnungen = o;
    return { ...layer, gruppen: { ...layer.gruppen, [String(k.gruppe)]: nd }, koerper: layer.koerper.map((x) => (x.gruppe === k.gruppe ? { ...x, basis: runde((x.basis || 0) - dd) } : x)) };
  }
  return {
    ...layer,
    koerper: layer.koerper.map((x) => {
      if (x.id !== k.id) return x;
      /** @type {Koerper} */
      const n = { ...x, hoehe: h1, basis: runde((x.basis || 0) - dd) };
      const o = oe(x.oeffnungen);
      if (o) n.oeffnungen = o;
      return n;
    }),
  };
}

/**
 * @typedef {{tiefe: number, wandartig: boolean, austritt: {ring: 'aussen'|number, kante: number, u0: number, u1: number}}} Durchgang
 *   tiefe = body depth behind the part of the edge (smallest sample, m); wandartig = the three samples leave through ONE opposite
 *   edge, antiparallel to the entry edge, at the same depth (a hole through it is a straight tunnel); austritt = that edge and the
 *   positions of the first and last sample along it from its start corner (m)
 */

/**
 * Depth of a body behind the part u0…u1 of edge `kante` of its outer ring, measured along the inward normal at three samples
 * (ends slightly inset, middle) against every edge of every ring.
 * @param {Pkt[]} profil normalised outer ring, m
 * @param {Pkt[][]} loecher normalised inner rings, m
 * @param {number} kante
 * @param {number} u0 m from the start corner
 * @param {number} u1 m
 * @returns {Durchgang|null} null when a sample leaves through nothing (broken profile)
 */
function durchgangMessen(profil, loecher, kante, u0, u1) {
  const n = profil.length, a = profil[kante], b = profil[(kante + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(L > 0)) return null;
  const e = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, nr = { x: e.y, y: -e.x }, dir = { x: -nr.x, y: -nr.y };
  /** @type {Array<{name: 'aussen'|number, r: Pkt[]}>} */
  const ringe = [{ name: "aussen", r: profil }, ...loecher.map((r, i) => ({ name: i, r }))];
  const rand = Math.min(PROFIL_DOPPELPUNKT_M, Math.max(0, (u1 - u0) / 4));
  /** @type {Array<{t: number, ring: 'aussen'|number, kante: number, w: number, nf: Pkt}>} */
  const treffer = [];
  for (const u of [u0 + rand, (u0 + u1) / 2, u1 - rand]) {
    const s = { x: a.x + e.x * u, y: a.y + e.y * u };
    /** @type {{t: number, ring: 'aussen'|number, kante: number, w: number, nf: Pkt}|null} */
    let best = null;
    for (const { name, r } of ringe) {
      for (let j = 0; j < r.length; j++) {
        if (name === "aussen" && j === kante) continue;
        const p = r[j], q = r[(j + 1) % r.length], f = { x: q.x - p.x, y: q.y - p.y };
        const den = dir.x * f.y - dir.y * f.x;
        if (Math.abs(den) < 1e-12) continue;
        const ps = { x: p.x - s.x, y: p.y - s.y };
        const t = (ps.x * f.y - ps.y * f.x) / den, v = (ps.x * dir.y - ps.y * dir.x) / den;
        if (t <= 1e-9 || v < -1e-9 || v > 1 + 1e-9) continue;
        const lf = Math.hypot(f.x, f.y) || 1;
        if (!best || t < best.t) best = { t, ring: name, kante: j, w: v * lf, nf: { x: f.y / lf, y: -f.x / lf } };
      }
    }
    if (!best) return null;
    treffer.push(best);
  }
  const t0 = treffer[0];
  const wandartig = treffer.every((x) => x.ring === t0.ring && x.kante === t0.kante && Math.abs(x.t - t0.t) <= DICKE_GLEICH_M)
    && t0.nf.x * nr.x + t0.nf.y * nr.y <= -(1 - 1e-6);
  return { tiefe: runde(Math.min(...treffer.map((x) => x.t))), wandartig, austritt: { ring: t0.ring, kante: t0.kante, u0: runde(treffer[0].w), u1: runde(treffer[2].w) } };
}

/**
 * @typedef {{index: number, oeffnung: KoerperOeffnung, ok: true, grund: null, text: null, a: Pkt, b: Pkt, laenge: number,
 *   masse: {w: number, h: number, sill: number, sturz: number}, mitte: number, durchgang: Durchgang}} OeffnungGut
 *   oeffnung: the entry in the NORMALISED edge order (geometrie()), a: start, b: end of the entry edge (resolved, site m), laenge m,
 *   masse = oeffnungsMasse (m), mitte = middle along the edge (m, = the stored u: an opening outside the edge clearance is
 *   reported, not moved), durchgang = the tunnel through the body
 * @typedef {{index: number, oeffnung: KoerperOeffnung, ok: false, grund: string, text: string}} OeffnungSchlecht
 * @typedef {OeffnungGut|OeffnungSchlecht} OeffnungsPruefung
 * @typedef {{ring: 'aussen'|number, kante: number, u0: number, u1: number, v0: number, v1: number}} FlaechenRechteck  rectangle on a
 *   side face: ring/edge in the normalised order, u0…u1 along the edge from its start corner, v0…v1 above the body bottom (m)
 */

/**
 * The two rectangles an opening occupies on the body faces: where it enters and where it leaves (review 107-06, overlap check).
 * On a wall-like body the exit edge runs antiparallel to the entry edge, so the middle sample of durchgangMessen is the exit middle.
 * @param {number} kante entry edge (normalised)
 * @param {number} mitte middle along the entry edge, m
 * @param {{w: number, h: number, sill: number}} masse m
 * @param {Durchgang} durchgang
 * @returns {FlaechenRechteck[]}
 */
function oeffnungsRechtecke(kante, mitte, masse, durchgang) {
  const v0 = masse.sill, v1 = masse.sill + masse.h, c = (durchgang.austritt.u0 + durchgang.austritt.u1) / 2;
  return [
    { ring: "aussen", kante, u0: mitte - masse.w / 2, u1: mitte + masse.w / 2, v0, v1 },
    { ring: durchgang.austritt.ring, kante: durchgang.austritt.kante, u0: c - masse.w / 2, u1: c + masse.w / 2, v0, v1 },
  ];
}

/** Do two sets of face rectangles share area on one face (more than 1 mm on both axes, like lochUeberlappt of the slab holes)? */
const rechteckeUeberlappen = (/** @type {FlaechenRechteck[]} */ A, /** @type {FlaechenRechteck[]} */ B) => A.some((a) => B.some((b) =>
  a.ring === b.ring && a.kante === b.kante && Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) > 1e-3 && Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0) > 1e-3));

/**
 * Check every opening of a body against its CURRENT geometry (derived on every read, never stored, like koerperGueltig): the
 * edge still exists, the opening fits into the face (oeffnungPasst, the wall rule of 107-04) at its stored place (inside the
 * edge clearance — review 107-06: no clamping, an opening that slid off its shortened edge is reported where it is), the body is
 * wall-like behind it, and it shares no area with an earlier opening on its entry or exit face (`ueberlappt`: two voids of one
 * hole would break the 3D hole shape and void the IFC proxy twice; the earlier one stays valid).
 * An opening that stopped fitting after a later edit stays in the data and is reported, never silently dropped or moved.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {OeffnungsPruefung[]} one entry per stored opening, in stored order
 */
export function oeffnungenPruefen(layer, k) {
  const g = geometrie(layer, k);
  const n = g.profil.length;
  /** @type {FlaechenRechteck[][]} */
  const belegt = [];
  return (g.oeffnungen || []).map((o, index) => {
    /** @param {'kante'|'passtNicht'|'nichtWandartig'|'ueberlappt'} grund @returns {OeffnungSchlecht} */
    const fehler = (grund) => ({ index, oeffnung: o, ok: false, grund, text: FLAECHE_TEXT[grund] });
    if (!(Number.isInteger(o?.kante) && o.kante >= 0 && o.kante < n)) return fehler("kante");
    const a = g.profil[o.kante], b = g.profil[(o.kante + 1) % n], laenge = Math.hypot(b.x - a.x, b.y - a.y);
    const masse = oeffnungsMasse(o);
    if (!oeffnungPasst(masse, laenge, g.hoehe).ok) return fehler("passtNicht");
    const mitte = Number(o.u);
    if (!Number.isFinite(mitte) || Math.abs(oeffnungMitte_m(mitte, masse.w, laenge) - mitte) > 1e-6) return fehler("passtNicht");
    const durchgang = durchgangMessen(g.profil, g.loecher || [], o.kante, mitte - masse.w / 2, mitte + masse.w / 2);
    if (!durchgang || !durchgang.wandartig) return fehler("nichtWandartig");
    const rechtecke = oeffnungsRechtecke(o.kante, mitte, masse, durchgang);
    if (belegt.some((r) => rechteckeUeberlappen(r, rechtecke))) return fehler("ueberlappt");
    belegt.push(rechtecke);
    /** @type {OeffnungGut} */
    const gut = { index, oeffnung: o, ok: true, grund: null, text: null, a, b, laenge, masse, mitte, durchgang };
    return gut;
  });
}

/**
 * @typedef {{kante: number, u: number, width: number, height: number, sill: number}} TeilRechteck  part rectangle of an outer side
 *   face: kante (normalised index), u = middle along the edge (m), width/height (m), sill = bottom above the body bottom (m)
 */

/**
 * Push/pull a PART rectangle of an outer side face (spec I.2 auto-cut, IV push through, BK-05/BK-64). Without a 3D boolean the
 * outcome depends on the rectangle:
 *  - the whole face → seiteVerschieben (art "seite");
 *  - the full height, part of the width → a step in the profile (edge split, middle part moved; art "profil");
 *  - part of the height pushed INTO a wall-like body until the rest thickness ≤ DURCHBRUCH_TOL_M → an entry in `oeffnungen`
 *    (art "oeffnung"), the geometry is not touched (3D draws the hole, IFC writes IfcOpeningElement + IfcRelVoidsElement);
 *  - part of the height pushed in but not through (a pocket), or through a body that is not wall-like → refused (FLAECHE_TEXT.csg
 *    / nichtWandartig): a cut into a volume needs the CSG core (107-14);
 *  - part of the height pulled OUT → a new free body in front of the face (art "anbau"; joined only visually, no union).
 * A cut through the full height would split the body and is refused (teilt). Group instances change their definition.
 * Review 107-06: a new opening sits at the place the export uses (u kept inside the edge clearance, oeffnungMitte_m) and is stored
 * in the stored edge order; one that would share area with an existing opening on its entry or exit face is refused (ueberlappt),
 * as is a step whose cut runs through an existing opening (oeffnungImWeg); hinweis hears `oeffnungRaus` when a step leaves an
 * opening without room on its edge.
 * @param {MassingLayer} layer
 * @param {string} id
 * @param {TeilRechteck} teil
 * @param {number} d m, positive = outwards, negative = into the body
 * @param {{abgelehnt?: ((pr: {grund?: string, text?: string}) => void)|null, hinweis?: ((h: {grund: string, text: string}) => void)|null}} [opt]
 * @returns {{layer: MassingLayer, art: 'seite'|'profil'|'oeffnung'|'anbau'|null, id?: string}} art null = nothing changed
 */
export function teilflaecheDruecken(layer, id, teil, d, { abgelehnt = null, hinweis = null } = {}) {
  /** @type {{layer: MassingLayer, art: null}} */
  const nichts = { layer, art: null };
  const k = layer.koerper.find((x) => x.id === id);
  if (!k || !teil || !Number.isFinite(d) || d === 0) return nichts;
  /** @param {'kante'|'flach'|'umgeklappt'|'csg'|'nichtWandartig'|'teilt'|'passtNicht'|'ueberlappt'|'oeffnungImWeg'} grund */
  const melde = (grund) => { if (abgelehnt) abgelehnt({ grund, text: FLAECHE_TEXT[grund] }); return nichts; };
  if (!instanzNeutral(k)) { if (abgelehnt) abgelehnt({ grund: "instanz", text: FLAECHE_TEXT.instanz }); return nichts; } // 107-08
  const g = geometrie(layer, k);
  const n = g.profil.length;
  if (!(Number.isInteger(teil.kante) && teil.kante >= 0 && teil.kante < n)) return melde("kante");
  const a = g.profil[teil.kante], b = g.profil[(teil.kante + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y), H = g.hoehe;
  const w = Math.min(Math.max(0, teil.width), L);
  const u = Math.min(Math.max(teil.u, w / 2), L - w / 2), u0 = u - w / 2, u1 = u + w / 2;
  const sill = Math.max(0, teil.sill), oben = Math.min(H, teil.sill + teil.height);
  if (!(w > 0) || !(oben > sill)) return melde("passtNicht");
  const eps = PROFIL_DOPPELPUNKT_M;
  const volleBreite = u0 <= eps && u1 >= L - eps, volleHoehe = sill <= eps && oben >= H - eps;
  if (volleBreite && volleHoehe) {
    const l = seiteVerschieben(layer, id, teil.kante, d, { abgelehnt, hinweis });
    return { layer: l, art: l === layer ? null : "seite" };
  }
  const durch = durchgangMessen(g.profil, g.loecher || [], teil.kante, u0, u1);
  const durchgestossen = d < 0 && !!durch && -d >= durch.tiefe - DURCHBRUCH_TOL_M;
  const q = /** @type {{profil?: Pkt[], loecher?: Pkt[][], oeffnungen?: KoerperOeffnung[]}} */ (quelleVon(layer, k));
  if (durchgestossen && volleHoehe) return melde("teilt");
  if (volleHoehe) {
    // a part of the edge over the full height: split the edge, move the middle part — a 2D step in the profile, no boolean
    const lok = ringLokal(q, "aussen");
    if (!lok) return melde("kante");
    const schnitte = [u0, u1].filter((x) => x > eps && x < L - eps);
    // a cut through an opening (entry or exit on this edge, with its edge clearance) would leave it hanging over a new corner
    const imWeg = oeffnungenPruefen(layer, k).some((p) => p.ok && oeffnungsRechtecke(p.oeffnung.kante, p.mitte, p.masse, p.durchgang)
      .some((rr) => rr.ring === "aussen" && rr.kante === teil.kante && schnitte.some((c) => c > rr.u0 - OEFFNUNG_RAND_M && c < rr.u1 + OEFFNUNG_RAND_M)));
    if (imWeg) return melde("oeffnungImWeg");
    const geteilt = kanteTeilen(lok.ring, teil.kante, schnitte);
    const ziel = teil.kante + (u0 > eps ? 1 : 0);
    const r = kanteVersetzen(geteilt.ring, ziel, d);
    if ("fehler" in r) return melde(r.fehler);
    if (ringUmgeklappt(r.ring, "aussen")) return melde("umgeklappt");
    const profil = lok.zurueck(r.ring.map(kopiePkt));
    const pr = aenderungAblehnen({ profil: q.profil || [], loecher: q.loecher || null }, { profil, loecher: q.loecher || null });
    if (pr) { if (abgelehnt) abgelehnt(pr); return nichts; }
    const oe = oeffnungenNormiertAendern(q.oeffnungen, lok, r.ring, (l) => oeffnungenUmnummern(l.map(geteilt.umnummern), r, ziel));
    const neu = quelleSchreiben(layer, k, { profil, loecher: q.loecher, oeffnungen: oe });
    if (hinweis && oeffnungVerloren(layer, neu, id)) hinweis({ grund: "oeffnungRaus", text: FLAECHE_TEXT.oeffnungRaus });
    return { layer: neu, art: "profil" };
  }
  if (d > 0) {
    // pulled out over part of the height: a free body in front of the face (visual join; a union needs the CSG core)
    const e = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, nr = { x: e.y, y: -e.x };
    const X0 = { x: a.x + e.x * u0, y: a.y + e.y * u0 }, X1 = { x: a.x + e.x * u1, y: a.y + e.y * u1 };
    const profil = [X0, X1, { x: X1.x + nr.x * d, y: X1.y + nr.y * d }, { x: X0.x + nr.x * d, y: X0.y + nr.y * d }];
    try {
      const r = koerperAnlegen(layer, profil, oben - sill, { basis: runde(g.basis + sill), name: "Anbau" });
      return { layer: r.layer, art: "anbau", id: r.id };
    } catch (err) {
      if (abgelehnt) abgelehnt(/** @type {any} */ (err)?.pruefung || { grund: "flaeche", text: PROFIL_GRUND_TEXT.flaeche });
      return nichts;
    }
  }
  // pushed in but not through = a pocket in the volume: needs the 3D boolean of the CSG core
  if (!durchgestossen || !durch) return melde("csg");
  if (!durch.wandartig) return melde("nichtWandartig");
  /** @type {KoerperOeffnung} */
  const o = { kante: teil.kante, u: runde(u), width: runde(w), height: runde(oben - sill), sill: runde(sill) };
  const masse = oeffnungsMasse(o);
  if (!oeffnungPasst(masse, L, H).ok) return melde("passtNicht");
  // the place the 3D view and the IFC use (edge clearance), so the stored u is what is drawn and exported
  o.u = runde(oeffnungMitte_m(o.u, masse.w, L));
  const durchO = durchgangMessen(g.profil, g.loecher || [], teil.kante, o.u - masse.w / 2, o.u + masse.w / 2);
  if (!durchO || !durchO.wandartig) return melde("nichtWandartig");
  const neueRechtecke = oeffnungsRechtecke(o.kante, o.u, masse, durchO);
  if (oeffnungenPruefen(layer, k).some((p) => p.ok && rechteckeUeberlappen(oeffnungsRechtecke(p.oeffnung.kante, p.mitte, p.masse, p.durchgang), neueRechtecke))) return melde("ueberlappt");
  const lok = ringLokal(q, "aussen");
  if (!lok) return melde("kante");
  const gespeichert = lok.umgekehrt ? oeffnungWenden(o, lok.ring) : o;
  return { layer: quelleSchreiben(layer, k, { profil: q.profil || [], loecher: q.loecher, oeffnungen: [...(q.oeffnungen || []), gespeichert] }), art: "oeffnung" };
}

// ---- 107-07: guide lines and guide points (massing_layer.hilfslinien, v4) ----
// Construction geometry of the modeller: never a body, never printed or exported (PDF, DXF and IFC read `koerper`, the
// plan export and the DXF never see this list, D-BK-16). Stored so they survive a reload and stay snap targets.

/**
 * @typedef {{id: string, art: 'gerade'|'strecke'|'punkt', a: Pkt, b?: Pkt}} Hilfslinie  site m; gerade = infinite line through
 *   a and b, strecke = the piece a–b, punkt = the point a (no b)
 */

/** Kinds of guide geometry. */
export const HILFSLINIEN_ARTEN = Object.freeze(["gerade", "strecke", "punkt"]);

/** Shortest guide line, m — two clicks closer than this give no direction [ASSUMED: the 1 mm double-point rule]. */
export const HILFSLINIE_MIN_M = PROFIL_DOPPELPUNKT_M;

/**
 * Add a guide line or a guide point. An absent list is created (old layers stay as they are until the first guide).
 * @param {MassingLayer} layer
 * @param {'gerade'|'strecke'|'punkt'} art
 * @param {Pkt} a site m
 * @param {Pkt|null} [b] site m, needed for gerade/strecke
 * @returns {{layer: MassingLayer, id: string}}
 * @throws {Error} unknown kind, invalid point, or a line whose two points coincide (German message for the command line)
 */
export function hilfslinieAnlegen(layer, art, a, b = null) {
  if (!HILFSLINIEN_ARTEN.includes(art)) throw new Error(`Hilfslinie: unbekannte Art „${art}“`);
  const ok = (/** @type {any} */ p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!ok(a)) throw new Error("Hilfslinie: Punkt fehlt");
  if (art !== "punkt" && (!ok(b) || Math.hypot(/** @type {Pkt} */ (b).x - a.x, /** @type {Pkt} */ (b).y - a.y) < HILFSLINIE_MIN_M)) {
    throw new Error("Hilfslinie braucht zwei verschiedene Punkte");
  }
  const id = `h${layer.naechsteId}`;
  /** @type {Hilfslinie} */
  const h = art === "punkt" ? { id, art, a: kopiePkt(a) } : { id, art, a: kopiePkt(a), b: kopiePkt(/** @type {Pkt} */ (b)) };
  return { id, layer: { ...layer, naechsteId: layer.naechsteId + 1, hilfslinien: [...(layer.hilfslinien || []), h] } };
}

/**
 * Remove guide lines by id, or all of them (`ids` = null). The field disappears when the list becomes empty, so a layer that
 * never kept a guide looks exactly as before 107-07.
 * @param {MassingLayer} layer
 * @param {string[]|null} [ids]
 * @returns {MassingLayer}
 */
export function hilfslinienLoeschen(layer, ids = null) {
  if (!layer.hilfslinien) return layer;
  const rest = ids ? layer.hilfslinien.filter((h) => !ids.includes(h.id)) : [];
  if (rest.length) return { ...layer, hilfslinien: rest };
  const { hilfslinien: _weg, ...ohne } = layer;
  return ohne;
}

/**
 * Snap segments of the guide geometry (objektfang.js): a point = zero-length segment (endpoint snap), a piece = segment, an
 * infinite line = segment clipped to ±halb_m around a with `gerade: true` (snapped through the kind "hilfsgerade").
 * Broken entries (NaN, missing b) are skipped, never thrown — the list may come from an old or edited file.
 * @param {MassingLayer} layer
 * @param {number} [halb_m] half length of an infinite line in the index, m (objektfang HILFSGERADE_HALB_M)
 * @returns {Array<{a: Pkt, b: Pkt, quelle: string, gerade?: boolean, id: string}>}
 */
export function hilfslinienSegmente(layer, halb_m = 1000) {
  const ok = (/** @type {any} */ p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  /** @type {Array<{a: Pkt, b: Pkt, quelle: string, gerade?: boolean, id: string}>} */
  const aus = [];
  for (const h of Array.isArray(layer?.hilfslinien) ? layer.hilfslinien : []) {
    if (!h || !ok(h.a)) continue;
    if (h.art === "punkt") { aus.push({ a: h.a, b: h.a, quelle: "hilfslinie", id: h.id }); continue; }
    if (!ok(h.b)) continue;
    const b = /** @type {Pkt} */ (h.b);
    const L = Math.hypot(b.x - h.a.x, b.y - h.a.y);
    if (L < HILFSLINIE_MIN_M) continue;
    if (h.art === "strecke") { aus.push({ a: h.a, b, quelle: "hilfslinie", id: h.id }); continue; }
    const ux = (b.x - h.a.x) / L, uy = (b.y - h.a.y) / L;
    aus.push({ a: { x: h.a.x - ux * halb_m, y: h.a.y - uy * halb_m }, b: { x: h.a.x + ux * halb_m, y: h.a.y + uy * halb_m }, quelle: "hilfslinie", gerade: true, id: h.id });
  }
  return aus;
}

// ---- 107-08: type of a body (box automatic, D-BK-09/D-BK-10), status, stored GUID ------------------------------------------

/**
 * Form key of a body: everything that defines its shape in its own frame (profile, holes and height of the body or its
 * definition, instance mirror and scale). Moving and rotating do not change it; push/pull, corner drag, side faces and scaling do.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {string}
 */
export function formSchluessel(layer, k) {
  const def = k.gruppe != null ? layer.gruppen[k.gruppe] : null;
  return JSON.stringify([def ? def.profil : k.profil || [], def ? def.loecher || null : k.loecher || null, def ? def.hoehe : k.hoehe || 0,
    !!k.spiegel, instanzMassstab(k)]);
}

/**
 * The box suggestion for one body as it is drawn (resolved through its group, with the instance transform): bauteilVorschlag of
 * the core data sheet on the plan profile and the height; a body with inner rings is no box (null).
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {ReturnType<typeof bauteilVorschlag>}
 */
export function koerperVorschlag(layer, k) {
  const g = geometrie(layer, k);
  if (g.loecher && g.loecher.length) return null;
  return bauteilVorschlag(g.profil, g.hoehe);
}

/**
 * Box automatic (D-BK-09, 24.10.): sets the type of every body that was CREATED or CHANGED ITS FORM between `vorher` and
 * `nachher` (formSchluessel; moving and rotating are no form change), as long as its `bauteil_typ_quelle` is absent or
 * "automatisch": a matching threshold sets `bauteil_typ` with the source "automatisch", no matching threshold removes a type the
 * automatic set earlier. A type the user set ("nutzer") or took back ("zurueckgenommen") is never touched. Bodies that did not
 * change keep what they have — old bodies stay untyped until their next change of form.
 * @param {MassingLayer|null} vorher layer before the edit (null = everything is new)
 * @param {MassingLayer} nachher layer after the edit
 * @returns {MassingLayer} `nachher` itself when nothing had to change, else a new layer
 */
export function typAutomatik(vorher, nachher) {
  const alt = new Map((vorher?.koerper || []).map((k) => [k.id, k]));
  let geaendert = false;
  const koerper = nachher.koerper.map((k) => {
    const q = k.bauteil_typ_quelle;
    if (q === "nutzer" || q === "zurueckgenommen") return k;
    const a = alt.get(k.id);
    if (a && vorher && formSchluessel(vorher, a) === formSchluessel(nachher, k)) return k;
    const v = koerperVorschlag(nachher, k);
    if (v) {
      if (k.bauteil_typ === v.typ && q === "automatisch") return k;
      geaendert = true;
      return { ...k, bauteil_typ: v.typ, bauteil_typ_quelle: /** @type {'automatisch'} */ ("automatisch") };
    }
    if (q !== "automatisch") return k;
    geaendert = true;
    const { bauteil_typ: _t, bauteil_typ_quelle: _q, ...rest } = k;
    return /** @type {Koerper} */ (rest);
  });
  return geaendert ? { ...nachher, koerper } : nachher;
}

/**
 * "Automatik zurücknehmen" (one click in the inspector, D-BK-09): the type goes away ("Bauteiltyp offen", never another type) and
 * the source becomes "zurueckgenommen", so the automatic does not set it again on later changes of form.
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @returns {MassingLayer}
 */
export function typZuruecknehmen(layer, ids) {
  return { ...layer, koerper: layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    const { bauteil_typ: _t, ...rest } = k;
    return { ...rest, bauteil_typ_quelle: /** @type {'zurueckgenommen'} */ ("zurueckgenommen") };
  }) };
}

/**
 * "Automatik wieder zulassen": the source goes away and the automatic runs once at once (otherwise nothing visible would happen
 * until the next change of form) [ASSUMED: an immediate run is what the person expects from the button].
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @returns {MassingLayer}
 */
export function typAutomatikZulassen(layer, ids) {
  const frei = { ...layer, koerper: layer.koerper.map((k) => {
    if (!ids.includes(k.id) || k.bauteil_typ_quelle !== "zurueckgenommen") return k;
    const { bauteil_typ_quelle: _q, bauteil_typ: _t, ...rest } = k;
    return /** @type {Koerper} */ (rest);
  }) };
  // the released bodies count as new for this one run (a layer without them as "before")
  return typAutomatik({ ...frei, koerper: frei.koerper.filter((k) => !ids.includes(k.id)) }, frei);
}

/**
 * The user sets (or clears) the type of bodies by hand: source "nutzer" — the automatic never overwrites it. An empty type
 * means "Bauteiltyp offen" stated by the user (same as taking the automatic back).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {string|null} typ key of BAUTEIL_TYPEN, or null/"" for "offen"
 * @returns {MassingLayer}
 */
export function typSetzen(layer, ids, typ) {
  if (!typ) return typZuruecknehmen(layer, ids);
  if (!BAUTEIL_TYPEN[typ]) throw new Error(`Unbekannter Bauteiltyp: ${typ}`);
  return { ...layer, koerper: layer.koerper.map((k) => (ids.includes(k.id) ? { ...k, bauteil_typ: typ, bauteil_typ_quelle: /** @type {'nutzer'} */ ("nutzer") } : k)) };
}

/**
 * Renovation status of bodies (spec V renovation_status; normalised like every element: "Existing" → bestand …). An empty or
 * unknown value removes the field ("ohne Status", D-BW-03 — never a default).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {string|null} status
 * @returns {MassingLayer}
 */
export function statusSetzen(layer, ids, status) {
  const s = status ? normalisiereStatus(status) : null;
  return { ...layer, koerper: layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    const { status: _s, ...rest } = k;
    return s ? { ...rest, status: s } : /** @type {Koerper} */ (rest);
  }) };
}

/**
 * Lazy GUID (spec V guid, BK-67): writes the GlobalId a body has in the IFC today (derived from project and body id, bauteilGuid
 * of the data sheet) onto the body, once — from then on it survives a project copy or a change of the id scheme. Bodies that
 * already carry a 22-character guid keep it. The export is byte-identical before and after (same value).
 * @param {MassingLayer} layer
 * @param {string|number|null} projektId
 * @param {string[]|null} [ids] only these bodies (default: all)
 * @returns {MassingLayer} the same layer when every body already has its guid
 */
export function guidsSichern(layer, projektId, ids = null) {
  let geaendert = false;
  const koerper = layer.koerper.map((k) => {
    if ((ids && !ids.includes(k.id)) || (typeof k.guid === "string" && k.guid.length === 22)) return k;
    geaendert = true;
    return { ...k, guid: bauteilGuid(projektId, "massing", { id: k.id }) };
  });
  return geaendert ? { ...layer, koerper } : layer;
}

// ---- 107-08: body → element (data sheet, IFC class, "Als Bauteil übernehmen") ------------------------------------------------

/**
 * @typedef {{x: number, z: number}} PktXZ  plan point of the BIM model in m (x = site x − bezug.x, z = site y − bezug.y: the frame
 *   the IFC export already uses for the Massing bodies, so a taken-over element lies exactly where its body was)
 * @typedef {object} KoerperElement
 * @property {string} id                body id (the GUID source "massing" of the data sheet)
 * @property {string} [guid]            stored guid of the body
 * @property {string} [bauteil_typ]
 * @property {string} [bauteil_typ_quelle]
 * @property {string} [status]
 * @property {string} [name]
 * @property {PktXZ[]} points           outer ring in the BIM frame (normalised orientation)
 * @property {number} height            body height in m (wall/column height, slab thickness)
 * @property {number} basis_m           bottom of the body in m above ±0
 * @property {{kurz: number, lang: number}|null} rechteck  sides of a rectangle profile in m, else null
 * @property {PktXZ} [a]                rectangle: start of the centre line along the long side
 * @property {PktXZ} [b]                rectangle: end of that centre line
 * @property {number} [thickness]       rectangle: short side in m (wall thickness)
 * @property {number} [size]            rectangle: long side in m (square column of this size, the BIM column has one size)
 * @property {number} [x]               centre of the profile (BIM frame, m)
 * @property {number} [zMitte]          centre of the profile (BIM frame, m)
 * @property {number} [dicke_m]         body height as slab thickness in m
 * @property {number} flaeche_m2        plan area of the profile minus its inner rings in m² (the quantity of a slab-like type)
 * @property {number} volumen_m3        flaeche_m2 × height in m³ (the quantity of a foundation)
 */

/**
 * Types whose data sheet measures along a centre line (IfcWall, IfcBeam, IfcColumn) — and no type at all (the takeover builds walls
 * from the outline of an untyped body). Slab-like and volume types are measured by area or volume instead.
 * @param {string|null|undefined} typ key of BAUTEIL_TYPEN
 * @returns {boolean}
 */
function linienTyp(typ) {
  if (!typ) return true;
  const ifc = BAUTEIL_TYPEN[typ]?.ifc;
  return ifc === "IfcWall" || ifc === "IfcBeam" || ifc === "IfcColumn";
}

/**
 * A body seen as an element of the BIM model: the fields the data sheet and the takeover need, derived (never stored).
 * Every body gets its plan area and volume. Rectangle profiles of an untyped body or of a linear type (wall, beam, column) also get
 * the centre line along the long side (a, b), the short side as wall thickness and the long side as column size. A slab-like or
 * volume type (slab, base slab, flat roof, cladding, foundation …) gets no centre line: the data sheet reads a centre line as
 * "length × height" (review 107-08: a 6 × 5 × 0.25 m slab body had a quantity of 1.5 m² instead of 30 m²).
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @param {Pkt|null} [bezug] site point of the BIM model origin (massing_layer.bezug; default the layer's own, else 0;0)
 * @returns {KoerperElement}
 */
export function koerperElement(layer, k, bezug = null) {
  const bz = bezug || layer.bezug || { x: 0, y: 0 };
  const g = geometrie(layer, k);
  const xz = (/** @type {Pkt} */ p) => ({ x: runde(p.x - bz.x), z: runde(p.y - bz.y) });
  const points = g.profil.map(xz);
  const loch = (g.loecher || []).reduce((sum, ring) => sum + Math.abs(flaecheSigniert(ring.map(xz))), 0);
  const flaeche_m2 = runde(Math.max(0, Math.abs(flaecheSigniert(points)) - loch));
  /** @type {KoerperElement} */
  const el = { id: k.id, points, height: g.hoehe, basis_m: g.basis, rechteck: null, flaeche_m2, volumen_m3: runde(flaeche_m2 * g.hoehe) };
  for (const f of /** @type {const} */ (["guid", "bauteil_typ", "bauteil_typ_quelle", "status", "name"])) if (k[f] != null && k[f] !== "") /** @type {any} */ (el)[f] = k[f];
  const cx = points.reduce((s, p) => s + p.x, 0) / (points.length || 1), cz = points.reduce((s, p) => s + p.z, 0) / (points.length || 1);
  el.x = runde(cx); el.zMitte = runde(cz);
  el.dicke_m = g.hoehe;
  const r = !g.loecher?.length ? rechteckSeiten(points) : null;
  if (r) el.rechteck = r;
  if (r && linienTyp(k.bauteil_typ)) {
    // centre line along the long side: from the middle of one short side to the middle of the other
    const e0 = { x: points[1].x - points[0].x, z: points[1].z - points[0].z };
    const l0 = Math.hypot(e0.x, e0.z);
    const langErst = l0 >= r.lang - 1e-6; // edge 0 is a long side
    const m = (/** @type {PktXZ} */ p, /** @type {PktXZ} */ q) => ({ x: runde((p.x + q.x) / 2), z: runde((p.z + q.z) / 2) });
    el.a = langErst ? m(points[3], points[0]) : m(points[0], points[1]);
    el.b = langErst ? m(points[1], points[2]) : m(points[2], points[3]);
    el.thickness = runde(r.kurz);
    el.size = runde(r.lang);
  }
  return el;
}

/** Storey index of a height above ±0 (m) for the takeover: the storey whose band [elevation, elevation + height) holds it. */
function geschossBei(/** @type {number} */ z, /** @type {number} */ geschossHoehe_m) {
  return Math.max(0, Math.floor((z + 1e-6) / (geschossHoehe_m > 0 ? geschossHoehe_m : 3)));
}

/**
 * Wall thickness of an envelope wall of the takeover when no envelope build-up is chosen, m.
 * [ASSUMED] 0.30 m = STANDARD_DICKE_M of bauteil/referenz.js, the editor's default for a drawn wall: an untyped body says nothing about
 * its walls. Not a norm value; the user replaces it by choosing the envelope build-up (then the thickness comes from the build-up and
 * this value is not written at all).
 */
export const UEBERNAHME_HUELLE_DICKE_M = STANDARD_DICKE_M;

/** Tolerance for "an edge of the body lies on a storey plane", m (1 mm: the inputs are rounded to mm). */
const EBENE_TOL_M = 1e-3;

/**
 * Why a body cannot be taken over (the modeller words it through i18n; nothing is written):
 *  - "typ":    the type has no BIM element of its own in the studio (beam, foundation, flat roof, cladding …)
 *  - "profil": a wall or column type needs a rectangle profile (centre line / one column size)
 *  - "lage":   a slab body lies on no storey ceiling — drawn slabs of the BIM model always hang under or stand on the ceiling plane of
 *              a storey (deckenLage, plane = elevation of level + 1); a slab at ground level belongs to the envelope (base plate)
 * @typedef {{grund: 'typ'|'profil'|'lage', typ: string|null, unterkante_m?: number, oberkante_m?: number}} UebernahmeAbgelehnt
 */

/**
 * "Als Bauteil übernehmen" (D-BK-10, spec IV "Box → Bauteil"): the BIM elements a body becomes, per storey, each with the note
 * `quelle_koerper` (body id, additive field). Pure; the caller writes them through the one BIM write path (saveBimModel).
 * Review 107-08: every element lies exactly where its body was — bottom, top and outline.
 *  - typed as a wall (class IfcWall) with a rectangle profile: one wall per storey band the body reaches, along the centre line,
 *    thickness = short side, its type kept. Lower edge = body bottom (`unterkante_versatz_m` against the storey elevation); a piece
 *    whose top lies on the next storey plane follows that storey (`oberkante_bezug: "geschoss"`, 107-02), any other top keeps the
 *    body's own height (`oberkante_bezug: "absolut"`, `height` = piece height) — a 1.10 m parapet stays 1.10 m high;
 *  - typed as a column with a rectangle profile: one column per storey band at the centre, size = long side, bottom and top of the
 *    body through `unterkante_versatz_m` / `oberkante_versatz_m` (a BIM column has no stored height, stuetzenHoehe follows the link);
 *  - typed as a slab (decke/bodenplatte): one drawn slab from the profile, thickness = body height, placed so its edges are the
 *    body's: top on a storey ceiling plane → that storey with `bezug: "oben"`, else bottom on one → `bezug: "unten"`, else refused;
 *  - untyped: the body as an envelope — one wall per profile edge and storey band (reference line `outside`, the envelope build-up
 *    `composite` when one is given, else UEBERNAHME_HUELLE_DICKE_M), heights as for a typed wall, and one ceiling slab per storey
 *    whose ceiling plane lies within the body;
 *  - any other type, or a wall/column type without a rectangle profile: refused (`abgelehnt`, nothing to write).
 * Storeys are the bands of `geschossHoehe_m` the body reaches from its bottom to its top [ASSUMED: storeys of one height, like the
 * studio's own body].
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @param {{geschossHoehe_m?: number, startIdx?: number, composite?: string|null, bezug?: Pkt|null}} [opt] startIdx = first free `_idx`
 *   of the BIM record; composite = envelope build-up for the walls of an untyped body
 * @returns {{customWalls: any[], customSlabs: any[], customColumns: any[], naechsterIdx: number, art: 'wand'|'stuetze'|'decke'|'huelle'|'abgelehnt', abgelehnt?: UebernahmeAbgelehnt}}
 */
export function bauteileAusKoerper(layer, k, { geschossHoehe_m = 3, startIdx = 1, composite = null, bezug = null } = {}) {
  const el = koerperElement(layer, k, bezug);
  const gh = geschossHoehe_m > 0 ? geschossHoehe_m : 3;
  const ebene = (/** @type {number} */ level) => elevationOf(level, gh);
  let idx = startIdx;
  const unten_m = el.basis_m, oben_m = el.basis_m + el.height;
  const unten = geschossBei(unten_m, gh);
  const oben = Math.max(unten, geschossBei(oben_m - EBENE_TOL_M, gh));
  const levels = Array.from({ length: oben - unten + 1 }, (_, i) => unten + i);
  const quelle = { quelle_koerper: k.id };
  const typ = k.bauteil_typ || null;
  const mitTyp = (/** @type {any} */ e) => (typ ? { ...e, bauteil_typ: typ } : e);
  const status = k.status ? { status: k.status } : {};
  /** @type {any[]} */ const customWalls = [];
  /** @type {any[]} */ const customSlabs = [];
  /** @type {any[]} */ const customColumns = [];
  const leer = (/** @type {UebernahmeAbgelehnt} */ abgelehnt) => ({ customWalls, customSlabs, customColumns, naechsterIdx: startIdx, art: /** @type {'abgelehnt'} */ ("abgelehnt"), abgelehnt });
  /**
   * The part of the body inside storey band `level`: lower and upper edge in m, its height, whether the top lies on the next storey
   * plane, and the shift of the lower edge against the storey elevation (only when it is not 0).
   * @param {number} level
   */
  const stueck = (level) => {
    const u = Math.max(unten_m, ebene(level)), o = Math.min(oben_m, ebene(level + 1));
    const versatz = runde(u - ebene(level));
    return { u, o, hoehe: runde(o - u), aufDecke: Math.abs(o - ebene(level + 1)) < EBENE_TOL_M, ...(Math.abs(versatz) >= EBENE_TOL_M ? { unterkante_versatz_m: versatz } : {}) };
  };
  const wandHoehen = (/** @type {number} */ level) => {
    const st = stueck(level);
    const unterkante = st.unterkante_versatz_m != null ? { unterkante_versatz_m: st.unterkante_versatz_m } : {};
    return st.aufDecke
      ? { height: st.hoehe, ...unterkante, oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: 0 }
      : { height: st.hoehe, ...unterkante, oberkante_bezug: "absolut" };
  };
  const wand = (/** @type {PktXZ} */ a, /** @type {PktXZ} */ b, /** @type {number} */ level, /** @type {Record<string, any>} */ extra) => ({
    a, b, level, ...wandHoehen(level), ...extra, ...status, ...quelle, _idx: idx++,
  });
  const ifc = typ ? BAUTEIL_TYPEN[typ]?.ifc : null;
  if (typ && ifc === "IfcWall") {
    if (!el.a || !el.b) return leer({ grund: "profil", typ });
    for (const level of levels) customWalls.push(mitTyp(wand(el.a, el.b, level, { thickness: el.thickness, refLine: "center" })));
    return { customWalls, customSlabs, customColumns, naechsterIdx: idx, art: "wand" };
  }
  if (typ === "stuetze") {
    if (!el.rechteck || el.size == null) return leer({ grund: "profil", typ });
    for (const level of levels) {
      const st = stueck(level);
      customColumns.push({ x: el.x, z: el.zMitte, level, size: el.size, ...(st.unterkante_versatz_m != null ? { unterkante_versatz_m: st.unterkante_versatz_m } : {}),
        oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: runde(st.o - ebene(level + 1)), ...status, ...quelle, _idx: idx++ });
    }
    return { customWalls, customSlabs, customColumns, naechsterIdx: idx, art: "stuetze" };
  }
  if (typ === "decke" || typ === "bodenplatte") {
    // the ceiling plane of storey L is ebene(L + 1); a drawn slab with bezug "oben" hangs under it, with "unten" it stands on it
    const ebeneBei = (/** @type {number} */ z) => { const l = Math.round(z / gh) - 1; return l >= 0 && Math.abs(ebene(l + 1) - z) < EBENE_TOL_M ? l : null; };
    const lo = ebeneBei(oben_m), lu = lo == null ? ebeneBei(unten_m) : null;
    if (lo == null && lu == null) return leer({ grund: "lage", typ, unterkante_m: runde(unten_m), oberkante_m: runde(oben_m) });
    customSlabs.push(mitTyp({ points: el.points, level: lo ?? lu, dicke_m: el.height, bezug: lo != null ? "oben" : "unten", ...status, ...quelle, _idx: idx++ }));
    return { customWalls, customSlabs, customColumns, naechsterIdx: idx, art: "decke" };
  }
  if (typ) return leer({ grund: "typ", typ });
  // envelope: the profile runs in the normalised orientation (positive area in the site frame = clockwise on the screen); the
  // reference line "outside" of a wall a→b lies on the side the wall's own convention calls outside (bauteil/referenz.js)
  const dicke = composite ? { composite } : { thickness: UEBERNAHME_HUELLE_DICKE_M };
  for (const level of levels) {
    el.points.forEach((p, i) => {
      const q = el.points[(i + 1) % el.points.length];
      customWalls.push(wand(p, q, level, { refLine: "outside", ...dicke }));
    });
    // the ceiling slab of this storey (default drawn slab: under the plane ebene(level + 1)) only when that plane lies in the body
    if (ebene(level + 1) <= oben_m + EBENE_TOL_M) customSlabs.push({ points: el.points, level, ...status, ...quelle, _idx: idx++ });
  }
  return { customWalls, customSlabs, customColumns, naechsterIdx: idx, art: "huelle" };
}

/**
 * "Übernahme zurücknehmen": the element lists without everything a takeover of body `id` created (`quelle_koerper === id`). The
 * body itself stays in the Massing layer (its undo is the modeller's stack).
 * @param {{customWalls?: any[], customSlabs?: any[], customColumns?: any[]}} modell element lists of the BIM record
 * @param {string} id body id
 * @returns {{customWalls: any[], customSlabs: any[], customColumns: any[], entfernt: number}}
 */
export function uebernahmeEntfernen(modell, id) {
  let entfernt = 0;
  const ohne = (/** @type {any[]|undefined} */ l) => (l || []).filter((e) => { const weg = e?.quelle_koerper === id; if (weg) entfernt++; return !weg; });
  return { customWalls: ohne(modell.customWalls), customSlabs: ohne(modell.customSlabs), customColumns: ohne(modell.customColumns), entfernt };
}

/**
 * True when a takeover of body `id` lies in the element lists (the modeller then offers "Übernahme zurücknehmen" instead of a
 * second takeover — two takeovers of one body would stack duplicate walls).
 * @param {{customWalls?: any[], customSlabs?: any[], customColumns?: any[]}|null|undefined} modell
 * @param {string} id
 * @returns {boolean}
 */
export function istUebernommen(modell, id) {
  return [modell?.customWalls, modell?.customSlabs, modell?.customColumns].some((l) => (l || []).some((e) => e?.quelle_koerper === id));
}
