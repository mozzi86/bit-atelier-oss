// Client side of the office mode (plan 93-03, lever 158): thin fetch wrappers for /api/buero/* and the two
// window events the app listens to. Server side: server/bueroRouter.js.
//
//   ladeIch()            who is this browser: host (loopback), paired device, unpaired device
//   ladeStatus()         host only: on/off, LAN URLs, devices, open code
//   setzeAktiv(an)       host only: switch office mode on/off (binds/unbinds the LAN listeners)
//   codeErzeugen(name)   host only: 6-digit pairing code for a named device
//   widerrufen(id)       host only: revoke a device
//   koppeln(code)        device: exchange the code for the httpOnly device cookie
//   abmelden()           device: revoke the own pairing
//
// Every function throws an Error with the server's plain-text reason (`error` field) on a non-2xx answer.
//
// In:  nothing (relative /api paths — same origin on host and device). Out: the functions and event names.

/** Fired after office mode was switched or a device changed — the gate and the header marker reload. */
export const BUERO_EREIGNIS = "bit:buero-geaendert";

/**
 * Answer of GET /api/buero/ich.
 * @typedef {{lokal: boolean, aktiv: boolean, appModus?: boolean,
 *   geraet?: {id: string, name: string, erstellt: string, laeuftAb: string, zuletzt: string|null}|null}} BueroIch
 */

/**
 * Host status of GET /api/buero/status.
 * @typedef {{aktiv: boolean, port: number, appModus: boolean, adressen: string[], urls: string[], fehler: string[],
 *   geraete: Array<{id: string, name: string, erstellt: string, laeuftAb: string, zuletzt: string|null}>,
 *   offenerCode: {name: string, laeuftAb: string}|null}} BueroStatus
 */

/**
 * JSON request against the local API; throws the server's reason.
 * @param {string} pfad e.g. "/api/buero/ich"
 * @param {RequestInit & {json?: unknown}} [o] json = request body (sent as application/json)
 * @returns {Promise<any>}
 */
async function anfrage(pfad, o = {}) {
  const { json, ...rest } = o;
  const r = await fetch(pfad, {
    cache: "no-store",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}),
  });
  const daten = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = /** @type {Error & {status?: number}} */ (new Error(daten?.error || `HTTP ${r.status}`));
    e.status = r.status;
    throw e;
  }
  return daten;
}

/** Tell the gate and the header marker that something changed. */
export function bueroGeaendert() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BUERO_EREIGNIS));
}

/** @returns {Promise<BueroIch>} */
export const ladeIch = () => anfrage("/api/buero/ich");
/** @returns {Promise<BueroStatus>} */
export const ladeStatus = () => anfrage("/api/buero/status");
/**
 * @param {boolean} an
 * @returns {Promise<BueroStatus>}
 */
export const setzeAktiv = (an) => anfrage("/api/buero/aktivieren", { method: "POST", json: { aktiv: an } });
/**
 * @param {string} name device name, e.g. "Tablet Baustelle"
 * @returns {Promise<{code: string, name: string, laeuftAb: string}>}
 */
export const codeErzeugen = (name) => anfrage("/api/buero/code", { method: "POST", json: { name } });
/**
 * @param {string} id device id
 * @returns {Promise<{ok: true}>}
 */
export const widerrufen = (id) => anfrage(`/api/buero/geraete/${encodeURIComponent(id)}`, { method: "DELETE" });
/**
 * @param {string} code the six digits shown on the host
 * @returns {Promise<{geraet: {name: string}}>}
 */
export const koppeln = (code) => anfrage("/api/buero/koppeln", { method: "POST", json: { code } });
/** @returns {Promise<{ok: true}>} */
export const abmelden = () => anfrage("/api/buero/abmelden", { method: "POST" });

/**
 * Only the digits of a typed code, at most six ("123 456" → "123456").
 * @param {string} eingabe
 * @returns {string}
 */
export function nurZiffern(eingabe) {
  return String(eingabe || "").replace(/\D/g, "").slice(0, 6);
}

/**
 * Local date and time of an ISO timestamp for the UI ("12.10.2026, 21:40"); "—" for nothing.
 * @param {string|null|undefined} iso
 * @param {string} [sprache] "de" | "en"
 * @returns {string}
 */
export function zeitpunkt(iso, sprache = "de") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(sprache === "en" ? "en-GB" : "de-DE", { dateStyle: "medium", timeStyle: "short" });
}
