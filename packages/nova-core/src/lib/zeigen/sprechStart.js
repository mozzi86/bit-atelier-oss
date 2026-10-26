// 106-05 review: press-and-hold for the speech field without React - at most ONE recording at a time.
// A quick double tap used to start two recordings: the first start was still waiting for the microphone when the second began, the first
// handle was overwritten and its microphone stayed open until the page was left. Here a press while a start is still on its way does not
// start a second one: it only says "the button is held again", and the start already under way goes on (one stream, stopped by the next release).
//
// Review 106-07: a recording never runs longer than `hoechstMs` (MAX_AUFNAHME_MS): if the release is lost (the button was rebuilt under the
// finger, the pointer capture went with it, the page lost the pointer), the microphone does not stay open - `beiHoechst()` is called, and
// the field ends the recording as if the button had been let go.
//
// In:  vorbereiten() - may this press record? (false: the caller has said why), aufnehmen() - opens the microphone (aufnahme.js handle),
//      beiAufnahme() - called once the recording runs, beiHoechst() - the maximum time is over. Out: {starten, stoppen, abbrechen, offen, startLaeuft}.

/**
 * @typedef {{stoppen: () => Promise<{blob: Blob, dauerMs: number}|null>, abbrechen: () => void}} AufnahmeHandle  Handle of aufnahme.js.
 */

/** Longest recording in ms [ASSUMED: 30 s - a spoken command is one sentence of a few seconds; longer means the release got lost]. */
export const MAX_AUFNAHME_MS = 30_000;

/**
 * Push-to-talk control: one recording at a time, a release before the microphone is open cancels it.
 * @param {{vorbereiten: () => Promise<boolean>|boolean, aufnehmen: () => Promise<AufnahmeHandle>, beiAufnahme?: () => void,
 *   beiFehler?: (e: any) => void, beiHoechst?: () => void, hoechstMs?: number}} opt
 *   vorbereiten: readiness for this press (false = do not record); aufnehmen: opens the microphone; beiAufnahme: the recording runs;
 *   beiFehler: aufnehmen() failed (a German sentence in e.message); hoechstMs: longest recording in ms (default MAX_AUFNAHME_MS);
 *   beiHoechst: called once when that time is over and the recording still runs (the caller stops it; without it the recording is dropped).
 * @returns {{starten: () => Promise<void>, stoppen: () => Promise<{blob: Blob, dauerMs: number}|null>|null, verwerfen: () => void, abbrechen: () => void,
 *   offen: () => boolean, startLaeuft: () => boolean}}
 *   starten: press (a second press during a start joins it); stoppen: release - null when no recording is open (nothing to send), else the
 *   recording (null inside the promise = too short); verwerfen: drops the current recording/start, later presses work; abbrechen: drops
 *   everything for good (unmount); offen: a recording runs; startLaeuft: a start is on its way.
 */
export function sprechSteuerung({ vorbereiten, aufnehmen, beiAufnahme, beiFehler, beiHoechst, hoechstMs = MAX_AUFNAHME_MS }) {
  /** @type {AufnahmeHandle|null} */ let aufnahme = null;
  /** @type {Promise<void>|null} */ let start = null;
  let gehalten = false;
  let beendet = false;
  /** @type {any} */ let uhr = null;
  const uhrAus = () => { clearTimeout(uhr); uhr = null; };

  const starten = () => {
    gehalten = true;
    if (beendet) return Promise.resolve();
    if (aufnahme) return Promise.resolve();
    if (start) return start; // the start under way takes this press: never a second stream
    start = (async () => {
      try {
        if (!(await vorbereiten())) { gehalten = false; return; }
        if (!gehalten || beendet) return; // let go before anything was opened
        /** @type {AufnahmeHandle} */ let a;
        try { a = await aufnehmen(); } catch (e) { gehalten = false; beiFehler?.(e); return; }
        if (!gehalten || beendet || aufnahme) { a.abbrechen(); return; } // let go while the microphone opened
        aufnahme = a;
        uhrAus();
        uhr = setTimeout(() => {
          uhr = null;
          if (aufnahme !== a) return;
          if (beiHoechst) beiHoechst(); else verwerfen();
        }, hoechstMs);
        beiAufnahme?.();
      } finally {
        start = null;
      }
    })();
    return start;
  };

  const stoppen = () => {
    gehalten = false;
    uhrAus();
    const a = aufnahme;
    if (!a) return null;
    aufnahme = null;
    return a.stoppen();
  };

  const verwerfen = () => {
    gehalten = false;
    uhrAus();
    const a = aufnahme;
    aufnahme = null;
    a?.abbrechen();
  };

  const abbrechen = () => {
    beendet = true;
    verwerfen();
  };

  return { starten, stoppen, verwerfen, abbrechen, offen: () => !!aufnahme, startLaeuft: () => !!start };
}
