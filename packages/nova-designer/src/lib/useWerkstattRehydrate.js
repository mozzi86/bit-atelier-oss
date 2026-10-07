// MSB-9 fix (75-06 Task 0, D-P75-08): the workshop tessellation zones live ONLY
// in the in-memory store (useBuildingProgram) — useBimModelSync persists
// footprint/storeys/storeyHeight/unit, never the zones. After an F5 on
// ?tab=studio the Massing shows zero rooms even though werkstatt_layer says
// angewendet: true, and the "Entfernen" + "Tesselierung anwenden" workaround was
// the only way to fill the store.
//
// This module regenerates the ·WT zones deterministically from the persisted
// layer after a load — mounted in ComplexDesigner, so it also runs when the
// workshop tab was never opened (the Massing reads the same store).
//
// Pure part: brauchtRehydrat (node-testable). React part: the hook below.
// In:  projectId (string|null), store state via useBuildingProgram.
// Out: buildingProgram.set({ zones }) — NEVER writes to werkstatt_layer.
import { useEffect, useRef } from "react";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { istWerkstattZone, tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_DEFAULT, einheitenAnreichern } from "@designer/lib/werkstattDefaults";

/**
 * Pure predicate: does the store need its workshop zones regenerated?
 *
 * The honest MSB-9 test: the persisted layer claims "angewendet" (the user
 * applied the tessellation before the reload) but NO ·WT zone is in the store
 * any more — that is exactly the post-reload state, because zones are
 * session-only. Any present ·WT zone means a live writer (the workshop tab or
 * this hook) already did its job.
 *
 * @param {object|null|undefined} layer  werkstatt_layer state ({ angewendet?: boolean, … })
 * @param {Array<object>} zones          current store zones (mixed ·WT/·W/BIM zones)
 * @param {Array<{x:number,z:number}>|null} footprintM building footprint polygon, metres, centred
 * @returns {boolean} true only when angewendet === true, a usable footprint
 *   (>= 3 points) exists, and no zone carries the ·WT marker
 */
export function brauchtRehydrat(layer, zones, footprintM) {
  if (!layer || layer.angewendet !== true) return false;
  // Without a footprint the tessellation has nothing to slice — wait for
  // useBimModelSync to finish loading (it arrives in the same tick group).
  if (!Array.isArray(footprintM) || footprintM.length < 3) return false;
  const liste = Array.isArray(zones) ? zones : [];
  return !liste.some(istWerkstattZone);
}

/**
 * Regenerate the workshop zones from the persisted layer after a reload.
 *
 * READ-ONLY on werkstatt_layer: writing there would race the mounted
 * workshop's own useFachlayer writer (two debounced writers on one field,
 * useFachlayer.js header rule 1). The only write target is buildingProgram.
 *
 * Runs AT MOST ONCE per project load (ref-guarded). Why not re-run on every
 * zone change: this hook's useFachlayer instance is a second reader — it does
 * NOT see the mounted workshop flipping `angewendet` back to false. Without
 * the guard, "Entfernen" in the workshop would be undone immediately by this
 * hook (stale angewendet:true + empty zones = the MSB-9 predicate). With the
 * guard the hook is purely the reload repair it is meant to be; every later
 * zone write belongs to the workshop's live effect (JSON-guarded).
 *
 * Keller/Tiefgarage zones are deliberately NOT regenerated here: they hang on
 * cfg.keller.aktiv / cfg.tiefgarage.aktiv and the workshop's live effect
 * (WohnungsWerkstatt.jsx, JSON-guarded) restores them idempotently as soon as
 * the tab mounts. Regenerating them twice would fight that writer.
 *
 * @param {string|null|undefined} projectId current project (null → no-op)
 * @returns {void}
 */
export function useWerkstattRehydrate(projectId) {
  // Same hook + field + default as WohnungsWerkstatt — ONE layer source.
  const [layer] = useFachlayer(projectId, "werkstatt_layer", WERKSTATT_DEFAULT);
  const store = useBuildingProgram();
  const zones = Array.isArray(store.zones) ? store.zones : [];
  const angewendet = layer?.angewendet === true;
  // Project id this hook already regenerated zones for (at most once per load).
  const rehydratedRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    if (rehydratedRef.current === projectId) return; // already repaired this load
    if (!brauchtRehydrat(layer, zones, store.footprintM)) return;
    // Rebuild the solver config EXACTLY like WohnungsWerkstatt.jsx does
    // (migration guards: plain objects instead of null, nordwinkel as number,
    // enriched units) — anything else would regenerate different zones than
    // the workshop would produce live.
    const cfg = {
      ...WERKSTATT_DEFAULT,
      ...(layer || {}),
      einheiten: einheitenAnreichern(layer?.einheiten),
      anordnung: layer?.anordnung && typeof layer.anordnung === "object" ? layer.anordnung : {},
      grenzenPositionen: layer?.grenzenPositionen && typeof layer.grenzenPositionen === "object" ? layer.grenzenPositionen : {},
      regeln: layer?.regeln && typeof layer.regeln === "object" ? layer.regeln : {},
      nordwinkel: Number.isFinite(Number(layer?.nordwinkel)) ? Number(layer.nordwinkel) : 0,
      // 75-14: door-swing overrides (same guard as the workshop).
      tuerAufschlaege: layer?.tuerAufschlaege && typeof layer.tuerAufschlaege === "object" ? layer.tuerAufschlaege : {},
    };
    const ergebnis = tesseliere({
      footprintM: store.footprintM,
      storeys: store.storeys,
      typ: cfg.typ,
      einheiten: cfg.einheiten,
      gesperrteGrenzen: cfg.gesperrteGrenzen,
      raumzonen: true,
      anordnung: cfg.anordnung,
      grenzenPositionen: cfg.grenzenPositionen,
      regeln: cfg.regeln,
      nordwinkel: cfg.nordwinkel,
      tuerAufschlaege: cfg.tuerAufschlaege,
    });
    // Keep the non-·WT zones standing (BIM-Studio rooms, quick-mode ·W zones).
    const ohneWT = zones.filter((z) => !istWerkstattZone(z));
    const naechste = [...ohneWT, ...ergebnis.zonen];
    // JSON guard like the workshop's live effect: identical zones → no write,
    // so a mounted workshop that already regenerated wins quietly.
    if (JSON.stringify(zones) !== JSON.stringify(naechste)) store.set({ zones: naechste });
    rehydratedRef.current = projectId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, angewendet, store.footprintM, zones.length]);
}
