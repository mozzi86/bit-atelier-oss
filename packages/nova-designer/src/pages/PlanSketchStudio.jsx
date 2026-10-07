import React from "react";
import SketchStudio from "@sketch/pages/SketchStudio.jsx";
import { useProject } from "@core/lib/ProjectContext";
import { useSketchLayer } from "@designer/lib/useSketchLayer";

// Projektbewusster Host des BIT Sketchers (Phase 34, PW-05): mit gewähltem
// Projekt wird der Sketch im BimModel-Feld "sketch_layer" persistiert und
// erscheint als Overlay im Grundriss des Gebäudemodells (Plan-Werkstatt).
// Ohne Projekt läuft der Sketcher im localStorage-Demo-Modus (Bestand).
// key={nonce}: Projektwechsel remountet das Studio mit dem frischen Stand.
export default function PlanSketchStudio() {
  const { project } = useProject();
  const { geladen, speichern } = useSketchLayer(project?.id);

  if (!project?.id) return <SketchStudio />;
  if (!geladen) {
    return (
      <div className="p-6 text-sm text-slate-500">Sketch des Projekts wird geladen…</div>
    );
  }
  return <SketchStudio key={geladen.nonce} initialJson={geladen.json} onPersist={speichern} />;
}
