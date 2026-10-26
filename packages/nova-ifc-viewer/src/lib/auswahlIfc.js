// 106-02: the selection of the IFC viewer as plain data for auswahlKontext() (@core/lib/zeigen).
// Resolves semantic elements of a parsed model into {guid, klasse, name, geschoss, steckbrief,
// mittelpunkt}: the GUID is the element's own GlobalId (what the IFC file says), the data sheet comes
// from steckbrief() with the model's values laid over it, and the centre/box from the merged mesh.
//
// In:  parsed model (parseIfcModel(): elements, merged {positions, index, ranges}, storeys).
// Out: pure functions, no DOM, no three.js. Scene coordinates are the model's (y up, metres).
import { BAUTEIL_TYPEN, steckbrief } from "@core/lib/bauteil/steckbrief.js";
import { auswahlKontext, AUSWAHL_KONTEXT_MAX } from "@core/lib/zeigen/auswahlKontext.js";

/**
 * Axis-aligned box of the given elements in the merged mesh.
 * @param {{positions: ArrayLike<number>, index: ArrayLike<number>, ranges: Array<{eid: number, start: number, count: number}>}} merged
 *   Merged geometry; ranges are in INDEX units (as parseIfcModel builds them).
 * @param {Iterable<number>} eids  expressIds whose ranges are measured.
 * @returns {{min: [number, number, number], max: [number, number, number]}|null}  Box in m; null when none of the
 *   elements has geometry.
 */
export function elementBox(merged, eids) {
  if (!merged?.ranges) return null;
  const set = eids instanceof Set ? eids : new Set(eids);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  const { positions, index } = merged;
  for (const r of merged.ranges) {
    if (!set.has(r.eid)) continue;
    for (let i = r.start; i < r.start + r.count; i++) {
      const v = index[i] * 3;
      for (let k = 0; k < 3; k++) {
        const c = positions[v + k];
        if (c < min[k]) min[k] = c;
        if (c > max[k]) max[k] = c;
      }
      n += 1;
    }
  }
  return n ? { min: /** @type {[number, number, number]} */ (min), max: /** @type {[number, number, number]} */ (max) } : null;
}

/**
 * Data sheet of an imported element. steckbrief() needs a type key; the first registry type with the
 * element's IFC class is taken, so values the model does not state stay type defaults MARKED
 * `abgeleitet` in `quelle` (never shown as decided). Values the model does state (status, cost
 * group, material, class) win and count as `gesetzt`. A class without a registry type gets a minimal
 * sheet that lists everything undecided as open.
 * What only the type default would know is NOT passed on as if it were a fact of this element: the
 * quantity comes from the model's own quantities (`mengen`, m2 / m / m3 of the type's unit; one piece for
 * a unit of Stk), else it is null; `tragend` and the coarse trade (`gewerkGrob`) are null and listed as open.
 * @param {any} el  Semantic element (ifcType, globalId, status, classification.code, material, mengen {area m2, length m, volume m3}).
 * @returns {any}  steckbrief()-compatible object whose `guid` is always the element's own GlobalId.
 */
export function steckbriefAusIfc(el) {
  const klasse = el?.ifcType || null;
  const guid = el?.globalId || null;
  const typKey = klasse ? Object.keys(BAUTEIL_TYPEN).find((k) => BAUTEIL_TYPEN[k].ifc === klasse) : null;
  const kg = el?.classification?.code && /^\d{1,3}$/.test(String(el.classification.code)) ? String(el.classification.code) : undefined;
  if (!typKey) {
    const stehtImModell = { kg: kg ?? null, material: el?.material || null, status: el?.status && el.status !== "unbekannt" ? el.status : null };
    const quelle = Object.fromEntries(Object.entries(stehtImModell).map(([k, v]) => [k, v == null ? "offen" : "gesetzt"]));
    return { typ: null, ...stehtImModell, gewerk: null, gewerkGrob: null, menge: null, bauabschnitt: null, tragend: null, guid, quelle,
      offen: Object.entries(quelle).filter(([, v]) => v === "offen").map(([k]) => k).concat(["gewerk"]) };
  }
  const roh = {
    guid: typeof guid === "string" && guid.length === 22 ? guid : undefined,
    ifc_klasse: klasse,
    status: el?.status && el.status !== "unbekannt" ? el.status : undefined, // steckbrief(): unknown stays "ohne Status"
    kg,
    material: el?.material || undefined,
  };
  const sb = steckbrief(roh, typKey, { quelle: "ifc", typAbgeleitet: true });
  const q = el?.mengen || {};
  const aus = { m2: q.area, m: q.length, m3: q.volume }[sb.menge.einheit];
  const stk = sb.menge.einheit === "Stk";
  const menge = stk ? sb.menge : aus > 0 ? { wert: Math.round(aus * 100) / 100, einheit: sb.menge.einheit } : null;
  const quelle = { ...sb.quelle, menge: menge ? (stk ? "abgeleitet" : "gesetzt") : "offen", tragend: "offen", gewerkGrob: "offen" };
  return { ...sb, menge, tragend: null, gewerkGrob: null, guid, quelle,
    offen: Object.entries(quelle).filter(([, v]) => v === "offen").map(([k]) => k) };
}

/**
 * One selected IFC element as input for auswahlKontext().
 * @param {any} el  Semantic element of the model (null/undefined for a hit without semantics).
 * @param {number} eid  expressId (used for the name when the element has no semantics).
 * @param {{merged?: any, guid?: string|null}} model  Parsed model (merged geometry) and the GUID of the hit.
 * @returns {{guid: string|null, klasse: string|null, name: string, geschoss: string|null, steckbrief: any, mittelpunkt: number[]|null}}
 *   mittelpunkt: centre of the element's box as [x, y, z] in m (null without geometry); guid null for an element without GlobalId.
 */
export function ifcBauteil(el, eid, model) {
  const box = elementBox(model.merged, [eid]);
  return {
    guid: el?.globalId || model.guid || null,
    klasse: el?.ifcType || null,
    name: el?.name || "",
    geschoss: el?.storey || null,
    steckbrief: el ? steckbriefAusIfc(el) : null,
    mittelpunkt: box ? [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) : null,
  };
}

/**
 * The selection record of a set of IFC elements (one click, or "Treffer auswählen"). Only the first
 * AUSWAHL_KONTEXT_MAX elements are resolved; the total and `gekuerzt` say so.
 * @param {number[]} eids  expressIds of the selected elements (a snapshot taken when the selection was made).
 * @param {{merged?: any, guidByExpressId?: Map<number, string>, elements?: any[]}} model  Parsed model.
 * @param {{elementZu?: (eid: number) => any, kamera?: any, breite?: number, hoehe?: number}} [opt]
 *   elementZu: expressId to semantic element (a cached lookup; default scans model.elements); kamera/breite/hoehe:
 *   camera and canvas size in px for the screen position.
 * @returns {ReturnType<typeof auswahlKontext>}
 */
export function ifcAuswahlKontext(eids, model, opt = {}) {
  const kopf = (eids || []).slice(0, AUSWAHL_KONTEXT_MAX);
  const zu = opt.elementZu || ((eid) => (model.elements || []).find((e) => e.expressId === eid));
  return auswahlKontext(
    kopf.map((eid) => ifcBauteil(zu(eid), eid, { merged: model.merged, guid: model.guidByExpressId?.get(eid) })),
    { kamera: opt.kamera, breite: opt.breite, hoehe: opt.hoehe, gesamt: (eids || []).length },
  );
}

/**
 * Short read-out of a loaded model so an agent can find GUIDs: counts per IFC class, storeys and the
 * first elements with geometry and a GUID (optionally only one IFC class, so a long model can be searched
 * class by class; the counts per class always cover the whole model).
 * @param {{elements?: any[], storeys?: string[], merged?: {ranges: Array<{eid: number}>}}} model  Parsed model.
 * @param {{max?: number, klasse?: string}} [opt]  max: upper bound of listed elements (default 200);
 *   klasse: list only this IFC class (case-insensitive, e.g. "IfcWall").
 * @returns {{klassen: Record<string, number>, geschosse: string[], anzahl: number, gekuerzt: boolean,
 *   bauteile: Array<{guid: string, klasse: string, name: string, geschoss: string|null}>}}
 *   anzahl: elements with geometry in the whole model; gekuerzt: the filtered list was cut at max.
 */
export function ifcModellUebersicht(model, opt = {}) {
  const max = opt.max ?? 200;
  const klasseGesucht = opt.klasse ? String(opt.klasse).toLowerCase() : null;
  const mitGeometrie = new Set((model?.merged?.ranges || []).map((r) => r.eid));
  const alle = (model?.elements || []).filter((e) => e.globalId && mitGeometrie.has(e.expressId));
  /** @type {Record<string, number>} */
  const klassen = {};
  for (const e of alle) klassen[e.ifcType || "?"] = (klassen[e.ifcType || "?"] || 0) + 1;
  const liste = klasseGesucht ? alle.filter((e) => String(e.ifcType || "").toLowerCase() === klasseGesucht) : alle;
  return {
    klassen,
    geschosse: [...(model?.storeys || [])],
    anzahl: alle.length,
    gekuerzt: liste.length > max,
    bauteile: liste.slice(0, max).map((e) => ({ guid: e.globalId, klasse: e.ifcType || "", name: e.name || "", geschoss: e.storey || null })),
  };
}
