// 106-05: one recording from the microphone (MediaRecorder, webm/opus) for the speech field. The browser and the permission dialog are
// injected, so the unit test runs with a fake recorder; the real permission prompt cannot be answered headless (the end-to-end test uses
// Chromium's fake audio device instead).
//
// Audio stays in memory: the Blob goes to the harness (POST /stt, faster-whisper on this computer, dropped after the call) and nowhere else.
// A recording shorter than MIN_AUFNAHME_MS is thrown away: a short click would only feed the speech model silence, and a model hears words in silence.
//
// In:  optional {mediaDevices, MediaRecorderKlasse, jetzt} for tests. Out: a handle {stoppen() -> Promise<{blob, dauerMs}|null>, abbrechen()}.

/** Shortest recording that is sent to the speech model, in ms [ASSUMED: below this the button was clicked, not held while speaking]. */
export const MIN_AUFNAHME_MS = 400;

/** Container the harness accepts (harness/voice/stt.py decodes webm/opus and wav). */
const MIME_BEVORZUGT = "audio/webm;codecs=opus";

/**
 * German sentence for a failure of getUserMedia.
 * @param {any} e  The rejection. @returns {string}
 */
export function mikrofonFehlerText(e) {
  const n = String(e?.name || "");
  if (n === "NotAllowedError" || n === "SecurityError") return "Das Mikrofon ist nicht erlaubt — im Browser (Schloss neben der Adresse) das Mikrofon für diese Seite freigeben";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "Kein Mikrofon gefunden — ein Mikrofon anschließen und noch einmal halten";
  if (n === "NotReadableError") return "Das Mikrofon wird von einem anderen Programm benutzt";
  return `Mikrofon nicht verfügbar: ${e?.message || e}`;
}

/**
 * Starts recording. Resolves when the microphone is open and the recorder runs (the permission prompt, if any, has been answered).
 * @param {{mediaDevices?: any, MediaRecorderKlasse?: any, jetzt?: () => number}} [opt]
 * @returns {Promise<{stoppen: () => Promise<{blob: Blob, dauerMs: number}|null>, abbrechen: () => void}>}
 * @throws {Error} A German sentence (no microphone API, permission refused, no device).
 */
export async function aufnahmeStarten(opt = {}) {
  const geraete = opt.mediaDevices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : null);
  const Recorder = opt.MediaRecorderKlasse ?? (typeof window !== "undefined" ? /** @type {any} */ (window).MediaRecorder : null);
  const jetzt = opt.jetzt ?? (() => Date.now());
  if (!geraete?.getUserMedia || !Recorder) throw new Error("Dieser Browser kann nicht aufnehmen (Mikrofon oder MediaRecorder fehlt)");
  /** @type {any} */ let stream;
  try { stream = await geraete.getUserMedia({ audio: true }); } catch (e) { throw new Error(mikrofonFehlerText(e)); }
  const mime = Recorder.isTypeSupported?.(MIME_BEVORZUGT) ? MIME_BEVORZUGT : "audio/webm";
  /** @type {any} */ let rec;
  try { rec = new Recorder(stream, { mimeType: mime }); } catch (e) { stream.getTracks().forEach((/** @type {any} */ t) => t.stop()); throw new Error(mikrofonFehlerText(e)); }
  /** @type {Blob[]} */ const stuecke = [];
  rec.ondataavailable = (/** @type {any} */ ev) => { if (ev.data?.size) stuecke.push(ev.data); };
  const start = jetzt();
  rec.start();
  const freigeben = () => stream.getTracks().forEach((/** @type {any} */ t) => t.stop());
  let fertig = false;
  return {
    stoppen: () => new Promise((resolve) => {
      if (fertig) { resolve(null); return; }
      fertig = true;
      rec.onstop = () => {
        freigeben();
        const dauerMs = jetzt() - start;
        resolve(dauerMs < MIN_AUFNAHME_MS || !stuecke.length ? null : { blob: new Blob(stuecke, { type: rec.mimeType || mime }), dauerMs });
      };
      try { rec.stop(); } catch { freigeben(); resolve(null); }
    }),
    abbrechen: () => {
      if (fertig) return;
      fertig = true;
      rec.onstop = () => freigeben();
      try { rec.stop(); } catch { freigeben(); }
    },
  };
}
