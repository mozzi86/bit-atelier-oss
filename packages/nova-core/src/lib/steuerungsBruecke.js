// App side of the local agent control (phase 104-04): while a drawing surface with a command register is open, the
// app long-polls the server for agent requests (server/steuerungRouter.js), runs each one through the register
// (befehlsregister.zeileBearbeiten — never throws, never opens a dialog) and posts the answer back.
//
// Several open tabs: each poll carries how long ago the tab's last user activity was (`alter`, ms; pointer / key; a focused window
// counts as "now"); the server turns that into its own time (review fix 106-07: clocks of different devices are never compared) and
// hands a request to the tab the user works in. A 204 with the header x-bit-steuerung-voll (too many waiting tabs) pauses before
// the next poll instead of asking again at once.
//
// In:  the register, optional base URL / fetch for tests. Out: a stop function (aborts the pending poll).

/** Pause after "list of waiting tabs full" in ms [ASSUMED: a few seconds; a free place appears when another tab's poll ends (10 s at most)]. */
export const VOLL_PAUSE_MS = 3000;

/**
 * @param {{zeileBearbeiten: (zeile: string, ctx?: any) => string}} register
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
        const alter = Math.max(0, Date.now() - seit());
        const r = await fetchFn(`${basis}/api/steuerung/naechste?alter=${alter}`, { cache: "no-store", signal: abbruch.signal });
        if (!aktiv) break;
        if (r.status === 200) {
          /** @type {{nr: any, zeile: any}} */
          let auftrag;
          // a static host (SPA fallback) answers every path with 200 and index.html: not JSON means there is
          // no control channel here, stop for good instead of asking again every 3 seconds
          try { auftrag = await r.json(); } catch { break; }
          const { nr, zeile } = auftrag;
          // ctx marks the caller: a request from the control channel is an agent (106-03: it cannot confirm or undo a change)
          const antwort = register.zeileBearbeiten(String(zeile), { kanal: "steuerung" });
          const gesendet = await fetchFn(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort }) });
          if (gesendet && gesendet.ok === false) {
            // the server refused the answer (e.g. 413 too large): say so in a small answer, else the agent waits 10 s for "may-have-run"
            // although the command has run - and it must know the state is unchanged for a read
            let id = null;
            try { id = JSON.parse(antwort)?.id ?? null; } catch { /* keep null */ }
            const klein = JSON.stringify({ id, ok: false, error: `Die Antwort der App wurde vom Server abgelehnt (HTTP ${gesendet.status}) — vermutlich zu groß; bei einem Bild eine kleinere breite wählen. Der Befehl selbst ist gelaufen.` });
            await fetchFn(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: klein }) });
          }
        } else if (r.status === 403 || r.status === 404) {
          break; // control not available here (LAN device, older server) — stop polling for good
        } else if (r.status !== 204) {
          await pause(5000);
        } else if (r.headers?.get?.("x-bit-steuerung-voll")) {
          await pause(VOLL_PAUSE_MS); // the server's list of waiting tabs is full: an immediate retry would only spin
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
