// 107-10 (BK-47, BK-48, BK-77, D-BK-15): the stored solid element operations — Fachlayer `solidrelationen_layer`
// { relationen: [{ id, ziel_guid, operator_guid, operation, aktiv }] } (version 1, fachlayerSchema.js, FACHLAYER-SCHEMA.md).
//
// A relation says "target A is cut by operator B": the TARGET stays stored unchanged (its a, b, profile, height never change,
// spec VI.3 — no writing back), the result is a derived solid of the CSG core (seo.js, lazy). Switching a relation off sets
// `aktiv: false`; the target then shows unchanged again. GUIDs are the persisted ones of 107-08 (bauteilGuid).
//
// This file is pure and free of the CSG core and of three.js: the BIM studio edits relations with it on its start path (the
// 107-14 guard: no request of /lib/csg/ before a solid is computed); seo.js re-exports it and resolves the relations.
//
// In: a layer blob, GUIDs, element records. Out: a NEW layer (never mutated), lists, the group rule.

import { verschneidungsgruppe } from "./steckbrief.js";

/**
 * Operations of a relation and the boolean of the CSG core each maps to (107-14 boolesch). `abzug_nach_oben` removes everything
 * above the operator's upper surface (a wall under a roof), `abzug_nach_unten` everything below its lower surface (the terrain
 * against the excavation pit, gelaendeSolid.js — there implicit, never stored).
 */
export const SEO_OPERATIONEN = Object.freeze({
  abzug: "subtract",
  abzug_nach_oben: "subtract",
  abzug_nach_unten: "subtract",
  schnitt: "intersect",
  vereinigung: "union",
});

/** Empty layer. */
export const SOLIDRELATIONEN_LEER = Object.freeze({ relationen: Object.freeze([]) });

/**
 * @typedef {"abzug"|"abzug_nach_oben"|"abzug_nach_unten"|"schnitt"|"vereinigung"} SeoOperation
 * @typedef {{id: string, ziel_guid: string, operator_guid: string, operation: SeoOperation, aktiv: boolean}} SeoRelation
 * @typedef {{v?: number, relationen: SeoRelation[]}} SolidrelationenLayer
 */

/**
 * The relations of a layer, cleaned: entries without both GUIDs or with an unknown operation are left out (never thrown away
 * from the store — the caller keeps the raw layer).
 * @param {any} layer
 * @returns {SeoRelation[]}
 */
export function relationenVon(layer) {
  const liste = Array.isArray(layer?.relationen) ? layer.relationen : [];
  return liste.filter((r) => r && typeof r.id === "string" && typeof r.ziel_guid === "string" && typeof r.operator_guid === "string"
    && Object.prototype.hasOwnProperty.call(SEO_OPERATIONEN, r.operation))
    .map((r) => ({ id: r.id, ziel_guid: r.ziel_guid, operator_guid: r.operator_guid, operation: r.operation, aktiv: r.aktiv !== false }));
}

/**
 * Creates a relation, or switches an existing one with the same target, operator and operation on again (no duplicates).
 * The id is "r<n>" with the next free number.
 * @param {any} layer current layer (may be empty / undefined)
 * @param {{ziel_guid: string, operator_guid: string, operation: SeoOperation}} r
 * @returns {{layer: SolidrelationenLayer, id: string}}
 */
export function relationAnlegen(layer, { ziel_guid, operator_guid, operation }) {
  if (!Object.prototype.hasOwnProperty.call(SEO_OPERATIONEN, operation)) throw new Error(`unknown solid operation: ${operation}`);
  const liste = Array.isArray(layer?.relationen) ? layer.relationen : [];
  const da = liste.find((r) => r?.ziel_guid === ziel_guid && r?.operator_guid === operator_guid && r?.operation === operation);
  if (da) return { layer: { ...layer, relationen: liste.map((r) => (r === da ? { ...r, aktiv: true } : r)) }, id: da.id };
  const n = liste.reduce((m, r) => Math.max(m, Number(/^r(\d+)$/.exec(String(r?.id))?.[1]) || 0), 0) + 1;
  const id = `r${n}`;
  return { layer: { ...(layer || {}), relationen: [...liste, { id, ziel_guid, operator_guid, operation, aktiv: true }] }, id };
}

/**
 * Switches a relation on or off (`aktiv`); the relation stays stored. Unknown id: the same layer.
 * @param {any} layer
 * @param {string} id
 * @param {boolean} aktiv
 * @returns {SolidrelationenLayer}
 */
export function relationAktivSetzen(layer, id, aktiv) {
  const liste = Array.isArray(layer?.relationen) ? layer.relationen : [];
  if (!liste.some((r) => r?.id === id)) return layer;
  return { ...layer, relationen: liste.map((r) => (r?.id === id ? { ...r, aktiv: !!aktiv } : r)) };
}

/**
 * Active relations whose target is the given GUID, in stored order.
 * @param {any} layer
 * @param {string} ziel_guid
 * @returns {SeoRelation[]}
 */
export function aktiveRelationenFuer(layer, ziel_guid) {
  return relationenVon(layer).filter((r) => r.aktiv && r.ziel_guid === ziel_guid);
}

/**
 * Does a relation act between two elements? Group 0 never intersects (D-BK-15), also not in a CSG subtraction: a target or an
 * operator in group 0 takes part in no relation — the relation stays stored but has no effect, and the panel says so. For groups
 * other than 0: [ASSUMED] an explicitly created relation is an action of the user and acts whatever group numbers both carry (the
 * groups steer only the automatic intersection of 107-09). Way to a decided value: the user confirms or asks for "same group only".
 * @param {any} ziel element record (verschneidungsgruppe as in steckbrief.js; missing = 1)
 * @param {any} operator element record
 * @returns {{wirkt: boolean, grund: null|"gruppe-0"}}
 */
export function relationWirkt(ziel, operator) {
  if (verschneidungsgruppe(ziel) === 0 || verschneidungsgruppe(operator) === 0) return { wirkt: false, grund: "gruppe-0" };
  return { wirkt: true, grund: null };
}

/**
 * Review 107-10: is a key of csg_cache_layer one of the solid relations ("<guid>|seo:<relation ids>", seo.js)? The intersection of
 * 107-09 and the relations clean the shared cache each for their own keys only (cacheBereinigen `bereich`). Pure, so the studio can
 * use it without loading seo.js.
 * @param {string} schluessel cache key "<guid>|<art>"
 * @returns {boolean}
 */
export function istSeoCacheSchluessel(schluessel) {
  return String(schluessel).includes("|seo:");
}
