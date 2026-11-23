// 115-05b part 2 (A-5): the focus check - a tab without the change stream (blocked, the cloud and serverless paths, a proxy that
// drops it, a bulk write or a file import that is never streamed) notices another stored state at the latest when the person comes
// back to it. Loaded LAZILY from @designer (StandWaechterHinweis.jsx, the designer's chunk is at its size budget).
//   Triggers: window `focus`, document `visibilitychange` to visible (the trigger of the studio's kiStandLaden) and a reconnect of
//   the change stream (`neuAbgleichen` of stromClient.js).
//   BimModel: read once inside the save chain and compared on INEQUALITY of id or updated_date (bimModelStandPruefen in
//   useBimModelSync): the same record in another state - older ones included - goes through the holders like a stream event
//   (clean studio → reload, own changes → merge); another record id → "ersetzt": a banner asks for a reload and every save of the
//   project rests until then.
//   BuildingComplex: read once (get by the base's id, else the newest of the project), queued behind the designer's writes; another
//   state goes into the designer's three-way path - the same one a 409 takes (komplexAbgleich.js, cards, locks).
// The pure decisions of 115-05a (studioSauber, standEntscheiden) live in standEntscheidung.js and are re-exported here.
//
// In:  project id; for the design record the designer's queue, base and merge (KomplexWaechter). Out: useStandWaechter ->
//      {ersetzt}; standPruefen / komplexStandPruefen / fokusAusloeser for the hook and the unit tests. Side effects: GET requests,
//      the merges named above, listeners on window / document while mounted.

import { useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { bimModelStandPruefen, bimModelErsetzt } from "@core/lib/useBimModelSync";
import { stromAbonnieren } from "./stromClient.js";
import { komplexDatensatzWaehlen } from "./komplexAbgleich.js";

export { studioSauber, standEntscheiden } from "./standEntscheidung.js";

/**
 * The designer's side of the design-record check.
 * @typedef {{pid: string, basis: () => ({id: string|null, updated_date: string|null}|undefined),
 *   nehmen: (gespeichert: any) => (boolean|void), einreihen: (lauf: () => Promise<any>) => Promise<any>}} KomplexWaechter
 *   basis = the stored base the designer knows (undefined until loaded); nehmen = its three-way path for another stored record
 *   (returns false when the designer of `pid` is no longer active - nothing taken, the base stays: review 115-05b part 2, 1);
 *   einreihen = runs `lauf` behind the designer's own writes (never beside one: a write on its way would look like another state)
 */

/**
 * Registers the triggers of the check: `focus` on the window and `visibilitychange` to "visible" on the document.
 * @param {{fenster: EventTarget, dokument: EventTarget & {visibilityState?: string}, pruefen: () => void}} a
 * @returns {() => void} removes both listeners
 */
export function fokusAusloeser({ fenster, dokument, pruefen }) {
  const beiFokus = () => pruefen();
  const beiSicht = () => { if (dokument.visibilityState === "visible") pruefen(); };
  fenster.addEventListener("focus", beiFokus);
  dokument.addEventListener("visibilitychange", beiSicht);
  return () => {
    fenster.removeEventListener("focus", beiFokus);
    dokument.removeEventListener("visibilitychange", beiSicht);
  };
}

/**
 * The check of the design record (BuildingComplex): queued behind the designer's writes, reads the record once and hands another
 * state (other id or updated_date - inequality, not "newer") to the designer's three-way path.
 * Review 115-05b part 2 (finding 1): a check that became inactive while it read (the page was left, another project opened) takes
 * NOTHING and moves no base - a pending write of the project left (the flush on leaving) must meet the server's 409 and its refusal
 * note, not a base moved under it without card or lock (it then got a 200 and overwrote the other writer silently).
 * @param {KomplexWaechter} komplex
 * @param {{aktiv?: () => boolean}} [o] aktiv = whether the check still belongs to the open designer (read after the GET)
 * @returns {Promise<"aktuell"|"uebernommen"|"ohne">} ohne = the designer has no base yet (not loaded) or is no longer active
 */
export function komplexStandPruefen(komplex, { aktiv = () => true } = {}) {
  return komplex.einreihen(async () => {
    const b = komplex.basis();
    if (!b) return /** @type {const} */ ("ohne");
    /** @type {any} */ let rec = null;
    if (b.id) {
      try {
        rec = await bitApi.entities.BuildingComplex.get(b.id);
      } catch (err) {
        if (/** @type {any} */ (err)?.status !== 404) throw err;
      }
    }
    // no record known yet (another tab may have created one), or the known one is gone: the newest of the project
    if (!rec) rec = komplexDatensatzWaehlen(await bitApi.entities.BuildingComplex.filter({ project_id: komplex.pid })).datensatz;
    if (!rec) return /** @type {const} */ ("aktuell");
    if (String(rec.id ?? "") === String(b.id ?? "") && String(rec.updated_date ?? "") === String(b.updated_date ?? "")) return /** @type {const} */ ("aktuell");
    if (!aktiv() || komplex.nehmen(rec) === false) return /** @type {const} */ ("ohne");
    return /** @type {const} */ ("uebernommen");
  });
}

/**
 * One check of the open project: the BimModel, then (when the designer passed it) the design record. A failed read of one part
 * does not stop the other; it is logged and reported as "fehler" (the next trigger tries again).
 * @param {string} projectId
 * @param {{komplex?: KomplexWaechter|null, aktiv?: () => boolean}} [o] aktiv = whether the check still belongs to the open page
 *   (false after unmount / project switch: nothing is taken in, no base moves - review 115-05b part 2, finding 1)
 * @returns {Promise<{bim: string, komplex: string}>} bim = aktuell / uebernommen / ersetzt / ohne / fehler (bimModelStandPruefen);
 *   komplex = aktuell / uebernommen / ohne / fehler
 */
export async function standPruefen(projectId, { komplex = null, aktiv = () => true } = {}) {
  /** @param {string} teil @returns {(err: any) => string} */
  const fehler = (teil) => (err) => { console.warn(`[standWaechter] ${teil} not checked: ${err?.message || err}`); return "fehler"; };
  const bim = await bimModelStandPruefen(projectId, { aktiv }).catch(fehler("BimModel"));
  const k = komplex ? await komplexStandPruefen(komplex, { aktiv }).catch(fehler("BuildingComplex")) : "ohne";
  return { bim, komplex: k };
}

/**
 * The focus check of the open project, mounted by the designer (lazily). One check at a time (focus and visibilitychange often
 * fire together; the second one is dropped while the first runs).
 * @param {string|null|undefined} projectId
 * @param {{komplex?: KomplexWaechter|null}} [opts] read at each check (a new object per render is fine)
 * @returns {{ersetzt: boolean}} ersetzt = the BimModel of the project was replaced by another record: reload (saves rest until then)
 */
export function useStandWaechter(projectId, opts = {}) {
  const [ersetztFuer, setErsetztFuer] = useState(/** @type {string|null} */ (null));
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!projectId) return undefined;
    let laeuft = false;
    let weg = false;
    const pruefen = async () => {
      if (laeuft || weg) return;
      laeuft = true;
      try {
        // weg = unmounted or another project: a check still reading then takes nothing (review 115-05b part 2, finding 1)
        const r = await standPruefen(projectId, { komplex: optsRef.current?.komplex ?? null, aktiv: () => !weg });
        if (!weg && r.bim === "ersetzt") setErsetztFuer(projectId);
      } finally {
        laeuft = false;
      }
    };
    if (bimModelErsetzt(projectId)) setErsetztFuer(projectId);
    const abFokus = fokusAusloeser({ fenster: window, dokument: document, pruefen: () => { void pruefen(); } });
    // the stream's own subscriber (useModellAbgleich) reads again after a gap too, but takes only NEWER states
    const abStrom = stromAbonnieren(projectId, () => {}, { neuAbgleichen: () => { void pruefen(); } });
    return () => { weg = true; abFokus(); abStrom(); };
  }, [projectId]);
  return { ersetzt: Boolean(projectId) && ersetztFuer === projectId };
}
