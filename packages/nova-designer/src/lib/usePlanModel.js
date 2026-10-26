// Fertiges Plan-Modell für Fachplaner-Reiter (Phase 34, PW-04): baut das
// Gebäudemodell aus der gemeinsamen Quelle (buildingProgram — footprintM/
// storeys/storeyHeight sind dort live) und lädt die in BitBimStudio
// gezeichneten Hüll-Parameter + Elementfelder read-only aus dem BimModel.
//
// Damit kann jeder propless eingebundene Reiter (Brandschutz, Statik, TGA …)
// einen readOnly-Grundriss rendern:
//   const plan = usePlanModel(project?.id);
//   <BimPlan2D model={plan.model} mode="grundriss" readOnly
//     customZones={plan.zones} envOpenings={plan.envOpenings} … />
//
// Seit 89-07 (BW-09) live: saveBimModel meldet jeden gespeicherten Patch
// (aufBimModelAenderung), dieser Hook mischt ihn in seinen Stand — Element-
// Änderungen aus BitBimStudio erscheinen ohne Reload in den Fachplaner-Plänen.
// Der Programm-Anteil (Hülle) war schon live, die Räume kommen aus dem Store.
import { useEffect, useMemo, useState } from "react";
import { createBuildingModel } from "@core/lib/buildingModel";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { loadBimModel, aufBimModelAenderung } from "@core/lib/useBimModelSync";
// 89-02: the workshop's walls/doors/rooms as classified components (read model for planners).
import { werkstattBauteile } from "@core/lib/werkstattBauteile";

/**
 * Project the module-level build-up registry (aufbauten.js) currently belongs to, shared by all hook instances: the ids "p-1", "p-2" …
 * exist in every project, so on a project switch the registry is emptied BEFORE the new project loads (a failed or late load must not
 * leave the previous project's build-ups behind).
 * @type {string|number|null}
 */
let aufbautenProjekt = null;

export function usePlanModel(projectId) {
  const bp = useBuildingProgram();
  // Statisch geladener Element-Anteil des BimModel (null solange lädt/leer).
  const [geladen, setGeladen] = useState(null);

  useEffect(() => {
    if (!projectId) {
      setGeladen(null);
      return undefined;
    }
    let cancelled = false;
    if (aufbautenProjekt !== projectId) { setzeProjektAufbauten(null); aufbautenProjekt = projectId; }
    loadBimModel(projectId)
      .then((m) => {
        // 107-03 (D-BK-22): project build-ups must be known before the model is built (wall thickness of a project build-up)
        if (!cancelled) { setzeProjektAufbauten(m?.aufbauten_layer ?? null); setGeladen(m || null); }
      })
      .catch(() => {
        /* offline: Hülle rendert trotzdem aus dem Store */
      });
    // 89-07: merge every saved patch of THIS project (same flat merge as the server).
    const abmelden = aufBimModelAenderung((pid, patch) => {
      if (!cancelled && pid === projectId) {
        if ("aufbauten_layer" in patch) setzeProjektAufbauten(patch.aufbauten_layer ?? null);
        setGeladen((alt) => ({ ...(alt || {}), ...patch }));
      }
    });
    return () => {
      cancelled = true;
      abmelden();
    };
  }, [projectId]);

  // Hülle live aus dem Store; Hüll-Parameter (Attika/Wandaufbau) aus dem
  // geladenen Datensatz, damit der Plan dem BIM-Studio entspricht.
  const model = useMemo(
    () =>
      createBuildingModel({
        footprintM: bp.footprintM,
        storeys: bp.storeys,
        storeyHeight: bp.storeyHeight,
        parapet: geladen?.parapet,
        wallThickness: geladen?.envThickness,
        wallComposite: geladen?.envComposite,
        huelleBezug: geladen?.huelle_bezug, // 107-01: reference line of the hull walls (optional field)
        geschosse: bp.geschosse, // 107-02: optional storey table (null = one height for all storeys)
        deckenDicke: geladen?.huelle_decke_dicke_m, deckenBezug: geladen?.huelle_decke_bezug, // 107-02: thickness/side of the hull slabs (optional fields; absent = 0.25 m, lower edge on the plane)
      }),
    [bp.footprintM, bp.storeys, bp.storeyHeight, bp.geschosse, geladen]
  );

  // Räume LIVE aus dem Store (Format wie customZones; _idx fehlt — für die
  // readOnly-Anzeige unerheblich, Selektion gibt es dort nicht).
  // Phase 61: we/raumart additiv durchreichen (Werkstatt-Zonen-Schema D-P61-03;
  // Schnellmodus-Zonen ohne diese Felder bleiben gültig).
  const zones = useMemo(
    () => (bp.zones || []).map((z) => ({ points: z.points, level: z.level, name: z.name, we: z.we, raumart: z.raumart })),
    [bp.zones]
  );

  // 89-02: workshop components derived LIVE from the store zones (·WT) — a separate list on
  // purpose: model.walls stays the envelope (edge-indexed; openings, facades rely on it).
  // D-BW-02: zones are clear dimensions, the walls lie outside (rohbau = growth per storey).
  const bauteile = useMemo(() => werkstattBauteile(bp.zones || [], { storeyHeight: bp.storeyHeight, geschosse: bp.geschosse }), [bp.zones, bp.storeyHeight, bp.geschosse]);

  return {
    model,
    zones,
    bauteile,
    envOpenings: geladen?.envOpenings || [],
    customSlabs: geladen?.customSlabs || [],
    customRoofs: geladen?.customRoofs || [],
    // Phase 43: drawn interior walls, columns and the openings on them (customWindows.wallIdx
    // → customWalls._idx). Read-only like the rest; BimPlan2D draws them via `elements`,
    // raumOeffnungen.js finds the doors/windows at a room's boundary.
    customWalls: geladen?.customWalls || [],
    customColumns: geladen?.customColumns || [],
    customWindows: geladen?.customWindows || [],
    // Hüll-Metadaten für Fachplaner (Phase 45): Dachform/-neigung und die
    // Eingangstür-Konfiguration (für autoEnvOpenings), read-only wie oben.
    dachform: geladen?.dachform || "flach",
    dachneigung: geladen?.dachneigung ?? 30,
    entranceCfg: geladen?.entranceCfg || null,
    storeys: bp.storeys,
    storeyHeight: bp.storeyHeight,
    geschosse: bp.geschosse || null,
    unit: bp.unit || "m",
  };
}
