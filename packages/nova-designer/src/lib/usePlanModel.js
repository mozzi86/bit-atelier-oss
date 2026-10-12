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
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { loadBimModel, aufBimModelAenderung } from "@core/lib/useBimModelSync";
// 89-02: the workshop's walls/doors/rooms as classified components (read model for planners).
import { werkstattBauteile } from "@core/lib/werkstattBauteile";

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
    loadBimModel(projectId)
      .then((m) => {
        if (!cancelled) setGeladen(m || null);
      })
      .catch(() => {
        /* offline: Hülle rendert trotzdem aus dem Store */
      });
    // 89-07: merge every saved patch of THIS project (same flat merge as the server).
    const abmelden = aufBimModelAenderung((pid, patch) => {
      if (!cancelled && pid === projectId) setGeladen((alt) => ({ ...(alt || {}), ...patch }));
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
      }),
    [bp.footprintM, bp.storeys, bp.storeyHeight, geladen]
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
  const bauteile = useMemo(() => werkstattBauteile(bp.zones || [], { storeyHeight: bp.storeyHeight }), [bp.zones, bp.storeyHeight]);

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
    unit: bp.unit || "m",
  };
}
