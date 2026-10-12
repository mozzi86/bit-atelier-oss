// Store of truth (89-07, decision D-BW-05 = D-P87-01, 12.10.2026).
//
// "Es gibt immer nur eine Wahrheit" — which store holds it depends on the edition, never on
// the tab or the client:
//   express   — open-source edition with the local server: the local data file
//               (server/db.json via Express) is the truth. One user, one file, no sync.
//   serverlos — local edition without a server (PWA, later the Tauri file): the browser
//               store (IndexedDB) of this device is the truth. No sync either.
//   supabase  — hosted office edition only: the Supabase row is the truth; several clients
//               write, every BimModel layer carries `updatedAt` (87-07) and a layer is
//               merged by LAST-WRITE-WINS on that time stamp (`layerLww`), so a delayed or
//               queued older write never overwrites a newer layer of another client.
// Nothing here talks to a network; the hosted edition is not connected to any project
// by this module (deploys only after the user's yes).
//
// In:  the data path constant (umgebung.js) and BimModel records. Out: WAHRHEIT,
//      wahrheitFuer(), layerLww().

import { DATENQUELLE } from "./umgebung.js";
import { istFachlayer } from "./fachlayerSchema.js";

/**
 * Store of truth per data path.
 * @type {Readonly<Record<"express"|"serverlos"|"supabase", {quelle: string, sync: "keiner"|"lww-je-layer", text: string}>>}
 */
export const WAHRHEITEN = Object.freeze({
  express: { quelle: "lokale-datei", sync: "keiner", text: "Lokale Datei (server/db.json über den lokalen Server) — Open-Source-Fassung" },
  serverlos: { quelle: "geraet", sync: "keiner", text: "Speicher dieses Geräts (Browser/Tauri-Datei) — lokale Fassung ohne Server" },
  supabase: { quelle: "supabase", sync: "lww-je-layer", text: "Gehostete Büro-Fassung (Supabase), Last-Write-Wins je Fachlayer über updatedAt" },
});

/**
 * Store of truth for a data path; unknown paths fall back to the local file (the safe default
 * of the open-source edition — never silently the cloud).
 * @param {string} [datenquelle] "express" | "serverlos" | "supabase"
 * @returns {{quelle: string, sync: "keiner"|"lww-je-layer", text: string}}
 */
export function wahrheitFuer(datenquelle = DATENQUELLE) {
  return WAHRHEITEN[/** @type {"express"|"serverlos"|"supabase"} */ (datenquelle)] || WAHRHEITEN.express;
}

/** Store of truth of this build. */
export const WAHRHEIT = wahrheitFuer(DATENQUELLE);

/**
 * Time stamp of a layer blob in milliseconds; missing/invalid → -Infinity (a blob without
 * `updatedAt` predates 87-07 and is older than any stamped one).
 * @param {any} blob
 * @returns {number}
 */
function stempelMs(blob) {
  const t = Date.parse(blob?.updatedAt ?? "");
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Merge an incoming BimModel patch into the stored record, last-write-wins PER LAYER
 * (hosted edition, D-BW-05). Non-layer fields merge flat as before (programme fields and
 * element fields have one writer each, KD-17). A layer of the patch replaces the stored
 * layer only if it is not older (`updatedAt` ≥ stored); on a tie the incoming write wins.
 * Pure function.
 * @param {Record<string, any>|null} vorhanden stored record (may be null)
 * @param {Record<string, any>} eingehend patch of the writer
 * @returns {{ ergebnis: Record<string, any>, verworfen: string[] }} merged record and the layer
 *   fields that were kept because the stored layer is newer
 */
export function layerLww(vorhanden, eingehend) {
  const alt = vorhanden || {};
  const ergebnis = { ...alt };
  const verworfen = [];
  for (const [feld, wert] of Object.entries(eingehend || {})) {
    if (istFachlayer(feld) && alt[feld] && wert && stempelMs(alt[feld]) > stempelMs(wert)) {
      verworfen.push(feld);
      continue;
    }
    ergebnis[feld] = wert;
  }
  return { ergebnis, verworfen };
}
