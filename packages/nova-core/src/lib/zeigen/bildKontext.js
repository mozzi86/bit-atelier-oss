// 106-06: an image of the view as CONTEXT for a model - the rules in one place, for every road an image can take:
//   - the app server (llm.js invokeLLM with `bilder`),
//   - the AI harness (WebSocket message with `bilder`, asked through GET /api/llm/bild-freigabe),
//   - the app's MCP server (tool ansicht_bild, same route),
//   - the speech field of the viewers (button "mit Bild").
// Decision D-IM-02 (24.10.): images may go to a model outside this computer BY DEFAULT, but
//   (a) before the first image of a project leaves the computer, a person confirms once for that project (stored on the project:
//       Project.bild_freigabe), with the note that the image leaves the device;
//   (b) a project with the NDA marker (Project.nda) never sends an image - only text and element GUIDs. [ASSUMED] This holds for EVERY
//       target, also a model on this computer: the marker says "never images", and a rule with an exception per target is one that leaks.
// Plus the office switches: "Nur lokale KI" (93-12) blocks every image to a target outside this computer, and the office setting
// `bilder_extern` (KiEinstellung, default true = D-IM-02) can forbid images to such targets for the whole office.
// The image never decides WHICH element is meant (guard rail 3): ground truth stays the GUID of the selection; D-IM-04 stays - an image only
// gives context, every change still needs a human confirmation.
//
// Pure: no network, no DOM. In: base64 PNGs, the project's markers, the switches. Out: checked image lists, a decision {ok, grund, text}.

/** Longest edge of an image sent to a model, px. Plan 106-06 Task 1 ("z. B. 1280 px Kante"); the viewer renders at most this width for a model. */
export const BILD_KANTE_MAX = 1280;

/** Largest decoded PNG, bytes [ASSUMED: a 1280 px PNG of a model view is ~0.3-1.5 MB; 3 MB leaves room and stays far below provider limits (5 MB per image at the strictest)]. */
export const BILD_BYTES_MAX = 3 * 1024 * 1024;

/** Most images in one request [ASSUMED: one view plus at most one detail; more is not what a spoken command needs and multiplies what leaves the device]. */
export const BILD_ANZAHL_MAX = 2;

/** Start of every base64-encoded PNG (the 8-byte PNG signature 89 50 4E 47 0D 0A 1A 0A encodes to this prefix). */
export const PNG_BASE64_KOPF = "iVBORw0KGgo";

/**
 * The German sentences of the decision, per reason. Keys of the i18n dictionary (i18nTeile/zeigen-106.js); {ziel} is filled afterwards.
 * @type {Readonly<Record<"nda"|"nur-lokal"|"buero"|"zustimmung"|"ohne-projekt"|"vision", string>>}
 */
export const BILD_GRUENDE = Object.freeze({
  "nda": "NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell — nur Text und Bauteil-Kennungen",
  "nur-lokal": "Nur lokale KI ist eingeschaltet (Einstellungen › KI): ein Bild geht nur an ein Modell auf diesem Rechner",
  "buero": "Bilder an KI außerhalb dieses Rechners sind in den Einstellungen des Büros ausgeschaltet (Einstellungen › KI)",
  "zustimmung": "Das Bild der Ansicht verlässt diesen Rechner ({ziel}) — dafür braucht es einmal je Projekt Ihre Zustimmung",
  "ohne-projekt": "Ohne geöffnetes Projekt geht kein Bild an ein Sprachmodell (NDA-Merker und Zustimmung hängen am Projekt)",
  "vision": "Dieses Modell versteht laut Katalog keine Bilder — nichts wurde gesendet. Ohne Bild senden oder ein Bildmodell wählen (Einstellungen › KI)",
});

/** @param {string} s @returns {Uint8Array} bytes of a base64 text (atob exists in browsers and in Node >= 16) */
function b64Bytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decoded size of a base64 text in bytes, without decoding it.
 * @param {string} b64  base64 without data: prefix. @returns {number} bytes
 */
export function base64Bytes(b64) {
  const s = String(b64 ?? "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

/**
 * Width and height of a PNG from its IHDR chunk (bytes 16-23, big-endian), read from the first 32 base64 characters.
 * @param {string} b64  base64 PNG without data: prefix.
 * @returns {{breite: number, hoehe: number}|null}  px; null when it is not a PNG or the header is broken.
 */
export function pngMasse(b64) {
  const s = String(b64 ?? "");
  if (!s.startsWith(PNG_BASE64_KOPF) || s.length < 32) return null;
  let b;
  try { b = b64Bytes(s.slice(0, 32)); } catch { return null; }
  // bytes 12-15 must spell "IHDR": the first chunk of every valid PNG
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
  const zahl = (/** @type {number} */ i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const breite = zahl(16), hoehe = zahl(20);
  return breite > 0 && hoehe > 0 ? { breite, hoehe } : null;
}

/**
 * Checks the images of a request: a list of at most BILD_ANZAHL_MAX PNGs, each at most BILD_KANTE_MAX px per edge and BILD_BYTES_MAX bytes.
 * Nothing is scaled here (that happens where the image is made, ansichtAlsPng); too large is refused in words, never silently cut.
 * @param {unknown} roh  `bilder` of a request: [{png_base64}] (a data: prefix is tolerated and removed).
 * @returns {Array<{png_base64: string, breite: number, hoehe: number}>}  [] for no images.
 * @throws {Error & {status: number}} 400 with a German sentence.
 */
export function bilderPruefen(roh) {
  if (roh == null) return [];
  const fehler = (/** @type {string} */ t) => Object.assign(new Error(t), { status: 400 });
  if (!Array.isArray(roh)) throw fehler("bilder: eine Liste [{png_base64}] erwartet");
  if (roh.length > BILD_ANZAHL_MAX) throw fehler(`Höchstens ${BILD_ANZAHL_MAX} Bilder je Anfrage`);
  return roh.map((b, i) => {
    const wo = `Bild ${i + 1}`;
    let s = typeof b?.png_base64 === "string" ? b.png_base64.trim() : "";
    if (s.startsWith("data:image/png;base64,")) s = s.slice("data:image/png;base64,".length);
    if (!s) throw fehler(`${wo}: png_base64 fehlt`);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw fehler(`${wo}: kein base64`);
    const masse = pngMasse(s);
    if (!masse) throw fehler(`${wo}: kein PNG`);
    if (masse.breite > BILD_KANTE_MAX || masse.hoehe > BILD_KANTE_MAX) {
      throw fehler(`${wo}: ${masse.breite} × ${masse.hoehe} px — höchstens ${BILD_KANTE_MAX} px Kante (kleiner aufnehmen)`);
    }
    if (base64Bytes(s) > BILD_BYTES_MAX) throw fehler(`${wo}: größer als ${Math.round(BILD_BYTES_MAX / 1024 / 1024)} MB`);
    return { png_base64: s, ...masse };
  });
}

/**
 * Templates of the target in words (i18n keys, English in i18nTeile/zeigen-106.js); {anbieter}, {wer}, {host} are filled after t().
 * @type {Readonly<Record<"anbieter"|"modell"|"lokal"|"extern"|"externHost", string>>}
 */
export const BILD_ZIEL_VORLAGEN = Object.freeze({
  anbieter: "an „{anbieter}“",
  modell: "an das Modell",
  lokal: "{wer} — auf diesem Rechner",
  extern: "{wer} — außerhalb dieses Rechners",
  externHost: "{wer} — außerhalb dieses Rechners ({host})",
});

/**
 * Where an image would go, in words for the button and the consent question.
 * @param {{lokal: boolean, anbieter?: string|null, host?: string|null}} z  lokal: the target is on this computer; anbieter: profile/provider name;
 *   host: host name of the target (null when unknown).
 * @param {(s: string) => string} [t]  translator of the templates (default German; the server and the harness texts stay German)
 * @returns {string}  e.g. "an „cloud“ — außerhalb dieses Rechners (api.example.com)".
 */
export function bildZielText(z, t = (s) => s) {
  const V = BILD_ZIEL_VORLAGEN;
  const fuellen = (/** @type {string} */ vorlage, /** @type {Record<string, string>} */ werte) =>
    t(vorlage).replace(/\{(\w+)\}/g, (m, k) => (k in werte ? werte[k] : m));
  const wer = z?.anbieter ? fuellen(V.anbieter, { anbieter: String(z.anbieter) }) : t(V.modell);
  if (z?.lokal) return fuellen(V.lokal, { wer });
  return z?.host ? fuellen(V.externHost, { wer, host: String(z.host) }) : fuellen(V.extern, { wer });
}

/**
 * The decision whether an image may go to a target, in the fixed order of D-IM-02:
 * no project -> refused; NDA -> refused (every target); target outside: "Nur lokale KI" -> refused, office switch off -> refused,
 * no consent for the project -> ask (grund "zustimmung"). A target on this computer needs no consent (nothing leaves the device).
 * The model's ability to read images is a separate check (modellKatalog.bildFaehig): it says nothing about privacy.
 * @param {{projekt: {nda?: boolean, bild_freigabe?: any}|null|undefined, zielLokal: boolean, nurLokal?: boolean, bilderExtern?: boolean, ziel?: string}} o
 *   projekt: the project record (null = none open); zielLokal: the model runs on this computer; nurLokal: the switch "Nur lokale KI";
 *   bilderExtern: office setting (default true, D-IM-02); ziel: words for the target (bildZielText), used in the consent sentence.
 * @returns {{ok: boolean, grund: null|"nda"|"nur-lokal"|"buero"|"zustimmung"|"ohne-projekt", text: string}}
 */
export function bildFreigabe(o) {
  const nein = (/** @type {"nda"|"nur-lokal"|"buero"|"zustimmung"|"ohne-projekt"} */ grund) =>
    ({ ok: false, grund, text: BILD_GRUENDE[grund].replace("{ziel}", o.ziel || "außerhalb dieses Rechners") });
  if (!o?.projekt) return nein("ohne-projekt");
  if (o.projekt.nda === true) return nein("nda");
  if (!o.zielLokal) {
    if (o.nurLokal) return nein("nur-lokal");
    if (o.bilderExtern === false) return nein("buero");
    if (!zugestimmt(o.projekt)) return nein("zustimmung");
  }
  return { ok: true, grund: null, text: "" };
}

/**
 * Whether the project carries a consent for images leaving the device (Project.bild_freigabe = {am: ISO date, durch?: text}).
 * @param {{bild_freigabe?: any}|null|undefined} projekt @returns {boolean}
 */
export function zugestimmt(projekt) {
  const f = projekt?.bild_freigabe;
  return !!f && typeof f === "object" && typeof f.am === "string" && f.am.length > 0;
}
