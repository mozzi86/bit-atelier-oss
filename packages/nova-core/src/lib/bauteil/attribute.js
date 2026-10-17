// Attributes of DERIVED elements (phase 97-02): workshop walls/doors ("wt-wall-<guid>",
// "wt-door-<guid>") and the synthetic hull ("hull-wall", "hull-floor", "hull-slab", "hull-roof")
// are regenerated on every tessellation — they have no stored object of their own to carry a
// status, cost group or trade. Their decisions live in ONE table on the BimModel, keyed by the
// stable element id: `bauteil_attribute_layer = { attribute: { [id]: {status, kg, gewerk, …} } }`.
// Drawn elements keep their attributes on the element itself (customWalls …), unchanged.
//
// In:  BimModel record / layer, element ids, attribute patches. Out: pure lookups and new layer
// objects; no I/O (the caller saves through saveBimModel).

/** Fields a derived element may carry (same names as on drawn elements). */
export const ATTRIBUT_FELDER = Object.freeze(["status", "erfassung", "kg", "gewerk", "gewerk_lb", "schicht", "bauabschnitt", "bauteil_typ"]);

/** Id prefixes of derived elements whose attributes live in the table. */
const ABGELEITET = /^(wt-wall-|wt-door-|hull-)/;

/**
 * @param {string} id classified element id
 * @returns {boolean} true for workshop/hull ids (attributes in the table)
 */
export function istAbgeleitet(id) {
  return ABGELEITET.test(String(id || ""));
}

/**
 * Attributes of one derived element, or null.
 * @param {any} quelle BimModel record or the layer object itself
 * @param {string} id
 * @returns {Record<string, any>|null}
 */
export function attributeVon(quelle, id) {
  const layer = quelle && typeof quelle === "object" && "bauteil_attribute_layer" in quelle ? quelle.bauteil_attribute_layer : quelle;
  const a = layer?.attribute?.[id];
  return a && typeof a === "object" ? a : null;
}

/**
 * Element with the table's attributes laid over it — only fields that are set, so an element
 * without entry stays exactly as it was (byte-identical lists, D-BW-03: no status invented).
 * @template T
 * @param {T} el
 * @param {Record<string, any>|null} attr
 * @returns {T}
 */
export function mitAttributen(el, attr) {
  if (!attr) return el;
  const satz = Object.fromEntries(ATTRIBUT_FELDER.filter((k) => attr[k] != null && attr[k] !== "").map((k) => [k, attr[k]]));
  return Object.keys(satz).length ? { ...el, ...satz } : el;
}

/**
 * New layer with the patch applied to one id. `null`/"" removes a field; an entry without
 * fields is dropped. Unknown fields are ignored.
 * @param {any} layer current bauteil_attribute_layer (may be null)
 * @param {string} id
 * @param {Record<string, any>} patch
 * @returns {{attribute: Record<string, Record<string, any>>}}
 */
export function attributPatch(layer, id, patch) {
  const alle = { ...(layer?.attribute || {}) };
  const neu = { ...(alle[id] || {}) };
  for (const k of ATTRIBUT_FELDER) {
    if (!(k in (patch || {}))) continue;
    const v = patch[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete neu[k];
    else neu[k] = v;
  }
  if (Object.keys(neu).length) alle[id] = neu;
  else delete alle[id];
  return { ...(layer && typeof layer === "object" ? layer : {}), attribute: alle };
}

/**
 * Workshop components with their table attributes (walls "wt-wall-<guid>", doors "wt-door-<guid>").
 * @template {{waende?: any[], tueren?: any[]}} W
 * @param {W} wt result of werkstattBauteile()
 * @param {any} layer bauteil_attribute_layer
 * @returns {W}
 */
export function werkstattMitAttributen(wt, layer) {
  if (!wt || !layer?.attribute) return wt;
  return {
    ...wt,
    waende: (wt.waende || []).map((w) => mitAttributen(w, attributeVon(layer, `wt-wall-${w.guid}`))),
    tueren: (wt.tueren || []).map((t) => mitAttributen(t, attributeVon(layer, `wt-door-${t.guid}`))),
  };
}
