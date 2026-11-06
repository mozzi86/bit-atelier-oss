// 106-08: may this page start an immersive VR session at all? A small module that every viewer loads with its page (the
// session code itself, xrSitzung.js, is loaded only when the person presses "In VR ansehen", so the page chunk stays small).
//
// Rule of the plan: without a WebXR device there is NO button (no dead button); the reason is kept as a sentence for the
// test hook and for the start error. Errors of a start are said in plain words, never as "NotSupportedError".
//
// A paired device (106-07, LAN access) opens the app over the LAN without HTTPS: the browser has no WebXR there (secure
// context only), so the button does not appear on such a device - XR never becomes a second road around the rights of 106-07.
//
// In:  the global object (window) or a stand-in with isSecureContext and navigator.xr. Out: xrVerfuegbarkeit(), xrStartFehlerText(),
// XR_GRUENDE. No three, no DOM writes.

/** German reasons (keys of the i18n dictionary) why VR is not offered or did not start. */
export const XR_GRUENDE = Object.freeze({
  unsicher: "VR nicht verfügbar: die Seite läuft ohne HTTPS — VR geht nur über HTTPS oder an diesem Rechner (localhost)",
  keinWebxr: "VR nicht verfügbar: dieser Browser kennt kein WebXR",
  keinGeraet: "VR nicht verfügbar: kein VR-Gerät gefunden",
  pruefFehler: "VR nicht verfügbar: die WebXR-Prüfung ist fehlgeschlagen",
  nichtUnterstuetzt: "VR konnte nicht starten: das Gerät bietet keine immersive Sitzung an",
  nichtErlaubt: "VR konnte nicht starten: der Browser hat die Sitzung nicht erlaubt — bitte im Browser des Geräts zulassen",
  laeuftSchon: "VR konnte nicht starten: es läuft schon eine VR-Sitzung",
  unbekannt: "VR konnte nicht starten",
});

/**
 * @typedef {Object} XrUmgebung
 * @property {boolean} [isSecureContext]  false on plain http outside localhost (no WebXR there).
 * @property {{xr?: {isSessionSupported?: (mode: string) => Promise<boolean>}}} [navigator]
 */

/**
 * Asks the browser whether an immersive VR session can be offered. Never throws.
 * @param {XrUmgebung} [umgebung]  Default: globalThis (the window).
 * @returns {Promise<{ok: boolean, grund: string|null}>}  ok = show the button; grund = German sentence (XR_GRUENDE key text) when not.
 */
export async function xrVerfuegbarkeit(umgebung = /** @type {any} */ (globalThis)) {
  if (umgebung?.isSecureContext === false) return { ok: false, grund: XR_GRUENDE.unsicher };
  const xr = umgebung?.navigator?.xr;
  if (!xr || typeof xr.isSessionSupported !== "function") return { ok: false, grund: XR_GRUENDE.keinWebxr };
  try {
    return (await xr.isSessionSupported("immersive-vr")) === true ? { ok: true, grund: null } : { ok: false, grund: XR_GRUENDE.keinGeraet };
  } catch {
    return { ok: false, grund: XR_GRUENDE.pruefFehler };
  }
}

/**
 * Plain German sentence for a failed start (requestSession / setSession rejected).
 * @param {unknown} e  The rejection (usually a DOMException).
 * @returns {{grund: string, detail: string}}  grund: dictionary key (pass to t()); detail: the browser's message, may be "".
 */
export function xrStartFehlerText(e) {
  const name = /** @type {any} */ (e)?.name ?? "";
  const detail = String(/** @type {any} */ (e)?.message ?? e ?? "").trim();
  if (name === "NotSupportedError") return { grund: XR_GRUENDE.nichtUnterstuetzt, detail };
  if (name === "NotAllowedError" || name === "SecurityError") return { grund: XR_GRUENDE.nichtErlaubt, detail };
  if (name === "InvalidStateError") return { grund: XR_GRUENDE.laeuftSchon, detail };
  return { grund: XR_GRUENDE.unbekannt, detail };
}
