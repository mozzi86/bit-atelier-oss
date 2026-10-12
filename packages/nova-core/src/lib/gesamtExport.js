// 78-04 (RC-30): full data export of an office as ONE ZIP — every record grouped by entity
// (daten/<Entity>.json) and every object-store payload (blobs/<id>.json), plus manifest.json with the
// SHA-256, size and record count of each file. The cloud terms promise a full export within 30 days; before
// this there was none (RC-30). Pure builder: the data source (Supabase, local server) is passed in.
//
// In:  { datensaetze: [{ entity, ...record }], blobs: [{ id, json }] }, metadata. Out: { zip: Uint8Array,
//      manifest, dateiname }. Uses fflate (existing dependency) and WebCrypto SHA-256.
import { zipSync, strToU8 } from "fflate";

/** Manifest schema version. */
export const EXPORT_VERSION = 1;

/** SHA-256 of bytes as lower-case hex (WebCrypto, browser and Node ≥ 20). */
async function sha256Hex(bytes) {
  const puffer = await globalThis.crypto.subtle.digest("SHA-256", /** @type {BufferSource} */ (bytes));
  return Array.from(new Uint8Array(puffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sicher = (s) => String(s || "unbekannt").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

/**
 * Build the export ZIP.
 * @param {{datensaetze: Array<{entity: string}>, blobs?: Array<{id: string, json: any}>}} quelle
 * @param {{org?: string|null, quelle?: string, jetzt?: Date}} [meta]
 * @returns {Promise<{zip: Uint8Array, manifest: {v: number, erzeugt: string, quelle: string, org: string|null, entitaeten: Record<string, number>, blobs: number, dateien: Array<{name: string, bytes: number, sha256: string, datensaetze?: number}>}, dateiname: string}>}
 */
export async function gesamtExportZip({ datensaetze = [], blobs = [] }, { org = null, quelle = "cloud", jetzt = new Date() } = {}) {
  /** @type {Record<string, object[]>} */
  const jeEntity = {};
  for (const d of datensaetze) {
    const e = d?.entity || "Unbekannt";
    (jeEntity[e] ||= []).push(d);
  }
  /** @type {Record<string, Uint8Array>} */
  const dateien = {};
  const liste = [];
  for (const [e, rows] of Object.entries(jeEntity).sort(([a], [b]) => a.localeCompare(b))) {
    const name = `daten/${sicher(e)}.json`;
    dateien[name] = strToU8(JSON.stringify(rows, null, 1));
    liste.push({ name, bytes: dateien[name].length, sha256: await sha256Hex(dateien[name]), datensaetze: rows.length });
  }
  for (const b of blobs) {
    const name = `blobs/${sicher(b.id)}.json`;
    dateien[name] = strToU8(JSON.stringify(b.json));
    liste.push({ name, bytes: dateien[name].length, sha256: await sha256Hex(dateien[name]) });
  }
  const manifest = {
    v: EXPORT_VERSION, erzeugt: jetzt.toISOString(), quelle, org,
    entitaeten: Object.fromEntries(Object.entries(jeEntity).map(([e, r]) => [e, r.length])),
    blobs: blobs.length, dateien: liste,
  };
  dateien["manifest.json"] = strToU8(JSON.stringify(manifest, null, 1));
  dateien["LIESMICH.txt"] = strToU8([
    "BIT-Atelier — Gesamtexport",
    `Erzeugt: ${manifest.erzeugt}`,
    "daten/<Entität>.json: alle Datensätze dieser Art (JSON-Array).",
    "blobs/<id>.json: Inhalte aus dem Objektspeicher (große Dateien, Bauteillisten).",
    "manifest.json: SHA-256 und Größe jeder Datei — zum Prüfen der Vollständigkeit.",
  ].join("\r\n"));
  return { zip: zipSync(dateien, { level: 6 }), manifest, dateiname: `BIT-Atelier-Gesamtexport_${jetzt.toISOString().slice(0, 10)}.zip` };
}
