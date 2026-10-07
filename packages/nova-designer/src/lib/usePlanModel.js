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
// Grenze (dokumentiert): loadBimModel cached EINEN Datensatz je Projekt —
// Element-Änderungen aus BitBimStudio in derselben Session propagieren nicht
// live hierher. Der Programm-Anteil (Hülle) ist dagegen live, und die Räume
// kommen live aus dem Store (BitBimStudio spiegelt customZones dorthin).
import { useEffect, useMemo, useState } from "react";
import { createBuildingModel } from "@core/lib/buildingModel";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { loadBimModel } from "@core/lib/useBimModelSync";

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
    return () => {
      cancelled = true;
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

  return {
    model,
    zones,
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
