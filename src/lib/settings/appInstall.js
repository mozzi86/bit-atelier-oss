// PWA installation for Settings › System ("Als App installieren", 28.09.2026):
// keeps the browser's deferred `beforeinstallprompt` event, tells whether the app
// already runs installed, and picks the manual hint for browsers without a
// prompt (Safari, Firefox). Pure helpers are separated from the window state so
// they can be unit-tested under node.
//
// In:  window events (registered once via registriereInstallPrompt), the user agent.
// Out: installStatus(), appInstallieren(), browserHinweis(ua).

/** @type {any} */
let verzoegertesPrompt = null;
/** @type {Set<() => void>} */
const zuhoerer = new Set();

/**
 * Register the `beforeinstallprompt` listener once, as early as possible (main.jsx):
 * Chromium fires it before the Settings page is ever imported, so a listener
 * inside the component would miss it.
 * @param {Window|undefined} [w]
 */
export function registriereInstallPrompt(w = typeof window !== "undefined" ? window : undefined) {
  if (!w || /** @type {any} */ (w).__bitInstallPromptRegistriert) return;
  /** @type {any} */ (w).__bitInstallPromptRegistriert = true;
  w.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    verzoegertesPrompt = e;
    zuhoerer.forEach((f) => f());
  });
  w.addEventListener("appinstalled", () => {
    verzoegertesPrompt = null;
    zuhoerer.forEach((f) => f());
  });
}

/**
 * Subscribe to prompt availability changes (React effect). Returns the unsubscribe.
 * @param {() => void} f
 * @returns {() => void}
 */
export function beiInstallAenderung(f) {
  zuhoerer.add(f);
  return () => { zuhoerer.delete(f); };
}

/**
 * True when the page runs as an installed app (standalone display mode,
 * iOS Safari's navigator.standalone).
 * @param {Window|undefined} [w]
 * @returns {boolean}
 */
export function istInstalliert(w = typeof window !== "undefined" ? window : undefined) {
  if (!w) return false;
  try {
    if (w.matchMedia && w.matchMedia("(display-mode: standalone)").matches) return true;
  } catch { /* matchMedia missing in some test environments */ }
  return /** @type {any} */ (w.navigator)?.standalone === true;
}

/**
 * Current status: 'installiert' | 'bereit' (prompt available) | 'manuell' (no prompt).
 * @param {Window|undefined} [w]
 * @returns {'installiert'|'bereit'|'manuell'}
 */
export function installStatus(w = typeof window !== "undefined" ? window : undefined) {
  if (istInstalliert(w)) return "installiert";
  return verzoegertesPrompt ? "bereit" : "manuell";
}

/**
 * Show the browser's install dialog. Resolves to the user's choice, or null
 * when no prompt is available (then the manual hint applies).
 * @returns {Promise<'accepted'|'dismissed'|null>}
 */
export async function appInstallieren() {
  const p = verzoegertesPrompt;
  if (!p) return null;
  p.prompt();
  const wahl = await p.userChoice;
  const ergebnis = wahl?.outcome === "accepted" ? "accepted" : "dismissed";
  if (ergebnis === "accepted") verzoegertesPrompt = null;
  zuhoerer.forEach((f) => f());
  return ergebnis;
}

/**
 * Which manual install hint fits the browser. Pure: decided from the user agent.
 * iOS Safari has no prompt at all; Firefox desktop dropped PWA install; everything
 * Chromium-based gets its own prompt sooner or later, so the address-bar hint is
 * the fallback while the prompt is not (yet) available.
 * @param {string} ua navigator.userAgent
 * @returns {'ios'|'safari'|'firefox'|'chromium'}
 */
export function browserHinweis(ua) {
  const s = String(ua || "");
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Firefox\//i.test(s)) return "firefox";
  if (/Safari\//i.test(s) && !/Chrome\/|Chromium\/|Edg\//i.test(s)) return "safari";
  return "chromium";
}

/** Test seam: forget the deferred prompt (node --test). */
export function _setzeZurueck() {
  verzoegertesPrompt = null;
  zuhoerer.clear();
}
