// Client side of the API session header (plan 96-04, server/sitzungsSchutz.js).
// Every WRITE to the app's own API (POST/PUT/PATCH/DELETE under /api) carries
// X-Bit-Session with the token of the running server. Installed once around
// window.fetch so that every caller — bitApi, the settings cards, the update
// dialog, the office-mode screens — sends it without each of them knowing.
// Reads pass through untouched.
//
// The token is fetched once at install time (and again on demand) and kept; a 401 that asks for
// renewal (server restarted, e.g. after an update) fetches it again and repeats
// the request once. If the token cannot be fetched at all, the request goes out
// without it and the server's plain-text 401 reaches the caller (never swallowed).
//
// In:  the window (injectable for tests), the API base URL. Out: installiereSitzungsKopf().

/** Methods that never change data. */
const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Wraps window.fetch so that writes to the app's API carry the session header.
 * Idempotent (a second call does nothing).
 * @param {{fenster?: any, apiBasis?: string}} [optionen] fenster: window-like object with fetch and
 *   location; apiBasis: base URL of the API (default "/api", may be absolute)
 * @returns {void}
 */
export function installiereSitzungsKopf({ fenster = globalThis.window, apiBasis = "/api" } = {}) {
  if (!fenster?.fetch || fenster.__bitSitzungsKopf) return;
  const original = fenster.fetch.bind(fenster);
  const basis = new URL(apiBasis.replace(/\/+$/, "") + "/", fenster.location.href);
  /** @type {Promise<string>|null} */
  let tokenZusage = null;

  const holeToken = () => {
    tokenZusage ??= original(new URL("sitzung", basis).href, { cache: "no-store" })
      .then(async (/** @type {Response} */ r) => {
        if (!r.ok) throw new Error(`Sitzung nicht abrufbar (HTTP ${r.status})`);
        const j = await r.json();
        return String(j?.token || "");
      })
      .catch((/** @type {any} */ e) => {
        tokenZusage = null;
        console.error(`[Sitzung] ${e?.message || e}`);
        return "";
      });
    return tokenZusage;
  };

  /** @param {RequestInfo|URL} eingabe @param {RequestInit} [init] */
  const gewickelt = async (eingabe, init = {}) => {
    const RequestKlasse = globalThis.Request;
    const anfrage = RequestKlasse && eingabe instanceof RequestKlasse ? /** @type {Request} */ (eingabe) : null;
    const methode = String(init.method || anfrage?.method || "GET").toUpperCase();
    let url;
    try {
      url = new URL(anfrage ? anfrage.url : String(eingabe), fenster.location.href);
    } catch {
      return original(eingabe, init);
    }
    const istApi = url.origin === basis.origin && url.pathname.startsWith(basis.pathname);
    if (!istApi || LESEND.has(methode)) return original(eingabe, init);

    const senden = (/** @type {string} */ token) => {
      const kopf = new globalThis.Headers(init.headers || anfrage?.headers || undefined);
      if (token) kopf.set("X-Bit-Session", token);
      return original(eingabe, { ...init, headers: kopf });
    };
    const antwort = await senden(await holeToken());
    if (antwort.status !== 401 || !antwort.headers.get("X-Bit-Sitzung-Erneuern")) return antwort;
    tokenZusage = null;
    const neu = await holeToken();
    return neu ? senden(neu) : antwort;
  };

  fenster.fetch = gewickelt;
  fenster.__bitSitzungsKopf = true;
  // Fetch the token right away so the first write does not wait for an extra round trip.
  holeToken();
}
