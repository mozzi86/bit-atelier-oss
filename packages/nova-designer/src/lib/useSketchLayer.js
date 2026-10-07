// Projektbewusste Sketch-Persistenz (Phase 34, PW-05): der BIT Sketcher
// speichert je Projekt im exklusiven BimModel-Feld "sketch_layer" (KD-17,
// Feld-Registry siehe useFachlayer.js) statt im localStorage-Demo-Slot.
//
// Bewusst NICHT über useFachlayer: der Sketch lebt als mutable Klasse im
// Host (SketchStudio, sketchRef + version-Bump) — hier braucht es nur
// (a) EINEN geladenen Ausgangsstand je Projekt (für key-Remount des Studios)
// und (b) einen Schreibweg über saveBimModel (debounced im Studio selbst).
import { useCallback, useEffect, useState } from "react";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";

const FELD = "sketch_layer";

export function useSketchLayer(projectId) {
  // { json: <Sketch.serialize()>|null, nonce } — nonce = key fürs Remount.
  const [geladen, setGeladen] = useState(null);

  useEffect(() => {
    if (!projectId) {
      setGeladen(null);
      return undefined;
    }
    let cancelled = false;
    loadBimModel(projectId)
      .then((m) => {
        if (!cancelled) setGeladen({ json: m?.[FELD] || null, nonce: projectId });
      })
      .catch(() => {
        // offline: leer starten — Speichern versucht es später erneut
        if (!cancelled) setGeladen({ json: null, nonce: projectId });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const speichern = useCallback(
    (json) => {
      if (!projectId) return;
      saveBimModel(projectId, { [FELD]: json }).catch(() => {
        /* offline: nächster Persist-Aufruf versucht es erneut */
      });
    },
    [projectId]
  );

  return { geladen, speichern };
}
