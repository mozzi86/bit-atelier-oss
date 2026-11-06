// 108-11: the roof fields of the building model record (BimModel) for the Massing-Studio — global roof form and slope plus the hull
// slab fields that move the eaves of a knee wall. The studio's programme store (useBuildingProgram) does not carry them: they belong
// to the record the BIM studio edits. Read-only here (the studio never writes them).
//
// Live like usePlanModel: loadBimModel (cached load of the record) once per project, then every saved patch of that project
// (aufBimModelAenderung — own saves and the changes of another device) is merged, so a roof form changed in the building model shows
// up in the massing iso without a reload.
//
// In:  project id. Out: the raw record fields (null until loaded / without a record); a failed load is reported with console.warn
//      and as {ladeFehler: message}, so the studio can say that the roof of the building model is missing instead of silently
//      showing the box.
import { useEffect, useState } from "react";
import { loadBimModel, aufBimModelAenderung } from "@core/lib/useBimModelSync";

/** Record fields this hook reads. */
const FELDER = Object.freeze(["dachform", "dachneigung", "huelle_decke_dicke_m", "huelle_decke_bezug"]);

/**
 * @typedef {{dachform: string|null, dachneigung: number|null, deckenDicke: number|undefined, deckenBezug: string|undefined}} ModellDach
 */

/**
 * The roof fields of a (partial) record in the shape hauptkoerperDach takes. Pure.
 * @param {Record<string, any>|null|undefined} r record or merged patches
 * @returns {ModellDach} dachneigung in degrees, deckenDicke in m
 */
export function modellDachAus(r) {
  return {
    dachform: r?.dachform ? String(r.dachform) : null,
    dachneigung: r?.dachneigung != null && Number.isFinite(Number(r.dachneigung)) ? Number(r.dachneigung) : null,
    deckenDicke: Number(r?.huelle_decke_dicke_m) > 0 ? Number(r?.huelle_decke_dicke_m) : undefined,
    deckenBezug: r?.huelle_decke_bezug === "oben" || r?.huelle_decke_bezug === "unten" ? r.huelle_decke_bezug : undefined,
  };
}

/**
 * Hook: the roof fields of the project's building model record, live (see file head). Side effect: loads the record (cached).
 * @param {string|number|null|undefined} projectId
 * @returns {Record<string, any>|null} the record fields of FELDER (raw), null until loaded or without a project, plus ladeFehler
 *   (string) when the record could not be loaded; feed modellDachAus()
 */
export function useModellDach(projectId) {
  const [felder, setFelder] = useState(/** @type {Record<string, any>|null} */ (null));
  useEffect(() => {
    if (!projectId) { setFelder(null); return undefined; }
    let aus = false;
    const nur = (/** @type {Record<string, any>|null|undefined} */ r) => Object.fromEntries(FELDER.filter((k) => r && k in r).map((k) => [k, r?.[k]]));
    loadBimModel(projectId)
      // merge: a patch that arrived while the record was loading is newer than the loaded record and wins
      .then((m) => { if (!aus) setFelder((alt) => ({ ...nur(m), ...(alt || {}) })); })
      .catch((/** @type {any} */ e) => {
        // the studio keeps the box without a roof — said in the console and (ladeFehler) next to the height key figure
        const text = String(e?.message || e);
        console.warn(`Massing-Studio: Dach des Gebäudemodells nicht geladen (${text})`);
        if (!aus) setFelder((alt) => ({ ...(alt || {}), ladeFehler: text }));
      });
    const abmelden = aufBimModelAenderung((pid, patch) => {
      if (aus || pid !== projectId || !patch) return;
      const teil = nur(patch);
      if (Object.keys(teil).length) setFelder((alt) => ({ ...(alt || {}), ...teil }));
    });
    return () => { aus = true; abmelden(); };
  }, [projectId]);
  return felder;
}
