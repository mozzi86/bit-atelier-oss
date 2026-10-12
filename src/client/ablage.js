// Storage location of the desktop client (Phase 70-03): the bridge between the
// file storage adapter (@core/api/dateiSpeicher.js, no Tauri inside) and the
// shell's file commands (client/src-tauri/src/ablage.rs, every path confined
// to the folder in the profile).
//
// In:  the profile's storage location. Out: speicherEinhaengen() — mounts the
//      file adapter for the project data, the snapshot ring and the personal
//      class — plus the folder helpers the start gate and the storage card use.
// Side effects: setzeSpeicher / setzeSchnappschussSpeicher / setzePersonalSpeicher.

import { dateiSpeicher } from '@core/api/dateiSpeicher';
import { setzeSpeicher } from '@core/api/demoDb';
import { setzeSchnappschussSpeicher } from '@core/api/schnappschuesse';
import { setzePersonalSpeicher } from '@core/api/personalDb';
import { huelleAufrufen } from './huelle.js';

/**
 * The file interface of dateiSpeicher.js on top of the shell's commands.
 * Paths are relative to the storage folder; the shell resolves and checks them.
 * @type {import('@core/api/dateiSpeicher').DateiSchnittstelle}
 */
export const huellenDateien = {
  lesen: (pfad) => huelleAufrufen('ablage_lesen', { pfad }),
  schreiben: (pfad, text) => huelleAufrufen('ablage_schreiben', { pfad, text }),
  umbenennen: (von, nach) => huelleAufrufen('ablage_umbenennen', { von, nach }),
  loeschen: (pfad) => huelleAufrufen('ablage_loeschen', { pfad }),
  liste: (ordner) => huelleAufrufen('ablage_liste', { ordner }),
  ordnerAnlegen: (ordner) => huelleAufrufen('ablage_ordner_anlegen', { ordner }),
};

/**
 * Mounts the file storage for everything the serverless data layer stores:
 * project collections, snapshot ring and personal class. Must run BEFORE the
 * app reads any data (the start gate renders <App/> only afterwards). Creates
 * the folder layout and meta.json, so a broken location fails HERE, with a
 * message, and not later as an empty project list.
 * @param {string} ablageort absolute path, only for the status readout (the shell knows the root itself)
 * @returns {Promise<ReturnType<typeof dateiSpeicher> & {stand: () => Promise<{benutzt: number, gesamt: null, ort: string}>}>}
 */
export async function speicherEinhaengen(ablageort) {
  const basis = dateiSpeicher('', huellenDateien);
  const speicher = {
    ...basis,
    /** Bytes in the folder; a folder has no quota, so `gesamt` stays null. */
    stand: async () => ({ benutzt: await ablageGroesse(), gesamt: null, ort: ablageort }),
  };
  await speicher.vorbereiten();
  const adapter = /** @type {any} */ (speicher);
  setzeSpeicher(adapter);
  setzeSchnappschussSpeicher(adapter);
  // No seed loader and no demo flag: personalDb keeps its own defaults (no
  // fictional HR data in a client since 83-02).
  setzePersonalSpeicher(adapter);
  return speicher;
}

/**
 * Default storage folder of this device (%LOCALAPPDATA%\BIT-Atelier-Ablage).
 * @returns {Promise<string>}
 */
export function ablageStandard() {
  return huelleAufrufen('ablage_standard');
}

/**
 * Native folder picker.
 * @param {string|null} [start] folder the dialog opens in
 * @returns {Promise<string|null>} chosen folder, null when cancelled
 */
export function ablageWaehlen(start = null) {
  return huelleAufrufen('ablage_waehlen', { start });
}

/**
 * What a folder holds.
 * @param {string} ordner absolute path
 * @returns {Promise<{vorhanden: boolean, hatDaten: boolean, leer: boolean}>}
 */
export function ablagePruefen(ordner) {
  return huelleAufrufen('ablage_pruefen', { ordner });
}

/**
 * Opens the current storage folder in the file manager.
 * @returns {Promise<void>}
 */
export function ablageOeffnen() {
  return huelleAufrufen('ablage_oeffnen');
}

/**
 * Bytes in the current storage folder.
 * @returns {Promise<number>}
 */
export function ablageGroesse() {
  return huelleAufrufen('ablage_groesse');
}

/**
 * Copies the current storage folder into an empty folder (the old one stays).
 * @param {string} ziel absolute path of the new folder
 * @returns {Promise<number>} number of files copied
 */
export function ablageKopieren(ziel) {
  return huelleAufrufen('ablage_kopieren', { ziel });
}

/** Path fragments of folders that a sync client manages [ASSUMED: the default folder names of the four common clients]. */
const SYNC_MUSTER = [/google drive/i, /my drive/i, /meine ablage/i, /onedrive/i, /dropbox/i, /icloud/i];

/**
 * Warns about a storage location inside a synchronised folder. Not a block:
 * it works most of the time, but rename is not guaranteed atomic there, and
 * the sync client may lock files or create conflict copies (70-02 research §4.5).
 * @param {string|null|undefined} pfad absolute path
 * @returns {boolean} true when the path looks like a synced folder
 */
export function istSyncOrdner(pfad) {
  return typeof pfad === 'string' && SYNC_MUSTER.some((m) => m.test(pfad));
}
