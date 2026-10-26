// 106-02: the elements of the BIM studio as plain data for the selection context (auswahlKontext) and
// for "select by GUID". One resolver per element kind turns a studio selection entry
// ({type, index|level/edge, scope}) into {guid, klasse, name, geschoss, steckbrief, mittelpunkt}.
// The GUID is the one the IFC export writes (bauteilGuid with the same source names as ifcExport.js,
// hull walls via huellwandGuid), so "dieses Bauteil" means the same element in hover, export and commands.
//
// In:  the element arrays of the studio, the generated model (hull walls, storeys), project id.
// Out: pure functions, no React, no three.js. Scene coordinates: x/z plan metres, y up (storey elevation through @core/lib/bauteil/hoehen.js).
import { steckbrief, typFuerWand } from "@core/lib/bauteil/steckbrief.js";
import { mitAttributen } from "@core/lib/bauteil/attribute.js";
import { elevationOf, unterkante, wandHoehe, stuetzenHoehe, geschosshoehe, dachFirsthoehe_m, dachNeigung_grad, geschosseAus, FLACHDACH_BIS_GRAD } from "@core/lib/bauteil/hoehen.js";
import { auswahlKontext, AUSWAHL_KONTEXT_MAX } from "@core/lib/zeigen/auswahlKontext.js";
import { huellwandGuid } from "./bauteilInfo.js";

/**
 * @typedef {object} BimDaten
 * @property {any[]} [customWalls]
 * @property {any[]} [customColumns]
 * @property {any[]} [customWindows]   openings in drawn walls [{wallIdx, u, kind, _idx}]
 * @property {any[]} [envOpenings]     openings in hull walls [{level, edge, u, kind, _idx}]
 * @property {any[]} [customZones]
 * @property {any[]} [customSlabs]
 * @property {any[]} [customRoofs]
 * @property {{walls?: any[], slabs?: any[], storeys?: Array<{level: number, name: string}>}} [model]  Generated model: hull walls, hull slabs, storeys.
 * @property {number} [storeyHeight]   Storey height in m (default 3).
 * @property {Array<{level: number, name?: string, hoehe_m: number}>|null} [geschosse]   Storey table (107-02); without it every storey has `storeyHeight`.
 * @property {Record<string, any>|null} [huelleAttribute]  Table attributes of the hull ("hull-wall"), laid over the sheet.
 * @property {Record<string, any>|null} [huelleDeckenAttribute]  Table attributes of the hull slabs ("hull-slab").
 * @property {Record<string, any>|null} [huelleBodenAttribute]   Table attributes of the base slab ("hull-floor").
 */

/**
 * Selection types a click can set in the studio. Hull slabs ("hullslab") have a GUID in the IFC export but
 * no mesh the mouse can pick, so a command refuses to select them (same as a click would) while the model
 * read-out still lists them.
 */
export const BIM_WAEHLBAR = Object.freeze(new Set(["wall", "column", "zone", "slab", "roof", "opening", "hullwall"]));

const finde = (arr, id) => (id == null ? undefined : (arr || []).find((x) => x._idx === id));

/** Name of a storey from the model's list ("EG", "1. OG"). */
const geschossName = (daten, level) => daten.model?.storeys?.find((s) => s.level === level)?.name ?? (level == null ? null : `Geschoss ${level}`);

const mitte = (punkte) => {
  const p = (punkte || []).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.z));
  return p.length ? { x: p.reduce((s, q) => s + q.x, 0) / p.length, z: p.reduce((s, q) => s + q.z, 0) / p.length } : null;
};

/**
 * One studio element as input for auswahlKontext().
 * @param {{type: string, index?: number, scope?: string, level?: number, edge?: number}} sel  Selection entry of the studio
 *   (wall, column, opening, zone, slab, roof, hullwall, hullslab).
 * @param {BimDaten} daten  Element arrays and model of the studio.
 * @param {{projektId?: string|number|null}} [opt]  Project of the model (part of the derived GUID).
 * @returns {{guid: string, klasse: string, name: string, geschoss: string|null, steckbrief: any, mittelpunkt: number[]|null, sel: any, waehlbar: boolean}|null}
 *   name: the element's own name (rooms), else the type label of its data sheet ("Außenwand", "Stütze"), like the IFC export;
 *   mittelpunkt: [x, y, z] in m; waehlbar: a click can select this kind of element (see BIM_WAEHLBAR);
 *   null for an entry that does not exist (any more) or has no GUID (generated auto openings): refused, not guessed.
 */
export function bimBauteil(sel, daten, opt = {}) {
  if (!sel) return null;
  const sh = daten.storeyHeight || 3;
  const gq = geschosseAus({ geschosse: daten.geschosse, storeyHeight: daten.storeyHeight });
  const ctx = { projektId: opt.projektId ?? null, storeyHeight: sh, geschosse: gq };
  // the sheet does not carry the two fields the change tools add (106-03); they are read off the element itself
  const sb = (el, typ, quelle, extra = {}) => ({ ...steckbrief(el, typ, { ...ctx, quelle, ...extra }), feuerwiderstand: el?.feuerwiderstand ?? null, statik_vermerk: el?.statik_vermerk ?? null });
  /** @param {any} s sheet @param {number|null} level @param {number[]|null} mp @param {string} name */
  const fertig = (s, level, mp, name = "") => ({ guid: s.guid, klasse: s.ifc.klasse, name: name || s.label || "", geschoss: geschossName(daten, level), steckbrief: s, mittelpunkt: mp, sel, waehlbar: BIM_WAEHLBAR.has(sel.type) });
  const y0 = (level) => elevationOf(level || 0, gq);

  if (sel.type === "wall") {
    const w = finde(daten.customWalls, sel.index); if (!w) return null;
    const ty = typFuerWand(w);
    return fertig(sb(w, ty.typ, "customWalls", { typAbgeleitet: ty.abgeleitet }), w.level, [(w.a.x + w.b.x) / 2, unterkante(w, gq) + wandHoehe(w, gq) / 2, (w.a.z + w.b.z) / 2]);
  }
  if (sel.type === "column") {
    const c = finde(daten.customColumns, sel.index); if (!c) return null;
    return fertig(sb(c, "stuetze", "customColumns"), c.level, [c.x, unterkante(c, gq) + stuetzenHoehe(c, gq) / 2, c.z]);
  }
  if (sel.type === "zone") {
    const z = finde(daten.customZones, sel.index); if (!z) return null;
    const m = mitte(z.points);
    return fertig(sb(z, "raum", "customZones"), z.level, m ? [m.x, unterkante(z, gq) + geschosshoehe(z.level || 0, gq) / 2, m.z] : null, z.name || "");
  }
  if (sel.type === "slab") {
    const s = finde(daten.customSlabs, sel.index); if (!s) return null;
    const m = mitte(s.points);
    return fertig(sb(s, "decke", "customSlabs"), s.level, m ? [m.x, y0(s.level) + geschosshoehe(s.level, gq) / 2, m.z] : null);
  }
  if (sel.type === "roof") {
    const r = finde(daten.customRoofs, sel.index); if (!r) return null;
    const m = mitte(r.points);
    return fertig(sb(r, dachNeigung_grad(r) <= FLACHDACH_BIS_GRAD ? "dach-flach" : "dach-geneigt", "customRoofs"), r.level, m ? [m.x, elevationOf((r.level || 0) + 1, gq) + dachFirsthoehe_m(r) / 2, m.z] : null);
  }
  if (sel.type === "opening") {
    const env = sel.scope === "env";
    const o = finde(env ? daten.envOpenings : daten.customWindows, sel.index); if (!o) return null;
    const w = env ? daten.model?.walls?.find((x) => x.level === o.level && x.edge === o.edge) : finde(daten.customWalls, o.wallIdx);
    const wallKey = env ? `env:${o.level}:${o.edge}` : `cw:${o.wallIdx}`;
    const tuer = o.kind === "door";
    // source name exactly as ifcExport.js builds it for the opening's GUID
    // 107-04: an opening without a filling (kind "oeffnung") is an IfcOpeningElement of the type "oeffnung", like the export writes it
    const s = sb(o, tuer ? (env ? "tuer-aussen" : "tuer-innen") : o.kind === "oeffnung" ? "oeffnung" : "fenster", `oeffnung|${wallKey}|${o.kind}|${o._idx ?? o.u ?? 0}`);
    let mp = null;
    if (w) { const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1; mp = [w.a.x + ((w.b.x - w.a.x) / len) * o.u, y0(w.level) + geschosshoehe(w.level, gq) / 2, w.a.z + ((w.b.z - w.a.z) / len) * o.u]; }
    return fertig(s, w?.level ?? o.level ?? null, mp);
  }
  if (sel.type === "hullwall") {
    const w = daten.model?.walls?.find((x) => x.level === sel.level && x.edge === sel.edge); if (!w) return null;
    // exactly the element the export builds: the generated wall (a, b, height, thickness, composite) flagged as hull with
    // id "<level>:<edge>" and source "huelle"; the table attributes lie over it. Quantity and build-up come from the wall itself.
    const el = mitAttributen({ ...w, huelle: true, id: `${w.level}:${w.edge}` }, daten.huelleAttribute || null);
    const s = sb(el, "wand-aussen", "huelle");
    return fertig({ ...s, guid: huellwandGuid(opt.projektId ?? null, w.level, w.edge) }, w.level, [(w.a.x + w.b.x) / 2, (w.elevation ?? y0(w.level)) + (w.height || geschosshoehe(w.level, gq)) / 2, (w.a.z + w.b.z) / 2]);
  }
  if (sel.type === "hullslab") {
    const p = daten.model?.slabs?.find((x) => x.level === sel.level); if (!p) return null;
    // the export: lowest hull slab = base slab (level <= 0 and elevation 0), else a floor slab; source "huelle-decke", id "<level>"
    const boden = p.level <= 0 && !(p.elevation > 0);
    const el = mitAttributen({ ...p, id: `${p.level}`, points: p.polygon }, (boden ? daten.huelleBodenAttribute : daten.huelleDeckenAttribute) || null);
    const s = sb(el, boden ? "bodenplatte" : "decke", "huelle-decke");
    const m = mitte(p.polygon);
    return fertig(s, Math.max(0, p.level), m ? [m.x, p.elevation || 0, m.z] : null); // contained in storey max(0, level) like the export
  }
  return null;
}

/**
 * Every element of the studio that has a GUID, as selection entries with their data.
 * @param {BimDaten} daten
 * @param {{projektId?: string|number|null}} [opt]
 * @returns {NonNullable<ReturnType<typeof bimBauteil>>[]}  Hull walls, hull slabs (not clickable: `waehlbar` false), drawn walls,
 *   columns, zones, slabs, roofs, openings. NOT listed because the export writes them without a stable GUID or not at all:
 *   generated auto openings, the generated roof and the parapet. An opening that does not fit its wall is listed here
 *   although the export skips it with a warning ("nicht exportiert") - the studio still shows and selects it.
 */
export function bimAlle(daten, opt = {}) {
  /** @type {any[]} */
  const eintraege = [];
  for (const w of daten.model?.walls || []) eintraege.push({ type: "hullwall", level: w.level, edge: w.edge });
  for (const p of daten.model?.slabs || []) eintraege.push({ type: "hullslab", level: p.level });
  const arten = [["wall", daten.customWalls], ["column", daten.customColumns], ["zone", daten.customZones], ["slab", daten.customSlabs], ["roof", daten.customRoofs]];
  for (const [type, arr] of arten) for (const x of arr || []) eintraege.push({ type, index: x._idx });
  for (const o of daten.customWindows || []) eintraege.push({ type: "opening", index: o._idx, scope: "custom" });
  for (const o of daten.envOpenings || []) eintraege.push({ type: "opening", index: o._idx, scope: "env" });
  return eintraege.map((e) => bimBauteil(e, daten, opt)).filter((b) => b != null);
}

/**
 * The selection record of a set of studio entries (what is selected right now). Entries that do not resolve to
 * an element with a GUID (generated auto openings, vanished elements) are not listed but counted as `ohneGuid`;
 * only the first AUSWAHL_KONTEXT_MAX elements are resolved to full records, the total and `gekuerzt` say so.
 * @param {Array<{type: string, index?: number, scope?: string, level?: number, edge?: number}>} eintraege  Selection entries.
 * @param {BimDaten} daten
 * @param {{projektId?: string|number|null, kamera?: any, breite?: number, hoehe?: number}} [opt]
 *   kamera/breite/hoehe: camera and canvas size in px for the screen position (omit in a view where pixels mean nothing).
 * @returns {ReturnType<typeof auswahlKontext>}
 */
export function bimAuswahlKontext(eintraege, daten, opt = {}) {
  const liste = Array.isArray(eintraege) ? eintraege : [];
  const alle = liste.map((e) => bimBauteil(e, daten, opt)).filter((b) => b != null);
  return auswahlKontext(alle.slice(0, AUSWAHL_KONTEXT_MAX),
    { kamera: opt.kamera, breite: opt.breite, hoehe: opt.hoehe, gesamt: alle.length, verworfen: liste.length - alle.length });
}

/**
 * The selection entry of the element with this GUID.
 * @param {string} guid  22-character GlobalId as the IFC export writes it.
 * @param {BimDaten} daten
 * @param {{projektId?: string|number|null}} [opt]
 * @returns {{sel: any, bauteil: NonNullable<ReturnType<typeof bimBauteil>>}|null}  null when no element has this GUID.
 */
export function bimPerGuid(guid, daten, opt = {}) {
  const b = bimAlle(daten, opt).find((x) => x.guid === guid);
  return b ? { sel: b.sel, bauteil: b } : null;
}

/**
 * Short read-out of the studio so an agent can find GUIDs: counts per IFC class, storeys, elements.
 * @param {BimDaten} daten
 * @param {{projektId?: string|number|null}} [opt]
 * @param {{max?: number, klasse?: string}} [liste]  max: upper bound of listed elements (default 200);
 *   klasse: list only this IFC class (case-insensitive); the counts per class always cover the whole model.
 * @returns {{klassen: Record<string, number>, geschosse: string[], anzahl: number, gekuerzt: boolean,
 *   bauteile: Array<{guid: string, klasse: string, name: string, geschoss: string|null, waehlbar: boolean}>}}
 *   anzahl/klassen: every element with a GUID (bimAlle), also the hull slabs a click cannot select (`waehlbar` false).
 */
export function bimModellUebersicht(daten, opt = {}, liste = {}) {
  const max = liste.max ?? 200;
  const alle = bimAlle(daten, opt);
  const klasseGesucht = liste.klasse ? String(liste.klasse).toLowerCase() : null;
  const gelistet = klasseGesucht ? alle.filter((b) => b.klasse.toLowerCase() === klasseGesucht) : alle;
  /** @type {Record<string, number>} */
  const klassen = {};
  for (const b of alle) klassen[b.klasse] = (klassen[b.klasse] || 0) + 1;
  return {
    klassen,
    geschosse: (daten.model?.storeys || []).map((s) => s.name),
    anzahl: alle.length,
    gekuerzt: gelistet.length > max,
    bauteile: gelistet.slice(0, max).map((b) => ({ guid: b.guid, klasse: b.klasse, name: b.name, geschoss: b.geschoss, waehlbar: b.waehlbar })),
  };
}
