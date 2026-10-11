// 86-05b: React hook that computes the building proposals of the current footprint off the
// main thread. Decision from the 86-05a measurement: the cold full enumeration reaches 2,1 s
// on the user's pentagon (rectangle 0,1 s, L 0,8 s, U 1,0 s) — above the round's ~2 s rule for
// synchronous useMemo, so a Web Worker runs it; the synchronous path stays as fallback when
// `Worker` is missing (tests, SSR) or the worker fails to load.
//
// In:  { footprintM (m), basis (workshop base inputs — layout-bound fields are dropped by the
//       lib), aktiv (compute only while the tab is open), max }
// Out: { liste: kartenDaten[], laedt, fehler, dauer_ms } — the list appears COMPLETE, never as
//      a partial state (the sort order must not jump, 86-05b-PLAN step 6).
// 86-05c: `aehnliche(karte)` asks the same worker for the deterministic neighbourhood of one
// card (lib nachbarn) and APPENDS the new cards to the list (dedupe by id); the answer is
// dropped when the inputs changed meanwhile (list key) — a neighbour of an old footprint
// must never land in the new list.
/* global Worker */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erzeugeVorschlaege, nachbarn, kartenDaten, basisBereinigt, footprintHash, VORSCHLAEGE_MAX } from "./bebauungsvorschlaege.js";

/**
 * @typedef {object} VorschlaegeStand
 * @property {Array<ReturnType<typeof kartenDaten>>} liste card data, enumeration order (+ appended neighbours, 86-05c)
 * @property {boolean} laedt a computation is running
 * @property {string|null} fehler plain-text error of the last run, null when fine
 * @property {number|null} dauer_ms duration of the last run (worker or sync), null before the first
 * @property {string|null} schluessel input key the list belongs to
 */

/** Synchronous computation (fallback path), same output shape as the worker. */
function rechneSynchron(footprintM, basis, max) {
  const t0 = performance.now();
  const liste = erzeugeVorschlaege(footprintM, basis, { max }).map(kartenDaten);
  return { liste, dauer_ms: Math.round(performance.now() - t0) };
}

/**
 * Proposals of a footprint + base configuration, computed in a Worker when the tab is active.
 * Re-runs only when the inputs change (key = footprint hash + cleaned base + max); a change
 * while a run is pending drops that run's answer (nonce). The worker lives as long as the
 * component and is terminated on unmount.
 * @param {{footprintM: Array<{x:number, z:number}>|null|undefined, basis: object, aktiv: boolean, max?: number}} p
 * @returns {VorschlaegeStand & {aehnliche: (karte: {id: string, typologie: any}) => void, aehnlichLaedt: boolean, aehnlichErgebnis: {ursprung: string, neu: number}|null}}
 *   aehnliche = 86-05c "ähnliche erzeugen" for one card; aehnlichErgebnis = source id + number of cards appended by the last call
 */
export function useVorschlaege({ footprintM, basis, aktiv, max = VORSCHLAEGE_MAX }) {
  /** @type {[VorschlaegeStand, (s: VorschlaegeStand | ((s: VorschlaegeStand) => VorschlaegeStand)) => void]} */
  const [stand, setStand] = useState(/** @type {VorschlaegeStand} */ ({ liste: [], laedt: false, fehler: null, dauer_ms: null, schluessel: null }));
  const [aehnlichLaedt, setAehnlichLaedt] = useState(false);
  const [aehnlichErgebnis, setAehnlichErgebnis] = useState(/** @type {{ursprung: string, neu: number}|null} */ (null));
  const basisRein = useMemo(() => basisBereinigt(basis), [basis]);
  const schluessel = useMemo(() => JSON.stringify({ fp: footprintHash(footprintM), basis: basisRein, max }), [footprintM, basisRein, max]);
  /** @type {React.MutableRefObject<Worker|null>} */
  const workerRef = useRef(null);
  const nonceRef = useRef(0);
  const eingabenRef = useRef({ footprintM, basisRein, max, schluessel });
  eingabenRef.current = { footprintM, basisRein, max, schluessel };
  const listeRef = useRef(stand.liste);
  listeRef.current = stand.liste;

  /** The shared worker, created on first use; null when `Worker` is missing or creation fails. */
  const holeWorker = useCallback(() => {
    if (typeof Worker === "undefined") return null;
    if (workerRef.current) return workerRef.current;
    try {
      workerRef.current = new Worker(new URL("./bebauungsvorschlaege.worker.js", import.meta.url), { type: "module" });
    } catch {
      workerRef.current = null;
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    if (!aktiv || stand.schluessel === schluessel) return undefined;
    const nonce = nonceRef.current + 1;
    nonceRef.current = nonce;
    const { footprintM: fp, basisRein: b, max: m } = eingabenRef.current;
    setStand((s) => ({ ...s, laedt: true, fehler: null }));
    setAehnlichErgebnis(null);
    const fertig = (liste, dauer_ms) => { if (nonce === nonceRef.current) setStand({ liste, laedt: false, fehler: null, dauer_ms, schluessel }); };
    const kaputt = (fehler) => { if (nonce === nonceRef.current) setStand({ liste: [], laedt: false, fehler, dauer_ms: null, schluessel }); };
    const synchron = () => {
      try { const r = rechneSynchron(fp, b, m); fertig(r.liste, r.dauer_ms); } catch (e) { kaputt(e instanceof Error ? e.message : String(e)); }
    };
    const w = holeWorker();
    if (!w) { synchron(); return undefined; }
    const onMessage = (ev) => {
      const d = ev && ev.data && typeof ev.data === "object" ? ev.data : null;
      if (!d || d.nonce !== nonce) return;
      if (d.fehler) kaputt(String(d.fehler));
      else fertig(Array.isArray(d.liste) ? d.liste : [], Number.isFinite(Number(d.dauer_ms)) ? Number(d.dauer_ms) : null);
    };
    // A worker that cannot load (bundling, CSP) must not leave the tab empty: compute inline.
    const onError = () => { workerRef.current = null; try { w?.terminate(); } catch { /* already gone */ } synchron(); };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ nonce, footprintM: fp, basis: b, max: m });
    return () => { w?.removeEventListener("message", onMessage); w?.removeEventListener("error", onError); };
  }, [aktiv, schluessel, stand.schluessel, holeWorker]);

  /**
   * 86-05c: append the neighbours of one card. The answer is applied only while the list key
   * is unchanged; cards already present (id) are skipped; the list never exceeds `max`.
   */
  const aehnliche = useCallback((karte) => {
    const { footprintM: fp, basisRein: b, max: m, schluessel: key } = eingabenRef.current;
    const vorhanden = listeRef.current;
    if (!karte || !karte.typologie || vorhanden.length >= m) { setAehnlichErgebnis({ ursprung: String(karte?.id ?? ""), neu: 0 }); return; }
    const nonce = `n${nonceRef.current}-${Date.now()}-${String(karte.id)}`;
    setAehnlichLaedt(true);
    const anhaengen = (neue) => {
      setAehnlichLaedt(false);
      if (eingabenRef.current.schluessel !== key) return;
      const ids = new Set(listeRef.current.map((v) => v.id));
      const frisch = neue.filter((v) => v && !ids.has(v.id)).slice(0, Math.max(0, m - listeRef.current.length));
      setAehnlichErgebnis({ ursprung: String(karte.id), neu: frisch.length });
      if (frisch.length) setStand((s) => ({ ...s, liste: [...s.liste, ...frisch] }));
    };
    const synchron = () => {
      try { anhaengen(nachbarn(karte, fp, b, { vorhanden, max: m }).map(kartenDaten)); } catch (e) { setAehnlichLaedt(false); setStand((s) => ({ ...s, fehler: e instanceof Error ? e.message : String(e) })); }
    };
    const w = holeWorker();
    if (!w) { synchron(); return; }
    const onMessage = (ev) => {
      const d = ev && ev.data && typeof ev.data === "object" ? ev.data : null;
      if (!d || d.nonce !== nonce) return;
      w.removeEventListener("message", onMessage);
      if (d.fehler) { setAehnlichLaedt(false); setStand((s) => ({ ...s, fehler: String(d.fehler) })); } else anhaengen(Array.isArray(d.liste) ? d.liste : []);
    };
    w.addEventListener("message", onMessage);
    // Only id + typology cross the boundary (the lib needs nothing else of the source card).
    w.postMessage({ nonce, art: "nachbarn", footprintM: fp, basis: b, max: m, vorschlag: { id: karte.id, typologie: karte.typologie }, vorhanden: vorhanden.map((v) => ({ id: v.id, typologie: v.typologie })) });
  }, [holeWorker]);

  useEffect(() => () => { try { workerRef.current?.terminate(); } catch { /* nothing to stop */ } workerRef.current = null; }, []);

  return { ...stand, aehnliche, aehnlichLaedt, aehnlichErgebnis };
}
