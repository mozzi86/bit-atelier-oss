// Device timer of the time tracking (phase 81-02, ZEIT-02, D-P81-19): a running
// timer lives in the device's localStorage, so it survives a reload; the booking
// is created only when the timer is stopped. Every storage access is wrapped in
// try/catch — a blocked storage (private mode, policy) makes the timer
// unavailable, never the page.
//
// Key "bit-atelier.zeit.timer.v1" (registered in @core/lib/browserSpeicher.js).
// Value: {start_ms, mitarbeiter_id, project_id, lph, leistung, kategorie_intern, notiz}.
// The same module keeps the device's choice "Stunden für" (key
// "bit-atelier.zeit.person.v1", a person id) — one place for the time tracking's
// device storage, until phase 82 ties bookings to the signed-in user.
//
// In:  an injected storage with getItem/setItem/removeItem (window.localStorage
//      in the app, a fake in the tests), epoch milliseconds. Out: plain objects.

/** localStorage key of the running timer. */
export const TIMER_SCHLUESSEL = "bit-atelier.zeit.timer.v1";

/**
 * Minutes of a timer run, rounded UP to the grid (a started quarter hour counts),
 * 0 below one minute (an accidental start is not a booking).
 * 09:00:00 → 09:07:00 = 15; → 09:16:00 = 30; → 09:00:40 = 0 (grid 15).
 * @param {number} startMs epoch milliseconds
 * @param {number} stopMs epoch milliseconds
 * @param {number} rasterMinuten grid in minutes (zeit_honorar.raster)
 * @returns {number} whole minutes, a multiple of the grid
 */
export function timerMinuten(startMs, stopMs, rasterMinuten) {
  const dauer = Number(stopMs) - Number(startMs);
  if (!Number.isFinite(dauer) || dauer < 60000) return 0;
  const raster = Number(rasterMinuten) > 0 ? Number(rasterMinuten) : 1;
  return Math.ceil(dauer / 60000 / raster) * raster;
}

/**
 * The running timer, if any.
 * @param {{getItem: (k: string) => string|null}|null|undefined} speicher
 * @returns {{verfuegbar: boolean, laeuft: boolean, daten: Record<string, any>|null}}
 */
export function leseTimer(speicher) {
  try {
    if (!speicher) return { verfuegbar: false, laeuft: false, daten: null };
    const roh = speicher.getItem(TIMER_SCHLUESSEL);
    if (!roh) return { verfuegbar: true, laeuft: false, daten: null };
    const daten = JSON.parse(roh);
    if (!daten || typeof daten.start_ms !== "number") return { verfuegbar: true, laeuft: false, daten: null };
    return { verfuegbar: true, laeuft: true, daten };
  } catch {
    // Storage blocked or value unreadable: the timer is unavailable on this device.
    return { verfuegbar: false, laeuft: false, daten: null };
  }
}

/**
 * Starts a timer (replaces a running one).
 * @param {{setItem: (k: string, v: string) => void}|null|undefined} speicher
 * @param {Record<string, any>} daten what is timed: mitarbeiter_id, project_id, lph, leistung, kategorie_intern, notiz
 * @param {number} jetztMs epoch milliseconds
 * @returns {{ok: boolean}}
 */
export function starteTimer(speicher, daten, jetztMs) {
  try {
    if (!speicher) return { ok: false };
    speicher.setItem(TIMER_SCHLUESSEL, JSON.stringify({ ...daten, start_ms: Number(jetztMs) }));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Stops the running timer and returns what it was timing.
 * @param {{getItem: (k: string) => string|null, removeItem: (k: string) => void}|null|undefined} speicher
 * @returns {{ok: boolean, daten: Record<string, any>|null}}
 */
export function stoppeTimer(speicher) {
  const t = leseTimer(speicher);
  if (!t.verfuegbar || !t.laeuft) return { ok: false, daten: null };
  try {
    /** @type {any} */ (speicher).removeItem(TIMER_SCHLUESSEL);
    return { ok: true, daten: t.daten };
  } catch {
    return { ok: false, daten: null };
  }
}

/** localStorage key of the person chosen under "Stunden für" on this device. */
export const PERSON_SCHLUESSEL = "bit-atelier.zeit.person.v1";

/**
 * The person id chosen on this device, or null.
 * @param {{getItem: (k: string) => string|null}|null|undefined} speicher
 * @returns {string|null}
 */
export function lesePersonWahl(speicher) {
  try {
    return speicher ? speicher.getItem(PERSON_SCHLUESSEL) : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the person chosen on this device (silently skipped when the storage is blocked).
 * @param {{setItem: (k: string, v: string) => void}|null|undefined} speicher
 * @param {string} mitarbeiterId
 * @returns {boolean} true when stored
 */
export function merkePersonWahl(speicher, mitarbeiterId) {
  try {
    if (!speicher) return false;
    speicher.setItem(PERSON_SCHLUESSEL, String(mitarbeiterId));
    return true;
  } catch {
    return false;
  }
}

/**
 * window.localStorage when reachable, otherwise null (private mode, SSR, policy).
 * @returns {Storage|null}
 */
export function geraeteSpeicher() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
