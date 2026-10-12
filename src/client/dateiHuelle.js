// dateiHuelle.js — the double-click import and "save back" inside the DESKTOP CLIENT (Tauri shell, plan
// 93-10). The shell registers .bitproj (tauri.conf.json bundle.fileAssociations), takes the path from its
// command line — a second start hands it over through the single-instance plugin — and offers four
// commands (client/src-tauri/src/datei.rs): datei_ausstehend, datei_lesen, datei_stand, datei_schreiben.
//
// Only loaded behind inHuelle() (dynamic import), so the browser builds never carry it.
// The source link (path, size, modification time at import) lives in localStorage of the shell — local
// to this machine, never in the project data or an export (D-93-10-03).
//
// In:  the commands of the shell, the in-browser database (demoDb via projektDatei.js).
// Out: importAdapterHuelle() and quelleAdapterHuelle() with the shape of src/lib/dateiOeffnenServer.js,
//      plus beiNeuerDatei() for a file opened while the window is already running.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { huelleAufrufen } from "./huelle.js";
import { demoDbAuslesen, demoDbErsetzen } from "@core/api/demoDb";
import { parseProjektDatei, uebernehmeProjekt, projektAlsBlob, kopieAnfuegen, vorhandeneProjekte, projekteIn } from "@core/api/projektDatei";
import { anzahlenVon, kopieOptionen, zurueckOptionen } from "@/lib/dateiOeffnen.js";

/** localStorage key of the source link. */
export const LINK_SCHLUESSEL = "bit-atelier.dateiquelle.v1";

/** @typedef {{pfad: string, name: string, groesse: number, geaendert_ms: number}} DateiInfo */

/** @param {string} text @returns {string} UTF-8 bytes as hex — header values must be ASCII */
function hex(text) {
  return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @returns {any|null} */
function linkLesen() {
  try {
    return JSON.parse(localStorage.getItem(LINK_SCHLUESSEL) || "null");
  } catch {
    return null;
  }
}

/** @param {object} link */
function linkSchreiben(link) {
  localStorage.setItem(LINK_SCHLUESSEL, JSON.stringify(link));
}

/**
 * Calls back whenever the shell received another .bitproj (second start while running).
 * @param {() => void} fn
 * @returns {Promise<() => void>} unsubscribe
 */
export function beiNeuerDatei(fn) {
  return listen("datei-oeffnen", () => fn());
}

/**
 * Writes bytes through the shell (raw request body; the path travels hex-encoded in a header).
 * @param {string} pfad absolute path
 * @param {Uint8Array} bytes
 * @param {boolean} neu true = the file must not exist yet (copy), false = overwrite an existing one
 * @returns {Promise<DateiInfo>}
 */
async function schreiben(pfad, bytes, neu) {
  try {
    return await invoke("datei_schreiben", bytes, { headers: { pfad: hex(pfad), neu: neu ? "1" : "0" } });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Import adapter for the next file the shell holds, or null when there is none.
 * @returns {Promise<null|{
 *   laden: () => Promise<{obj: any, lokalAnzahl: Record<string, number>, wiederOeffnen: Array<{id: string, name: string}>, quelle: {name: string}}>,
 *   ersetzen: (vorschau: any) => Promise<void>, kopie: (vorschau: any) => Promise<void>, abbrechen: () => Promise<void>,
 * }>}
 */
export async function importAdapterHuelle() {
  /** @type {DateiInfo|null} */
  const info = await huelleAufrufen("datei_ausstehend");
  if (!info) return null;
  return {
    async laden() {
      const roh = /** @type {ArrayBuffer} */ (await huelleAufrufen("datei_lesen", { pfad: info.pfad }));
      const obj = await parseProjektDatei(roh);
      const lokal = await demoDbAuslesen();
      return {
        obj,
        lokalAnzahl: anzahlenVon(lokal),
        wiederOeffnen: vorhandeneProjekte(/** @type {any} */ (obj).daten, projekteIn(lokal).map((p) => p.id)),
        quelle: { name: info.name },
      };
    },
    async ersetzen(vorschau) {
      await uebernehmeProjekt(vorschau.obj, vorschau.importOptionen);
      linkSchreiben({
        pfad: info.pfad, name: info.name, groesse: info.groesse, geaendertMs: info.geaendert_ms,
        projektname: vorschau.obj.projektname || "", art: vorschau.obj.art, bereiche: vorschau.obj.bereiche,
        ...zurueckOptionen(vorschau.importOptionen), importiertAm: new Date().toISOString(), gespeichertAm: null,
      });
    },
    async kopie(vorschau) {
      const { daten } = kopieAnfuegen(await demoDbAuslesen(), vorschau.obj.daten, kopieOptionen());
      await demoDbErsetzen(daten, "vor Import");
    },
    async abbrechen() {},
  };
}

/**
 * A free "<name> (Kopie <stamp>[ n]).bitproj" next to the source; the shell refuses an existing name
 * (create_new), so the next candidate is tried.
 * @param {string} pfad source path
 * @param {number} versuch 1, 2, …
 * @returns {string}
 */
export function kopiePfad(pfad, versuch, jetzt = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  const stempel = `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())} ${z(jetzt.getHours())}${z(jetzt.getMinutes())}`;
  const basis = pfad.replace(/\.bitproj$/i, "");
  return `${basis} (Kopie ${stempel}${versuch > 1 ? ` ${versuch}` : ""}).bitproj`;
}

/**
 * Linked-source adapter of the desktop client (same shape as quelleAdapter() of the local edition).
 * Change detection: size + modification time (no hashing crate in the shell — D-93-10-04).
 * @returns {{quelle: () => Promise<any>, zurueck: (entscheidung?: "ueberschreiben"|"kopie") => Promise<any>}}
 */
export function quelleAdapterHuelle() {
  return {
    async quelle() {
      const link = linkLesen();
      if (!link?.pfad) return null;
      /** @type {DateiInfo|null} */
      const stand = await huelleAufrufen("datei_stand", { pfad: link.pfad }).catch(() => null);
      return { name: link.name, pfad: link.pfad, importiertAm: link.importiertAm, gespeichertAm: link.gespeichertAm, vorhanden: !!stand };
    },
    async zurueck(entscheidung) {
      const link = linkLesen();
      if (!link?.pfad) throw new Error("Keine verknüpfte Projektdatei.");
      /** @type {DateiInfo|null} */
      const stand = await huelleAufrufen("datei_stand", { pfad: link.pfad });
      const geaendert = !stand || stand.groesse !== link.groesse || stand.geaendert_ms !== link.geaendertMs;
      if (geaendert && !entscheidung) return { konflikt: stand ? "geaendert" : "fehlt" };
      const { blob } = await projektAlsBlob(link.projektname || undefined, {
        ohne: link.ohne, ohneSettingKeys: link.ohneSettingKeys, ohneDokumentBereiche: link.ohneDokumentBereiche, art: link.art, bereiche: link.bereiche,
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      /** @type {DateiInfo} */
      let neu;
      if (entscheidung === "kopie") {
        let versuch = 1;
        for (;;) {
          try {
            neu = await schreiben(kopiePfad(link.pfad, versuch), bytes, true);
            break;
          } catch (e) {
            if (!/existiert|exists/i.test(String(/** @type {Error} */ (e).message)) || versuch > 50) throw e;
            versuch += 1;
          }
        }
      } else {
        neu = await schreiben(link.pfad, bytes, !stand);
      }
      linkSchreiben({ ...link, pfad: neu.pfad, name: neu.name, groesse: neu.groesse, geaendertMs: neu.geaendert_ms, gespeichertAm: new Date().toISOString() });
      return { ok: true, pfad: neu.pfad, kopie: entscheidung === "kopie" };
    },
  };
}
