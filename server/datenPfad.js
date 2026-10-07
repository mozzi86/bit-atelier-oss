// datenPfad.js — the ONE place that decides where the local API writes its files
// (Plan 83-03). Before this module server/index.js and server/seed.js each built
// `path.join(__dirname, 'db.json')` themselves; a downloaded release needs its
// data next to the app (`<app>/daten/`), not inside the program folder `server/`.
//
// Rule: BIT_DATA_DIR set → every server write file lives in that folder (created
// when missing); not set → `server/` as before, so existing setups (npm run dev,
// the seeder, tests) keep their data where it is. A relative BIT_DATA_DIR is
// resolved against the working directory of the process.
//
// Files that follow this rule: db.json (+ .bak/.tmp siblings written by db.js),
// blobs/, personal.json (+ siblings), personal-blobs/.
//
// In:  process.env.BIT_DATA_DIR (or an env object in tests). Out: absolute paths.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder of this file (`server/`) — the default data folder. */
export const SERVER_ORDNER = path.dirname(fileURLToPath(import.meta.url));

/**
 * The data folder of the local API.
 * Side effect: creates the folder (recursively) when BIT_DATA_DIR points to a
 * folder that does not exist yet.
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {string} absolute folder path
 */
export function datenOrdner(env = process.env) {
  const gesetzt = String(env.BIT_DATA_DIR ?? '').trim();
  if (!gesetzt) return SERVER_ORDNER;
  const ordner = path.resolve(gesetzt);
  fs.mkdirSync(ordner, { recursive: true });
  return ordner;
}

/**
 * Absolute path of one data file or sub-folder inside the data folder.
 * @param {string} name file or folder name, e.g. 'db.json' or 'blobs' (no path separators)
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {string} absolute path
 */
export function datenPfad(name, env = process.env) {
  if (!name || /[\\/]/.test(name) || name === '..' || name === '.') {
    throw new Error(`datenPfad: ungültiger Name ${JSON.stringify(name)} — nur ein Datei- oder Ordnername ohne Pfad`);
  }
  return path.join(datenOrdner(env), name);
}
