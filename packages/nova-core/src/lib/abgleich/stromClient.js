// 106-09: the page side of the change stream (server/aenderungsStrom.js).
//
// ONE connection per browser and project, not one per tab (review 106-09): a browser allows about six HTTP/1.1
// connections per host, and a held stream per tab (plus the control long-poll of 104-04) used up that pool from three
// tabs on, so every API call of every tab waited. Now the tabs of one browser elect a leader per project with the Web
// Locks API (`navigator.locks`); only the leader holds the EventSource and hands every event and its connection state
// to the other tabs through a BroadcastChannel. When the leader tab closes, its lock is released and the next tab takes
// over (it resumes with `seit=<last seq>`). A browser without Web Locks or BroadcastChannel keeps one connection per tab
// (rolle "einzeln"), as before.
//
// After a gap - the browser reconnected, the server restarted (its seq starts again at 0), a leader change, the replay
// buffer was too short - the subscribers are asked to read the record again (`neuAbgleichen`): every `bereit` after the
// first one a tab saw means "you may have missed something". A connection the browser gave up (CLOSED: 503 limit, 404,
// a proxy error while the server restarts) is opened again with a growing pause; its state ("getrennt" with a reason)
// goes to abgleichStand, and the viewers show it.
//
// Events of THIS tab's own writes (same client id, clientKennung.js) are dropped here - a tab never applies its own
// change twice. Everything else is handed to the subscribers as data; nothing is written or confirmed because of an
// event (D-IM-04).
//
// Only on the express data path in a browser: the cloud path and the serverless build have no such route, the stream
// stays "aus" there and the app behaves as before 106-09.
//
// In:  project id, subscriber functions. Out: stromAbonnieren(), stromVerfuegbar(), naechstePause(); the connection
//      state goes to abgleichStand.verbindungSetzen().

import { DATENQUELLE } from "../umgebung.js";
import { clientKennung } from "./clientKennung.js";
import { abgleichStand } from "./abgleichStand.js";

const API_BASE = import.meta.env?.VITE_API_BASE_URL || "/api";

/** Pauses before opening a refused/closed stream again, ms (then the last one repeats) [ASSUMED: a server restart takes seconds]. */
export const WIEDER_PAUSEN_MS = Object.freeze([3000, 6000, 15000, 30000, 60000]);

/**
 * Pause before the n-th attempt to open a closed stream again.
 * @param {number} versuch 1 = first retry @returns {number} ms
 */
export function naechstePause(versuch) {
  return WIEDER_PAUSEN_MS[Math.min(Math.max(1, versuch), WIEDER_PAUSEN_MS.length) - 1];
}

/** German keys of the reasons a stream is down (the viewers translate them). */
export const GRUND = Object.freeze({
  abgelehnt: "Der Server hat den Abgleich abgelehnt — neuer Versuch läuft.",
  unterbrochen: "Verbindung zum Abgleich unterbrochen — neuer Versuch läuft.",
});

/**
 * @typedef {{seq: number, projekt: string, entitaet: string, id: string, art: "angelegt"|"geaendert"|"geloescht",
 *   felder: string[], updated_date: string|null, geraet: {id: string, name: string}|null, client: string|null, zeit: string,
 *   datensatz?: any}} StromEreignis
 */

/**
 * @typedef {{hoerer: Set<(e: StromEreignis) => void>, neu: Set<() => void>, bc: any, quelle: any, abbruch: AbortController|null,
 *   freigeben: (() => void)|null, letzteSeq: number|null, instanz: string|null, bereitGesehen: boolean, rolle: "leiter"|"folger"|"einzeln",
 *   versuche: number, wieder: any, zu: boolean}} Kanal
 */

/** @type {Map<string, Kanal>} */
const offen = new Map();

/**
 * Whether this page can hold a change stream (browser with EventSource, express data path).
 * @returns {boolean}
 */
export function stromVerfuegbar() {
  return DATENQUELLE === "express" && typeof globalThis.EventSource === "function";
}

/** @returns {boolean} whether the tabs of this browser can share one stream */
const teilenMoeglich = () => typeof globalThis.BroadcastChannel === "function" && typeof globalThis.navigator?.locks?.request === "function";

/**
 * Subscribes to the change events of one project. All subscribers of all tabs of this browser share one connection.
 * @param {string|null|undefined} projektId
 * @param {(e: StromEreignis) => void} fn called per event of ANOTHER tab or device (own writes are dropped)
 * @param {{neuAbgleichen?: () => void}} [o] called after a gap in the stream: read the record again
 * @returns {() => void} unsubscribe (closes the connection after the last subscriber of this tab)
 */
export function stromAbonnieren(projektId, fn, { neuAbgleichen } = {}) {
  if (!projektId || !stromVerfuegbar()) return () => {};
  const pid = String(projektId);
  let k = offen.get(pid);
  if (!k) { k = kanalOeffnen(pid); offen.set(pid, k); }
  const kanal = k;
  kanal.hoerer.add(fn);
  if (neuAbgleichen) kanal.neu.add(neuAbgleichen);
  return () => {
    kanal.hoerer.delete(fn);
    if (neuAbgleichen) kanal.neu.delete(neuAbgleichen);
    if (kanal.hoerer.size === 0 && offen.get(pid) === kanal) {
      kanalSchliessen(kanal);
      offen.delete(pid);
      if (abgleichStand.stand().verbindung.projekt === pid) abgleichStand.verbindungSetzen({ status: "aus", projekt: null });
    }
  };
}

/** @param {string} pid @returns {Kanal} */
function kanalOeffnen(pid) {
  /** @type {Kanal} */
  const k = { hoerer: new Set(), neu: new Set(), bc: null, quelle: null, abbruch: null, freigeben: null, letzteSeq: null, instanz: null,
    bereitGesehen: false, rolle: teilenMoeglich() ? "folger" : "einzeln", versuche: 0, wieder: null, zu: false };
  abgleichStand.verbindungSetzen({ status: "verbinde", projekt: pid, rolle: k.rolle });
  if (k.rolle === "einzeln") { verbinden(pid, k); return k; }
  k.bc = new globalThis.BroadcastChannel(`bit-abgleich:${pid}`);
  k.bc.onmessage = (/** @type {MessageEvent} */ m) => {
    const d = m.data || {};
    if (d.art === "aenderung") verteilen(pid, k, d.e);
    else if (d.art === "bereit") bereit(pid, k, d.instanz ?? null);
    else if (d.art === "status" && k.rolle === "folger") abgleichStand.verbindungSetzen({ status: d.status, projekt: pid, grund: d.grund ?? null, rolle: "folger" });
    else if (d.art === "frage" && k.rolle === "leiter") statusSenden(k, abgleichStand.stand().verbindung);
  };
  k.bc.postMessage({ art: "frage" }); // a leader (if any) tells the state of the connection
  k.abbruch = new AbortController();
  globalThis.navigator.locks.request(`bit-abgleich-strom:${pid}`, { signal: k.abbruch.signal }, () => new Promise((resolve) => {
    if (k.zu) { resolve(undefined); return; }
    k.rolle = "leiter";
    k.freigeben = () => resolve(undefined);
    verbinden(pid, k);
  })).catch(() => { /* aborted: this tab closed its last subscription before it became leader */ });
  return k;
}

/** @param {Kanal} k */
function kanalSchliessen(k) {
  k.zu = true;
  if (k.wieder) clearTimeout(k.wieder);
  k.quelle?.close();
  k.quelle = null;
  k.abbruch?.abort();
  k.freigeben?.();
  k.bc?.close();
}

/** @param {Kanal} k @param {import("./abgleichStand.js").Verbindung} v */
function statusSenden(k, v) {
  try { k.bc?.postMessage({ art: "status", status: v.status, grund: v.grund ?? null }); } catch { /* channel closed */ }
}

/** @param {string} pid @param {Kanal} k @param {"verbinde"|"verbunden"|"getrennt"} status @param {string|null} [grund] */
function statusSetzen(pid, k, status, grund = null) {
  abgleichStand.verbindungSetzen({ status, projekt: pid, grund, rolle: k.rolle });
  if (k.rolle === "leiter") statusSenden(k, { status, projekt: pid, grund });
}

/** One event to this tab's subscribers (own writes dropped). @param {string} pid @param {Kanal} k @param {StromEreignis} e */
function verteilen(pid, k, e) {
  if (!e || e.projekt !== pid) return;
  if (typeof e.seq === "number") k.letzteSeq = Math.max(k.letzteSeq ?? 0, e.seq);
  if (e.client === clientKennung()) return;
  for (const h of [...k.hoerer]) {
    try { h(e); } catch (err) { console.error(`[abgleich] event not processed: ${/** @type {any} */ (err)?.message || err}`); }
  }
}

/** The stream is (again) open: after the first time, read everything again. @param {string} pid @param {Kanal} k @param {string|null} instanz */
function bereit(pid, k, instanz) {
  if (instanz && k.instanz && instanz !== k.instanz) k.letzteSeq = null; // the server restarted: its numbers start again
  if (instanz) k.instanz = instanz;
  if (k.rolle === "folger") abgleichStand.verbindungSetzen({ status: "verbunden", projekt: pid, rolle: "folger" });
  if (!k.bereitGesehen) { k.bereitGesehen = true; return; }
  for (const f of [...k.neu]) {
    try { f(); } catch (err) { console.error(`[abgleich] resync failed: ${/** @type {any} */ (err)?.message || err}`); }
  }
}

/** Opens the EventSource (leader or single tab). @param {string} pid @param {Kanal} k */
function verbinden(pid, k) {
  if (k.zu) return;
  const seit = k.letzteSeq != null ? `&seit=${k.letzteSeq}` : "";
  const quelle = new globalThis.EventSource(`${API_BASE}/aenderungen?projekt=${encodeURIComponent(pid)}${seit}`);
  k.quelle = quelle;
  statusSetzen(pid, k, "verbinde");
  quelle.addEventListener("bereit", (/** @type {MessageEvent} */ ev) => {
    k.versuche = 0;
    /** @type {any} */ let d = {};
    try { d = JSON.parse(String(ev.data)); } catch { d = {}; }
    statusSetzen(pid, k, "verbunden");
    if (k.rolle === "leiter") { try { k.bc?.postMessage({ art: "bereit", instanz: d.instanz ?? null }); } catch { /* closed */ } }
    bereit(pid, k, d.instanz ?? null);
  });
  quelle.addEventListener("aenderung", (/** @type {MessageEvent} */ ev) => {
    /** @type {StromEreignis} */
    let e;
    try { e = JSON.parse(String(ev.data)); } catch { return; }
    if (k.rolle === "leiter") { try { k.bc?.postMessage({ art: "aenderung", e }); } catch { /* closed */ } }
    verteilen(pid, k, e);
  });
  quelle.onerror = () => {
    if (k.zu || k.quelle !== quelle) return;
    if (quelle.readyState !== 2) { statusSetzen(pid, k, "getrennt", GRUND.unterbrochen); return; } // the browser retries itself
    // CLOSED: the browser gave up (refused, 404, proxy error) - open it again ourselves, with a growing pause
    quelle.close();
    k.quelle = null;
    k.versuche += 1;
    statusSetzen(pid, k, "getrennt", GRUND.abgelehnt);
    k.wieder = setTimeout(() => { k.wieder = null; verbinden(pid, k); }, naechstePause(k.versuche));
  };
}
