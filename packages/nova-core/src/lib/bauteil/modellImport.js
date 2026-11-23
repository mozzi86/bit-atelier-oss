// 108-09 (D-EFH-06): model from a geometry JSON — the hand-written validator of the import format "bit-modell" (no schema library,
// zod stays unused). It checks a JSON a person or an agent wrote, names every fault with its path and a plain German sentence (which
// field, which element, why), and returns the fields in the stored form of a BimModel record. Pure: no I/O, no React, no three.js.
// The server route (server/modellImportRouter.js) and the MCP tool modell_importieren use it; the browser bundle does not load it.
// Only RELATIVE imports (no Vite alias), so plain Node loads it.
//
// Format (version 1, all lengths in metres, plan axes x to the right and z to the south, the same as a BimModel record):
//   { format: "bit-modell", version: 1, einheit: "m", achsen: "x-rechts-z-sued",
//     programm: { footprintM: [{x, z}, …] (≥ 3 points), storeys (storeys above ground), storeyHeight (m),
//                 geschosse?: [{level, name?, hoehe_m, kniestock_m?}], untergeschosse? (0 … 3) },
//     dachform?: "flach"|"sattel"|"walm"|"pult"|null, dachneigung? (degrees), entranceCfg?, parapet?,
//     customWalls?: [{_idx, level, a: {x, z}, b: {x, z}, thickness, height?, …}],
//     customColumns?: [{_idx, level, x, z, size?, …}],
//     customWindows?: [{_idx, wallIdx, u, kind: "window"|"door"|"oeffnung", typeId?, width?, height?, sill?, anschlag?, aufschlag?, …}],
//     envOpenings?: [{_idx, level, edge, u, kind, …}]  (opening in the hull wall of edge `edge` of the footprint on storey `level`),
//     customZones?: [{_idx, level, points: [{x, z}, …], name?, …}], customSlabs?: [{_idx, level, points, …}],
//     customRoofs?: [{_idx, level, points, …}], customStairs?: [{_idx, level, start: {x, z}, richtung_grad, breite_m, …}] }
// Element records keep every further field they carry (they are the studio's own records); unknown TOP-LEVEL and programme fields are
// dropped and named as a warning.
//
// Rules: format/version/unit/axes; footprint ≥ 3 points without self-intersection (massingModell.profilGueltig); storey table with
// integer, unique levels, hoehe_m > 0 and kniestock_m only on the top row; `_idx` integer ≥ 1 and unique over ALL lists (the studio's
// counter is max(_idx) + 1); levels exist; `wallIdx` names a wall of customWalls; `edge` < number of footprint edges; enums
// (kind, anschlag, aufschlag, bruestung_bezug, dachform); openings that do not fit their host wall (oeffnungPasst, under the roof
// profile of a gable wall) and stair rule deviations (treppeBerechnen) are WARNINGS — the studio stores such records too and says so.
//
// In:  the parsed JSON. Out: modellPruefen() → {ok, fehler, warnungen, normalisiert, zusammenfassung}; importPatch() → the record patch
//      with the GlobalIds pinned like the studio's save (steckbrief.guidsAnheften); listenAnzahl() for the dry run.

import { profilGueltig } from "../massing/massingModell.js";
import { createBuildingModel } from "../buildingModel.js";
import { ankerFuerWand, BRUESTUNG_BEZUEGE, oeffnungPasst, oeffnungsMasse, wirtVon } from "./oeffnungen.js";
import { treppeBerechnen } from "./treppe.js";
import { istUTreppe, treppeUBerechnen, TREPPE_U } from "./treppeU.js"; // 115-13: two-flight stair with landing
import { geschosseAus, geschosshoehe } from "./hoehen.js";
import { DACHFORMEN, globalesDach } from "./dachGeometrie.js";
import { mitGiebelProfilen } from "./giebel.js";
import { guidsAnheften } from "./steckbrief.js";
import { MAX_UNTERGESCHOSSE } from "./ebenen.js";

/** Name of the format (field `format`). */
export const IMPORT_FORMAT = "bit-modell";
/** The one version this validator reads. */
export const IMPORT_VERSION = 1;
/** Unit of every length. */
export const IMPORT_EINHEIT = "m";
/** Plan axes: x to the right (east), z to the south — the axes of footprintM and every element. */
export const IMPORT_ACHSEN = "x-rechts-z-sued";

/** Element lists of the format, in the order the studio stores them. */
export const IMPORT_LISTEN = Object.freeze(["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs", "customStairs"]);

/** Programme fields of the format (inside `programm`). */
const PROGRAMM_FELDER = Object.freeze(["footprintM", "storeys", "storeyHeight", "geschosse", "untergeschosse"]);
/** Further top-level fields besides the lists. */
const KOPF_FELDER = Object.freeze(["format", "version", "einheit", "achsen", "programm", "dachform", "dachneigung", "entranceCfg", "parapet"]);

/** Lists whose elements get their GlobalId pinned on the write — exactly the lists the studio's save pins (BitBimStudio save effect). */
export const GUID_LISTEN = Object.freeze(["customWalls", "customColumns", "customZones", "customSlabs", "customRoofs", "customStairs"]);

/**
 * Plausibility limits of the units. [ASSUMED] — chosen for buildings from a garden house to a large block; way to a decided value: the
 * first imports of real models. Footprint extent outside the range and any length above `millimeter_ab` are ERRORS (wrong unit); wall
 * thickness and storey height outside their range are WARNINGS (a knee storey of 0.75 m or a 2 m retaining wall exist).
 */
export const PLAUSIBEL = Object.freeze({
  /** extent of the footprint (larger side of its box), m */
  umriss_m: Object.freeze({ min: 2, max: 300 }),
  /** wall thickness, m */
  wanddicke_m: Object.freeze({ min: 0.05, max: 1.5 }),
  /** storey height, m */
  geschosshoehe_m: Object.freeze({ min: 2, max: 8 }),
  /** a length or coordinate above this many metres is taken as millimetres, m */
  millimeter_ab: 1000,
  /** roof pitch, degrees (exclusive upper bound) */
  dachneigung_grad: Object.freeze({ min: 0, max: 90 }),
  /** storeys above ground */
  geschosse_max: 60,
});

/** Most elements per list. [ASSUMED] 10,000 — far above a single building; bounds the work of the host check (lists × walls). */
export const MAX_JE_LISTE = 10000;

const OEFFNUNGS_ARTEN = Object.freeze(["window", "door", "oeffnung"]);
const ANSCHLAEGE = Object.freeze(["links", "rechts"]);
const AUFSCHLAEGE = Object.freeze(["innen", "aussen"]);

/** German noun of one element per list (the start of every element sentence). */
const ELEMENT_NAME = Object.freeze({
  customWalls: "Wand", customColumns: "Stütze", customWindows: "Öffnung", envOpenings: "Hüllöffnung",
  customZones: "Raum", customSlabs: "Decke", customRoofs: "Dach", customStairs: "Treppe",
});

/**
 * @typedef {{pfad: string, text: string}} Meldung  pfad like `customWindows[3].wallIdx`; text: one German sentence
 * @typedef {{ok: boolean, fehler: Meldung[], warnungen: Meldung[], normalisiert: Record<string, any>|null,
 *   zusammenfassung: Record<string, number>}} PruefErgebnis
 *   normalisiert: the stored form (null while there are errors); zusammenfassung: elements per list and footprint points
 */

const istObjekt = (/** @type {unknown} */ v) => v != null && typeof v === "object" && !Array.isArray(v);
const zahl = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ganz = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isInteger(v) ? v : null);
/** Number in German writing, at most 3 decimals ("2,75"). @param {number} v */
const de = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",").replace("-", "−");

/**
 * A list of integers in short German writing: runs of three or more become "a–b" ("1–13", "1, 3, 5–7"); empty = "keine".
 * @param {number[]} werte @returns {string}
 */
export function nummernText(werte) {
  const s = [...new Set(werte)].sort((a, b) => a - b);
  if (!s.length) return "keine";
  /** @type {string[]} */
  const teile = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j += 1;
    if (j - i >= 2) teile.push(`${de(s[i])}–${de(s[j])}`);
    else for (let k = i; k <= j; k += 1) teile.push(de(s[k]));
    i = j + 1;
  }
  return teile.join(", ");
}

/**
 * Rounds every non-integer number of a JSON value to 1 mm (3 decimals) — the stored precision of the studio. Strings, booleans and
 * null stay; `undefined` entries of objects are left out (JSON form).
 * @param {any} v @returns {any}
 */
export function aufMillimeter(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  if (Array.isArray(v)) return v.map(aufMillimeter);
  if (istObjekt(v)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, w] of Object.entries(v)) if (w !== undefined) out[k] = aufMillimeter(w);
    return out;
  }
  return v;
}

/**
 * Who an element is, in words: "Wand 3", "Fenster 7", "Tür 9 in der Hülle", "Raum 4 (Küche)".
 * @param {string} liste list name @param {any} el element record @returns {string}
 */
function wer(liste, el) {
  const nr = ganz(el?._idx) ?? "ohne Nummer";
  if (liste === "customWindows" || liste === "envOpenings") {
    const art = el?.kind === "door" ? "Tür" : el?.kind === "window" ? "Fenster" : "Öffnung";
    return `${art} ${nr}${liste === "envOpenings" ? " in der Hülle" : ""}`;
  }
  const name = liste === "customZones" && typeof el?.name === "string" && el.name.trim() ? ` (${el.name.trim().slice(0, 40)})` : "";
  return `${ELEMENT_NAME[/** @type {keyof typeof ELEMENT_NAME} */ (liste)] || "Element"} ${nr}${name}`;
}

/**
 * Checks a geometry JSON of the format "bit-modell" (see file head). Never throws; every fault is a line with path and German text.
 * @param {unknown} json the parsed import
 * @returns {PruefErgebnis}
 */
export function modellPruefen(json) {
  /** @type {Meldung[]} */ const fehler = [];
  /** @type {Meldung[]} */ const warnungen = [];
  const f = (/** @type {string} */ pfad, /** @type {string} */ text) => { fehler.push({ pfad, text }); };
  const w = (/** @type {string} */ pfad, /** @type {string} */ text) => { warnungen.push({ pfad, text }); };
  /** @type {Record<string, number>} */
  const zusammenfassung = {};
  const ende = () => ({ ok: fehler.length === 0, fehler, warnungen, normalisiert: null, zusammenfassung });

  if (!istObjekt(json)) {
    f("", "Die Datei ist kein JSON-Objekt — erwartet wird { \"format\": \"bit-modell\", \"version\": 1, … }.");
    return ende();
  }
  const j = /** @type {Record<string, any>} */ (json);

  // ---- head ----
  if (j.format !== IMPORT_FORMAT) f("format", `format muss „${IMPORT_FORMAT}“ sein (gefunden: ${JSON.stringify(j.format ?? null)}).`);
  if (j.version !== IMPORT_VERSION) f("version", `version ${JSON.stringify(j.version ?? null)} wird nicht gelesen — unterstützt ist nur Version ${IMPORT_VERSION}.`);
  if (j.einheit !== IMPORT_EINHEIT) {
    f("einheit", j.einheit === "mm" || j.einheit === "cm"
      ? `einheit „${j.einheit}“ wird nicht umgerechnet — alle Längen bitte in Metern angeben (einheit: „m“).`
      : `einheit muss „${IMPORT_EINHEIT}“ (Meter) sein (gefunden: ${JSON.stringify(j.einheit ?? null)}).`);
  }
  if (j.achsen !== IMPORT_ACHSEN) {
    f("achsen", `achsen muss „${IMPORT_ACHSEN}“ sein (x nach rechts, z nach Süden — wie im Gebäudemodell; gefunden: ${JSON.stringify(j.achsen ?? null)}).`);
  }
  for (const k of Object.keys(j)) {
    if (KOPF_FELDER.includes(k) || IMPORT_LISTEN.includes(k)) continue;
    w(k, k === "autoFenster"
      ? "autoFenster wird noch nicht ausgewertet (Regelfenster abschalten folgt mit Plan 108-04) — das Feld wird nicht übernommen."
      : `Unbekanntes Feld „${k}“ — wird nicht übernommen.`);
  }

  // ---- programme ----
  const p = istObjekt(j.programm) ? /** @type {Record<string, any>} */ (j.programm) : null;
  if (!p) f("programm", "programm fehlt — es braucht mindestens footprintM, storeys und storeyHeight.");
  const prog = p || {};
  for (const k of Object.keys(prog)) if (!PROGRAMM_FELDER.includes(k)) w(`programm.${k}`, `Unbekanntes Programmfeld „${k}“ — wird nicht übernommen.`);

  /**
   * One length or coordinate: finite, not "probably millimetres", optional limits (min inclusive).
   * @param {string} pfad @param {unknown} v @param {string} wasText who/what in words @param {{min?: number, minExklusiv?: number}} [g]
   * @returns {number|null}
   */
  const laenge = (pfad, v, wasText, g = {}) => {
    const n = zahl(v);
    if (n == null) { f(pfad, `${wasText}: ${JSON.stringify(v ?? null)} ist keine Zahl (Meter erwartet).`); return null; }
    if (Math.abs(n) > PLAUSIBEL.millimeter_ab) { f(pfad, `${wasText}: ${de(n)} m ist unplausibel groß — vermutlich Millimeter statt Meter angegeben.`); return null; }
    if (g.minExklusiv != null && !(n > g.minExklusiv)) { f(pfad, `${wasText}: ${de(n)} m — muss größer als ${de(g.minExklusiv)} m sein.`); return null; }
    if (g.min != null && n < g.min) { f(pfad, `${wasText}: ${de(n)} m — darf nicht kleiner als ${de(g.min)} m sein.`); return null; }
    return n;
  };
  /** A plan point {x, z}. @param {string} pfad @param {unknown} pt @param {string} wasText @returns {{x: number, z: number}|null} */
  const punkt = (pfad, pt, wasText) => {
    if (!istObjekt(pt)) { f(pfad, `${wasText}: Punkt fehlt oder ist kein Objekt {x, z}.`); return null; }
    const q = /** @type {any} */ (pt);
    if (q.y != null && q.z == null) { f(pfad, `${wasText}: Punkte haben x und z (Grundriss), nicht y.`); return null; }
    const x = laenge(`${pfad}.x`, q.x, wasText), z = laenge(`${pfad}.z`, q.z, wasText);
    return x == null || z == null ? null : { x, z };
  };
  /** A polygon of ≥ 3 points. @param {string} pfad @param {unknown} liste @param {string} wasText @returns {Array<{x: number, z: number}>|null} */
  const polygon = (pfad, liste, wasText) => {
    if (!Array.isArray(liste)) { f(pfad, `${wasText}: Punktliste fehlt.`); return null; }
    if (liste.length < 3) { f(pfad, `${wasText}: braucht mindestens 3 Punkte (gefunden: ${liste.length}).`); return null; }
    const pkt = liste.map((q, i) => punkt(`${pfad}[${i}]`, q, `${wasText}, Punkt ${i}`));
    return pkt.every(Boolean) ? /** @type {Array<{x: number, z: number}>} */ (pkt) : null;
  };

  const umriss = p ? polygon("programm.footprintM", prog.footprintM, "Umriss") : null;
  if (umriss) {
    const xs = umriss.map((q) => q.x), zs = umriss.map((q) => q.z);
    const ausdehnung = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const g = profilGueltig(umriss.map((q) => ({ x: q.x, y: q.z })));
    if (!g.ok) f("programm.footprintM", `Umriss ungültig: ${g.text}.`);
    else if (ausdehnung < PLAUSIBEL.umriss_m.min || ausdehnung > PLAUSIBEL.umriss_m.max) {
      f("programm.footprintM", `Umriss ist ${de(ausdehnung)} m groß — plausibel sind ${PLAUSIBEL.umriss_m.min} bis ${PLAUSIBEL.umriss_m.max} m. Einheit prüfen (Meter).`);
    }
  }
  const kanten = umriss ? umriss.length : 0;

  let storeys = null;
  if (p) {
    storeys = ganz(prog.storeys);
    if (storeys == null || storeys < 1 || storeys > PLAUSIBEL.geschosse_max) {
      f("programm.storeys", `storeys (Geschosse über Gelände) muss eine ganze Zahl von 1 bis ${PLAUSIBEL.geschosse_max} sein (gefunden: ${JSON.stringify(prog.storeys ?? null)}).`);
      storeys = null;
    }
  }
  const storeyHeight = p ? laenge("programm.storeyHeight", prog.storeyHeight, "Geschosshöhe storeyHeight", { minExklusiv: 0 }) : null;
  if (storeyHeight != null && (storeyHeight < PLAUSIBEL.geschosshoehe_m.min || storeyHeight > PLAUSIBEL.geschosshoehe_m.max)) {
    w("programm.storeyHeight", `Geschosshöhe ${de(storeyHeight)} m liegt außerhalb von ${PLAUSIBEL.geschosshoehe_m.min} bis ${PLAUSIBEL.geschosshoehe_m.max} m — bitte prüfen.`);
  }
  let ug = 0;
  if (prog.untergeschosse != null) {
    const u = ganz(prog.untergeschosse);
    if (u == null || u < 0 || u > MAX_UNTERGESCHOSSE) f("programm.untergeschosse", `untergeschosse muss eine ganze Zahl von 0 bis ${MAX_UNTERGESCHOSSE} sein (gefunden: ${JSON.stringify(prog.untergeschosse)}).`);
    else ug = u;
  }
  /** Levels that exist: −untergeschosse … storeys − 1. */
  const ebenen = storeys == null ? null : Array.from({ length: storeys + ug }, (_, i) => i - ug);

  if (prog.geschosse != null) {
    if (!Array.isArray(prog.geschosse) || !prog.geschosse.length) f("programm.geschosse", "geschosse muss eine Liste von Zeilen {level, hoehe_m} sein.");
    else {
      /** @type {Map<number, number>} */
      const gesehen = new Map();
      const oberste = Math.max(...prog.geschosse.map((/** @type {any} */ g) => (ganz(g?.level) ?? -Infinity)));
      prog.geschosse.forEach((/** @type {any} */ g, /** @type {number} */ i) => {
        const pf = `programm.geschosse[${i}]`;
        if (!istObjekt(g)) { f(pf, `Zeile ${i} der Geschosstabelle ist kein Objekt {level, hoehe_m}.`); return; }
        const lv = ganz(g.level);
        if (lv == null) { f(`${pf}.level`, `Zeile ${i}: level muss eine ganze Zahl sein (gefunden: ${JSON.stringify(g.level ?? null)}).`); return; }
        if (gesehen.has(lv)) f(`${pf}.level`, `Geschoss ${lv} steht doppelt in der Tabelle (schon in Zeile ${gesehen.get(lv)}).`);
        else gesehen.set(lv, i);
        if (ebenen && !ebenen.includes(lv)) w(`${pf}.level`, `Geschoss ${lv} liegt außerhalb von storeys/untergeschosse (vorhanden: ${nummernText(ebenen)}) — die Zeile wirkt nicht.`);
        const h = laenge(`${pf}.hoehe_m`, g.hoehe_m, `Geschoss ${lv}: hoehe_m`, { minExklusiv: 0 });
        if (h != null && (h < PLAUSIBEL.geschosshoehe_m.min || h > PLAUSIBEL.geschosshoehe_m.max)) {
          w(`${pf}.hoehe_m`, `Geschoss ${lv}: Höhe ${de(h)} m liegt außerhalb von ${PLAUSIBEL.geschosshoehe_m.min} bis ${PLAUSIBEL.geschosshoehe_m.max} m — bitte prüfen (Kniestock gehört in kniestock_m).`);
        }
        if (g.kniestock_m != null) {
          if (lv !== oberste) f(`${pf}.kniestock_m`, `Geschoss ${lv}: kniestock_m ist nur am obersten Geschoss (${oberste}) erlaubt.`);
          else laenge(`${pf}.kniestock_m`, g.kniestock_m, `Geschoss ${lv}: kniestock_m`, { min: 0 });
        }
      });
    }
  }

  // ---- roof, entrance, parapet ----
  if (j.dachform != null && !DACHFORMEN.includes(j.dachform)) f("dachform", `dachform „${String(j.dachform).slice(0, 40)}“ gibt es nicht — erlaubt: ${DACHFORMEN.join(", ")} oder null.`);
  if (j.dachneigung != null) {
    const n = zahl(j.dachneigung);
    if (n == null || n < PLAUSIBEL.dachneigung_grad.min || n >= PLAUSIBEL.dachneigung_grad.max) {
      f("dachneigung", `dachneigung muss eine Zahl von ${PLAUSIBEL.dachneigung_grad.min} bis unter ${PLAUSIBEL.dachneigung_grad.max} Grad sein (gefunden: ${JSON.stringify(j.dachneigung)}).`);
    }
  }
  if (j.entranceCfg != null) {
    if (!istObjekt(j.entranceCfg)) f("entranceCfg", "entranceCfg muss ein Objekt sein, z. B. {\"enabled\": false}.");
    else {
      const e = j.entranceCfg;
      if (e.enabled != null && typeof e.enabled !== "boolean") f("entranceCfg.enabled", "entranceCfg.enabled muss true oder false sein.");
      if (e.width != null) laenge("entranceCfg.width", e.width, "Eingang: Breite", { minExklusiv: 0 });
      if (e.height != null) laenge("entranceCfg.height", e.height, "Eingang: Höhe", { minExklusiv: 0 });
      if (e.uRel != null && !(zahl(e.uRel) != null && e.uRel >= 0 && e.uRel <= 1)) f("entranceCfg.uRel", "Eingang: uRel ist die Lage auf der Kante von 0 bis 1.");
      if (e.edge != null && !(ganz(e.edge) != null && e.edge >= 0 && (!kanten || e.edge < kanten))) {
        f("entranceCfg.edge", `Eingang: Kante ${JSON.stringify(e.edge)} gibt es nicht (Umriss hat ${kanten} Kanten: ${kanten ? nummernText([...Array(kanten).keys()]) : "keine"}).`);
      }
    }
  }
  if (j.parapet != null) {
    if (!istObjekt(j.parapet)) f("parapet", "parapet muss ein Objekt {enabled, height} sein.");
    else {
      if (j.parapet.enabled != null && typeof j.parapet.enabled !== "boolean") f("parapet.enabled", "parapet.enabled muss true oder false sein.");
      if (j.parapet.height != null) laenge("parapet.height", j.parapet.height, "Attika: Höhe", { minExklusiv: 0 });
    }
  }

  // ---- lists: shape, _idx over all lists, level ----
  /** @type {Map<number, string>} */
  const idxBei = new Map();
  /** @type {Map<string, string>} */
  const guidBei = new Map();
  /** @type {Record<string, any[]>} */
  const listen = {};
  for (const liste of IMPORT_LISTEN) {
    if (j[liste] == null) continue;
    if (!Array.isArray(j[liste])) { f(liste, `${liste} muss eine Liste sein.`); continue; }
    if (j[liste].length > MAX_JE_LISTE) { f(liste, `${liste} hat ${j[liste].length} Elemente — höchstens ${MAX_JE_LISTE} je Liste.`); continue; }
    listen[liste] = j[liste];
    zusammenfassung[liste] = j[liste].length;
    j[liste].forEach((/** @type {any} */ el, /** @type {number} */ i) => {
      const pf = `${liste}[${i}]`;
      if (!istObjekt(el)) { f(pf, `${ELEMENT_NAME[/** @type {keyof typeof ELEMENT_NAME} */ (liste)]} an Stelle ${i} ist kein Objekt.`); return; }
      const name = wer(liste, el);
      const idx = ganz(el._idx);
      if (idx == null || idx < 1) f(`${pf}._idx`, `${name}: _idx muss eine ganze Zahl ab 1 sein (gefunden: ${JSON.stringify(el._idx ?? null)}).`);
      else if (idxBei.has(idx)) f(`${pf}._idx`, `${name}: _idx ${idx} ist schon an ${idxBei.get(idx)} vergeben — jede Nummer darf über alle Listen nur einmal vorkommen.`);
      else idxBei.set(idx, pf);
      if (typeof el.guid === "string" && el.guid.length === 22) {
        if (guidBei.has(el.guid)) f(`${pf}.guid`, `${name}: guid ${el.guid} ist schon an ${guidBei.get(el.guid)} vergeben.`);
        else guidBei.set(el.guid, pf);
      }
      if (liste !== "customWindows") {
        const lv = ganz(el.level);
        if (lv == null) f(`${pf}.level`, `${name}: level (Geschoss) muss eine ganze Zahl sein (gefunden: ${JSON.stringify(el.level ?? null)}).`);
        else if (ebenen && !ebenen.includes(lv)) f(`${pf}.level`, `${name}: Geschoss ${lv} gibt es nicht (vorhanden: ${nummernText(ebenen)}).`);
      }
    });
  }

  // ---- per kind ----
  const waende = listen.customWalls || [];
  const wandNummern = waende.map((x) => ganz(x?._idx)).filter((x) => x != null);
  waende.forEach((el, i) => {
    if (!istObjekt(el)) return;
    const pf = `customWalls[${i}]`, name = wer("customWalls", el);
    const a = punkt(`${pf}.a`, el.a, `${name}, Anfang a`), b = punkt(`${pf}.b`, el.b, `${name}, Ende b`);
    if (a && b && Math.hypot(b.x - a.x, b.z - a.z) < 0.01) f(pf, `${name}: Anfang und Ende liegen aufeinander (Länge unter 1 cm).`);
    if (el.thickness != null) {
      const d = laenge(`${pf}.thickness`, el.thickness, `${name}: Dicke`, { minExklusiv: 0 });
      if (d != null && (d < PLAUSIBEL.wanddicke_m.min || d > PLAUSIBEL.wanddicke_m.max)) {
        w(`${pf}.thickness`, `${name}: Dicke ${de(d)} m liegt außerhalb von ${de(PLAUSIBEL.wanddicke_m.min)} bis ${de(PLAUSIBEL.wanddicke_m.max)} m — bitte prüfen.`);
      }
    }
    if (el.height != null) laenge(`${pf}.height`, el.height, `${name}: Höhe`, { minExklusiv: 0 });
  });
  (listen.customColumns || []).forEach((el, i) => {
    if (!istObjekt(el)) return;
    const pf = `customColumns[${i}]`, name = wer("customColumns", el);
    laenge(`${pf}.x`, el.x, `${name}: x`);
    laenge(`${pf}.z`, el.z, `${name}: z`);
    if (el.size != null) laenge(`${pf}.size`, el.size, `${name}: Querschnitt size`, { minExklusiv: 0 });
  });
  for (const liste of /** @type {const} */ (["customWindows", "envOpenings"])) {
    (listen[liste] || []).forEach((el, i) => {
      if (!istObjekt(el)) return;
      const pf = `${liste}[${i}]`, name = wer(liste, el);
      if (!OEFFNUNGS_ARTEN.includes(el.kind)) f(`${pf}.kind`, `${name}: kind „${String(el.kind ?? "")}“ gibt es nicht — erlaubt: window (Fenster), door (Tür), oeffnung (Öffnung ohne Füllung).`);
      if (el.typeId != null && typeof el.typeId !== "string") f(`${pf}.typeId`, `${name}: typeId muss ein Text sein.`);
      if (el.u != null) laenge(`${pf}.u`, el.u, `${name}: Lage u (Mitte ab Wandanfang)`, { min: 0 });
      if (el.width != null) laenge(`${pf}.width`, el.width, `${name}: Breite`, { minExklusiv: 0 });
      if (el.height != null) laenge(`${pf}.height`, el.height, `${name}: Höhe`, { minExklusiv: 0 });
      if (el.sill != null) laenge(`${pf}.sill`, el.sill, `${name}: Brüstung`);
      if (el.anschlag != null && !ANSCHLAEGE.includes(el.anschlag)) f(`${pf}.anschlag`, `${name}: anschlag „${String(el.anschlag)}“ gibt es nicht — erlaubt: links, rechts.`);
      if (el.aufschlag != null && !AUFSCHLAEGE.includes(el.aufschlag)) f(`${pf}.aufschlag`, `${name}: aufschlag „${String(el.aufschlag)}“ gibt es nicht — erlaubt: innen, aussen.`);
      if (el.bruestung_bezug != null && !BRUESTUNG_BEZUEGE.includes(el.bruestung_bezug)) {
        f(`${pf}.bruestung_bezug`, `${name}: bruestung_bezug „${String(el.bruestung_bezug)}“ gibt es nicht — erlaubt: ${BRUESTUNG_BEZUEGE.join(", ")}.`);
      }
      if (liste === "customWindows") {
        const wi = ganz(el.wallIdx);
        if (wi == null) f(`${pf}.wallIdx`, `${name}: wallIdx (Nummer der Wand) fehlt oder ist keine ganze Zahl.`);
        else if (!wandNummern.includes(wi)) f(`${pf}.wallIdx`, `${name}: Wand ${wi} gibt es nicht (vorhanden: ${nummernText(/** @type {number[]} */ (wandNummern))}).`);
      } else {
        const k = ganz(el.edge);
        if (k == null || k < 0 || (kanten && k >= kanten)) {
          f(`${pf}.edge`, `${name}: Kante ${JSON.stringify(el.edge ?? null)} gibt es nicht (Umriss hat ${kanten} Kanten: ${kanten ? nummernText([...Array(kanten).keys()]) : "keine"}).`);
        }
      }
    });
  }
  for (const liste of /** @type {const} */ (["customZones", "customSlabs", "customRoofs"])) {
    (listen[liste] || []).forEach((el, i) => {
      if (!istObjekt(el)) return;
      const pf = `${liste}[${i}]`, name = wer(liste, el);
      const pkt = polygon(`${pf}.points`, el.points, name);
      if (pkt) {
        const g = profilGueltig(pkt.map((q) => ({ x: q.x, y: q.z })));
        if (!g.ok) w(`${pf}.points`, `${name}: ${g.text} — bitte prüfen.`);
      }
    });
  }
  /** U stairs with a split override, checked against their total once the storey heights are known. @type {Array<{i: number, n1: number, pf: string, name: string}>} */
  const uLauf1 = [];
  (listen.customStairs || []).forEach((el, i) => {
    if (!istObjekt(el)) return;
    const pf = `customStairs[${i}]`, name = wer("customStairs", el);
    punkt(`${pf}.start`, el.start, `${name}, Antritt start`);
    if (zahl(el.richtung_grad) == null) f(`${pf}.richtung_grad`, `${name}: richtung_grad (Laufrichtung in Grad, 0 = +x, 90 = +z) fehlt.`);
    laenge(`${pf}.breite_m`, el.breite_m, `${name}: Laufbreite breite_m`, { minExklusiv: 0 });
    // 115-13: "podest_u" (two flights with intermediate landing) is computed as well
    if (el.art != null && el.art !== "gerade" && el.art !== TREPPE_U) f(`${pf}.art`, `${name}: art „${String(el.art)}“ wird nicht berechnet — nur „gerade“ (einläufig) und „${TREPPE_U}“ (zweiläufig mit Zwischenpodest).`);
    // 115-13 review 20.11. (finding 4): the optional fields of the two-flight stair are checked like the other fields — before, an
    // invalid value was stored silently and the geometry fell back to a default without saying so. Only for art "podest_u": a straight
    // stair never reads them (its import stays as it was).
    if (istUTreppe(el)) {
      if (el.wende != null && el.wende !== "links" && el.wende !== "rechts") f(`${pf}.wende`, `${name}: wende „${String(el.wende)}“ gibt es nicht — erlaubt: links, rechts (Drehsinn beim Hinaufgehen).`);
      if (el.auge_m != null) laenge(`${pf}.auge_m`, el.auge_m, `${name}: Treppenauge auge_m`, { min: 0 });
      if (el.podest_tiefe_m != null) laenge(`${pf}.podest_tiefe_m`, el.podest_tiefe_m, `${name}: Podesttiefe podest_tiefe_m`, { minExklusiv: 0 });
      if (el.steigungen_lauf1 != null) {
        const n1 = ganz(el.steigungen_lauf1);
        if (n1 == null || n1 < 1) f(`${pf}.steigungen_lauf1`, `${name}: steigungen_lauf1 ${JSON.stringify(el.steigungen_lauf1)} — erwartet eine ganze Zahl ab 1 (Steigungen des unteren Laufs).`);
        else uLauf1.push({ i, n1, pf, name });
      }
    }
  });

  if (fehler.length) return ende();

  // ---- the stored form, then the checks that need the built model ----
  /** @type {Record<string, any>} */
  const programm = { footprintM: umriss, storeys, storeyHeight };
  if (prog.geschosse != null) programm.geschosse = prog.geschosse;
  if (prog.untergeschosse != null) programm.untergeschosse = ug;
  /** @type {Record<string, any>} */
  const roh = { ...programm, unit: IMPORT_EINHEIT };
  for (const k of ["dachform", "dachneigung", "entranceCfg", "parapet"]) if (j[k] !== undefined) roh[k] = j[k];
  for (const liste of IMPORT_LISTEN) if (listen[liste]) roh[liste] = listen[liste];
  const normalisiert = aufMillimeter(roh);
  // 115-13 review 20.11.: the split must leave flight 2 at least one riser — the total follows from the storey height (or `steigungen`)
  if (uLauf1.length) {
    try {
      const gsT = geschosseAus({ geschosse: normalisiert.geschosse, storeyHeight: normalisiert.storeyHeight });
      for (const { i, n1, pf, name } of uLauf1) {
        const t = normalisiert.customStairs[i];
        const n = treppeUBerechnen({ ...t, steigungen_lauf1: undefined }, geschosshoehe(t.level, gsT)).n;
        if (n1 >= n) f(`${pf}.steigungen_lauf1`, `${name}: steigungen_lauf1 ${n1} — die Treppe hat ${n} Steigungen, der untere Lauf darf höchstens ${n - 1} haben.`);
      }
    } catch (err) {
      w("customStairs", `Die Aufteilung der Läufe ließ sich nicht prüfen (${/** @type {any} */ (err)?.message || err}).`);
    }
    if (fehler.length) return ende();
  }
  zusammenfassung.umrissPunkte = kanten;

  // openings against their host wall — the same test as the studio's hint and the IFC export (warning: the studio stores them too)
  try {
    const gs = geschosseAus({ geschosse: normalisiert.geschosse, storeyHeight: normalisiert.storeyHeight });
    const model = createBuildingModel({
      footprintM: normalisiert.footprintM, storeys: normalisiert.storeys, storeyHeight: normalisiert.storeyHeight, geschosse: normalisiert.geschosse ?? null,
      untergeschosse: normalisiert.untergeschosse ?? 0, dachform: normalisiert.dachform ?? null, dachneigung: normalisiert.dachneigung ?? null,
      ...(normalisiert.parapet ? { parapet: normalisiert.parapet } : {}),
    });
    const giebel = mitGiebelProfilen(model, globalesDach(model, normalisiert.dachform, normalisiert.dachneigung, gs));
    const wirtModell = { customWalls: normalisiert.customWalls || [], huelle: giebel.model.walls, werkstatt: null, projektId: null, geschosse: gs };
    for (const liste of /** @type {const} */ (["customWindows", "envOpenings"])) {
      (normalisiert[liste] || []).forEach((/** @type {any} */ o, /** @type {number} */ i) => {
        const wirt = wirtVon(o, wirtModell);
        if (!wirt) { w(`${liste}[${i}]`, `${wer(liste, o)}: keine Wand gefunden, in der die Öffnung sitzt.`); return; }
        const len = wirt.wand.laenge_m || 1, u = o.u ?? len / 2;
        const anker = o.bruestung_bezug === "okrd" || o.bruestung_bezug === "okff"
          ? ankerFuerWand({ level: wirt.wand.level || 0, unterkante_m: wirt.wand.unterkante_m }, gs, { huelle: model.slabs, gezeichnet: normalisiert.customSlabs || [] },
            { x: wirt.wand.a.x + ((wirt.wand.b.x - wirt.wand.a.x) / len) * u, z: wirt.wand.a.z + ((wirt.wand.b.z - wirt.wand.a.z) / len) * u })
          : null;
        const r = oeffnungPasst(oeffnungsMasse(o, anker), wirt.wand.laenge_m, wirt.wand.hoehe_m, { profil: wirt.wand.profil || null, u: o.u ?? null });
        if (!r.ok) w(`${liste}[${i}]`, `${wer(liste, o)}: ${r.text} — im 3D auf die Wand begrenzt, im IFC nicht enthalten.`);
      });
    }
    (normalisiert.customStairs || []).forEach((/** @type {any} */ t, /** @type {number} */ i) => {
      for (const x of (istUTreppe(t) ? treppeUBerechnen(t, geschosshoehe(t.level, gs)) : treppeBerechnen(t, geschosshoehe(t.level, gs))).warnungen) w(`customStairs[${i}]`, `${wer("customStairs", t)}: ${x.text}.`);
    });
  } catch (err) {
    w("", `Die Öffnungs- und Treppenprüfung lief nicht durch (${/** @type {any} */ (err)?.message || err}) — die Form ist geprüft, die Passung nicht.`);
  }

  return { ok: true, fehler, warnungen, normalisiert, zusammenfassung };
}

/**
 * Elements per list of a record or an import (for the dry run "vorher → nachher").
 * @param {Record<string, any>|null|undefined} satz BimModel record or normalised import
 * @returns {Record<string, number>}
 */
export function listenAnzahl(satz) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const l of IMPORT_LISTEN) out[l] = Array.isArray(satz?.[l]) ? satz[l].length : 0;
  return out;
}

/**
 * The record patch of an import: programme fields, roof and lists of the import replace the stored ones; a list the import does not
 * name is written empty (the import is the whole drawn model) — except `customStairs`, which follows the studio's additive rule (written
 * only when the import names it or the record already had it). Fields outside the format (fachlayer such as netz_layer, gauben,
 * planNotizen, build-up settings) are not part of the patch and stay. GlobalIds are pinned exactly like the studio's save
 * (guidsAnheften on GUID_LISTEN), so the IFC GUID of an element is the one the studio would pin. The outline gets the provenance
 * "gezeichnet" (a decision, not a measurement).
 * @param {Record<string, any>} normalisiert modellPruefen().normalisiert
 * @param {string|null} projektId project of the record (part of the derived GUID)
 * @param {{hatteTreppen?: boolean, jetzt?: Date}} [opt] hatteTreppen: the stored record has the field customStairs
 * @returns {Record<string, any>}
 */
export function importPatch(normalisiert, projektId, { hatteTreppen = false, jetzt = new Date() } = {}) {
  const n = normalisiert || {};
  /** @type {Record<string, any>} */
  const patch = {
    footprintM: n.footprintM, footprintQuelle: { art: "gezeichnet", datum: jetzt.toISOString() },
    storeys: n.storeys, storeyHeight: n.storeyHeight, unit: IMPORT_EINHEIT,
    geschosse: Array.isArray(n.geschosse) ? n.geschosse : null, untergeschosse: n.untergeschosse ?? 0,
    dachform: n.dachform ?? null, dachneigung: n.dachneigung ?? null,
  };
  if (n.entranceCfg !== undefined) patch.entranceCfg = n.entranceCfg;
  if (n.parapet !== undefined) patch.parapet = n.parapet;
  for (const liste of IMPORT_LISTEN) {
    if (liste === "customStairs" && n.customStairs === undefined && !hatteTreppen) continue;
    const l = Array.isArray(n[liste]) ? n[liste] : [];
    patch[liste] = GUID_LISTEN.includes(liste) ? guidsAnheften(l, projektId, liste) : l;
  }
  return patch;
}
