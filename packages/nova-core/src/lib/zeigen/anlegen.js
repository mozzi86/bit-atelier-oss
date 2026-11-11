// 261111-zs1: "Zeigen und Sagen" for CREATING elements - the pure geometry and the element builder behind the proposal kind
// "anlegen" of the change chain (aenderungen.js). The place comes from pointing (numbered points, the selection), kind and size
// come from the sentence (sprachbefehl.js). Nothing here changes a model in place and nothing runs before a person confirmed
// the proposal (guard rail 1 of phase 106): this module only answers "where exactly" and builds the NEW model on request.
//
// What it holds:
//  - the pointing points: at most ZEIGEPUNKTE_MAX numbered points, the oldest drops out (punkteHinzu),
//  - door snapping: which drawn wall a point means and where along it (wandAmPunkt) - refused, never guessed, when no wall or two
//    walls are equally near,
//  - rooms by number (raumNachNummer) and "the wall between room A and room B" (wandZwischenRaeumen),
//  - the element builder (anlegenBauen): it calls the studio's OWN drawing functions (@designer/lib/zeichnenModell.js wandAnlegen,
//    oeffnungAnlegen, notizAnlegen), handed in as `zeichnen` because @core must not import @designer. So an element made by a sentence
//    is the same record a click or the drawing agent makes, plus the additive fields of the sentence (status, wall kind, fire rating,
//    DIN hinge side) and its pinned GUID.
//
// In:  model record (customWalls, customWindows, customZones, planNotizen ... in m; plan x east, z south), points {x, z, level} in m,
//      the parameters of an "anlegen" proposal, the drawing functions.
// Out: plain results {ok, ...} / {ok: false, grund} with a German sentence, or a new model + the created element. Pure, node-testable.
import { bauteilGuid } from "../bauteil/steckbrief.js";
import { wandGeometrie } from "../bauteil/referenz.js";
import { oeffnungsMasse } from "../bauteil/oeffnungen.js";

/** Most pointing points at a time (decision D1 of 261111-zs1): numbered 1..4 in the order they were set. */
export const ZEIGEPUNKTE_MAX = 4;

/**
 * How far a point may lie outside the face of a wall and still mean that wall for a door, in m [ASSUMED: 0.30 m - a click
 * "on the wall" at plan scales 1:50-1:100 lands within a few millimetres on paper; a larger capture would grab the neighbour wall].
 */
export const TUER_FANG_TOLERANZ_M = 0.3;

/**
 * Distance from the wall axis a point may have when the wall is SELECTED and the point only gives the place along it, in m
 * [ASSUMED: 1.2 m, the capture distance of the studio's own door click (BitBimStudio onPoint)].
 */
export const TUER_FANG_AUSWAHL_M = 1.2;

/** Two walls whose distances to a point differ by less than this are "equally near" and the point is refused, in m [ASSUMED: 5 cm]. */
export const TUER_MEHRDEUTIG_M = 0.05;

/** Clearance between a door leaf edge and the wall end the drawing function keeps, in m (same 10 cm as oeffnungAnlegen / neueOeffnung). */
export const TUER_RAND_M = 0.1;

/** Status every element made by "anlegen" gets: the internal spelling of "neu" (the status convention has no alias "neu", decision D6). */
export const ANLEGEN_STATUS = "neubau";

/**
 * Kinds of wall a sentence can name -> label for the sentence and the additive fields the new wall gets.
 * [ASSUMED] Trockenbau: non-load-bearing partition (BAUTEIL_TYPEN "wand-innen") of trade LB 039 Trockenbauarbeiten (STLB-Bau), as the
 * data sheet's own note on "wand-innen" says ("als Trockenbauwand LB 039 setzen"); Mauerwerk: only the material - whether it is
 * load-bearing stays with the data sheet's thickness rule (typFuerWand). A plain "Wand" gets nothing beyond its thickness.
 * @type {Readonly<Record<string, {label: string, felder: Readonly<Record<string, string>>}>>}
 */
export const WANDARTEN = Object.freeze({
  trockenbau: Object.freeze({ label: "Trockenbauwand", felder: Object.freeze({ bauteil_typ: "wand-innen", material: "Trockenbau", gewerk_lb: "039" }) }),
  mauerwerk: Object.freeze({ label: "Mauerwerkswand", felder: Object.freeze({ material: "Mauerwerk" }) }),
  wand: Object.freeze({ label: "Wand", felder: Object.freeze({}) }),
});

/** DIN hinge sides of a door (DIN 107: seen from the side the door opens to, hinges on the left = DIN links). */
export const DIN_ANSCHLAEGE = Object.freeze(["links", "rechts"]);

/**
 * What an "anlegen" proposal can make: model array, IFC class for the sentence and the selection, German word.
 * @type {Readonly<Record<"wand"|"tuer"|"notiz", {arrayName: string, klasse: string, wort: string}>>}
 */
export const ANLEGEN_OBJEKTE = Object.freeze({
  wand: Object.freeze({ arrayName: "customWalls", klasse: "IfcWall", wort: "Wand" }),
  tuer: Object.freeze({ arrayName: "customWindows", klasse: "IfcDoor", wort: "Tür" }),
  notiz: Object.freeze({ arrayName: "planNotizen", klasse: "IfcAnnotation", wort: "Notiz" }),
});

/** Refusal when the surface did not hand in the drawing functions (an IFC viewer, a test without them). */
export const OHNE_ZEICHNEN_TEXT = "Anlegen geht nur im BIM-Studio — hier fehlen die Zeichenfunktionen";

/** @typedef {{x: number, z: number, level?: number}} ZeigePunkt  a pointing point in m (plan x east, z south) on storey `level` */

/**
 * The drawing functions of the studio, with the signatures of @designer/lib/zeichnenModell.js.
 * @typedef {{wandAnlegen: (m: any, spec: any) => any, oeffnungAnlegen: (m: any, spec: any) => any, notizAnlegen: (m: any, spec: any) => any}} ZeichenFunktionen
 */

/** @param {string} grund @returns {{ok: false, grund: string}} */
const nein = (grund) => ({ ok: false, grund });

/** @param {number} v @returns {string} German number text, at most 2 decimals (sentences only) */
const zahl = (v) => String(Math.round(Number(v) * 100) / 100).replace(".", ",");

/**
 * Adds one pointing point (decision D1): the list keeps at most ZEIGEPUNKTE_MAX points in the order they were set; a fifth point pushes
 * the oldest out and the others move up one number. A point on another storey than the others starts a new list (points of two storeys
 * never make one wall).
 * @param {ReadonlyArray<ZeigePunkt>} punkte  Current points (m). @param {ZeigePunkt} p  New point (m).
 * @returns {Array<{x: number, z: number, level: number}>}  The new list (the input is not changed).
 */
export function punkteHinzu(punkte, p) {
  const neu = { x: Number(p.x), z: Number(p.z), level: Math.round(Number(p.level) || 0) };
  const alt = (punkte || []).map((q) => ({ x: Number(q.x), z: Number(q.z), level: Math.round(Number(q.level) || 0) }));
  if (!Number.isFinite(neu.x) || !Number.isFinite(neu.z)) return alt;
  const gleichesGeschoss = alt.filter((q) => q.level === neu.level);
  const liste = gleichesGeschoss.length === alt.length ? [...alt, neu] : [neu];
  return liste.slice(-ZEIGEPUNKTE_MAX);
}

/**
 * Checks the number of points a kind needs and that all lie on one storey.
 * @param {ReadonlyArray<ZeigePunkt>|null|undefined} punkte @param {number} anzahl  Points needed.
 * @param {string} wofuer  Words for the refusal ("eine Wand").
 * @returns {{ok: true, punkte: ZeigePunkt[], level: number}|{ok: false, grund: string}}
 */
export function punktePruefen(punkte, anzahl, wofuer) {
  const liste = Array.isArray(punkte) ? punkte : [];
  const soll = anzahl === 1 ? "einen Punkt" : `${anzahl} Punkte`;
  if (!liste.length) return nein(`Für ${wofuer} fehlt der Ort — erst ${soll} im Grundriss setzen (Werkzeug „Punkte“)`);
  if (liste.length !== anzahl) {
    return nein(`Für ${wofuer} genau ${soll} setzen — gesetzt ${liste.length === 1 ? "ist 1 Punkt" : `sind ${liste.length} Punkte`} (Esc leert die Punkte)`);
  }
  const level = Math.round(Number(liste[0].level) || 0);
  if (liste.some((q) => Math.round(Number(q.level) || 0) !== level)) return nein("Die Punkte liegen in verschiedenen Geschossen — alle im selben Geschoss setzen");
  return { ok: true, punkte: liste.map((q) => ({ x: Number(q.x), z: Number(q.z), level })), level };
}

/**
 * Where a point lies relative to a drawn wall: along the reference line from `a` (u, m), and outside the wall BODY (m, 0 = on or
 * inside the body; the body is offset from the reference line by bauteil/referenz.js, so a point on the drawn face counts as on it).
 * @param {any} w  Drawn wall {a, b, thickness | composite, refLine}. @param {{x: number, z: number}} p  Point in m.
 * @returns {{u_m: number, laenge_m: number, innerhalb: boolean, abstandKoerper_m: number, abstandAchse_m: number}}
 *   innerhalb: the point projects onto the segment (0 <= u <= length).
 */
function lageAnWand(w, p) {
  const g = wandGeometrie(w);
  const rx = p.x - w.a.x, rz = p.z - w.a.z;
  const u = rx * g.richtung.x + rz * g.richtung.z;
  const s = rx * g.normale.x + rz * g.normale.z; // signed distance from the reference line along the normal
  const koerper = Math.max(0, Math.abs(s - g.versatz_m) - g.dicke_m / 2);
  return { u_m: u, laenge_m: g.laenge_m, innerhalb: u >= -1e-9 && u <= g.laenge_m + 1e-9, abstandKoerper_m: koerper, abstandAchse_m: Math.abs(s) };
}

/**
 * Door snapping: the drawn wall a point means and the place along it. Only drawn walls (customWalls) of the point's storey count -
 * hull walls are derived from the footprint and get their openings in the hull editor [ASSUMED: first form of 261111-zs1].
 * Without `wandIdx` the wall whose body is nearest within TUER_FANG_TOLERANZ_M wins; two walls equally near (within TUER_MEHRDEUTIG_M,
 * e.g. at a corner) are refused. With `wandIdx` (the selected wall) only that wall counts and the point may lie up to
 * TUER_FANG_AUSWAHL_M from its axis.
 * @param {any} modell  Model record (customWalls). @param {ZeigePunkt} punkt  Point in m.
 * @param {{wandIdx?: number|null}} [opt]  wandIdx: `_idx` of the selected wall.
 * @returns {{ok: true, wand: any, u_m: number, laenge_m: number}|{ok: false, grund: string}}  u_m: m from the wall start `a`.
 */
export function wandAmPunkt(modell, punkt, opt = {}) {
  const level = Math.round(Number(punkt?.level) || 0);
  const waende = (modell?.customWalls || []).filter((/** @type {any} */ w) => w?.a && w?.b && Math.round(Number(w.level) || 0) === level);
  if (opt.wandIdx != null) {
    const w = (modell?.customWalls || []).find((/** @type {any} */ x) => x._idx === opt.wandIdx);
    if (!w) return nein("Die gewählte Wand ist keine gezeichnete Wand — Türen gehen hier nur in gezeichnete Wände");
    if (Math.round(Number(w.level) || 0) !== level) return nein("Der Punkt liegt in einem anderen Geschoss als die gewählte Wand");
    const l = lageAnWand(w, punkt);
    if (!l.innerhalb || l.abstandAchse_m > TUER_FANG_AUSWAHL_M) return nein(`Der Punkt liegt nicht an der gewählten Wand (höchstens ${zahl(TUER_FANG_AUSWAHL_M)} m daneben, zwischen ihren Enden)`);
    return { ok: true, wand: w, u_m: l.u_m, laenge_m: l.laenge_m };
  }
  const nah = waende.map((w) => ({ w, l: lageAnWand(w, punkt) }))
    .filter((k) => k.l.innerhalb && k.l.abstandKoerper_m <= TUER_FANG_TOLERANZ_M)
    .sort((x, y) => x.l.abstandKoerper_m - y.l.abstandKoerper_m);
  if (!nah.length) return nein(`Der Punkt liegt an keiner gezeichneten Wand (höchstens ${zahl(TUER_FANG_TOLERANZ_M * 100)} cm daneben) — näher an die Wand zeigen oder die Wand vorher wählen`);
  if (nah.length > 1 && nah[1].l.abstandKoerper_m - nah[0].l.abstandKoerper_m < TUER_MEHRDEUTIG_M) {
    return nein(`Der Punkt liegt an zwei Wänden (W-${nah[0].w._idx} und W-${nah[1].w._idx}) — die Wand vorher wählen`);
  }
  return { ok: true, wand: nah[0].w, u_m: nah[0].l.u_m, laenge_m: nah[0].l.laenge_m };
}

/**
 * The place of a door of width `breite_m` on a wall, kept TUER_RAND_M + half the width from both ends (as oeffnungAnlegen does), and the
 * refusals a person must hear instead of a door shifted without a word: the wall is too short, or the door overlaps an opening of that wall.
 * @param {any} modell  Model record (customWindows). @param {any} wand  Drawn wall. @param {number} u_m  Wished middle, m from `a`.
 * @param {number} breite_m  Door width in m.
 * @returns {{ok: true, u_m: number, verschoben_m: number}|{ok: false, grund: string}}  verschoben_m: how far the middle moved to fit (m, >= 0).
 */
export function tuerLage(modell, wand, u_m, breite_m) {
  const len = Math.hypot(wand.b.x - wand.a.x, wand.b.z - wand.a.z);
  const half = breite_m / 2;
  if (len < breite_m + 2 * TUER_RAND_M - 1e-9) return nein(`Die Wand W-${wand._idx} ist mit ${zahl(len)} m zu kurz für eine Tür von ${zahl(breite_m)} m`);
  const u = Math.max(half + TUER_RAND_M, Math.min(u_m, len - half - TUER_RAND_M));
  for (const o of (modell?.customWindows || []).filter((/** @type {any} */ x) => x.wallIdx === wand._idx)) {
    const ow = oeffnungsMasse(o).w;
    if (Math.abs(Number(o.u) - u) < (ow + breite_m) / 2 - 1e-9) {
      const wort = o.kind === "door" ? "Tür" : o.kind === "oeffnung" ? "Öffnung" : "Fenster";
      return nein(`Die Tür überschneidet ${wort} ${o._idx} in der Wand W-${wand._idx} — an eine freie Stelle zeigen`);
    }
  }
  return { ok: true, u_m: Math.round(u * 1000) / 1000, verschoben_m: Math.round(Math.abs(u - u_m) * 1000) / 1000 };
}

/**
 * Room number of a zone (decision D5): its own field `nummer` when stored, else the first word of its name when that word contains a
 * digit ("1.05 Büro" -> "1.05"). A decimal comma reads as a dot ("1,05" = "1.05").
 * @param {any} zone @returns {string|null}
 */
export function zonenNummer(zone) {
  if (zone?.nummer != null && String(zone.nummer).trim()) return String(zone.nummer).trim().replace(",", ".");
  const erstes = String(zone?.name ?? "").trim().split(/\s+/)[0] || "";
  return /\d/.test(erstes) ? erstes.replace(",", ".") : null;
}

/**
 * The zone with this room number, exactly (no prefix, no "nearly"). Refused when none or several zones carry it.
 * @param {any} modell  Model record (customZones). @param {string} nummer  e.g. "1.05" (a comma is read as a dot).
 * @returns {{ok: true, zone: any}|{ok: false, grund: string}}
 */
export function raumNachNummer(modell, nummer) {
  const n = String(nummer ?? "").trim().replace(",", ".");
  if (!n) return nein("Die Raumnummer fehlt");
  const treffer = (modell?.customZones || []).filter((/** @type {any} */ z) => zonenNummer(z) === n);
  if (!treffer.length) return nein(`Einen Raum ${n} gibt es im Modell nicht`);
  if (treffer.length > 1) return nein(`Raum ${n} gibt es ${treffer.length}-mal — erst den Raum wählen und „dieser Raum heißt …“ sagen`);
  return { ok: true, zone: treffer[0] };
}

/**
 * Name of a renamed zone (decision D5): a number that came from the name stays in front ("1.05 Büro" -> "1.05 Lager"); a zone with its own
 * `nummer` field or without a number gets the new name as it is.
 * @param {any} zone @param {string} name  New name (trimmed). @returns {string}
 */
export function neuerRaumname(zone, name) {
  const n = String(name ?? "").trim();
  if (zone?.nummer != null && String(zone.nummer).trim()) return n;
  const nr = zonenNummer(zone);
  return nr && !n.startsWith(nr) ? `${String(zone.name).trim().split(/\s+/)[0]} ${n}` : n;
}

/**
 * Room stamp of a zone: the mean of its corner points, the spot the plan writes the room label (BimPlan2D) - in m.
 * @param {any} zone  {points: [{x, z}]}. @returns {{x: number, z: number}|null}  null: the zone has no corner points (no stamp to measure from).
 */
export function raumStempel(zone) {
  const p = (zone?.points || []).filter((/** @type {any} */ q) => Number.isFinite(q?.x) && Number.isFinite(q?.z));
  if (!p.length) return null;
  return { x: p.reduce((s, q) => s + q.x, 0) / p.length, z: p.reduce((s, q) => s + q.z, 0) / p.length };
}

/**
 * Do two plan segments cross (touching counts)? @param {{x: number, z: number}} p1 @param {{x: number, z: number}} p2
 * @param {{x: number, z: number}} q1 @param {{x: number, z: number}} q2 @returns {boolean}
 */
function schneiden(p1, p2, q1, q2) {
  const d = (p2.x - p1.x) * (q2.z - q1.z) - (p2.z - p1.z) * (q2.x - q1.x);
  if (Math.abs(d) < 1e-12) return false; // parallel: a wall along the line between two stamps does not separate them
  const t = ((q1.x - p1.x) * (q2.z - q1.z) - (q1.z - p1.z) * (q2.x - q1.x)) / d;
  const u = ((q1.x - p1.x) * (p2.z - p1.z) - (q1.z - p1.z) * (p2.x - p1.x)) / d;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
}

/**
 * "Die Wand zwischen Raum A und Raum B": the drawn wall whose reference line is crossed by the straight line between the two room stamps.
 * Exactly one such wall is the target; none or several are refused with a sentence (a corridor wall crossed twice, two parallel skins).
 * Both rooms must lie on one storey; only drawn walls (customWalls) of that storey count.
 * @param {any} modell  Model record (customZones, customWalls). @param {string} nrA  Room number. @param {string} nrB  Room number.
 * @returns {{ok: true, wand: any, raumA: any, raumB: any}|{ok: false, grund: string}}
 */
export function wandZwischenRaeumen(modell, nrA, nrB) {
  const a = raumNachNummer(modell, nrA);
  if (!a.ok) return nein(/** @type {any} */ (a).grund);
  const b = raumNachNummer(modell, nrB);
  if (!b.ok) return nein(/** @type {any} */ (b).grund);
  if (a.zone === b.zone) return nein("Zweimal derselbe Raum — zwei verschiedene Raumnummern sagen");
  const level = Math.round(Number(a.zone.level) || 0);
  if (Math.round(Number(b.zone.level) || 0) !== level) return nein(`Raum ${String(nrA).trim()} und Raum ${String(nrB).trim()} liegen in verschiedenen Geschossen`);
  const sa = raumStempel(a.zone), sb = raumStempel(b.zone);
  // A room without an outline has no stamp: say so instead of "no wall between them".
  if (!sa) return nein(`Raum ${String(nrA).trim()} hat keinen Umriss — die Wand wählen und „Wand abbrechen“ sagen`);
  if (!sb) return nein(`Raum ${String(nrB).trim()} hat keinen Umriss — die Wand wählen und „Wand abbrechen“ sagen`);
  const treffer = (modell?.customWalls || []).filter((/** @type {any} */ w) => w?.a && w?.b && Math.round(Number(w.level) || 0) === level && schneiden(sa, sb, w.a, w.b));
  if (!treffer.length) return nein(`Zwischen Raum ${String(nrA).trim()} und Raum ${String(nrB).trim()} liegt keine gezeichnete Wand`);
  if (treffer.length > 1) return nein(`Zwischen Raum ${String(nrA).trim()} und Raum ${String(nrB).trim()} liegen ${treffer.length} Wände (${treffer.map((/** @type {any} */ w) => `W-${w._idx}`).join(", ")}) — die Wand wählen und „Wand abbrechen“ sagen`);
  return { ok: true, wand: treffer[0], raumA: a.zone, raumB: b.zone };
}

/**
 * GUID of an element made by "anlegen", derived exactly as the studio, the IFC export and bauteilImModell do (a stored `guid` wins):
 * wall "customWalls", door "oeffnung|cw:<wallIdx>|door|<_idx>" (aenderungen.js oeffnungGuid), note "planNotizen".
 * @param {string|number|null} projektId @param {"wand"|"tuer"|"notiz"} objekt @param {any} el @returns {string}  22-character GlobalId.
 */
export function anlegenGuid(projektId, objekt, el) {
  if (objekt === "tuer") return bauteilGuid(projektId, `oeffnung|cw:${el?.wallIdx}|${el?.kind}|${el?._idx ?? el?.u ?? 0}`, el);
  return bauteilGuid(projektId, ANLEGEN_OBJEKTE[objekt].arrayName, el);
}

/** Arrays a drawing function expects to exist (zeichnenModell.js reads them without a fallback). */
const LISTEN = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "planNotizen"];

/**
 * Builds the element of an "anlegen" proposal on a model: calls the studio's drawing function, adds the sentence's fields and pins the GUID.
 * The preview and the execution both call this on the model of THEIR moment, so what is confirmed is what a click would have drawn.
 * Parameters per kind (all lengths in m, plan x east, z south):
 *  - wand  {objekt: "wand", wandart, dicke_m, a: {x, z}, b: {x, z}, level},
 *  - tuer  {objekt: "tuer", wandIdx, u_m, breite_m, feuerwiderstand?, din_anschlag?, level, wand_geometrie?},
 *  - notiz {objekt: "notiz", punkt: {x, z}, level, text}.
 * A door names its wall by `_idx`; `wand_geometrie` ({a, b} as the proposal saw them) makes a door on a wall that was moved meanwhile fail.
 * @param {any} modell  Model record. @param {any} params  See above.
 * @param {{zeichnen?: ZeichenFunktionen|null, projektId?: string|number|null, naechsteIdx?: number, geschosshoehe_m?: number}} [opt]
 *   zeichnen: drawing functions (required); naechsteIdx: `_idx` for the new element (the studio's counter); geschosshoehe_m: storey height
 *   in m the wall records when its top follows the storey.
 * @returns {{modell: any, element: any, arrayName: string, guid: string, objekt: "wand"|"tuer"|"notiz"}}  modell: the NEW model, only the
 *   one array copied; element: the stored record (without the origin mark - the caller adds it).
 * @throws {Error} German text: no drawing functions, unknown kind, the drawing function refused, the wall of a door changed.
 */
export function anlegenBauen(modell, params, opt = {}) {
  const z = opt.zeichnen;
  if (!z) throw new Error(OHNE_ZEICHNEN_TEXT);
  const p = params || {};
  const objekt = /** @type {"wand"|"tuer"|"notiz"} */ (p.objekt);
  const def = ANLEGEN_OBJEKTE[objekt];
  if (!def) throw new Error(`Anlegen: unbekannte Art „${p.objekt}“ (möglich: Wand, Tür, Notiz)`);
  /** @type {Record<string, any>} */
  const basis = { naechsteIdx: Number.isInteger(opt.naechsteIdx) ? opt.naechsteIdx : 1, ...(opt.geschosshoehe_m ? { storeyHeight_m: opt.geschosshoehe_m } : {}) };
  for (const k of LISTEN) basis[k] = Array.isArray(modell?.[k]) ? modell[k] : [];
  /** @type {any} */
  let r;
  if (objekt === "wand") {
    const art = WANDARTEN[p.wandart] ? p.wandart : "wand";
    if (!(Number(p.dicke_m) > 0)) throw new Error("Wand anlegen: die Dicke fehlt");
    r = z.wandAnlegen(basis, { a: p.a, b: p.b, level: p.level, thickness_m: Number(p.dicke_m) });
    if (r?.ok) r.zusatz = { status: ANLEGEN_STATUS, ...WANDARTEN[art].felder };
  } else if (objekt === "tuer") {
    const wand = basis.customWalls.find((/** @type {any} */ w) => w._idx === p.wandIdx);
    if (!wand) throw new Error(`Tür anlegen: die Wand W-${p.wandIdx} gibt es nicht mehr`);
    if (p.wand_geometrie && JSON.stringify({ a: wand.a, b: wand.b }) !== JSON.stringify({ a: p.wand_geometrie.a, b: p.wand_geometrie.b })) {
      throw new Error(`Die Wand W-${wand._idx} wurde seit dem Vorschlag bewegt — verwerfen und neu vorschlagen`);
    }
    // The proposal checked the place on ITS model; an opening drawn on this wall since then must refuse the door, not sit under it.
    const lage = tuerLage(basis, wand, Number(p.u_m), Number(p.breite_m));
    if (!lage.ok) throw new Error(/** @type {any} */ (lage).grund);
    r = z.oeffnungAnlegen(basis, { wandId: wand._idx, kind: "door", versatz_m: Number(p.u_m), breite_m: Number(p.breite_m) });
    if (r?.ok) r.zusatz = { status: ANLEGEN_STATUS, ...(p.feuerwiderstand ? { feuerwiderstand: String(p.feuerwiderstand) } : {}), ...(DIN_ANSCHLAEGE.includes(p.din_anschlag) ? { din_anschlag: p.din_anschlag } : {}) };
  } else {
    r = z.notizAnlegen(basis, { punkt: p.punkt, level: p.level, text: p.text });
    if (r?.ok) r.zusatz = {};
  }
  if (!r?.ok) throw new Error(r?.error || `${def.wort} anlegen ging nicht`);
  const liste = r.modell[def.arrayName] || [];
  const roh = liste.find((/** @type {any} */ e) => e._idx === r.element.id);
  if (!roh) throw new Error(`${def.wort} anlegen: das neue Element fehlt in der Liste`);
  const ohneGuid = { ...roh, ...r.zusatz };
  const guid = anlegenGuid(opt.projektId ?? null, objekt, ohneGuid);
  const element = { ...ohneGuid, guid };
  return { modell: { ...modell, [def.arrayName]: liste.map((/** @type {any} */ e) => (e === roh ? element : e)) }, element, arrayName: def.arrayName, guid, objekt };
}
