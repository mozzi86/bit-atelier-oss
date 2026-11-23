// bauherrMoeblierung.js — the client moves furniture (W-1118-22, Bauherrenzugang 110).
//
// One truth stays the office's model: the client never reads or writes it. The office releases a PROJECTION of the furnished
// rooms (kind BauherrMoeblierung, bauherrProjektion.js): room outlines and the furniture standing in them, nothing of the building
// elements. The client moves and turns that furniture in the portal and sends the result back as a PROPOSAL (feedback of art
// "moeblierung"); the office checks it against the model of that moment and takes it over or not.
//
// The projection contract allows scalars and flat lists only (bauherr_bereinigen), so:
//   - a room outline is one text "x,y;x,y;…" in metres (umrissText / umrissLesen);
//   - furniture is a flat list with the room key, type, size, centre and rotation;
//   - a proposal is one text, JSON of [[room, id, x, y, rot], …] (vorschlagText / vorschlagLesen), bounded in length.
//
// Nothing the client sends is trusted: vorschlagPruefen takes only entries that name furniture of the released projection, with
// finite numbers, a quarter-turn rotation and a place inside its room; vorschlagAnwenden changes only centre and rotation of
// furniture that still stands in the model — never type, size, room, never a building element.
//
// Geometry as in the office's furniture code (@designer/lib/moebel.js): x/y = centre in metres in the room's coordinates (y is the
// model's z), rotation 0 | 90 | 180 | 270 clockwise, b = width and t = depth at rotation 0, drag grid 5 cm.
//
// In:  rooms and furniture of the model (office), projection rows and proposals (portal). Out: projections, proposals, verdicts,
//      the changed furnishing. Pure, no imports — the portal needs neither the furniture catalogue nor the designer.

/** Drag grid in metres — the same 5 cm as the office's furniture planning (moebel.js MOEBEL_RASTER). */
export const RASTER_M = 0.05;
/** Longest proposal text the database accepts (characters) — enough for a few hundred pieces of furniture. */
export const VORSCHLAG_MAX = 16000;
/** Most entries of one proposal [ASSUMED: far above a furnished house, bounds the work of a hostile text]. */
export const VORSCHLAG_EINTRAEGE_MAX = 400;
/** Furniture may touch a wall: a corner counts as inside up to this distance outside the outline (m). */
const RAND_M = 0.011;

/** @typedef {{x: number, y: number}} P */
/** @typedef {{id: string, raum: string, typ: string, name: string, kategorie: string, b: number, t: number, x: number, y: number, rot: number}} BMoebel */
/** @typedef {{schluessel: string, name: string, geschoss: string, umriss: string}} BRaum */
/** @typedef {[string, string, number, number, number]} Aenderung room key, furniture id, x (m), y (m), rotation (deg) */

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const zahl = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);

/**
 * A room outline as text: "x,y;x,y;…" in metres with two decimals.
 * @param {ReadonlyArray<{x: number, z?: number, y?: number}>} punkte model points (x / z) or plan points (x / y)
 * @returns {string} empty when there are fewer than three usable points
 */
export function umrissText(punkte) {
  const p = (Array.isArray(punkte) ? punkte : []).map((q) => [zahl(q?.x), zahl(q?.z ?? q?.y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return p.length >= 3 ? p.map(([x, y]) => `${r2(x)},${r2(y)}`).join(';') : '';
}

/**
 * The outline text back as points.
 * @param {unknown} text "x,y;x,y;…"
 * @returns {P[]} empty when the text is not an outline of at least three points
 */
export function umrissLesen(text) {
  if (typeof text !== 'string' || text.length > 20000) return [];
  const p = text.split(';').map((s) => s.split(',').map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
  return p.length >= 3 ? p : [];
}

/**
 * The projection of the furnished rooms for the client.
 * @param {object} e
 * @param {ReadonlyArray<Record<string, any>>} e.raeume rooms of the model ({name, level, points: [{x, z}], …})
 * @param {Record<string, ReadonlyArray<Record<string, any>>>|null|undefined} e.moeblierung complexData.moeblierung (key → items)
 * @param {(raum: Record<string, any>) => string} e.schluessel the furnishing key of a room (moebel.js zoneKey)
 * @param {(raum: Record<string, any>) => ReadonlyArray<Record<string, any>>} e.moebelVon the furniture of a room (moebel.js moebelFuerZone)
 * @param {(typ: string) => {name?: string, b?: number, t?: number, kategorie?: string}|null} e.typ catalogue lookup (moebel.js moebelById)
 * @param {(level: number) => string} [e.geschossName] storey label, default "Geschoss <n>"
 * @param {string} [e.titel]
 * @param {string} [e.stand] date text of the model state
 * @param {boolean} [e.aenderbar] the client may send a proposal
 * @returns {{titel: string, stand: string, aenderbar: boolean, raeume: BRaum[], moebel: BMoebel[]}} only rooms with an outline;
 *   furniture of an unknown type or without a finite place is left out (the client could neither see nor move it)
 */
export function moeblierungProjektion({ raeume, moeblierung: _m, schluessel, moebelVon, typ, geschossName = (l) => `Geschoss ${l}`, titel = 'Möblierung', stand = '', aenderbar = true }) {
  /** @type {BRaum[]} */
  const rs = [];
  /** @type {BMoebel[]} */
  const ms = [];
  for (const raum of Array.isArray(raeume) ? raeume : []) {
    const umriss = umrissText(raum?.points || []);
    if (!umriss) continue;
    const key = String(schluessel(raum));
    rs.push({ schluessel: key, name: String(raum.name || 'Raum').replace(/ ·W?T?$/, ''), geschoss: geschossName(Number(raum.level) || 0), umriss });
    for (const it of moebelVon(raum) || []) {
      const t = typ(String(it?.typ ?? ''));
      const b = zahl(t?.b), tiefe = zahl(t?.t), x = zahl(it?.x), y = zahl(it?.y);
      if (!t || !(b > 0) || !(tiefe > 0) || !Number.isFinite(x) || !Number.isFinite(y) || it?.id == null) continue;
      ms.push({ id: String(it.id), raum: key, typ: String(it.typ), name: String(t.name || it.typ), kategorie: String(t.kategorie || 'furn'),
        b: r2(b), t: r2(tiefe), x: r2(x), y: r2(y), rot: drehung(it.rot) });
    }
  }
  return { titel, stand, aenderbar: aenderbar === true, raeume: rs, moebel: ms };
}

/** A rotation as a quarter turn 0 | 90 | 180 | 270 (anything else → 0). @param {unknown} v @returns {number} */
export function drehung(v) {
  const n = ((Math.round(Number(v) / 90) * 90) % 360 + 360) % 360;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Axis-parallel box of a piece of furniture: b and t swap at 90° / 270°.
 * @param {{b: number, t: number, x: number, y: number, rot: number}} m metres, centre x/y
 * @returns {{x0: number, y0: number, x1: number, y1: number}} metres
 */
export function moebelBox(m) {
  const quer = m.rot === 90 || m.rot === 270;
  const w = quer ? m.t : m.b, h = quer ? m.b : m.t;
  return { x0: m.x - w / 2, y0: m.y - h / 2, x1: m.x + w / 2, y1: m.y + h / 2 };
}

/** Distance of a point to a segment (m). @param {P} p @param {P} a @param {P} b */
function abstand(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * Point inside an outline, its edge included (a cupboard stands AGAINST the wall).
 * @param {P} p @param {ReadonlyArray<P>} umriss
 * @returns {boolean}
 */
export function imUmriss(p, umriss) {
  if (!umriss || umriss.length < 3) return false;
  let innen = false;
  for (let i = 0, j = umriss.length - 1; i < umriss.length; j = i, i += 1) {
    const a = umriss[i], b = umriss[j];
    if (abstand(p, a, b) <= RAND_M) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) innen = !innen;
  }
  return innen;
}

/**
 * A piece of furniture stands completely inside its room (all four corners).
 * @param {{b: number, t: number, x: number, y: number, rot: number}} m @param {ReadonlyArray<P>} umriss
 * @returns {boolean}
 */
export function stehtImRaum(m, umriss) {
  const k = moebelBox(m);
  return [[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]].every(([x, y]) => imUmriss({ x, y }, umriss));
}

/**
 * Two pieces of furniture overlap (touching is no overlap).
 * @param {{b: number, t: number, x: number, y: number, rot: number}} a @param {{b: number, t: number, x: number, y: number, rot: number}} b
 * @returns {boolean}
 */
export function ueberlappt(a, b) {
  const p = moebelBox(a), q = moebelBox(b), e = 0.001;
  return p.x0 < q.x1 - e && q.x0 < p.x1 - e && p.y0 < q.y1 - e && q.y0 < p.y1 - e;
}

/**
 * Where a dragged piece of furniture comes to stand: on the 5 cm grid, pulled flush to a wall when a side comes within `fang_m`
 * of an axis-parallel wall, and never outside the room — a place outside keeps the last place inside.
 * @param {BMoebel} m the piece as it stands (its last valid place)
 * @param {number} x wanted centre x (m) @param {number} y wanted centre y (m)
 * @param {ReadonlyArray<P>} umriss its room
 * @param {{fang_m?: number}} [o] snap distance to walls, default 0.15 m [ASSUMED: a finger is less precise than a mouse]
 * @returns {BMoebel} the piece at its new place, or unchanged when the wanted place is not inside the room
 */
export function platzieren(m, x, y, umriss, { fang_m = 0.15 } = {}) {
  const raster = (/** @type {number} */ v) => r2(Math.round(v / RASTER_M) * RASTER_M);
  let nx = raster(x), ny = raster(y);
  const quer = m.rot === 90 || m.rot === 270;
  const hw = (quer ? m.t : m.b) / 2, hh = (quer ? m.b : m.t) / 2;
  // walls parallel to an axis: pull the nearer side of the box onto them
  for (let i = 0; i < umriss.length; i += 1) {
    const a = umriss[i], b = umriss[(i + 1) % umriss.length];
    if (Math.abs(a.x - b.x) < 0.005 && ny >= Math.min(a.y, b.y) - hh && ny <= Math.max(a.y, b.y) + hh) {
      if (Math.abs(nx - hw - a.x) <= fang_m) nx = r2(a.x + hw);
      else if (Math.abs(nx + hw - a.x) <= fang_m) nx = r2(a.x - hw);
    }
    if (Math.abs(a.y - b.y) < 0.005 && nx >= Math.min(a.x, b.x) - hw && nx <= Math.max(a.x, b.x) + hw) {
      if (Math.abs(ny - hh - a.y) <= fang_m) ny = r2(a.y + hh);
      else if (Math.abs(ny + hh - a.y) <= fang_m) ny = r2(a.y - hh);
    }
  }
  const neu = { ...m, x: nx, y: ny };
  return stehtImRaum(neu, umriss) ? neu : m;
}

/**
 * A quarter turn clockwise; refused (unchanged) when the turned piece would leave the room.
 * @param {BMoebel} m @param {ReadonlyArray<P>} umriss
 * @returns {BMoebel}
 */
export function drehen(m, umriss) {
  const neu = { ...m, rot: (m.rot + 90) % 360 };
  return stehtImRaum(neu, umriss) ? neu : m;
}

/**
 * What the client changed: one entry per piece whose place or rotation differs from the released state.
 * @param {ReadonlyArray<BMoebel>} freigegeben furniture of the projection
 * @param {ReadonlyArray<BMoebel>} jetzt the same furniture after the client's edits
 * @returns {Aenderung[]}
 */
export function aenderungenAus(freigegeben, jetzt) {
  const alt = new Map((freigegeben || []).map((m) => [`${m.raum}\u0000${m.id}`, m]));
  /** @type {Aenderung[]} */
  const aus = [];
  for (const m of jetzt || []) {
    const a = alt.get(`${m.raum}\u0000${m.id}`);
    if (a && (r2(a.x) !== r2(m.x) || r2(a.y) !== r2(m.y) || drehung(a.rot) !== drehung(m.rot))) aus.push([m.raum, m.id, r2(m.x), r2(m.y), drehung(m.rot)]);
  }
  return aus;
}

/** The proposal as the one text the feedback carries. @param {ReadonlyArray<Aenderung>} aenderungen @returns {string} */
export function vorschlagText(aenderungen) {
  return JSON.stringify(aenderungen || []);
}

/**
 * A proposal text back as entries — only well-formed ones (two texts, three finite numbers); null when the text is no proposal.
 * @param {unknown} text
 * @returns {Aenderung[]|null}
 */
export function vorschlagLesen(text) {
  if (typeof text !== 'string' || !text || text.length > VORSCHLAG_MAX) return null;
  /** @type {unknown} */
  let roh;
  try { roh = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(roh) || roh.length > VORSCHLAG_EINTRAEGE_MAX) return null;
  /** @type {Aenderung[]} */
  const aus = [];
  for (const e of roh) {
    if (!Array.isArray(e) || e.length !== 5 || typeof e[0] !== 'string' || typeof e[1] !== 'string' || ![e[2], e[3], e[4]].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    aus.push([e[0], e[1], r2(e[2]), r2(e[3]), drehung(e[4])]);
  }
  return aus;
}

/**
 * Checks a proposal against the projection it answers: every entry must name furniture of that projection and put it inside its
 * own room. Overlaps are reported, not refused (the office decides).
 * @param {{raeume?: ReadonlyArray<BRaum>, moebel?: ReadonlyArray<BMoebel>, aenderbar?: boolean}|null} projektion
 * @param {ReadonlyArray<Aenderung>|null} aenderungen
 * @returns {{ok: boolean, grund?: string, gueltig: Aenderung[], abgelehnt: Array<{id: string, grund: string}>, moebel: BMoebel[], ueberlappungen: number}}
 *   moebel: the furniture with the valid entries applied (for a preview); grund: plain text when nothing can be taken
 */
export function vorschlagPruefen(projektion, aenderungen) {
  const leer = { ok: false, gueltig: [], abgelehnt: [], moebel: [...(projektion?.moebel || [])], ueberlappungen: 0 };
  if (!projektion || projektion.aenderbar !== true) return { ...leer, grund: 'Zu dieser Möblierung ist kein Vorschlag angefragt.' };
  if (!Array.isArray(aenderungen)) return { ...leer, grund: 'Der Vorschlag ist nicht lesbar.' };
  if (!aenderungen.length) return { ...leer, grund: 'Der Vorschlag ändert nichts.' };
  const raum = new Map((projektion.raeume || []).map((r) => [r.schluessel, umrissLesen(r.umriss)]));
  const stand = new Map((projektion.moebel || []).map((m) => [`${m.raum}\u0000${m.id}`, m]));
  /** @type {Aenderung[]} */
  const gueltig = [];
  /** @type {Array<{id: string, grund: string}>} */
  const abgelehnt = [];
  for (const a of aenderungen) {
    const [rk, id, x, y, rot] = a;
    const m = stand.get(`${rk}\u0000${id}`);
    if (!m) { abgelehnt.push({ id, grund: 'Dieses Möbel gibt es in der freigegebenen Möblierung nicht.' }); continue; }
    const neu = { ...m, x, y, rot: drehung(rot) };
    if (!stehtImRaum(neu, raum.get(rk) || [])) { abgelehnt.push({ id, grund: 'Das Möbel stünde außerhalb seines Raums.' }); continue; }
    stand.set(`${rk}\u0000${id}`, neu);
    gueltig.push([rk, id, r2(x), r2(y), drehung(rot)]);
  }
  const moebel = [...stand.values()];
  let ueberlappungen = 0;
  for (let i = 0; i < moebel.length; i += 1) for (let j = i + 1; j < moebel.length; j += 1) if (moebel[i].raum === moebel[j].raum && ueberlappt(moebel[i], moebel[j])) ueberlappungen += 1;
  return gueltig.length ? { ok: true, gueltig, abgelehnt, moebel, ueberlappungen } : { ok: false, grund: 'Kein Eintrag des Vorschlags ist zulässig.', gueltig, abgelehnt, moebel, ueberlappungen };
}

/**
 * Takes a checked proposal over into the model's furnishing: centre and rotation of furniture that still stands under the same
 * room key with the same id. Nothing else of an item changes; furniture that is gone meanwhile is skipped and reported.
 * @param {Record<string, ReadonlyArray<Record<string, any>>>|null|undefined} moeblierung complexData.moeblierung
 * @param {ReadonlyArray<Aenderung>} aenderungen entries that passed vorschlagPruefen
 * @returns {{moeblierung: Record<string, Array<Record<string, any>>>, uebernommen: number, uebersprungen: string[]}} a NEW furnishing
 *   object (the input is never mutated); uebersprungen: ids of furniture no longer found
 */
export function vorschlagAnwenden(moeblierung, aenderungen) {
  /** @type {Record<string, Array<Record<string, any>>>} */
  const aus = Object.fromEntries(Object.entries(moeblierung || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((it) => ({ ...it })) : /** @type {any} */ (v)]));
  let uebernommen = 0;
  /** @type {string[]} */
  const uebersprungen = [];
  for (const [rk, id, x, y, rot] of aenderungen || []) {
    let it = Array.isArray(aus[rk]) ? aus[rk].find((m) => String(m?.id) === id) : null;
    if (!it) {
      // the furniture may still stand under an older key of the same room (moebel.js reads those too): taken when the id is unique
      const treffer = Object.values(aus).flatMap((l) => (Array.isArray(l) ? l.filter((m) => String(m?.id) === id) : []));
      if (treffer.length === 1) it = treffer[0];
    }
    if (!it) { uebersprungen.push(id); continue; }
    it.x = r2(x); it.y = r2(y); it.rot = drehung(rot);
    uebernommen += 1;
  }
  return { moeblierung: aus, uebernommen, uebersprungen };
}
