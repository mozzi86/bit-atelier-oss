// befundPaket.js — the findings package as ONE ZIP download (Phase 69-14).
//
// Why: a check run used to end in two separate downloads (PDF, BCF) and a
// mail carrying numbers but no file (ID-10). The package is what a visitor
// hands on inside their own company: report.pdf + findings.bcf + a standalone
// HTML summary + a manifest with SHA-256 per file. The IFC itself is NOT part
// of the package — it is somebody else's model under NDA (plan 69-14).
//
// Built on the 71-03 building blocks (lieferpaket.js): sha256Hex + fflate
// zipSync + the same STORE-for-binaries/DEFLATE-for-text strategy. No second
// ZIP logic. baueLieferpaket itself is NOT reused: its entry names follow the
// Richtlinien convention and it requires the IFC — the findings package has its
// own names and no IFC (plan Task 2 allows calling the building blocks
// individually).
//
// In:  { projekt, datum, pdf, bcf, html, kennzahlen }
// Out: { zip, manifest, name } — name = <projekt>_<JJJJ-MM-TT>_befundpaket.zip

import { zipSync, strToU8 } from "fflate";
import { sha256Hex } from "./lieferpaket.js";

/**
 * Fixed file names inside the package — stable so the manifest and any
 * e-mail text can name them.
 */
export const PAKET_DATEIEN = {
  pdf: "bericht.pdf",
  bcf: "befunde.bcf",
  html: "zusammenfassung.html",
  manifest: "manifest.json",
};

/**
 * Coerce Uint8Array/ArrayBuffer/TypedArray views to Uint8Array (same helper
 * semantics as lieferpaket.js alsU8 — duplicated deliberately: it is 5 lines
 * and importing a non-exported helper would mean touching 71-03's API).
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView|null|undefined} x
 * @returns {Uint8Array|null}
 */
function alsU8(x) {
  if (x == null) return null;
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new Error("baueBefundPaket: erwartet Uint8Array oder ArrayBuffer");
}

/**
 * Package file name: <projekt>_<JJJJ-MM-TT>_befundpaket.zip. The project name
 * is reduced to filename-safe characters (same character class as
 * ModelCheck's safeFileName) — a deterministic name, no surprises on Windows.
 * @param {string} projekt project name
 * @param {Date} d creation date
 * @returns {string} e.g. "Buerocampus_2026-09-25_befundpaket.zip"
 */
export function paketDateiname(projekt, d) {
  const basis = String(projekt || "projekt").replace(/[^\wäöüÄÖÜß-]+/g, "_");
  const jjjj = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const tt = String(d.getDate()).padStart(2, "0");
  return `${basis}_${jjjj}-${mm}-${tt}_befundpaket.zip`;
}

/**
 * Build the findings package.
 *
 * Missing parts are honest: a run without PDF (html2canvas failed) or without
 * BCF (no findings) still produces a package — the manifest's `hinweise`
 * names what is absent and why (same pattern as baueLieferpaket).
 *
 * @param {{
 *   projekt?: string,
 *   datum?: string|Date,
 *   pdf?: Uint8Array|ArrayBuffer|null,
 *   bcf?: Uint8Array|ArrayBuffer|null,
 *   html: string,
 *   kennzahlen?: object
 * }} p html is REQUIRED (the summary always exists — it is generated, not exported)
 * @returns {Promise<{zip: Uint8Array, manifest: object, name: string}>}
 *   manifest = { erzeugt, projekt, kennzahlen, dateien: [{name, bytes, sha256}], hinweise: string[] }
 */
export async function baueBefundPaket({ projekt = "projekt", datum, pdf = null, bcf = null, html, kennzahlen = {} }) {
  if (typeof html !== "string" || !html) throw new Error("baueBefundPaket: html fehlt (Pflicht — die Zusammenfassung ist immer erzeugbar)");
  const zeit = datum ? new Date(datum) : new Date();
  const zeitOk = Number.isNaN(zeit.getTime()) ? new Date() : zeit;

  const hinweise = [];
  /** @type {{name: string, bytes: number, sha256: string}[]} */
  const dateien = [];
  const eintraege = /** @type {import("fflate").Zippable} */ ({});

  // STORE (level 0) for the binaries — the PDF is a JPEG raster and the BCF
  // is itself a ZIP; DEFLATE would cost seconds per click for ~0 gain (71-03
  // lesson). DEFLATE 6 for the two text files.
  const aufnehmen = async (name, bytes, level) => {
    eintraege[name] = [bytes, { level, mtime: zeitOk }];
    dateien.push({ name, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  };

  const pdfBytes = alsU8(pdf);
  if (pdfBytes && pdfBytes.length) await aufnehmen(PAKET_DATEIEN.pdf, pdfBytes, 0);
  else hinweise.push("Prüfbericht (PDF) nicht enthalten — PDF-Erzeugung fehlgeschlagen; die HTML-Zusammenfassung trägt dieselben Kennzahlen.");

  const bcfBytes = alsU8(bcf);
  if (bcfBytes && bcfBytes.length) await aufnehmen(PAKET_DATEIEN.bcf, bcfBytes, 0);
  else hinweise.push("BCF nicht enthalten — der Lauf hatte keine Befunde zum Übergeben.");

  await aufnehmen(PAKET_DATEIEN.html, strToU8(html), 6);

  const name = paketDateiname(projekt, zeitOk);
  const manifest = {
    erzeugt: zeitOk.toISOString(),
    projekt: String(projekt),
    kennzahlen: kennzahlen || {},
    dateien,
    hinweise,
  };
  eintraege[PAKET_DATEIEN.manifest] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6, mtime: zeitOk }];

  const zip = zipSync(eintraege);
  return { zip, manifest, name };
}
