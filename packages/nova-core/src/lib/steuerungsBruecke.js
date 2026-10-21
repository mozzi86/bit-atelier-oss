// App side of the local agent control (phase 104-04): while a drawing surface with a command register is open, the
// app long-polls the server for agent requests (server/steuerungRouter.js), runs each one through the register
// (befehlsregister.zeileBearbeiten — never throws, never opens a dialog) and posts the answer back.
//
// Several open tabs: each poll carries the time of the tab's last user activity (pointer / key; a focused window
// counts as "now"); the server hands a request to the tab the user works in.
//
// In:  the register, optional base URL / fetch for tests. Out: a stop function (aborts the pending poll).

/**
 * @param {{zeileBearbeiten: (zeile: string) => string}} register
 * @param {{basis?: string, fetchFn?: typeof fetch, pause?: (ms: number) => Promise<void>, aktivSeit?: () => number}} [opt]
 *   aktivSeit: time of the last user activity in ms (default: tracked on window)
 * @returns {() => void} stop
 */
export function starteSteuerungsBruecke(register, { basis = "", fetchFn = (...a) => fetch(...a), pause = (ms) => new Promise((r) => setTimeout(r, ms)), aktivSeit = null } = {}) {
  let aktiv = true;
  let zuletzt = Date.now();
  const merken = () => { zuletzt = Date.now(); };
  const mitFenster = typeof window !== "undefined" && !aktivSeit;
  if (mitFenster) { window.addEventListener("pointerdown", merken, true); window.addEventListener("keydown", merken, true); }
  // the focused window always counts as "now" — the window the user is in gets the agent's commands
  const seit = aktivSeit || (() => (typeof document !== "undefined" && document.hasFocus() ? Date.now() : zuletzt));
  let abbruch = /** @type {AbortController|null} */ (null);
  (async () => {
    while (aktiv) {
      abbruch = new AbortController();
      try {
        const r = await fetchFn(`${basis}/api/steuerung/naechste?aktiv=${seit()}`, { cache: "no-store", signal: abbruch.signal });
        if (!aktiv) break;
        if (r.status === 200) {
          const { nr, zeile } = await r.json();
          const antwort = register.zeileBearbeiten(String(zeile));
          await fetchFn(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort }) });
        } else if (r.status === 403 || r.status === 404) {
          break; // control not available here (LAN device, older server) — stop polling for good
        } else if (r.status !== 204) {
          await pause(5000);
        }
      } catch {
        if (!aktiv) break;
        await pause(3000); // server restarting / offline
      }
    }
  })();
  return () => {
    aktiv = false;
    abbruch?.abort();
    if (mitFenster) { window.removeEventListener("pointerdown", merken, true); window.removeEventListener("keydown", merken, true); }
  };
}
