// Storage of phase 82 (deadlines, correspondence, rights): every read and write
// of Nutzer, Schreiben, Briefvorlage and Postbucheintrag goes through
// bueroEntitaet (E-03) — a source guard in bueroOrgaSpeicher.test.js keeps
// other files from naming these entities directly.
//
// Cloud lock (E-03, relaxed by E-20 on 28.09.2026): without the release
// (BUERO_CLOUD_FREIGABE) the Supabase build refuses the four entities BEFORE
// touching the API, with a plain-text reason. Termin, Terminquittung and Abnahme
// are project data and stay open (E-03 does not name /Deadlines).
//
// bereitmachen (serverless build): all seven 82 stores in ONE IndexedDB version
// bump (BEFUNDE-79 H-4: each store on its own cost a bump and closed the
// connection of a project list loading at the same time), with a bounded retry
// when IndexedDB reports "blockiert".
//
// In:  `api` = bitApi (injected, node tests pass a fake). Out: verfuegbar,
//      bueroEntitaet, ladeBueroOrga, speichereBuero, loescheBuero, bereitmachen,
//      CLOUD_GESPERRT_TEXTE.

import { BUERO_CLOUD_FREIGABE } from "@core/lib/umgebung.js";
import { speichere } from "@/lib/accounting/speicher.js";
import { BUERO_ORGA_ENTITAETEN, BUERO_ORGA_GESPERRT } from "./entitaeten.js";

/** Plain-text refusal per locked entity (E-03). */
export const CLOUD_GESPERRT_TEXTE = Object.freeze({
  Nutzer: "Nutzer & Rechte bleiben lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).",
  Schreiben: "Schriftverkehr bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).",
  Briefvorlage: "Schriftverkehr bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).",
  Postbucheintrag: "Schriftverkehr bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).",
});

/**
 * Whether the locked office entities may be used on a data path.
 * @param {string} datenquelle 'serverlos' | 'express' | 'supabase'
 * @param {boolean} [freigabe] E-20 switch, default BUERO_CLOUD_FREIGABE
 * @returns {boolean}
 */
export function verfuegbar(datenquelle, freigabe = BUERO_CLOUD_FREIGABE) {
  return datenquelle !== "supabase" || freigabe === true;
}

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Entity client of a phase-82 entity: in a locked cloud build every call of a
 * locked entity rejects with the plain-text reason and never reaches the API.
 * @param {any} api
 * @param {string} name one of BUERO_ORGA_ENTITAETEN
 * @param {{datenquelle: string, freigabe?: boolean}} kontext
 * @returns {any} client with list/filter/get/create/update/delete
 * @throws {Error} plain text for an unknown entity
 */
export function bueroEntitaet(api, name, { datenquelle, freigabe = BUERO_CLOUD_FREIGABE }) {
  if (!BUERO_ORGA_ENTITAETEN.includes(name)) throw new Error(`„${name}“ gehört nicht zu Fristen, Schriftverkehr & Rechte.`);
  if (BUERO_ORGA_GESPERRT.includes(name) && !verfuegbar(datenquelle, freigabe)) {
    const nein = async () => { throw new Error(/** @type {any} */ (CLOUD_GESPERRT_TEXTE)[name]); };
    return { list: nein, filter: nein, get: nein, create: nein, update: nein, delete: nein };
  }
  const c = api?.entities?.[name];
  if (!c) throw new Error(`Speicher: keine Schnittstelle für „${name}“.`);
  return c;
}

/**
 * Loads collections of the phase (default: all seven). A locked entity in the
 * cloud yields an empty list plus its reason in `gesperrt` instead of a throw,
 * so the deadline page still shows the open sources.
 * @param {any} api
 * @param {{datenquelle: string, freigabe?: boolean, entitaeten?: ReadonlyArray<string>, filter?: Record<string, any>|null}} kontext
 * @returns {Promise<{daten: Record<string, any[]>, gesperrt: Record<string, string>}>}
 * @throws {Error} plain text when a read of an open entity fails
 */
export async function ladeBueroOrga(api, { datenquelle, freigabe = BUERO_CLOUD_FREIGABE, entitaeten = BUERO_ORGA_ENTITAETEN, filter = null }) {
  /** @type {Record<string, any[]>} */
  const daten = {};
  /** @type {Record<string, string>} */
  const gesperrt = {};
  await Promise.all(entitaeten.map(async (name) => {
    if (BUERO_ORGA_GESPERRT.includes(name) && !verfuegbar(datenquelle, freigabe)) {
      daten[name] = [];
      gesperrt[name] = /** @type {any} */ (CLOUD_GESPERRT_TEXTE)[name];
      return;
    }
    const c = bueroEntitaet(api, name, { datenquelle, freigabe });
    try {
      const liste = filter ? await c.filter(filter) : await c.list();
      daten[name] = Array.isArray(liste) ? [...liste] : [];
    } catch (fehler) {
      throw new Error(`${name} konnte nicht geladen werden: ${text(fehler)}`);
    }
  }));
  return { daten, gesperrt };
}

/**
 * Saves one record (79's speichere: get → update | create, retry on "blockiert").
 * @param {any} api
 * @param {string} name
 * @param {Record<string, any>} obj
 * @param {{datenquelle: string, freigabe?: boolean}} kontext
 * @returns {Promise<Record<string, any>>}
 * @throws {Error} plain text (cloud lock, failure)
 */
export async function speichereBuero(api, name, obj, { datenquelle, freigabe = BUERO_CLOUD_FREIGABE }) {
  const c = bueroEntitaet(api, name, { datenquelle, freigabe });
  if (BUERO_ORGA_GESPERRT.includes(name) && !verfuegbar(datenquelle, freigabe)) return c.create(obj);
  return speichere(api, name, obj);
}

/**
 * Deletes one record (404 counts as deleted).
 * @param {any} api
 * @param {string} name
 * @param {string} id
 * @param {{datenquelle: string, freigabe?: boolean}} kontext
 * @returns {Promise<void>}
 * @throws {Error} plain text
 */
export async function loescheBuero(api, name, id, { datenquelle, freigabe = BUERO_CLOUD_FREIGABE }) {
  try {
    await bueroEntitaet(api, name, { datenquelle, freigabe }).delete(id);
  } catch (fehler) {
    const f = /** @type {any} */ (fehler);
    if (f?.status === 404 || /\b404\b/.test(String(f?.message ?? ""))) return;
    throw new Error(`${name} ${id} konnte nicht gelöscht werden: ${text(fehler)}`);
  }
}

/** Upper bound of attempts when IndexedDB reports "blockiert" (H-4). */
const VERSUCHE = 6;

/**
 * Creates all seven 82 stores in one version bump (serverless build only).
 * @param {{datenquelle: string, idb?: {stelleStoresSicher: (namen: string[]) => Promise<void>}, warte?: (ms: number) => Promise<void>}} kontext
 *   idb: injectable (tests); default the real demoIdb.js
 * @returns {Promise<void>}
 * @throws {Error} plain text on a locked cloud build or after the last attempt
 */
export async function bereitmachen({ datenquelle, idb, warte = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (datenquelle === "express") return;
  if (datenquelle === "supabase") throw new Error("Fristen, Schriftverkehr & Rechte: keine lokalen Speicher in der Cloud-Fassung.");
  const adapter = idb || (await import("@core/api/demoIdb.js"));
  for (let versuch = 1; ; versuch++) {
    try {
      await adapter.stelleStoresSicher([...BUERO_ORGA_ENTITAETEN]);
      return;
    } catch (fehler) {
      if (!/blockiert/i.test(text(fehler)) || versuch >= VERSUCHE) throw fehler;
      await warte(200 * versuch);
    }
  }
}
