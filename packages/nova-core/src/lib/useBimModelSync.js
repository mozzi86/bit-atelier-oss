// Zentraler Projekt-Sync der gemeinsamen Quelle (useBuildingProgram) mit der
// persistierten BimModel-Entität: Beim Projektwechsel wird das Bauprogramm
// (Footprint/Geschosse/Höhe/Einheit) + die Räume in den Store geladen —
// unabhängig davon, welcher Tab gerade offen ist.
//
// EIN Schreibpfad (KD-17): Vorher schrieben zwei unabhängige Debounce-Effekte
// denselben Datensatz — dieser Hook (1.500 ms) und BitBimStudio (1.200 ms).
// Der letzte Schreiber gewann (nicht deterministisch), und ohne vorhandenen
// Datensatz konnte jeder Schreiber einen eigenen anlegen. Jetzt ist dieses Modul
// die Autorität für den Datensatz: loadBimModel() löst ihn genau einmal je
// Projekt auf, saveBimModel() ist der einzige Schreibpfad und serialisiert alle
// Aufrufe. Der Hook schreibt ausschließlich die Programmfelder, BitBimStudio
// ausschließlich seine Elementfelder — die Feldmengen sind disjunkt, der Server
// merged flach, also überschreibt keiner die Arbeit des anderen.
// Verschoben nach @core am 26.08.2026: `saveBimModel` ist der EINZIGE Schreibpfad
// für BimModel (KD-17). Seit der IFC-Viewer (@ifc) den Grundriss aus der Geometrie
// ableitet, braucht auch er diesen Pfad — und @ifc darf @designer nicht importieren.
// Ihn dort zu umgehen und direkt über bitApi zu schreiben, hätte eine zweite
// Schreibstelle geschaffen: genau die zweite Wahrheit, die das Prinzip der einzigen
// Quelle verhindern soll.
import { useEffect, useRef } from "react";
import { bitApi } from "@core/api/bitApi";
import { buildingProgram, useBuildingProgram } from "@core/lib/useBuildingProgram";
import { zonenNachLoad } from "@core/lib/zonenNachLoad";
// 87-07: layer schema versions live at the ONE read/write path, so every hook
// (useFachlayer, useSketchLayer, BcfIssues, IdsEditor, LieferpaketKarte) gets
// migrated blobs on load and stamped blobs (v, updatedAt) on save without edits.
import { LAYER_VERSION, migrateLayer, stempelFuerSave } from "@core/lib/fachlayerSchema";

/**
 * 87-07: migrate every registered layer field of a loaded record to its current
 * schema version (see fachlayerSchema.js). Returns the same object when nothing changed.
 * @param {any} m BimModel record or null
 * @returns {any}
 */
export function migriereLayerDesDatensatzes(m) {
  if (!m || typeof m !== "object") return m;
  let out = m;
  for (const feld of Object.keys(LAYER_VERSION)) {
    if (m[feld] == null) continue;
    const r = migrateLayer(feld, m[feld]);
    if (r.migriert) out = out === m ? { ...m, [feld]: r.wert } : { ...out, [feld]: r.wert };
  }
  return out;
}

// Datensatz-Autorität je Projekt: { projectId, id, load } (load = laufendes/
// erledigtes Laden als Promise, damit mehrere Leser EINEN Request teilen).
const record = { projectId: null, id: null, load: null };
// Project of the last load THIS hook completed — tells a re-mount in the same
// project (keep session zones, I-02) from a project switch (drop them). Module
// level on purpose: the hook's refs die with the Komplex-Designer route, and
// record.projectId is no substitute — child hooks (usePlanModel, useFachlayer)
// call loadBimModel first and have already moved it to the new project.
let letztesSyncProjekt = null;
// Serialisierung aller Schreibvorgänge — nie zwei Requests gleichzeitig.
let chain = Promise.resolve();

/** Datensatz des Projekts laden (geteilter Request; Ergebnis wird gecacht). */
export function loadBimModel(projectId) {
  if (!projectId) return Promise.resolve(null);
  if (record.projectId !== projectId || !record.load) {
    record.projectId = projectId;
    record.id = null;
    record.load = bitApi.entities.BimModel.filter({ project_id: projectId })
      .then((rows) => {
        const m = migriereLayerDesDatensatzes((rows || [])[0] || null);
        if (record.projectId === projectId) record.id = m?.id || null;
        return m;
      })
      .catch((err) => {
        // Fehlgeschlagenes Laden nicht cachen (offline -> später erneut versuchen).
        if (record.projectId === projectId) record.load = null;
        throw err;
      });
  }
  return record.load;
}

/**
 * Einziger Schreibpfad auf BimModel: partielles Update (der Server merged flach),
 * serialisiert. Ohne bekannten Datensatz wird erst geladen — sonst würden zwei
 * Aufrufe zwei Datensätze anlegen. Schlägt das Laden fehl, wird NICHT blind
 * angelegt, sondern der Fehler weitergegeben.
 */
export function saveBimModel(projectId, patch) {
  const run = async () => {
    if (!projectId) return null;
    if (record.projectId !== projectId || (!record.id && !record.load)) await loadBimModel(projectId);
    else if (record.load) await record.load;
    // 87-07: registered layer fields leave with their schema version and a time stamp.
    const data = { project_id: projectId, ...patch };
    for (const feld of Object.keys(data)) if (LAYER_VERSION[feld] !== undefined) data[feld] = stempelFuerSave(feld, data[feld]);
    let ergebnis;
    if (record.id) {
      ergebnis = await bitApi.entities.BimModel.update(record.id, data);
    } else {
      ergebnis = await bitApi.entities.BimModel.create(data);
      if (record.projectId === projectId) record.id = ergebnis?.id || null;
    }
    // Cache kohärent halten (Phase 34): loadBimModel cached EINEN Datensatz je
    // Projekt — ohne Patch sähen spätere Leser (usePlanModel, useFachlayer,
    // Sketch-Overlay im Grundriss) bis zum Reload den alten Stand.
    if (record.projectId === projectId && record.load) {
      const vorher = record.load;
      record.load = (async () => ({ ...((await vorher.catch(() => null)) || {}), ...data }))();
    }
    return ergebnis;
  };
  const result = chain.then(run, run);
  chain = result.catch(() => { /* Kette läuft weiter, Fehler geht an den Aufrufer */ });
  return result;
}

/**
 * Loads the project's BimModel into the shared store on mount / project switch
 * and writes the programme fields back (debounced).
 * @param {string|null|undefined} projectId current project
 * @param {{ zonenBehalten?: (zone: object) => boolean }} [opts]
 *   zonenBehalten — predicate for session-only store zones (Wohnungsplaner " ·W",
 *   Wohnungs-Werkstatt " ·WT") that must survive a re-mount in the SAME project
 *   (I-02, external review Phase 61). The caller owns the markers: @core does
 *   not import @designer. Without it the load replaces the zones wholesale
 *   (behaviour before I-02).
 */
export function useBimModelSync(projectId, opts = {}) {
  const bp = useBuildingProgram();
  const loadingRef = useRef(false);
  const lastLoaded = useRef("");
  // 87-02: the project whose record was LOADED successfully. Until then the store only
  // holds defaults — and the write-back below must never push those to the server
  // (a transient load failure used to be followed, 1,5 s later, by a save of 4 storeys
  // and a null footprint over the real geometry).
  const geladenRef = useRef(null);
  // Predicate lives in a ref: callers pass an inline arrow, and a new identity
  // per render must not re-trigger the load effect.
  const behaltenRef = useRef(opts.zonenBehalten);
  behaltenRef.current = opts.zonenBehalten;

  // Laden bei Projektwechsel UND bei jedem Re-Mount der Route — Programm +
  // Räume in die gemeinsame Quelle. The zones are merged, not replaced: see
  // zonenNachLoad (I-02).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    loadingRef.current = true;
    // Decided BEFORE the await: a re-mount in the same project keeps the
    // session zones; a switch drops the old project's store entirely.
    const gleichesProjekt = letztesSyncProjekt === projectId;
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        const patch = {
          footprintM: m?.footprintM || null,
          storeys: m?.storeys || 4,
          storeyHeight: m?.storeyHeight || 3,
          unit: m?.unit || "m",
          zones: zonenNachLoad({
            // id = persistentes _idx der BIM-Studio-Zone (Phase 43: stabiler Raumschlüssel der Möblierung)
            geladen: (m?.customZones || []).map((z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx })),
            vorhanden: buildingProgram.get().zones,
            gleichesProjekt,
            behalten: behaltenRef.current,
          }),
        };
        lastLoaded.current = JSON.stringify([patch.footprintM, patch.storeys, patch.storeyHeight, patch.unit]);
        geladenRef.current = projectId;
        buildingProgram.set({ ...patch, syncFehler: null });
        letztesSyncProjekt = projectId;
      } catch (err) {
        // 87-02: offline / server away — the store keeps its defaults, the write-back
        // stays locked (geladenRef) and the user gets to see why nothing is there.
        geladenRef.current = null;
        console.warn(`[bimModel] Laden fehlgeschlagen für Projekt ${projectId}: ${err?.message || err} — Geometrie wird nicht zurückgeschrieben`);
        if (!cancelled) buildingProgram.set({ syncFehler: "laden" });
      } finally { setTimeout(() => { loadingRef.current = false; }, 50); }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Programm-Felder debounced zurückschreiben (nur wenn wirklich geändert).
  // Elementfelder schreibt BitBimStudio über denselben saveBimModel-Pfad.
  useEffect(() => {
    // 87-02: never before a successful load of THIS project (see geladenRef).
    if (!projectId || loadingRef.current || geladenRef.current !== projectId) return;
    const sig = JSON.stringify([bp.footprintM, bp.storeys, bp.storeyHeight, bp.unit]);
    if (sig === lastLoaded.current) return;
    let abgebrochen = false;
    const t = setTimeout(async () => {
      // 87-02: three attempts with backoff (0,5 / 1 / 1,5 s), then say so instead of
      // waiting silently for the next change.
      for (let versuch = 1; versuch <= 3 && !abgebrochen; versuch += 1) {
        try {
          await saveBimModel(projectId, { footprintM: bp.footprintM, storeys: bp.storeys, storeyHeight: bp.storeyHeight, unit: bp.unit });
          lastLoaded.current = sig;
          if (buildingProgram.get().syncFehler === "speichern") buildingProgram.set({ syncFehler: null });
          return;
        } catch (err) {
          if (versuch === 3) {
            console.warn(`[bimModel] Speichern fehlgeschlagen für Projekt ${projectId} (3 Versuche): ${err?.message || err}`);
            if (!abgebrochen) buildingProgram.set({ syncFehler: "speichern" });
          } else {
            await new Promise((r) => setTimeout(r, 500 * versuch));
          }
        }
      }
    }, 1500);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [projectId, bp.footprintM, bp.storeys, bp.storeyHeight, bp.unit]);
}
