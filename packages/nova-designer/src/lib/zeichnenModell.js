// Drawing model for the building studio: the operations an agent and the numeric
// inputs share. Pure — no React, no I/O. The studio applies the returned model
// through the same setters as a click, and those setters record one step in
// bimHistorie.js (vorAenderung). Undo and redo are not implemented here.
//
// Coordinates are plan metres: x to the east, z to the south (plan-z points
// south; see the drawing skill). Angles are degrees, 0° along +x, 90° along +z.
// Lengths, thicknesses, widths, heights and sills are metres.
//
// In:  a ZeichenModell (element arrays + naechsteIdx) and a parameter object.
// Out: { ok:true, modell, element } or { ok:false, error } with a German sentence
//      the studio shows in the hint line. The input model is never mutated.

/** Millimetres stored as metres, so a typed coordinate does not grow float noise. */
const RUND = 1000;

/** Shortest wall the click tool already refuses, in metres. */
const MIN_WAND_M = 0.05;

/**
 * A double-click that both selects a hull wall and lands on the grip that
 * appears under the second click must not delete or insert a footprint corner.
 * The grip is accepted only after the wall has already been selected this long.
 * [ASSUMED] 400 ms: longer than a double-click, shorter than a deliberate second
 * gesture. No norm value.
 */
export const GRIFF_LOESCH_WARTE_MS = 400;

/**
 * @typedef {{ x: number, z: number }} Pkt
 * @typedef {{
 *   customWalls: any[], customColumns: any[], customWindows: any[], envOpenings: any[],
 *   customZones: any[], customSlabs: any[], customRoofs: any[], naechsteIdx: number,
 *   storeyHeight_m?: number
 * }} ZeichenModell
 */

/**
 * @param {number} v
 * @returns {number} metres, rounded to the millimetre
 */
function rund(v) {
  return Math.round(Number(v) * RUND) / RUND;
}

/**
 * @param {any} p
 * @returns {Pkt|null}
 */
function punkt(p) {
  const x = Number(p?.x), z = Number(p?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: rund(x), z: rund(z) };
}

/**
 * @param {string} error German sentence for the hint line
 * @returns {{ ok: false, error: string }}
 */
function nein(error) {
  return { ok: false, error };
}

/**
 * @param {ZeichenModell} modell
 * @param {Partial<ZeichenModell>} teil
 * @param {any} element
 * @param {number} naechsteIdx
 * @returns {{ ok: true, modell: ZeichenModell, element: any }}
 */
function ja(modell, teil, element, naechsteIdx) {
  return { ok: true, modell: { ...modell, ...teil, naechsteIdx }, element };
}

/**
 * Empty element model. naechsteIdx is the next free `_idx` (integer).
 * @returns {ZeichenModell}
 */
export function leeresZeichenmodell() {
  return {
    customWalls: [], customColumns: [], customWindows: [], envOpenings: [],
    customZones: [], customSlabs: [], customRoofs: [], naechsteIdx: 1,
  };
}

/**
 * End point of a segment. Angle 0° is +x (east), 90° is +z (south).
 * @param {Pkt} start start point in metres
 * @param {number} laenge_m length in metres
 * @param {number} winkel_grad direction in degrees
 * @returns {Pkt}
 */
export function punktAusLaengeWinkel(start, laenge_m, winkel_grad) {
  const rad = (Number(winkel_grad) * Math.PI) / 180;
  const l = Number(laenge_m);
  return { x: rund(start.x + Math.cos(rad) * l), z: rund(start.z + Math.sin(rad) * l) };
}

/**
 * @param {any} w wall `{a,b}` in metres
 * @returns {number} length in metres
 */
function wandLaenge(w) {
  return Math.hypot(Number(w?.b?.x) - Number(w?.a?.x), Number(w?.b?.z) - Number(w?.a?.z));
}

/**
 * @param {ZeichenModell} modell
 * @param {{ a: Pkt, b: Pkt, level?: number, thickness_m?: number, height_m?: number|null,
 *   refLine?: string, composite?: string|null, storeyHeight_m?: number }} spec
 *   a, b: end points in metres. level: storey index (0 = ground floor). thickness_m: single-layer
 *   thickness in metres (ignored by the viewer when composite is set — same rule as wandDicke_m).
 *   height_m: absolute height in metres; omitted = the wall follows one storey, like a click.
 *   storeyHeight_m: storey height in metres stored on the record when the top follows the storey.
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: "wall", id: number } } | { ok: false, error: string }}
 */
export function wandAnlegen(modell, spec) {
  const a = punkt(spec?.a), b = punkt(spec?.b);
  if (!a || !b) return nein("Wand braucht Start und Ende mit x und z in Metern.");
  if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_WAND_M) return nein("Wand kürzer als 5 cm.");
  const id = modell.naechsteIdx;
  const folgt = spec?.height_m == null || !Number.isFinite(Number(spec.height_m));
  const hoehe = folgt ? Number(spec?.storeyHeight_m ?? modell.storeyHeight_m) || 3 : Number(spec.height_m);
  if (!Number.isFinite(hoehe) || hoehe <= 0) return nein("Wandhöhe muss in Metern größer als 0 sein.");
  const dicke = spec?.thickness_m == null ? 0.3 : Number(spec.thickness_m);
  if (!Number.isFinite(dicke) || dicke <= 0) return nein("Wanddicke muss in Metern größer als 0 sein.");
  const wand = {
    a, b, level: Math.round(Number(spec?.level) || 0), thickness: rund(dicke), height: rund(hoehe),
    oberkante_bezug: folgt ? "geschoss" : "absolut", oberkante_geschosse: 1, oberkante_versatz_m: 0,
    refLine: spec?.refLine || "center",
    ...(spec?.composite ? { composite: spec.composite } : {}),
    _idx: id,
  };
  return ja(modell, { customWalls: [...modell.customWalls, wand] }, { art: "wall", id }, id + 1);
}

/**
 * Wall from a start point, a length and an angle. Same record as wandAnlegen.
 * @param {ZeichenModell} modell
 * @param {{ start: Pkt, laenge_m: number, winkel_grad: number, level?: number, thickness_m?: number,
 *   height_m?: number|null, refLine?: string, composite?: string|null, storeyHeight_m?: number }} spec
 *   start: metres. laenge_m: metres. winkel_grad: degrees, 0 = +x, 90 = +z (south).
 * @returns {ReturnType<typeof wandAnlegen>}
 */
export function wandAusRichtung(modell, spec) {
  const start = punkt(spec?.start);
  if (!start) return nein("Wand braucht einen Startpunkt mit x und z in Metern.");
  const laenge = Number(spec?.laenge_m);
  if (!Number.isFinite(laenge) || laenge < MIN_WAND_M) return nein("Wandlänge muss in Metern mindestens 5 cm sein.");
  const winkel = Number(spec?.winkel_grad);
  if (!Number.isFinite(winkel)) return nein("Wandwinkel muss in Grad angegeben sein.");
  return wandAnlegen(modell, { ...spec, a: start, b: punktAusLaengeWinkel(start, laenge, winkel) });
}

/**
 * Door, window or empty opening on a drawn wall. The middle sits `versatz_m` metres
 * from the wall start and is clamped inside the wall, like a click (half the width plus 10 cm).
 * @param {ZeichenModell} modell
 * @param {{ wandId: number, kind?: "window"|"door"|"oeffnung", versatz_m?: number, breite_m?: number,
 *   hoehe_m?: number, bruestung_m?: number, typeId?: string }} spec
 *   wandId: `_idx` of a drawn wall. versatz_m: metres along the wall from a. breite_m, hoehe_m,
 *   bruestung_m: metres (sill measured from the bottom of the wall). Omitted sizes use the type
 *   defaults (window 1.00×1.40 m, sill 0.90 m; door 1.00×2.10 m, sill 0).
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: "opening", id: number, scope: "custom" } } | { ok: false, error: string }}
 */
export function oeffnungAnlegen(modell, spec) {
  const wand = modell.customWalls.find((w) => w._idx === spec?.wandId);
  if (!wand) return nein("Keine gezeichnete Wand mit dieser Nummer.");
  const kind = spec?.kind === "door" ? "door" : spec?.kind === "oeffnung" ? "oeffnung" : "window";
  const typeId = spec?.typeId || (kind === "door" ? "single" : kind === "oeffnung" ? "oeffnung" : "single");
  const breite = spec?.breite_m == null ? (kind === "door" ? 1 : kind === "oeffnung" ? 1 : 1) : Number(spec.breite_m);
  const hoehe = spec?.hoehe_m == null ? (kind === "door" ? 2.1 : kind === "oeffnung" ? 2.1 : 1.4) : Number(spec.hoehe_m);
  const bruestung = spec?.bruestung_m == null ? (kind === "window" ? 0.9 : 0) : Number(spec.bruestung_m);
  if (![breite, hoehe, bruestung].every((n) => Number.isFinite(n) && n >= 0) || breite <= 0 || hoehe <= 0) {
    return nein("Öffnung braucht Breite und Höhe in Metern größer als 0.");
  }
  const len = wandLaenge(wand);
  const half = breite / 2;
  const versatz = spec?.versatz_m == null ? len / 2 : Number(spec.versatz_m);
  if (!Number.isFinite(versatz)) return nein("Abstand der Öffnung muss in Metern angegeben sein.");
  const u = rund(Math.max(half + 0.1, Math.min(versatz, Math.max(half + 0.1, len - half - 0.1))));
  const id = modell.naechsteIdx;
  const satz = { wallIdx: wand._idx, u, kind, typeId, width: rund(breite), height: rund(hoehe), sill: rund(bruestung), _idx: id };
  return ja(modell, { customWindows: [...modell.customWindows, satz] }, { art: "opening", id, scope: "custom" }, id + 1);
}

/**
 * Rectangle in the plan, corners in metres. Width runs along +x, depth along +z.
 * @param {number} x origin x in metres
 * @param {number} z origin z in metres
 * @param {number} breite_m metres along +x
 * @param {number} tiefe_m metres along +z
 * @returns {Pkt[]|null}
 */
function rechteck(x, z, breite_m, tiefe_m) {
  const o = punkt({ x, z });
  const b = Number(breite_m), t = Number(tiefe_m);
  if (!o || !Number.isFinite(b) || !Number.isFinite(t) || b <= 0 || t <= 0) return null;
  return [o, { x: rund(o.x + b), z: o.z }, { x: rund(o.x + b), z: rund(o.z + t) }, { x: o.x, z: rund(o.z + t) }];
}

/**
 * Slab from an explicit polygon or from a rectangle (x, z, breite_m, tiefe_m), all in metres.
 * @param {ZeichenModell} modell
 * @param {{ points?: Pkt[], x?: number, z?: number, breite_m?: number, tiefe_m?: number, level?: number, dicke_m?: number }} spec
 *   dicke_m: slab thickness in metres (default 0.22, the studio default).
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: "slab", id: number } } | { ok: false, error: string }}
 */
export function deckeAnlegen(modell, spec) {
  const pts = Array.isArray(spec?.points) && spec.points.length >= 3
    ? spec.points.map(punkt)
    : rechteck(spec?.x, spec?.z, spec?.breite_m, spec?.tiefe_m);
  if (!pts || pts.some((p) => !p)) return nein("Decke braucht mindestens drei Punkte oder ein Rechteck in Metern.");
  const id = modell.naechsteIdx;
  const decke = {
    points: pts, level: Math.round(Number(spec?.level) || 0), _idx: id,
    ...(spec?.dicke_m != null ? { dicke_m: rund(Number(spec.dicke_m)) } : {}),
  };
  if (decke.dicke_m != null && !(decke.dicke_m > 0)) return nein("Deckendicke muss in Metern größer als 0 sein.");
  return ja(modell, { customSlabs: [...modell.customSlabs, decke] }, { art: "slab", id }, id + 1);
}

/**
 * Zone (room polygon) from points or from a rectangle, in metres.
 * @param {ZeichenModell} modell
 * @param {{ points?: Pkt[], x?: number, z?: number, breite_m?: number, tiefe_m?: number, level?: number, name?: string }} spec
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: "zone", id: number } } | { ok: false, error: string }}
 */
export function zoneAnlegen(modell, spec) {
  const pts = Array.isArray(spec?.points) && spec.points.length >= 3
    ? spec.points.map(punkt)
    : rechteck(spec?.x, spec?.z, spec?.breite_m, spec?.tiefe_m);
  if (!pts || pts.some((p) => !p)) return nein("Raum braucht mindestens drei Punkte oder ein Rechteck in Metern.");
  const id = modell.naechsteIdx;
  const name = String(spec?.name || `Raum ${modell.customZones.length + 1}`);
  const zone = { points: pts, level: Math.round(Number(spec?.level) || 0), name, _idx: id };
  return ja(modell, { customZones: [...modell.customZones, zone] }, { art: "zone", id }, id + 1);
}

/** Longest text of a plan note in characters [ASSUMED: a note is a short remark on the sheet, not a report]. */
export const NOTIZ_MAX_ZEICHEN = 200;

/**
 * 261111-zs1: text note at a point of the plan ("Notiz: Brüstung prüfen"). A note is a plan annotation, not a building
 * element: it lives in the additive list `planNotizen` of the model record (a record without the list gets it here).
 * @param {ZeichenModell & {planNotizen?: any[]}} modell
 * @param {{ punkt: Pkt, level?: number, text: string }} spec  punkt: anchor point in metres; level: storey index; text: the note (trimmed, 1..NOTIZ_MAX_ZEICHEN characters).
 * @returns {{ ok: true, modell: ZeichenModell & {planNotizen: any[]}, element: { art: "note", id: number } } | { ok: false, error: string }}
 */
export function notizAnlegen(modell, spec) {
  const p = punkt(spec?.punkt);
  if (!p) return nein("Notiz braucht einen Punkt mit x und z in Metern.");
  const text = String(spec?.text ?? "").trim();
  if (!text) return nein("Notiz ohne Text.");
  if (text.length > NOTIZ_MAX_ZEICHEN) return nein(`Notiz länger als ${NOTIZ_MAX_ZEICHEN} Zeichen.`);
  const id = modell.naechsteIdx;
  const notiz = { x: p.x, z: p.z, level: Math.round(Number(spec?.level) || 0), text, _idx: id };
  return /** @type {any} */ (ja(modell, /** @type {any} */ ({ planNotizen: [...(modell.planNotizen || []), notiz] }), { art: "note", id }, id + 1));
}

/** Fields a caller may change. Anything else is refused so a patch cannot replace `_idx`. */
const FELDER = {
  wall: ["a", "b", "level", "thickness", "height", "refLine", "composite", "oberkante_bezug", "oberkante_geschosse", "oberkante_versatz_m", "unterkante_versatz_m", "raumbegrenzend"],
  column: ["x", "z", "level", "size"],
  opening: ["u", "width", "height", "sill", "kind", "typeId", "bruestung_bezug"],
  zone: ["name", "level", "points", "messregel", "din277_gruppe"],
  slab: ["level", "points", "dicke_m", "bezug"],
};

/**
 * @param {ZeichenModell} modell
 * @param {"wall"|"column"|"opening"|"zone"|"slab"} art
 * @returns {any[]|null}
 */
function listeVon(modell, art) {
  if (art === "wall") return modell.customWalls;
  if (art === "column") return modell.customColumns;
  if (art === "opening") return modell.customWindows;
  if (art === "zone") return modell.customZones;
  if (art === "slab") return modell.customSlabs;
  return null;
}

/**
 * @param {"wall"|"column"|"opening"|"zone"|"slab"} art
 * @returns {keyof ZeichenModell|null}
 */
function schluessel(art) {
  if (art === "wall") return "customWalls";
  if (art === "column") return "customColumns";
  if (art === "opening") return "customWindows";
  if (art === "zone") return "customZones";
  if (art === "slab") return "customSlabs";
  return null;
}

/**
 * Change one drawn element. `patch.thickness` is metres, `patch.u` is metres along the wall.
 * @param {ZeichenModell} modell
 * @param {{ art: "wall"|"column"|"opening"|"zone"|"slab", id: number, patch: Record<string, any> }} spec
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: string, id: number } } | { ok: false, error: string }}
 */
export function elementAendern(modell, spec) {
  const key = schluessel(spec?.art);
  const liste = key ? listeVon(modell, spec.art) : null;
  if (!liste) return nein("Unbekannte Bauteilart.");
  const erlaubt = new Set(FELDER[spec.art]);
  const patch = spec?.patch || {};
  const fremd = Object.keys(patch).filter((k) => !erlaubt.has(k));
  if (fremd.length) return nein(`Feld nicht änderbar: ${fremd.join(", ")}.`);
  if (!liste.some((el) => el._idx === spec.id)) return nein("Bauteil nicht gefunden.");
  const neu = liste.map((el) => (el._idx === spec.id ? { ...el, ...patch } : el));
  return ja(modell, { [key]: neu }, { art: spec.art, id: spec.id }, modell.naechsteIdx);
}

/**
 * The doors, windows and openings that stay when walls are deleted: an opening whose host wall (`wallIdx`) is among the deleted
 * walls goes with it — the one rule for the drawing agent (elementLoeschen) and every delete in the studio (Entf, frame selection,
 * context menu). Openings of other walls and hull openings (`envOpenings`, no `wallIdx`) are not touched.
 * @param {any[]} oeffnungen customWindows records
 * @param {Iterable<number>} wandIds `_idx` of the deleted walls
 * @returns {any[]} the same array when nothing goes, else a new one
 */
export function oeffnungenOhneWaende(oeffnungen, wandIds) {
  const weg = new Set(wandIds);
  const liste = Array.isArray(oeffnungen) ? oeffnungen : [];
  if (!weg.size || !liste.some((o) => weg.has(o?.wallIdx))) return liste;
  return liste.filter((o) => !weg.has(o?.wallIdx));
}

/**
 * Delete one drawn element. A wall takes its openings with it (oeffnungenOhneWaende).
 * @param {ZeichenModell} modell
 * @param {{ art: "wall"|"column"|"opening"|"zone"|"slab", id: number }} spec id is `_idx`
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: string, id: number } } | { ok: false, error: string }}
 */
export function elementLoeschen(modell, spec) {
  const key = schluessel(spec?.art);
  const liste = key ? listeVon(modell, spec.art) : null;
  if (!liste) return nein("Unbekannte Bauteilart.");
  if (!liste.some((el) => el._idx === spec.id)) return nein("Bauteil nicht gefunden.");
  const teil = { [key]: liste.filter((el) => el._idx !== spec.id) };
  if (spec.art === "wall") teil.customWindows = oeffnungenOhneWaende(modell.customWindows, [spec.id]);
  return ja(modell, teil, { art: spec.art, id: spec.id }, modell.naechsteIdx);
}

/**
 * Copy of one element onto another storey: new `_idx`, no GUID (the save assigns one from the new number).
 * @param {any} el
 * @param {number} level storey index
 * @param {number} id new `_idx`
 * @param {Record<string, any>} extra
 */
function kopie(el, level, id, extra = {}) {
  const { guid: _g, wirt_guid: _w, geaendert_durch: _d, ...rest } = el;
  return { ...rest, ...extra, level, _idx: id };
}

/**
 * Copy the drawn elements of one storey onto another: walls, their doors and windows,
 * columns, zones and slabs. Roofs stay (they belong to the top). Hull openings of that
 * storey are copied onto the same edge of the target storey. Both levels are storey indices
 * (0 = ground floor). The target storey must already exist; this function does not change
 * the storey count.
 * @param {ZeichenModell} modell
 * @param {{ von: number, nach: number }} spec von, nach: storey index
 * @returns {{ ok: true, modell: ZeichenModell, element: { art: "storey", von: number, nach: number, anzahl: number } } | { ok: false, error: string }}
 */
export function geschossKopieren(modell, spec) {
  const von = Math.round(Number(spec?.von));
  const nach = Math.round(Number(spec?.nach));
  if (!Number.isInteger(von) || !Number.isInteger(nach)) return nein("Geschoss kopieren braucht zwei Geschossnummern.");
  if (von === nach) return nein("Quelle und Ziel sind dasselbe Geschoss.");
  let idx = modell.naechsteIdx;
  const wandMap = new Map();
  const waende = [];
  for (const w of modell.customWalls) {
    if ((w.level ?? 0) !== von) continue;
    const id = idx++;
    wandMap.set(w._idx, id);
    waende.push(kopie(w, nach, id));
  }
  const fenster = [];
  for (const o of modell.customWindows) {
    const ziel = wandMap.get(o.wallIdx);
    if (ziel == null) continue;
    const id = idx++;
    const { guid: _g, wirt_guid: _w, geaendert_durch: _d, level: _l, ...rest } = o;
    fenster.push({ ...rest, wallIdx: ziel, _idx: id });
  }
  const huelle = [];
  for (const o of modell.envOpenings) {
    if ((o.level ?? 0) !== von) continue;
    huelle.push(kopie(o, nach, idx++));
  }
  const stuetzen = modell.customColumns.filter((c) => (c.level ?? 0) === von).map((c) => kopie(c, nach, idx++));
  const zonen = modell.customZones.filter((z) => (z.level ?? 0) === von).map((z) => kopie(z, nach, idx++));
  const decken = modell.customSlabs.filter((s) => (s.level ?? 0) === von).map((s) => kopie(s, nach, idx++));
  const anzahl = waende.length + fenster.length + huelle.length + stuetzen.length + zonen.length + decken.length;
  if (!anzahl) return ja(modell, {}, { art: "storey", von, nach, anzahl: 0 }, modell.naechsteIdx);
  return ja(modell, {
    customWalls: [...modell.customWalls, ...waende],
    customWindows: [...modell.customWindows, ...fenster],
    envOpenings: [...modell.envOpenings, ...huelle],
    customColumns: [...modell.customColumns, ...stuetzen],
    customZones: [...modell.customZones, ...zonen],
    customSlabs: [...modell.customSlabs, ...decken],
  }, { art: "storey", von, nach, anzahl }, idx);
}

/**
 * Reply a drawing agent may keep. The whole model stays inside the studio:
 * the caller gets `element` (the new or changed record, plus `art` and `id`)
 * and never `modell`. A delete has no record left, so `element` is only `{art, id}`.
 * @param {{ ok?: boolean, error?: string, modell?: ZeichenModell, element?: any }} r
 *   result of a pure operation (still carries `modell` for the studio)
 * @returns {{ ok: true, element: any } | { ok: false, error: string }}
 */
export function elementFuerApi(r) {
  if (!r?.ok) return { ok: false, error: r?.error || "Schreibfehler" };
  const el = r.element || {};
  const m = r.modell;
  /** @type {any} */
  let satz = null;
  if (m && el.id != null) {
    if (el.art === "wall") satz = (m.customWalls || []).find((/** @type {any} */ w) => w._idx === el.id);
    else if (el.art === "column") satz = (m.customColumns || []).find((/** @type {any} */ c) => c._idx === el.id);
    else if (el.art === "opening") satz = ((el.scope === "env" ? m.envOpenings : m.customWindows) || []).find((/** @type {any} */ o) => o._idx === el.id);
    else if (el.art === "zone") satz = (m.customZones || []).find((/** @type {any} */ z) => z._idx === el.id);
    else if (el.art === "slab") satz = (m.customSlabs || []).find((/** @type {any} */ s) => s._idx === el.id);
    else if (el.art === "roof") satz = (m.customRoofs || []).find((/** @type {any} */ x) => x._idx === el.id);
  }
  const element = satz ? { ...satz, ...el, _idx: satz._idx } : { ...el };
  return { ok: true, element };
}

/**
 * How many drawn elements sit on one storey. Openings count with their wall's storey.
 * Hull openings count on their own level. The numbers are for that storey only.
 * @param {Pick<ZeichenModell, "customWalls"|"customColumns"|"customWindows"|"envOpenings"|"customZones"|"customSlabs"|"customRoofs">} modell
 * @param {number} level storey index (0 = ground floor)
 * @returns {{ level: number, bereich: "geschoss", waende: number, stuetzen: number, fenster: number, tueren: number, oeffnungen: number, raeume: number, decken: number, daecher: number }}
 */
export function zaehleGeschoss(modell, level) {
  const lvl = Math.round(Number(level) || 0);
  const waende = (modell.customWalls || []).filter((w) => (w.level ?? 0) === lvl);
  const ids = new Set(waende.map((w) => w._idx));
  const offen = (modell.customWindows || []).filter((o) => ids.has(o.wallIdx));
  const huelle = (modell.envOpenings || []).filter((o) => (o.level ?? 0) === lvl);
  const alle = [...offen, ...huelle];
  // Strict kinds: a door is never a window and never an empty opening (`oeffnungen`).
  // A missing kind counts as a window, which is what a click stored before `kind` existed.
  const art = (/** @type {any} */ o) => (o?.kind === "door" ? "door" : o?.kind === "oeffnung" ? "oeffnung" : "window");
  const ist = (kind) => alle.filter((o) => art(o) === kind).length;
  return {
    level: lvl, bereich: "geschoss",
    waende: waende.length,
    stuetzen: (modell.customColumns || []).filter((c) => (c.level ?? 0) === lvl).length,
    fenster: ist("window"), tueren: ist("door"), oeffnungen: ist("oeffnung"),
    raeume: (modell.customZones || []).filter((z) => (z.level ?? 0) === lvl).length,
    decken: (modell.customSlabs || []).filter((s) => (s.level ?? 0) === lvl).length,
    daecher: (modell.customRoofs || []).filter((r) => (r.level ?? 0) === lvl).length,
  };
}

/**
 * Read elements. `level` filters by storey index. `id` is `_idx`.
 * @param {ZeichenModell} modell
 * @param {{ art?: "wall"|"column"|"opening"|"zone"|"slab"|"roof", level?: number, id?: number }} [filter]
 * @returns {any[]} copies
 */
export function abfragen(modell, filter = {}) {
  const art = filter.art;
  /** @type {any[]} */
  let liste = [];
  if (!art || art === "wall") liste = liste.concat(modell.customWalls.map((w) => ({ ...w, art: "wall" })));
  if (!art || art === "column") liste = liste.concat(modell.customColumns.map((w) => ({ ...w, art: "column" })));
  if (!art || art === "opening") liste = liste.concat(modell.customWindows.map((w) => ({ ...w, art: "opening", scope: "custom" })));
  if (!art || art === "zone") liste = liste.concat(modell.customZones.map((w) => ({ ...w, art: "zone" })));
  if (!art || art === "slab") liste = liste.concat(modell.customSlabs.map((w) => ({ ...w, art: "slab" })));
  if (!art || art === "roof") liste = liste.concat((modell.customRoofs || []).map((w) => ({ ...w, art: "roof" })));
  if (filter.id != null) liste = liste.filter((el) => el._idx === filter.id);
  if (filter.level != null && art !== "opening") liste = liste.filter((el) => (el.level ?? 0) === Math.round(Number(filter.level)));
  if (filter.level != null && art === "opening") {
    const ids = new Set(modell.customWalls.filter((w) => (w.level ?? 0) === Math.round(Number(filter.level))).map((w) => w._idx));
    liste = liste.filter((el) => ids.has(el.wallIdx));
  }
  return liste.map((el) => ({ ...el }));
}

/**
 * Whether a footprint grip may delete or insert a corner.
 * @param {number} alterMs milliseconds since this hull wall became the selection
 * @param {number} [warteMs] threshold in milliseconds (default GRIFF_LOESCH_WARTE_MS)
 * @returns {boolean} true only when the selection is old enough to be deliberate
 */
export function griffLoeschenErlaubt(alterMs, warteMs = GRIFF_LOESCH_WARTE_MS) {
  return Number(alterMs) >= warteMs;
}

/**
 * Footprint after a double-click on corner `index`. A fresh selection (the click
 * that revealed the grip) returns the same corners. At least three corners remain.
 * @param {Array<{x: number, z: number}>} punkte footprint corners in metres
 * @param {number} index corner index
 * @param {number} alterMs age of the selection in milliseconds
 * @param {number} [warteMs]
 * @returns {Array<{x: number, z: number}>} next corners (a new array)
 */
export function fussabdruckNachDoppelklick(punkte, index, alterMs, warteMs = GRIFF_LOESCH_WARTE_MS) {
  const liste = (Array.isArray(punkte) ? punkte : []).map((p) => ({ x: p.x, z: p.z }));
  if (!griffLoeschenErlaubt(alterMs, warteMs) || liste.length <= 3) return liste;
  const i = Math.round(Number(index));
  if (!Number.isInteger(i) || i < 0 || i >= liste.length) return liste;
  return liste.filter((_, k) => k !== i);
}

/**
 * Undo/redo shortcut, or null. Text fields are left to the browser.
 * Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo. Alt is not a drawing shortcut.
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean, target?: any }} e
 * @returns {"undo"|"redo"|null}
 */
export function editorKuerzel(e) {
  const ziel = e?.target;
  const tag = String(ziel?.tagName || "");
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || ziel?.isContentEditable) return null;
  if (typeof ziel?.closest === "function" && ziel.closest("input,textarea,select,[contenteditable]")) return null;
  if (!(e?.ctrlKey || e?.metaKey) || e?.altKey) return null;
  const k = String(e?.key || "").toLowerCase();
  if (k === "z" && !e.shiftKey) return "undo";
  if (k === "y" || (k === "z" && e.shiftKey)) return "redo";
  return null;
}

/**
 * Grundriss-Bedienung part 1: ⌘A (Mac) / Ctrl+A selects all elements of the active storey. Not while a text field has the focus
 * (there the browser selects the text), not with Alt or Shift.
 * @param {any} e keydown event
 * @returns {boolean}
 */
export function alleWaehlenKuerzel(e) {
  const ziel = e?.target;
  const tag = String(ziel?.tagName || "");
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || ziel?.isContentEditable) return false;
  if (typeof ziel?.closest === "function" && ziel.closest("input,textarea,select,[contenteditable]")) return false;
  if (!(e?.ctrlKey || e?.metaKey) || e?.altKey || e?.shiftKey) return false;
  return String(e?.key || "").toLowerCase() === "a";
}

/** Layer id of each selectable drawn element type (same mapping as the studio's EBENE_VON_TYP). */
const AUSWAHL_EBENE = Object.freeze({ wall: "walls", column: "columns", opening: "openings", zone: "zones", slab: "shell", roof: "attika" });

/**
 * Selection entries of all drawn elements of one storey — what ⌘A selects, in the form of the frame selection: walls, columns, the
 * doors/windows on those walls (scope "custom"), zones, slabs, roofs. Elements on a hidden or locked layer are left out
 * (`erlaubt`), like a click refuses a locked layer. Hull walls and hull openings are not drawn elements and stay out, as in the frame.
 * @param {Pick<ZeichenModell, "customWalls"|"customColumns"|"customWindows"|"customZones"|"customSlabs"|"customRoofs">} modell
 * @param {number} level storey index
 * @param {(ebeneId: string) => boolean} [erlaubt] true = the layer may be selected (visible and not locked)
 * @returns {Array<{type: string, index: number, scope?: string}>}
 */
export function alleImGeschoss(modell, level, erlaubt = () => true) {
  /** @type {Array<{type: string, index: number, scope?: string}>} */
  const aus = [];
  const darf = (/** @type {keyof typeof AUSWAHL_EBENE} */ t) => erlaubt(AUSWAHL_EBENE[t]);
  const imGeschoss = (/** @type {any} */ el) => Number(el?.level) === level;
  const waende = (modell.customWalls || []).filter(imGeschoss);
  if (darf("wall")) for (const w of waende) aus.push({ type: "wall", index: w._idx });
  if (darf("column")) for (const c of (modell.customColumns || []).filter(imGeschoss)) aus.push({ type: "column", index: c._idx });
  if (darf("opening")) {
    const ids = new Set(waende.map((w) => w._idx));
    for (const o of modell.customWindows || []) if (ids.has(o.wallIdx)) aus.push({ type: "opening", index: o._idx, scope: "custom" });
  }
  for (const [t, liste] of /** @type {Array<[keyof typeof AUSWAHL_EBENE, any[]|undefined]>} */ ([["zone", modell.customZones], ["slab", modell.customSlabs], ["roof", modell.customRoofs]])) {
    if (darf(t)) for (const el of (liste || []).filter(imGeschoss)) aus.push({ type: t, index: el._idx });
  }
  return aus;
}

/**
 * Shift + frame: the frame's elements are ADDED to the selection (entries already selected stay once), instead of replacing it.
 * @param {Array<{type: string, index: number, scope?: string}>} alt current selection
 * @param {Array<{type: string, index: number, scope?: string}>} neu elements inside the frame
 * @returns {Array<{type: string, index: number, scope?: string}>}
 */
export function auswahlErgaenzen(alt, neu) {
  const schl = (/** @type {{type: string, index: number, scope?: string}} */ m) => `${m.type}:${m.index}:${m.scope || ""}`;
  const da = new Set((alt || []).map(schl));
  return [...(alt || []), ...(neu || []).filter((m) => !da.has(schl(m)) && da.add(schl(m)))];
}

/**
 * Clamps a typed number into [min, max], both in the field's own unit (metres for a wall thickness).
 * An empty field is `leer` (the caller may keep the previous value or clear an optional size).
 * A text that is not a number returns null (do not commit).
 * @param {unknown} text raw field text
 * @param {number|null|undefined} min lower bound, same unit as the field
 * @param {number|null|undefined} max upper bound, same unit as the field
 * @returns {{ leer: true } | { leer: false, wert: number } | null}
 */
export function zahlKlemmen(text, min, max) {
  if (text == null || String(text).trim() === "") return { leer: true };
  const n = Number(String(text).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  let wert = n;
  if (min != null && Number.isFinite(Number(min))) wert = Math.max(Number(min), wert);
  if (max != null && Number.isFinite(Number(max))) wert = Math.min(Number(max), wert);
  return { leer: false, wert };
}

/**
 * True when the key event belongs to the open editor. A click on the drawing
 * canvas focuses `<main tabindex="-1">` (the page), which is outside the studio
 * card — that still counts. The app sidebar does not.
 * @param {{ contains?: (n: any) => boolean }|null} root editor root element
 * @param {any} target event target
 * @param {{ body?: any, html?: any, haupt?: { contains?: (n: any) => boolean }|null }} [seite]
 *   document.body, documentElement, and the page main element
 * @returns {boolean}
 */
export function fokusImEditor(root, target, seite = {}) {
  if (!target || target === seite.body || target === seite.html) return true;
  const haupt = seite.haupt;
  if (haupt && (target === haupt || haupt.contains?.(target))) return true;
  if (root?.contains?.(target)) return true;
  return false;
}
