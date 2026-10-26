// Checks against wrong planning (phase 97-06, concept .planning/phases/97-brillen/97-KONZEPT.md §5).
// They run on the ONE model (drawn elements, workshop components, hull, network, openings) and
// return findings — never a block: whether a load-bearing wall may go or a seal is adequate is
// decided by the structural / fire-protection engineer; the program shows what is missing or
// contradictory (liability decision: warn/hinweis, never fail).
//
// Implemented (numbers of the concept):
//  1 element without status in an existing-building project            hinweis
//  3 opening survives its demolished wall                               warn
//  5 demolition of a load-bearing element without structural note       warn
//  6 layer status contradicts the element (core demolished, layer kept)  warn
//    + opening demolished in a wall that stays → draw a Zumauerung      hinweis
//  8 penetration of a fire-rated element without fire stop / weaker one warn
//  9 penetration in a load-bearing element without structural approval  warn
// 10 penetration in a wall that is demolished                           hinweis
// 11 a line crosses a wall without a planned penetration                hinweis
// 12 a penetration lies outside its host wall (107-04)                  hinweis
// 2 (tender position mixing statuses) runs in the AVA card "Mengentöpfe" (bestandsMengen.statusMischung),
// 7 (lens vs sheet scale) in the PDF export (97-09). Not yet: 4 (survey-closed flag does not exist yet).
//
// In:  { modell (BimModel record), werkstatt (werkstattBauteile result, optional), durchbrueche
//      (Durchbruch records), projektId, bauart, huelle (hull walls of the model, optional), geschosse (storey source, optional) }.
//      Out: Befund[]. Pure, no I/O.

import { typFuerWand, steckbrief, bauteilGuid } from "./steckbrief.js";
import { attributeVon, mitAttributen, werkstattMitAttributen } from "./attribute.js";
import { normalizeStatus } from "../bimClassification.js";
import { wirtVon, durchbruchImWirt } from "./oeffnungen.js";

/** German name and element-id prefix of an opening: door, opening without a filling (107-04), else window. */
const artVon = (/** @type {any} */ o) => (o?.kind === "door" ? { name: "Tür", id: "door" } : o?.kind === "oeffnung" ? { name: "Öffnung", id: "oeffnung" } : { name: "Fenster", id: "window" });

/**
 * @typedef {object} Befund
 * @property {number} regel   rule number of the concept §5
 * @property {string} code
 * @property {'warn'|'hinweis'} stufe
 * @property {string} text    German UI text (i18n key where constant)
 * @property {string[]} ids   affected element ids / opening numbers
 */

/** Fire resistance in minutes after DIN EN 13501-2 ("EI 90" → 90, "ohne"/empty → 0, unknown → null). */
export function feuerMinuten(klasse) {
  if (klasse === "ohne" || klasse === "" || klasse == null) return 0;
  const m = /^EI\s*(\d+)$/.exec(String(klasse).trim());
  return m ? Number(m[1]) : null;
}

/** Distance from point p to segment a–b in the plan (m). */
function abstandZuStrecke(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Crossing point of two plan segments, or null (touching at an end counts as crossing). */
function schnitt(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const n = r.x * s.z - r.z * s.x;
  if (Math.abs(n) < 1e-12) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / n;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / n;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * r.x, z: a.z + t * r.z };
}

/**
 * Walls of the model with id, GUID, level, axis, status and load-bearing flag.
 * @param {any} modell
 * @param {any} werkstatt
 * @param {string|number|null} projektId
 */
function waendeVon(modell, werkstatt, projektId) {
  const liste = [];
  for (const w of Array.isArray(modell?.customWalls) ? modell.customWalls : []) {
    if (!w?.a || !w?.b) continue;
    const typ = typFuerWand(w).typ;
    liste.push({ id: `wall-${w._idx}`, guid: bauteilGuid(projektId, "customWalls", w), level: w.level || 0, a: w.a, b: w.b,
      status: normalizeStatus(w.status), tragend: steckbrief(w, typ).tragend, vermerk: w.statik_vermerk, roh: w });
  }
  const wt = werkstattMitAttributen(werkstatt, modell?.bauteil_attribute_layer);
  for (const w of (wt?.waende || []).filter((x) => !x.huelle)) {
    liste.push({ id: `wt-wall-${w.guid}`, guid: w.guid, level: w.level || 0, a: w.a, b: w.b, status: normalizeStatus(w.status),
      tragend: !!w.tragend, vermerk: w.statik_vermerk, roh: w });
  }
  return liste;
}

/**
 * Run the checks.
 * @param {{modell: any, werkstatt?: any, durchbrueche?: any[], projektId?: string|number|null, bauart?: 'neubau'|'bestand', huelle?: any[]|null, geschosse?: import("./hoehen.js").Geschosse}} eingabe
 *   huelle (107-04): `model.walls` of the building model — hosts of check 12 among the hull walls; geschosse (107-04): the storey source (hoehen.js) —
 *   without it check 12 does not test the height
 * @returns {Befund[]}
 */
export function fehlplanungPruefen({ modell, werkstatt = null, durchbrueche = [], projektId = null, bauart = "neubau", huelle = null, geschosse = undefined }) {
  /** @type {Befund[]} */
  const befunde = [];
  const m = modell || {};
  const waende = waendeVon(m, werkstatt, projektId);
  const nachGuid = new Map(waende.map((w) => [w.guid, w]));
  const arr = (a) => (Array.isArray(a) ? a : []);
  // host walls for the penetration checks 9, 10 and 12: ONE resolver (wirtVon) over drawn, hull and workshop walls (107-04 review: 9 and 10 used
  // their own map of drawn and workshop walls and missed a penetration in a hull wall that check 12 found)
  const wirtModell = { customWalls: arr(m.customWalls), huelle: arr(huelle), werkstatt: werkstatt ? werkstattMitAttributen(werkstatt, m.bauteil_attribute_layer) : null, projektId, geschosse };
  /**
   * Status and load-bearing flag of the host of a penetration. Drawn and workshop walls come from the wall list; a hull wall is read like the
   * IFC export reads it (attributes of "hull-wall" over the model wall, load-bearing from the data-sheet type).
   * @param {any} d penetration record
   * @returns {{status: string|null, tragend: boolean}|null} null when no wall of this model matches
   */
  const wirtDaten = (d) => {
    const wirt = wirtVon(d, wirtModell);
    if (!wirt) return null;
    if (wirt.familie === "huelle") {
      const roh = mitAttributen({ ...wirt.roh, huelle: true, id: `${wirt.roh.level}:${wirt.roh.edge}` }, attributeVon(m, "hull-wall"));
      return { status: normalizeStatus(roh.status), tragend: !!steckbrief(roh, typFuerWand(roh).typ).tragend };
    }
    return nachGuid.get(wirt.guid) ?? null;
  };

  // 1 — existing-building project: every element needs a status (an unknown one silently
  // changes demolition and tender quantities).
  if (bauart === "bestand") {
    const ohne = [
      ...waende.filter((w) => !w.status).map((w) => w.id),
      ...arr(m.customColumns).filter((c) => !normalizeStatus(c.status)).map((c) => `column-${c._idx}`),
      ...arr(m.customSlabs).filter((s) => !normalizeStatus(s.status)).map((s) => `slab-${s._idx}`),
      ...arr(m.customRoofs).filter((r) => !normalizeStatus(r.status)).map((r) => `roof-${r._idx}`),
      ...(normalizeStatus(attributeVon(m, "hull-wall")?.status) ? [] : ["hull-wall"]),
    ];
    if (ohne.length) befunde.push({ regel: 1, code: "ohne_status", stufe: "hinweis", text: `${ohne.length} Bauteil(e) ohne Umbaustatus im Bestandsprojekt`, ids: ohne });
  }

  // 3 — an opening in a demolished wall must go with it (or be decided otherwise).
  for (const o of arr(m.customWindows)) {
    const w = waende.find((x) => x.id === `wall-${o.wallIdx}`);
    if (w?.status === "abbruch" && normalizeStatus(o.status) !== "abbruch") {
      befunde.push({ regel: 3, code: "oeffnung_in_abbruchwand", stufe: "warn", text: `${artVon(o).name} bleibt stehen, die Wand wird abgebrochen`, ids: [`${artVon(o).id}-${o._idx}`] });
    }
  }
  if (normalizeStatus(attributeVon(m, "hull-wall")?.status) === "abbruch") {
    const bleiben = arr(m.envOpenings).filter((o) => normalizeStatus(o.status) !== "abbruch");
    if (bleiben.length) befunde.push({ regel: 3, code: "oeffnung_in_abbruchwand", stufe: "warn", text: `${bleiben.length} Öffnung(en) der Hülle bleiben stehen, die Hülle wird abgebrochen`, ids: bleiben.map((o) => `env-${artVon(o).id}-${o._idx}`) });
  }

  // 5 — demolishing a load-bearing element needs the structural engineer (shoring, load path).
  const tragendAbbruch = [
    ...waende.filter((w) => w.tragend && w.status === "abbruch" && !String(w.vermerk || "").trim()).map((w) => w.id),
    ...arr(m.customColumns).filter((c) => normalizeStatus(c.status) === "abbruch" && !String(c.statik_vermerk || "").trim()).map((c) => `column-${c._idx}`),
  ];
  if (tragendAbbruch.length) befunde.push({ regel: 5, code: "abbruch_tragend", stufe: "warn", text: "Abbruch tragender Bauteile ohne Vermerk zu Abstützung/Statik — Tragwerksplanung einbinden", ids: tragendAbbruch });

  // 6 — layer status against element status (97-05): when the load-bearing core (thickest layer)
  // is demolished, no layer can stay or be new on it; a new layer on a demolished element is a
  // contradiction as well.
  for (const w of arr(m.customWalls)) {
    const ss = w?.schicht_status && typeof w.schicht_status === "object" ? w.schicht_status : null;
    if (!ss) continue;
    const st = normalizeStatus(w.status);
    const schichten = steckbrief(w, typFuerWand(w).typ).aufbau?.schichten || [];
    if (!schichten.length) continue;
    const kern = schichten.reduce((k, l, i) => (l.dicke_m > schichten[k].dicke_m ? i : k), 0);
    const kernStatus = schichten[kern].status;
    const widerspruch = schichten.some((l, i) => i !== kern && kernStatus === "abbruch" && l.status && l.status !== "abbruch")
      || (st === "abbruch" && schichten.some((l) => l.status === "neubau"));
    if (widerspruch) befunde.push({ regel: 6, code: "schichtstatus_widerspruch", stufe: "warn", text: "Schicht bleibt oder ist neu, aber der Kern der Wand wird abgebrochen", ids: [`wall-${w._idx}`] });
  }
  for (const o of arr(m.customWindows)) {
    const w = waende.find((x) => x.id === `wall-${o.wallIdx}`);
    if (normalizeStatus(o.status) === "abbruch" && w && w.status && w.status !== "abbruch") {
      const zu = arr(m.customWalls).some((z) => z?.bauteil_typ === "zumauerung" && (z.level || 0) === w.level && abstandZuStrecke(z.a, w.a, w.b) < 0.3 && abstandZuStrecke(z.b, w.a, w.b) < 0.3);
      if (!zu) befunde.push({ regel: 6, code: "zumauerung_fehlt", stufe: "hinweis", text: `${artVon(o).name} wird abgebrochen, die Wand bleibt — Zumauerung als eigenes Bauteil zeichnen`, ids: [`${artVon(o).id}-${o._idx}`] });
    }
  }

  // 8, 9, 10 — penetrations (Durchbruch records of the openings planning); the host of 9 and 10 is found like the one of 12 (wirtDaten).
  for (const d of arr(durchbrueche)) {
    if (!d || d.status === "abgelehnt") continue;
    const nr = d.nr || d.id || "?";
    const soll = feuerMinuten(d.feuerwiderstand);
    if (soll) {
      const schott = d.brandschott && typeof d.brandschott === "object" ? d.brandschott : null;
      const ist = schott ? feuerMinuten(schott.klasse) : null;
      if (!schott && !String(d.abschottung || "").trim()) befunde.push({ regel: 8, code: "schott_fehlt", stufe: "warn", text: `${nr}: Durchführung durch ${d.feuerwiderstand} ohne Brandschott (MLAR Abschn. 4)`, ids: [nr] });
      else if (schott && ist !== null && ist < soll) befunde.push({ regel: 8, code: "schott_schwaecher", stufe: "warn", text: `${nr}: Brandschott ${schott.klasse} schwächer als das Bauteil (${d.feuerwiderstand})`, ids: [nr] });
    }
    const wirt = d.bauteil_guid ? wirtDaten(d) : null;
    if (wirt?.tragend && d.pruefung?.statik?.ergebnis !== "ok") befunde.push({ regel: 9, code: "durchbruch_tragend_ohne_statik", stufe: "warn", text: `${nr}: Durchbruch in tragendem Bauteil ohne Freigabe der Statik`, ids: [nr] });
    if (wirt?.status === "abbruch") befunde.push({ regel: 10, code: "durchbruch_in_abbruchwand", stufe: "hinweis", text: `${nr}: Durchbruch in einer Wand, die abgebrochen wird — gegenstandslos?`, ids: [nr] });
  }

  // 12 — a penetration whose position does not lie in its host wall (107-04). The host is the wall named by `bauteil_guid` among the drawn, hull and
  // workshop walls of THIS model; a GUID that names no wall here (an element of an imported model file) is no finding — it is not ours to check.
  // hinweis, not warn (liability decision): the openings planning stores x/y/z rounded and may place a request before the wall is drawn at its
  // final spot; whether the penetration really misses the wall is for the planner to look at. Tolerance DURCHBRUCH_WIRT_TOL_M [ASSUMED].
  for (const d of arr(durchbrueche)) {
    if (!d || d.status === "abgelehnt" || !d.bauteil_guid) continue;
    // an incomplete position is the finding "lage_fehlt" of the openings planning, not ours
    if (![d.x, d.y, d.z].every((v) => v != null && v !== "" && Number.isFinite(Number(v)))) continue;
    const wirt = wirtVon(d, wirtModell);
    if (!wirt) continue;
    const r = durchbruchImWirt(d, wirt, { hoehe: geschosse !== undefined });
    if (!r.innen) befunde.push({ regel: 12, code: "durchbruch_ausserhalb_wirt", stufe: "hinweis", text: `${d.nr || d.id || "?"}: Durchbruch liegt nicht im zugeordneten Bauteil (${r.grund})`, ids: [d.nr || d.id || "?"] });
  }

  // 11 — a line of the network crosses a wall on its level without a planned penetration there.
  // [ASSUMED] tolerance 0.6 m between crossing point and opening position (IFC X = plan x,
  // IFC Y = plan z); a wall that is demolished needs no penetration.
  const netz = m.netz_layer && Array.isArray(m.netz_layer.kanten) ? m.netz_layer : null;
  if (netz) {
    const offen = [];
    for (const k of netz.kanten) {
      const pts = Array.isArray(k?.points) ? k.points : [];
      for (let i = 1; i < pts.length; i++) {
        for (const w of waende) {
          if (w.level !== (k.level || 0) || w.status === "abbruch") continue;
          const p = schnitt(pts[i - 1], pts[i], w.a, w.b);
          if (!p) continue;
          const geplant = arr(durchbrueche).some((d) => d && d.status !== "abgelehnt" && (d.bauteil_guid === w.guid || !d.bauteil_guid)
            && Number.isFinite(Number(d.x)) && Number.isFinite(Number(d.y)) && Math.hypot(Number(d.x) - p.x, Number(d.y) - p.z) <= 0.6
            && abstandZuStrecke({ x: Number(d.x), z: Number(d.y) }, w.a, w.b) <= 0.6);
          if (!geplant) offen.push(`${k.id}×${w.id}`);
        }
      }
    }
    if (offen.length) befunde.push({ regel: 11, code: "kreuzung_ohne_durchbruch", stufe: "hinweis", text: `${offen.length} Leitungskreuzung(en) mit Wänden ohne geplanten Durchbruch`, ids: offen });
  }
  return befunde;
}
