// Pure merge rule for the zones written into the shared store (useBuildingProgram)
// after a BimModel load. Own import-free module so it stays node-testable —
// useBimModelSync pulls bitApi, which only loads under Vite (same pattern as
// @designer/lib/fachlayerPending).
//
// Why this exists (I-02, external review Phase 61, 02.09.2026): the load effect
// of useBimModelSync runs on EVERY mount of the Komplex-Designer route, not only
// on a project switch. It replaced the store zones with the persisted customZones
// wholesale — and thereby dropped the session-only zones of the Wohnungsplaner
// (" ·W") and the Wohnungs-Werkstatt (" ·WT") on every route change. Those zones
// are deliberately never persisted (KD-18: BitBimStudio keeps them out of
// saveBimModel), so the store is the only place they live and must survive a
// re-mount. On a real project switch nothing of the old store may survive.
//
// In:  persisted zones of the loaded record, current store zones, whether this is
//      the same project as the last load, a predicate for session zones.
// Out: the zone array for buildingProgram.set({ zones }).

/**
 * Zones for the store after a BimModel load.
 * @param {object} opts
 * @param {Array<object>} [opts.geladen] persisted zones of the loaded record,
 *   already mapped to the store shape {points, level, name}
 * @param {Array<object>} [opts.vorhanden] zones currently in the store
 * @param {boolean} opts.gleichesProjekt true for a re-mount in the SAME project
 *   (session zones are kept); false on a project switch (they are dropped)
 * @param {(zone: object) => boolean} [opts.behalten] predicate marking a store
 *   zone as session-only and worth keeping. The caller owns the markers —
 *   @core must not import @designer (ESLint boundary, Phase 31).
 * @returns {Array<object>} persisted zones first, kept session zones after —
 *   kept zones are the SAME object references (we/raumart fields survive)
 */
export function zonenNachLoad({ geladen, vorhanden, gleichesProjekt, behalten }) {
  const basis = Array.isArray(geladen) ? geladen : [];
  if (!gleichesProjekt || typeof behalten !== "function") return basis;
  const session = (Array.isArray(vorhanden) ? vorhanden : []).filter((z) => behalten(z));
  return [...basis, ...session];
}
