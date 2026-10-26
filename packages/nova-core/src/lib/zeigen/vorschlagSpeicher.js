// 106-03: the small store behind the preview of a viewer - the OPEN proposals (shown in words, waiting for a human)
// and the HISTORY of executed steps (each with its origin, each reversible on its own). The viewer owns one store, the
// register commands write to it, the preview component (components/zeigen/AenderungsVorschau.jsx) reads from it.
//
// Pure: no React, no DOM, no three. The state is an immutable snapshot that is replaced on every change, so a
// React `useSyncExternalStore(abonnieren, stand)` re-renders exactly when something changed.
//
// In:  proposals (vorschlagErzeugen records), origin records of executed steps (herkunftEintrag records).
// Out: store {stand, abonnieren, offen, holen, hinzu, entfernen, aktualisieren, verlauf, verlaufHinzu, verlaufMarkieren, leeren}.

/** Most steps kept in the history of one session [ASSUMED: enough for a working session, bounded so memory stays flat]. */
export const VERLAUF_MAX = 200;

/**
 * @typedef {ReturnType<typeof import("./aenderungen.js").vorschlagErzeugen>} Vorschlag
 * @typedef {ReturnType<typeof import("./aenderungen.js").herkunftEintrag> & {zurueckgenommen?: string|null}} Schritt
 * @typedef {{offen: ReadonlyArray<Vorschlag>, verlauf: ReadonlyArray<Schritt>}} Stand
 */

/**
 * Creates an empty store.
 * @returns {{
 *   stand: () => Stand,
 *   abonnieren: (fn: () => void) => () => void,
 *   offen: () => Vorschlag[],
 *   holen: (id: string) => Vorschlag|null,
 *   hinzu: (v: Vorschlag) => void,
 *   entfernen: (id: string) => boolean,
 *   aktualisieren: (id: string, patch: Partial<Vorschlag>) => Vorschlag|null,
 *   verlauf: () => Schritt[],
 *   verlaufHinzu: (s: Schritt) => void,
 *   verlaufMarkieren: (vorschlagId: string, patch: Partial<Schritt>) => boolean,
 *   leeren: () => void,
 * }}  `stand()` returns the same object until something changes (stable for useSyncExternalStore);
 *   `hinzu` replaces an open proposal with the same id; `entfernen` answers whether one was removed.
 */
export function vorschlagSpeicher() {
  /** @type {Stand} */
  let s = { offen: [], verlauf: [] };
  /** @type {Set<() => void>} */
  const hoerer = new Set();
  /** @param {Stand} neu */
  const setze = (neu) => { s = neu; hoerer.forEach((f) => f()); };
  return {
    stand: () => s,
    abonnieren(fn) { hoerer.add(fn); return () => { hoerer.delete(fn); }; },
    offen: () => [...s.offen],
    holen: (id) => s.offen.find((v) => v.id === id) ?? null,
    hinzu(v) { setze({ ...s, offen: [...s.offen.filter((x) => x.id !== v.id), v] }); },
    entfernen(id) {
      if (!s.offen.some((v) => v.id === id)) return false;
      setze({ ...s, offen: s.offen.filter((v) => v.id !== id) });
      return true;
    },
    aktualisieren(id, patch) {
      const alt = s.offen.find((v) => v.id === id);
      if (!alt) return null;
      const neu = { ...alt, ...patch };
      setze({ ...s, offen: s.offen.map((v) => (v.id === id ? neu : v)) });
      return neu;
    },
    verlauf: () => [...s.verlauf],
    verlaufHinzu(schritt) { setze({ ...s, verlauf: [...s.verlauf, schritt].slice(-VERLAUF_MAX) }); },
    verlaufMarkieren(vorschlagId, patch) {
      if (!s.verlauf.some((x) => x.vorschlag_id === vorschlagId)) return false;
      setze({ ...s, verlauf: s.verlauf.map((x) => (x.vorschlag_id === vorschlagId ? { ...x, ...patch } : x)) });
      return true;
    },
    leeren() { setze({ offen: [], verlauf: [] }); },
  };
}
