// lieferpaket.js — das Lieferpaket als ZIP (Phase 71-03).
//
// Aus einem Prüflauf entsteht, was der Bauherr je Übergabe verlangt (LV 5.1.3/
// 5.1.10, BAP 8.1.2, Namensrichtlinie): das geprüfte IFC unter dem Richtlinien-Namen,
// der Prüfbericht (PDF), das BCF der offenen Befunde, das Übergabeprotokoll
// und ein Manifest mit SHA-256 je Datei.
//
// Stufe A: das gelieferte IFC ist die GELADENE DATEI selbst — hier wird kein
// IFC neu geschrieben. Der Manifest-Hash des IFC ist damit der Hash des
// geprüften Puffers (T-71-10), das Protokoll nennt ihn.
//
// ZIP über fflate.zipSync (Muster novaXlsx.js:29 — kopiert, nicht importiert;
// @ifc darf nicht von @ava abhängen). STORE (level 0) für IFC/PDF/BCF — das
// PDF ist JPEG-Raster, das BCF ein ZIP, das IFC oft > 100 MB (Deflate wäre
// Sekunden pro Klick); DEFLATE nur für Protokoll und Manifest.

import { zipSync, strToU8 } from "fflate";

/** Fester ZIP-Zeitstempel je Paket, damit derselbe Inhalt dieselben Bytes gibt. */
function zeitstempel(erzeugt) {
  const d = erzeugt ? new Date(erzeugt) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * SHA-256 als Hex — Browser und Node (≥ 20) über `globalThis.crypto.subtle`.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("sha256Hex: WebCrypto (crypto.subtle) ist nicht verfügbar");
  const puffer = await subtle.digest("SHA-256", /** @type {BufferSource} */ (bytes));
  return Array.from(new Uint8Array(puffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Dateinamen im Paket aus dem Richtlinien-Namen (mit Endung).
 * @param {string} dateiname z. B. P5_00000-01_TX_FM_XX_P_01.ifc
 * @returns {{basis: string, ifc: string, pdf: string, bcf: string, protokoll: string, manifest: string, zip: string}}
 */
export function paketNamen(dateiname) {
  const voll = String(dateiname || "modell.ifc").split(/[\\/]/).pop();
  const punkt = voll.lastIndexOf(".");
  const basis = punkt > 0 ? voll.slice(0, punkt) : voll;
  const endung = punkt > 0 ? voll.slice(punkt + 1) : "ifc";
  return {
    basis,
    ifc: `${basis}.${endung}`,
    pdf: `${basis}_Pruefbericht.pdf`,
    bcf: `${basis}_Befunde.bcf`,
    protokoll: `${basis}_Uebergabeprotokoll.md`,
    manifest: "manifest.json",
    zip: `${basis}_Lieferpaket.zip`,
  };
}

function alsU8(x) {
  if (x == null) return null;
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new Error("baueLieferpaket: erwartet Uint8Array oder ArrayBuffer");
}

/**
 * Lieferpaket bauen.
 *
 * @param {{dateiname: string, ifc: Uint8Array|ArrayBuffer, pdf?: Uint8Array|null,
 *   bcf?: Uint8Array|null, protokoll?: string, erzeugt?: string|Date,
 *   protokollErgaenzen?: (hashes: Array<{name: string, sha256: string}>) => string}} p
 *   protokollErgaenzen: optional — bekommt die Hashes von IFC/PDF/BCF und
 *   liefert den endgültigen Protokolltext (das Protokoll soll den IFC-Hash
 *   nennen, T-71-10; es kann sich nicht selbst hashen, also zwei Schritte).
 * @returns {Promise<{zip: Uint8Array, manifest: object, namen: object}>}
 *   manifest = { erzeugt, dateiname, herkunft, dateien: [{ name, bytes, sha256 }], hinweise: string[] }
 */
export async function baueLieferpaket({ dateiname, ifc, pdf = null, bcf = null, protokoll = "", erzeugt, protokollErgaenzen }) {
  const namen = paketNamen(dateiname);
  const ifcBytes = alsU8(ifc);
  if (!ifcBytes || !ifcBytes.length) throw new Error("baueLieferpaket: IFC-Bytes fehlen");
  const pdfBytes = alsU8(pdf);
  const bcfBytes = alsU8(bcf);
  const zeit = zeitstempel(erzeugt);

  const hinweise = [];
  const dateien = [];
  const eintraege = /** @type {import("fflate").Zippable} */ ({});

  const aufnehmen = async (name, bytes, level) => {
    eintraege[name] = [bytes, { level, mtime: zeit }];
    dateien.push({ name, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  };

  await aufnehmen(namen.ifc, ifcBytes, 0);
  if (pdfBytes && pdfBytes.length) await aufnehmen(namen.pdf, pdfBytes, 0);
  else hinweise.push("Prüfbericht (PDF) nicht enthalten — Export fehlgeschlagen oder nicht angefordert.");
  if (bcfBytes && bcfBytes.length) await aufnehmen(namen.bcf, bcfBytes, 0);
  else hinweise.push("Kein BCF enthalten — keine offenen Befunde im Prüflauf.");

  // Protokoll bekommt die Hashes der Nutzdaten (nicht seinen eigenen).
  const text = typeof protokollErgaenzen === "function"
    ? protokollErgaenzen(dateien.map(({ name, sha256 }) => ({ name, sha256 })))
    : String(protokoll || "");
  await aufnehmen(namen.protokoll, strToU8(text), 6);

  const manifest = {
    erzeugt: zeit.toISOString(),
    dateiname: namen.ifc,
    herkunft: "geladene Datei, kein Neu-Export (Stufe A)",
    dateien,
    hinweise,
  };
  eintraege[namen.manifest] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6, mtime: zeit }];

  const zip = zipSync(eintraege);
  return { zip, manifest, namen };
}
