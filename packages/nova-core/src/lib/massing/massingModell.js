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
// rotation, group); mesh, plan, section and IFC are always derived from it. A mesh is never the source and may at
// most later lie as a discardable intermediate store (D-BK-08a, plan 107-14). Derivations must never write back
// into profile or height.
//
// Units: metres in site coordinates (x east, y north — the studio's convention), angles in
// degrees. Pure functions, every edit returns a NEW layer (undo via @core/lib/undoStack).
//
// In: layer objects, edit parameters. Out: new layers, resolved geometry, parsed typed input.

import { gesamtHoehe, geschosseAus } from "../bauteil/hoehen.js"; // 107-02: building height from the storey table (ausEinzelkoerper)

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
 * @property {number} drehung      rotation about the origin in degrees (counter-clockwise)
 * @property {string|null} gruppe  group number ("1", "2" …) — instance of that definition
 * @typedef {{v?: number, koerper: Koerper[], gruppen: Record<string, {profil: Pkt[], hoehe: number}>, naechsteId: number, parametrik?: {knoten: any[], kanten: any[]}, gelaende?: import('./gelaende.js').Gelaende, bezug?: Pkt, riegel?: Array<{id: string, pfad: Pkt[], opt: Record<string, any>}>}} MassingLayer
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
 * Profile and height of a body, resolved through its group definition, in site coordinates.
 * @param {MassingLayer} layer
 * @param {Koerper} k
 * @returns {{profil: Pkt[], hoehe: number, basis: number}}
 */
export function geometrie(layer, k) {
  const def = k.gruppe != null ? layer.gruppen[k.gruppe] : null;
  const profil = def ? def.profil : k.profil || [];
  const hoehe = def ? def.hoehe : k.hoehe || 0;
  const w = ((k.drehung || 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  return {
    profil: profil.map((p) => ({ x: runde(k.pos.x + p.x * c - p.y * s), y: runde(k.pos.y + p.x * s + p.y * c) })),
    hoehe, basis: k.basis || 0,
  };
}

/** Next free body id and the layer with the counter advanced. */
function neueId(layer) {
  return [`k${layer.naechsteId}`, { ...layer, naechsteId: layer.naechsteId + 1 }];
}

/**
 * New body from a closed profile (site metres) extruded by `hoehe`.
 * @param {MassingLayer} layer
 * @param {Pkt[]} profil at least 3 points
 * @param {number} hoehe m (> 0)
 * @returns {{layer: MassingLayer, id: string}}
 */
export function koerperAnlegen(layer, profil, hoehe, { basis = 0, name = "" } = {}) {
  if (!Array.isArray(profil) || profil.length < 3) throw new Error("Fläche braucht mindestens 3 Punkte");
  const [id, l] = neueId(layer);
  return { id, layer: { ...l, koerper: [...l.koerper, { id, name, profil: profil.map(kopiePkt), hoehe: runde(Math.max(0.01, hoehe)), basis, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }] } };
}

/**
 * Push/pull the top face: height changes by `delta` m (never below 1 cm). For a group instance
 * the definition changes — all instances of that number follow.
 * @param {MassingLayer} layer
 * @param {string} id
 * @param {number} delta m
 * @returns {MassingLayer}
 */
export function pushPull(layer, id, delta) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k) return layer;
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
  const n = Math.max(1, Math.min(500, Math.round(anzahl)));
  let l = layer;
  const neu = [];
  const quellen = layer.koerper.filter((k) => ids.includes(k.id));
  for (let i = 1; i <= n; i++) {
    const f = modus === "teilen" ? i / n : i;
    for (const q of quellen) {
      const [id, l2] = neueId(l);
      l = { ...l2, koerper: [...l2.koerper, { ...q, id, pos: { x: runde(q.pos.x + delta.x * f), y: runde(q.pos.y + delta.y * f) } }] };
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
  const def = vorhanden || (erste.gruppe != null ? layer.gruppen[erste.gruppe] : { profil: (erste.profil || []).map(kopiePkt), hoehe: erste.hoehe || 0 });
  return {
    nr: nummer,
    layer: {
      ...layer,
      gruppen: { ...layer.gruppen, [nummer]: def },
      koerper: layer.koerper.map((k) => (ids.includes(k.id) ? (({ profil: _p, hoehe: _h, ...rest }) => ({ ...rest, gruppe: nummer }))(k) : k)),
    },
  };
}

/**
 * Change the definition of a group number (profile in group coordinates and/or height) — every
 * instance of that number changes.
 * @param {MassingLayer} layer
 * @param {string} nr
 * @param {{profil?: Pkt[], hoehe?: number}} patch
 * @returns {MassingLayer}
 */
export function gruppeAendern(layer, nr, patch) {
  const d = layer.gruppen[nr];
  if (!d) return layer;
  return { ...layer, gruppen: { ...layer.gruppen, [nr]: { profil: (patch.profil || d.profil).map(kopiePkt), hoehe: runde(patch.hoehe ?? d.hoehe) } } };
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
  return { nr, layer: { ...layer, gruppen: { ...layer.gruppen, [nr]: { ...layer.gruppen[k.gruppe], profil: layer.gruppen[k.gruppe].profil.map(kopiePkt) } }, koerper: layer.koerper.map((x) => (x.id === id ? { ...x, gruppe: nr } : x)) } };
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
 * Rotate bodies about a centre by `winkel` degrees (counter-clockwise). The position turns about
 * the centre and the body's own rotation grows — group definitions stay untouched (an instance
 * may stand at any angle, like a SketchUp component).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} zentrum
 * @param {number} winkel degrees
 * @returns {MassingLayer}
 */
export function drehen(layer, ids, zentrum, winkel) {
  const w = (winkel * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  return {
    ...layer,
    koerper: layer.koerper.map((k) => {
      if (!ids.includes(k.id)) return k;
      const dx = k.pos.x - zentrum.x, dy = k.pos.y - zentrum.y;
      return { ...k, pos: { x: runde(zentrum.x + dx * c - dy * s), y: runde(zentrum.y + dx * s + dy * c) }, drehung: runde(((k.drehung || 0) + winkel) % 360) };
    }),
  };
}

/**
 * Scale bodies in plan about a centre by `faktor` (> 0). Own profiles are scaled; for group
 * instances the DEFINITION is scaled — every instance of that number changes (component rule).
 * Height is not changed (that is push/pull).
 * @param {MassingLayer} layer
 * @param {string[]} ids
 * @param {Pkt} zentrum
 * @param {number} faktor
 * @returns {MassingLayer}
 */
export function skalieren(layer, ids, zentrum, faktor) {
  if (!(faktor > 0)) throw new Error("Faktor muss größer als 0 sein");
  const skal = (p) => ({ x: runde(p.x * faktor), y: runde(p.y * faktor) });
  const gruppen = { ...layer.gruppen };
  const erledigt = new Set();
  const koerper = layer.koerper.map((k) => {
    if (!ids.includes(k.id)) return k;
    const pos = { x: runde(zentrum.x + (k.pos.x - zentrum.x) * faktor), y: runde(zentrum.y + (k.pos.y - zentrum.y) * faktor) };
    if (k.gruppe != null) {
      if (!erledigt.has(k.gruppe)) { gruppen[k.gruppe] = { ...gruppen[k.gruppe], profil: gruppen[k.gruppe].profil.map(skal) }; erledigt.add(k.gruppe); }
      return { ...k, pos };
    }
    return { ...k, pos, profil: (k.profil || []).map(skal) };
  });
  return { ...layer, gruppen, koerper };
}

/**
 * "Folge mir": a rectangular cross-section (breite × hoehe, m) swept along a plan path — the
 * result is one body whose footprint is the path offset by breite/2 to both sides (mitred joins,
 * mitre limited to 4 × half width [ASSUMED] so sharp corners do not spike).
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
    const cos = n1 && n2 ? Math.max(0.25, (n.x / l) * n1.x + (n.y / l) * n1.y) : 1;
    const d = (h / cos) * seite;
    return { x: runde(p.x + (n.x / l) * d), y: runde(p.y + (n.y / l) * d) };
  });
  return [...versatz(1), ...versatz(-1).reverse()];
}

/**
 * Body from a swept cross-section ("Folge mir").
 * @param {MassingLayer} layer
 * @param {Pkt[]} pfad
 * @param {number} breite m
 * @param {number} hoehe m
 * @returns {{layer: MassingLayer, id: string}}
 */
export function folgeMir(layer, pfad, breite, hoehe) {
  return koerperAnlegen(layer, pfadUmriss(pfad, breite), hoehe, { name: "Folge mir" });
}

/**
 * Move one corner of a body to a new site point. For a group instance the point is turned back
 * into the group's own coordinates (position and rotation undone) and the DEFINITION changes —
 * every instance of that number follows (component rule).
 * @param {MassingLayer} layer
 * @param {string} id
 * @param {number} index corner index
 * @param {Pkt} ziel site metres
 * @returns {MassingLayer}
 */
export function eckeVerschieben(layer, id, index, ziel) {
  const k = layer.koerper.find((x) => x.id === id);
  if (!k) return layer;
  const w = (-(k.drehung || 0) * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
  const dx = ziel.x - k.pos.x, dy = ziel.y - k.pos.y;
  const lokal = { x: runde(dx * c - dy * s), y: runde(dx * s + dy * c) };
  if (k.gruppe != null) {
    const d = layer.gruppen[k.gruppe];
    if (!d.profil[index]) return layer;
    return gruppeAendern(layer, k.gruppe, { profil: d.profil.map((p, i) => (i === index ? lokal : p)) });
  }
  if (!k.profil?.[index]) return layer;
  return { ...layer, koerper: layer.koerper.map((x) => (x.id === id ? { ...x, profil: (x.profil || []).map((p, i) => (i === index ? lokal : p)) } : x)) };
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
  return koerperAnlegen(layer, g.profil, hoehe, { basis: runde(g.basis + g.hoehe), name: "Aufstockung" });
}
