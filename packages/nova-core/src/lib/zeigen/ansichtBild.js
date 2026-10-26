// 106-04: the current 3D view as ONE PNG for a model (MCP tool ansicht_bild, register command ansicht-bild).
// Ground truth stays the GUID from the ray - an image is only what the person sees right now, so an agent can
// describe it or check a change; it never selects anything by pixels (guard rail 3 of the phase).
//
// The renderer is read synchronously: the WebGL buffer is only valid right after render() (no preserveDrawingBuffer),
// so the frame is drawn into a small 2D canvas in the same task, which is also the downscale. The register answers
// synchronously (befehlsregister.js), a Promise would be sent as {} - hence no Image.onload and no download.
//
// In:  three {renderer, scene, camera} of the viewer, optional width in px. Out: {png_base64, breite, hoehe, format}.

/** Default image width in px when the caller gives none. */
export const BILD_BREITE_STANDARD = 800;
/** Upper bound of the image width in px: a 1600 px PNG of a model view stays far below the 4 MB answer limit of the control channel. */
export const BILD_BREITE_MAX = 1600;
/** Smallest useful width in px (a thumbnail says nothing about a building); smaller requests are raised to it. */
export const BILD_BREITE_MIN = 64;

/**
 * Width from a command parameter: empty = default, too large = the maximum (said in the answer by `breite`).
 * @param {any} v  Number or numeric text, px.
 * @returns {number}  Integer px between BILD_BREITE_MIN and BILD_BREITE_MAX.
 * @throws {Error} German text when it is not a number.
 */
export function bildBreite(v) {
  if (v == null || v === "") return BILD_BREITE_STANDARD;
  const n = Math.round(Number(String(v).replace(",", ".")));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`breite: eine Zahl in Pixel erwartet (${BILD_BREITE_MIN} bis ${BILD_BREITE_MAX}, Standard ${BILD_BREITE_STANDARD})`);
  return Math.min(BILD_BREITE_MAX, Math.max(BILD_BREITE_MIN, n));
}

/** @param {number} w @param {number} h @returns {HTMLCanvasElement} */
const browserCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

/**
 * Renders one frame and returns it as a PNG, downscaled to the wanted width (never enlarged).
 * @param {{renderer?: any, scene?: any, camera?: any}|null|undefined} three  The viewer's three.js handles.
 * @param {{breite?: any, kante?: number, erzeugeCanvas?: (w: number, h: number) => any}} [opt]
 *   breite: px (default 800, max 1600); kante (106-06): longest edge in px - a tall window is scaled so that its HEIGHT stays within it too
 *   (the image for a model, bildKontext.BILD_KANTE_MAX); erzeugeCanvas: canvas factory (tests; default document.createElement).
 * @returns {{png_base64: string, breite: number, hoehe: number, format: "image/png"}}  png_base64 without the data: prefix.
 * @throws {Error} German text: no 3D view ready, no size, canvas without PNG.
 */
export function ansichtAlsPng(three, { breite, kante, erzeugeCanvas = browserCanvas } = {}) {
  const t = three || {};
  if (!t.renderer || !t.scene || !t.camera) throw new Error("Keine 3D-Ansicht bereit — erst ein Modell öffnen");
  const wunsch = bildBreite(breite);
  const quelle = t.renderer.domElement;
  const qb = Number(quelle?.width), qh = Number(quelle?.height);
  if (!(qb > 0 && qh > 0)) throw new Error("Die 3D-Ansicht hat keine Größe — ist sie sichtbar?");
  let ziel = Math.min(wunsch, qb); // a small window is not enlarged: the answer states the real width
  if (Number(kante) > 0) ziel = Math.max(1, Math.min(ziel, Math.floor((Number(kante) * qb) / Math.max(qb, qh))));
  const hoehe = Math.max(1, Math.round((qh * ziel) / qb));
  t.renderer.render(t.scene, t.camera); // the buffer is valid only now, until the frame is composited
  const c = erzeugeCanvas(ziel, hoehe);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Bild nicht möglich: kein 2D-Zeichenfeld");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(quelle, 0, 0, qb, qh, 0, 0, ziel, hoehe);
  const url = String(c.toDataURL("image/png"));
  const marke = "data:image/png;base64,";
  if (!url.startsWith(marke) || url.length <= marke.length) throw new Error("Bild nicht möglich: das Zeichenfeld lieferte kein PNG");
  return { png_base64: url.slice(marke.length), breite: ziel, hoehe, format: "image/png" };
}
