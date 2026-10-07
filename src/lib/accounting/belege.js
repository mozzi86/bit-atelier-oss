// Receipt validation and record shape (phase 79, plan 79-04 T3): a file picked
// for an incoming invoice, insurance policy or fixed asset is checked against
// the office's size and MIME whitelist BEFORE it becomes a Beleg record.
//
// Storage note: the demo/local/Express paths of this app have no blob store
// (bitApi.js:128-137), so a Beleg keeps its file as a data URL like every other
// imported document (packages/nova-core/src/lib/pdf.js fileToDataUrl). The
// 5 MB default limit (BUERO_STANDARD.beleg_max_bytes) exists because that data
// URL round-trips through IndexedDB's snapshot ring and the Express JSON file —
// not a legal limit, a technical one (79-RESEARCH risk 4).
//
// In:  a file-like descriptor {name, size, type}, the effective settings
//      (beleg_max_bytes, beleg_mime), a data URL and the record a receipt
//      belongs to. Out: {ok, fehler} or a plain Beleg record; no side effects.

/** File extensions accepted for each whitelisted MIME type (renamed-file guard). */
const ENDUNG_JE_MIME = Object.freeze({
  "application/pdf": Object.freeze(["pdf"]),
  "image/jpeg": Object.freeze(["jpg", "jpeg"]),
  "image/png": Object.freeze(["png"]),
  // XRechnung/ZUGFeRD embed their structured invoice as XML alongside the PDF.
  "application/xml": Object.freeze(["xml"]),
  "text/xml": Object.freeze(["xml"]),
});

/**
 * Byte limit as a whole-megabyte text ("5 MB"), falling back to one decimal
 * only when the limit is not a whole number of megabytes.
 * @param {number} bytes
 * @returns {string}
 */
function mbText(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/**
 * Validates a file before it becomes a Beleg: size against `beleg_max_bytes`,
 * MIME against the `beleg_mime` whitelist (PDF/JPG/PNG/XML for XRechnung and
 * ZUGFeRD), and the file extension against the MIME type — a renamed `.exe`
 * with a faked `type` is still refused.
 * @param {{name?: string, size?: number, type?: string}} datei file or File
 * @param {{beleg_max_bytes: number, beleg_mime: string[]}} einst effective settings (wirksameEinstellungen)
 * @returns {{ok: boolean, fehler: string}} fehler: German plain-text message, empty when ok
 */
export function pruefeBeleg(datei, einst) {
  const groesse = Number(datei?.size);
  const mime = String(datei?.type || "");
  const name = String(datei?.name || "");
  const punkt = name.lastIndexOf(".");
  const endung = punkt >= 0 ? name.slice(punkt + 1).toLowerCase() : "";

  if (!Number.isFinite(groesse) || groesse <= 0) return { ok: false, fehler: "Datei ist leer oder unlesbar" };
  if (groesse > einst.beleg_max_bytes) return { ok: false, fehler: `Datei zu groß (max. ${mbText(einst.beleg_max_bytes)})` };
  if (!Array.isArray(einst.beleg_mime) || !einst.beleg_mime.includes(mime)) return { ok: false, fehler: "Dateityp nicht erlaubt" };
  const erlaubteEndungen = ENDUNG_JE_MIME[mime] || [];
  if (erlaubteEndungen.length && !erlaubteEndungen.includes(endung)) return { ok: false, fehler: "Dateityp nicht erlaubt" };
  return { ok: true, fehler: "" };
}

/**
 * Beleg record from a validated file, its data URL and the record it belongs to.
 * @param {{name: string, size: number, type: string}} datei
 * @param {string} dataUrl data URL (packages/nova-core/src/lib/pdf.js fileToDataUrl)
 * @param {{typ: string, id: string}} bezug the owning record, e.g. {typ: "Eingangsrechnung", id}
 * @returns {Omit<import("./datenmodell.js").Beleg, "id">} without `id` — speicher.speichere assigns one on save
 */
export function belegDatensatz(datei, dataUrl, bezug) {
  return { name: datei.name, mime: datei.type, groesse: datei.size, data: dataUrl, bezug };
}

/**
 * Sets (or clears) the receipt reference of a record that carries `beleg_id`.
 * Does not mutate the input.
 * @param {Record<string, any>} eingangsrechnung any record with a `beleg_id` field
 * @param {string|null} belegId
 * @returns {Record<string, any>} a new object
 */
export function belegVerweisSetzen(eingangsrechnung, belegId) {
  return { ...eingangsrechnung, beleg_id: belegId || undefined };
}
