// 106-01: which building element is a mesh of the BIM studio? The resolver for identitaetAus()
// (strahlPick.js). Pure functions, no three.js, no React: the studio hands in its element arrays.
// Ground truth is the GUID the export would write for the element (phase 106 guard rail 3), so
// "dieses Bauteil" means the same element in the hover, in the IFC file and in later commands.
//
// In:  mesh.userData tags (kind, id, scope, level, edge), the element arrays, the project id.
// Out: bauteilSchluessel() (cheap identity key), bauteilInfoAus() (label, GUID, kind) or null.
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

/**
 * Cheap identity key of a mesh from its userData tags; equal keys = same element (all skins of a
 * composite wall share it). Compared per frame before the GUID is derived.
 * @param {Record<string, any>|null|undefined} ud  mesh.userData
 * @returns {string}  "kind|id|scope|level|edge", "" without a kind.
 */
export function bauteilSchluessel(ud) {
  if (!ud || !ud.kind) return "";
  return ["kind", "id", "scope", "level", "edge"].map((k) => ud[k] ?? "").join("|");
}

/**
 * GUID of a generated hull wall: the same derivation as the IFC export (ifcExport.js builds the
 * hull walls with quelle "huelle" and id "<level>:<edge>"), so hover and export agree.
 * @param {string|number|null} projektId
 * @param {number} level  Storey index (0 = ground floor).
 * @param {number} edge   Edge index of the hull polygon.
 * @returns {string}  22-character IFC GlobalId.
 */
export function huellwandGuid(projektId, level, edge) {
  return bauteilGuid(projektId, "huelle", { id: `${level}:${edge}` });
}

/**
 * Resolve a mesh to a building element of the studio.
 * @param {Record<string, any>|null|undefined} ud  mesh.userData of the hit mesh.
 * @param {{customWalls?: any[], customColumns?: any[], customZones?: any[], customSlabs?: any[], customRoofs?: any[]}} daten
 *   The element arrays of the studio; elements are found by their persistent `_idx`.
 * @param {{projektId?: string|number|null, uebersetze?: (de: string) => string}} [opt]
 *   projektId: project of the model (part of the derived GUID); uebersetze: UI translation of the labels.
 * @returns {{guid: string, name: string, label: string, kind: string, bauteilId: number|null, schluessel: string, userData: Record<string, any>}|null}
 *   null for anything that is no element of the model (context buildings, parapet, corner fillers,
 *   an element that no longer exists): an unknown hit is refused, not guessed.
 */
export function bauteilInfoAus(ud, daten, opt = {}) {
  if (!ud || !ud.kind) return null;
  const pid = opt.projektId ?? null;
  const t = opt.uebersetze ?? ((x) => x);
  const finde = (arr, id) => (id == null ? undefined : (arr || []).find((x) => x._idx === id));
  /** @type {{label: string, guid: string, name?: string}|null} */
  let info = null;
  if (ud.kind === "wall") { const w = finde(daten.customWalls, ud.id); if (w) info = { label: t("Wand"), guid: bauteilGuid(pid, "customWalls", w) }; }
  else if (ud.kind === "column") { const c = finde(daten.customColumns, ud.id); if (c) info = { label: t("Stütze"), guid: bauteilGuid(pid, "customColumns", c) }; }
  else if (ud.kind === "zone") { const z = finde(daten.customZones, ud.id); if (z) info = { label: t("Raum"), guid: bauteilGuid(pid, "customZones", z), name: z.name }; }
  else if (ud.kind === "cslab") { const s = finde(daten.customSlabs, ud.id); if (s) info = { label: t("Decke"), guid: bauteilGuid(pid, "customSlabs", s) }; }
  else if (ud.kind === "croof") { const r = finde(daten.customRoofs, ud.id); if (r) info = { label: t("Dach"), guid: bauteilGuid(pid, "customRoofs", r) }; }
  else if (ud.kind === "wallShell") info = { label: t("Hüllwand"), guid: huellwandGuid(pid, ud.level ?? 0, ud.edge ?? 0) };
  if (!info) return null;
  return { guid: info.guid, name: info.name || "", label: info.label, kind: ud.kind, bauteilId: ud.id ?? null, schluessel: bauteilSchluessel(ud), userData: ud };
}
