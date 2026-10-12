// Storage rule of the platform (user 11.10.2026): payloads LARGER than 1 MB go to object storage (blob store /
// Supabase bucket), payloads SMALLER than 256 KB go into the database (entity or Fachlayer field), anything in
// between is decided by context. ONE place for the thresholds — features ask here instead of carrying their
// own numbers.
//
// The grey zone is decided by a deterministic classifier (speicherKlassifizieren): fixed criteria (grows with
// the project? loaded in lists? a medium? always read with its record?) answered by a profile per kind of
// content (SPEICHER_PROFILE) — same payload, same place, no network.
//
// In:  a value (string, object, Uint8Array) or a byte count. Out: "db" | "blob" + the measured size.

/** Upper bound for the database, bytes (256 KB). */
export const DB_MAX_BYTES = 256 * 1024;
/** Lower bound for mandatory object storage, bytes (1 MB). */
export const BLOB_MIN_BYTES = 1024 * 1024;

/**
 * Size of a value as it would be stored, in bytes (UTF-8 of the JSON / string; raw length of binary).
 * @param {unknown} wert
 * @returns {number} bytes
 */
export function bytesVon(wert) {
  if (wert == null) return 0;
  if (typeof wert === "number") return Math.max(0, wert);
  if (wert instanceof Uint8Array) return wert.length;
  const text = typeof wert === "string" ? wert : JSON.stringify(wert);
  return new TextEncoder().encode(text).length;
}

/**
 * The criteria (options) of the grey-zone classifier, in the order they are asked. Each yes/no answer has a
 * fixed vote; the first decisive criterion wins and its reason is returned. Deterministic on purpose (user
 * 11.10.2026 suggested a classifier for the in-between zone): the same payload always lands in the same
 * place, no network, no model.
 */
export const KRITERIEN = Object.freeze([
  { key: "waechst", frage: "Wächst der Inhalt mit dem Projekt (Bauteile, Befunde, Prüfläufe)?", ja: "blob", grund: "wächst mit dem Projekt" },
  { key: "inListen", frage: "Wird der Datensatz in Listen/Übersichten mitgeladen?", ja: "blob", grund: "würde jede Liste mit dem Inhalt belasten" },
  { key: "medium", frage: "Ist es ein Medium (Foto, PDF, Scan), das man erst beim Öffnen braucht?", ja: "blob", grund: "Medium, wird erst beim Öffnen geladen" },
  { key: "mitDatensatz", frage: "Wird der Inhalt immer zusammen mit dem Datensatz gebraucht (Vorschau, Einstellungen)?", ja: "db", grund: "wird immer mit dem Datensatz gelesen" },
]);

/** Fixed profile per kind of content — answers to KRITERIEN [ASSUMED from how the app reads each kind]. */
export const SPEICHER_PROFILE = Object.freeze({
  dokument: { medium: true, inListen: true },
  beleg: { medium: true, inListen: true },
  foto: { medium: true },
  vorschau: { mitDatensatz: true },
  bauteile: { waechst: true },
  befunde: { waechst: true },
  prueflauf: { waechst: true, inListen: true },
  einstellungen: { mitDatensatz: true },
});

/**
 * Classifier for the grey zone (256 KB … 1 MB). Outside it the hard limits decide.
 * @param {number} bytes
 * @param {{art?: string, waechst?: boolean, inListen?: boolean, medium?: boolean, mitDatensatz?: boolean}} [kontext]
 *   art = key of SPEICHER_PROFILE; explicit criteria override the profile
 * @returns {{ort: "db"|"blob", grund: string}}
 */
export function speicherKlassifizieren(bytes, kontext = {}) {
  if (bytes < DB_MAX_BYTES) return { ort: "db", grund: "kleiner als 256 KB" };
  if (bytes > BLOB_MIN_BYTES) return { ort: "blob", grund: "größer als 1 MB" };
  const antworten = { ...(SPEICHER_PROFILE[kontext.art] || {}), ...Object.fromEntries(Object.entries(kontext).filter(([k]) => k !== "art")) };
  for (const k of KRITERIEN) if (antworten[k.key] === true) return { ort: /** @type {"db"|"blob"} */ (k.ja), grund: k.grund };
  return { ort: "db", grund: "kein Kriterium spricht für den Objektspeicher" };
}

/**
 * Where does a payload belong?
 * @param {unknown} wert value or byte count
 * @param {{art?: string, waechst?: boolean, inListen?: boolean, medium?: boolean, mitDatensatz?: boolean}} [kontext]
 *   kind of content and/or criteria for the grey zone (speicherKlassifizieren)
 * @returns {{ort: "db"|"blob", bytes: number, grund: string}}
 */
export function speicherOrt(wert, kontext = {}) {
  const bytes = bytesVon(wert);
  return { ...speicherKlassifizieren(bytes, kontext), bytes };
}

/** New blob id with a readable prefix (letters, digits, dash — the blob store's alphabet). */
export function blobIdNeu(praefix) {
  return `${String(praefix || "inhalt").replace(/[^A-Za-z0-9_-]/g, "-")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const mb = (b) => `${(b / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

/**
 * Store a payload where the rule says: returns what the record keeps (`inline` for the database field,
 * `blob` = blob id). Without an object store (browser build: bitApi.blobs throws) the payload stays in
 * the database and `hinweis` says so in plain text — the caller shows it; nothing is lost silently.
 * @param {unknown} inhalt payload (data URL, array, object)
 * @param {{blobId: string, art?: string, waechst?: boolean, inListen?: boolean, medium?: boolean, mitDatensatz?: boolean, api?: {blobs: {put: (id: string, json: any) => Promise<any>}}}} o
 *   art / criteria: context for the grey-zone classifier
 * @returns {Promise<{inline: any, blob: string|null, ort: "db"|"blob", bytes: number, grund: string, hinweis: string|null}>}
 */
export async function inhaltAblegen(inhalt, { blobId, api, ...kontext } = /** @type {any} */ ({})) {
  const { ort, bytes, grund } = speicherOrt(inhalt, kontext);
  if (ort === "db") return { inline: inhalt, blob: null, ort, bytes, grund, hinweis: null };
  const bit = api || (await import("@core/api/bitApi")).bitApi;
  try {
    await bit.blobs.put(blobId, { inhalt });
    return { inline: null, blob: blobId, ort: "blob", bytes, grund, hinweis: null };
  } catch (e) {
    return {
      inline: inhalt, blob: null, ort: "db", bytes, grund,
      hinweis: `${mb(bytes)} liegen in der Datenbank, weil hier kein Objektspeicher verfügbar ist (${e?.message || e}).`,
    };
  }
}

/**
 * Read a payload stored by inhaltAblegen.
 * @param {any} inline database field value
 * @param {string|null|undefined} blobId blob id
 * @param {{api?: {blobs: {get: (id: string) => Promise<any>}}}} [o]
 * @returns {Promise<any>} the payload or null
 */
export async function inhaltLaden(inline, blobId, { api } = {}) {
  if (inline != null) return inline;
  if (!blobId) return null;
  const bit = api || (await import("@core/api/bitApi")).bitApi;
  const b = await bit.blobs.get(blobId);
  return b?.inhalt ?? null;
}
