import React, { useMemo } from "react";
import SketchStudio from "@sketch/pages/SketchStudio.jsx";
import { useProject } from "@core/lib/ProjectContext";
import { useSketchLayer } from "@designer/lib/useSketchLayer";
import { planAusDatensatz, transparenzPausen } from "@designer/lib/skizzePause";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";

// Projektbewusster Host des BIT Sketchers (Phase 34, PW-05): mit gewähltem
// Projekt wird der Sketch im BimModel-Feld "sketch_layer" persistiert und
// erscheint als Overlay im Grundriss des Gebäudemodells (Plan-Werkstatt).
// Ohne Projekt läuft der Sketcher im localStorage-Demo-Modus (Bestand).
// key={nonce}: Projektwechsel remountet das Studio mit dem frischen Stand.
// 15.11.2026: Grundrisse je Geschoss und der Schnitt des Gebäudemodells gehen als Transparenzpausen (reine Anzeige) hinein —
// aus dem Datensatz, wie er beim Öffnen der Seite geladen wurde.
export default function PlanSketchStudio() {
  const { project } = useProject();
  const { geladen, speichern } = useSketchLayer(project?.id);
  const satz = geladen?.satz || null;
  const pausen = useMemo(() => {
    if (!satz) return [];
    setzeProjektAufbauten(satz.aufbauten_layer ?? null); // project build-ups decide the wall thickness of the plan
    try {
      return transparenzPausen(planAusDatensatz(satz));
    } catch (e) {
      console.error("Transparenzpause konnte nicht aus dem Gebäudemodell erzeugt werden:", e); // the sketch itself stays usable
      return [];
    }
  }, [satz]);

  if (!project?.id) return <SketchStudio />;
  if (!geladen) {
    return (
      <div className="p-6 text-sm text-slate-500">Sketch des Projekts wird geladen…</div>
    );
  }
  return <SketchStudio key={geladen.nonce} initialJson={geladen.json} onPersist={speichern} pausen={pausen} />;
}
