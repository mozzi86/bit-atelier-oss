// 89-07 (BW-09, D-BW-05): the workshop zones — and with them the walls, doors and rooms of
// werkstattBauteile — for readers outside the designer (AVA, coverage report), derived on load,
// never stored a second time.
//
// Why derive instead of persisting: the truth is the saved record (D-BW-05: the local file in the
// open-source edition). The workshop zones are a deterministic function of the record's
// werkstatt_layer plus its building programme (footprintM, storeys, storeyHeight, achseM) — the
// tessellation goldens pin that down, and useWerkstattRehydrate already rebuilds the store from
// exactly these inputs after a reload. A stored copy of the components would be the second truth
// that goes stale the moment the layer or the footprint changes.
//
// Package boundary: the derivation (tesseliere) lives in @designer, which @core and @ava may not
// import. The app root registers it here as an async loader (dynamic import → own chunk). A mirror
// without the designer (AVA customer repo) registers nothing — readers then keep the session-only
// behaviour of 89-03 (zones only when the workshop ran in this session).
//
// Session first: while the shared store holds THIS project's workshop zones (workshop tab or
// rehydrate ran), they are used as they are — the same derivation plus the cellar/garage zones
// (level −1), which depend on the rainwater plant and the site and are therefore not derived here.
//
// In:  projectId; the record via loadBimModel (shared cache, layers migrated); saved patches via
//      aufBimModelAenderung (live). Out: { zonen, quelle } — zones in store shape (points m, level,
//      name with " ·WT", we, raumart, tueren …). Pure parts are node-testable.
import { useEffect, useMemo, useState } from "react";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { loadBimModel, aufBimModelAenderung, storeGehoertZu } from "@core/lib/useBimModelSync";
import { istWerkstattZone } from "@core/lib/werkstattBauteile";

/** Record fields the derivation reads — a saved patch touching one of them re-derives. */
export const ABLEITUNG_FELDER = Object.freeze(["werkstatt_layer", "footprintM", "storeys", "storeyHeight", "achseM"]);

/**
 * @typedef {(layer: any, programm: {footprintM: any, storeys: number, storeyHeight: number, achseM: any}) => Array<any>} WerkstattAbleitung
 */

/** @type {null | (() => Promise<WerkstattAbleitung>)} */
let ladeAbleitung = null;
/** @type {null | Promise<WerkstattAbleitung>} */
let geladeneAbleitung = null;

/**
 * Register the derivation (app root: `() => import("@designer/lib/useWerkstattRehydrate").then(m => m.werkstattZonenAusLayer)`).
 * @param {() => Promise<WerkstattAbleitung>} loader async loader of (layer, programme) → zones
 * @returns {() => void} unregister (tests)
 */
export function registriereWerkstattAbleitung(loader) {
  ladeAbleitung = typeof loader === "function" ? loader : null;
  geladeneAbleitung = null;
  return () => { ladeAbleitung = null; geladeneAbleitung = null; };
}

/** @returns {boolean} is a derivation registered (full app, not a designer-less mirror)? */
export const hatWerkstattAbleitung = () => ladeAbleitung !== null;

/** @returns {Promise<WerkstattAbleitung|null>} the loaded derivation (loaded once), null without registration */
function ableitung() {
  if (!ladeAbleitung) return Promise.resolve(null);
  if (!geladeneAbleitung) {
    geladeneAbleitung = ladeAbleitung().catch((err) => { geladeneAbleitung = null; throw err; });
  }
  return geladeneAbleitung;
}

/**
 * Building programme of a record with the SAME defaults useBimModelSync loads into the store
 * (storeys 4, storey height 3 m, axis only with ≥ 2 points) — otherwise the derivation would
 * see other inputs than the workshop.
 * @param {any} m BimModel record
 * @returns {{footprintM: any, storeys: number, storeyHeight: number, achseM: any}}
 */
export function programmAusDatensatz(m) {
  return {
    footprintM: m?.footprintM || null,
    storeys: m?.storeys || 4,
    storeyHeight: m?.storeyHeight || 3,
    achseM: Array.isArray(m?.achseM) && m.achseM.length >= 2 ? m.achseM : null,
  };
}

/**
 * Workshop zones of a saved record (pure): [] unless the layer says "angewendet" and a usable
 * footprint (≥ 3 points) exists — the same gate as useWerkstattRehydrate.brauchtRehydrat.
 * @param {any} m BimModel record (layers migrated, loadBimModel)
 * @param {WerkstattAbleitung|null} ableiten registered derivation
 * @returns {Array<any>} zones (only " ·WT" zones are returned)
 */
export function werkstattZonenAusDatensatz(m, ableiten) {
  const layer = m?.werkstatt_layer;
  if (!layer || layer.angewendet !== true || typeof ableiten !== "function") return [];
  const programm = programmAusDatensatz(m);
  if (!Array.isArray(programm.footprintM) || programm.footprintM.length < 3) return [];
  return (ableiten(layer, programm) || []).filter(istWerkstattZone);
}

/**
 * Input signature of the derivation (layer without its save stamp + programme) — equal
 * signature, equal zones; a save that only re-stamps `updatedAt` does not re-derive.
 * @param {any} m
 * @returns {string}
 */
export function ableitungsSignatur(m) {
  const layer = m?.werkstatt_layer && typeof m.werkstatt_layer === "object" ? { ...m.werkstatt_layer } : null;
  if (layer) delete layer.updatedAt;
  return JSON.stringify([layer, programmAusDatensatz(m)]);
}

/**
 * Workshop zones of a project for readers outside the designer. Session zones of THIS project
 * win (quelle "sitzung"); otherwise the zones are derived from the saved record (quelle
 * "datensatz", live over saved patches); "keine" = nothing applied / no derivation registered.
 * @param {string|null|undefined} projectId
 * @returns {{zonen: Array<any>, quelle: "sitzung"|"datensatz"|"keine"}}
 */
export function useWerkstattZonen(projectId) {
  const bp = useBuildingProgram();
  const sitzung = useMemo(
    () => (storeGehoertZu(projectId) ? (bp.zones || []).filter(istWerkstattZone) : []),
    [bp.zones, projectId],
  );
  const brauchtAbleitung = Boolean(projectId) && sitzung.length === 0 && hatWerkstattAbleitung();
  const [abgeleitet, setAbgeleitet] = useState(/** @type {{projectId: string|null, zonen: Array<any>}} */ ({ projectId: null, zonen: [] }));

  useEffect(() => {
    if (!brauchtAbleitung || !projectId) return undefined;
    let abgebrochen = false;
    let signatur = null;
    const rechne = async () => {
      const m = await loadBimModel(projectId);
      const sig = ableitungsSignatur(m);
      if (abgebrochen || sig === signatur) return;
      signatur = sig;
      const fn = await ableitung();
      if (abgebrochen) return;
      setAbgeleitet({ projectId, zonen: werkstattZonenAusDatensatz(m, fn) });
    };
    const fehler = (err) => {
      // Offline or a broken derivation: say so, keep the last state (no silent empty AVA list).
      console.warn(`[werkstattAbleitung] Werkstatt-Zonen für Projekt ${projectId} nicht abgeleitet: ${err?.message || err}`);
    };
    rechne().catch(fehler);
    const abmelden = aufBimModelAenderung((pid, patch) => {
      if (pid !== projectId || !ABLEITUNG_FELDER.some((f) => f in (patch || {}))) return;
      rechne().catch(fehler);
    });
    return () => { abgebrochen = true; abmelden(); };
  }, [projectId, brauchtAbleitung]);

  if (sitzung.length) return { zonen: sitzung, quelle: "sitzung" };
  if (abgeleitet.projectId === projectId && abgeleitet.zonen.length) return { zonen: abgeleitet.zonen, quelle: "datensatz" };
  return { zonen: [], quelle: "keine" };
}
