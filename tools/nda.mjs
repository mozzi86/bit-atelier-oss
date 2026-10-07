// nda.mjs — the single door to customer / NDA material (Plan 83-01).
//
// Real-project material (customer documents, the real project's fixtures and
// goldens, the oracle scripts) is NOT part of this repository. It lives in a
// private archive outside Git; the environment variable BIT_NDA_DIR points to
// that archive. The archive carries `nda-konfig.json`, which maps NEUTRAL keys
// to its files ("pfade") and holds the project-specific values the NDA tests
// compare against ("werte"). That way neither paths nor names of the real
// projects appear anywhere in the code.
//
// In:  process.env.BIT_NDA_DIR (absolute path, forward or back slashes)
// Out: NDA_FEHLT (skip reason or false), ndaPfad(key), ndaWert(key)
//
// Without BIT_NDA_DIR every NDA test is skipped with NDA_SKIP_MELDUNG. A SET
// variable with a broken archive (no konfig, unknown key) throws in plain text
// instead — a misconfiguration must not look like a clean skip.
//
// Run the NDA tests locally (PowerShell):
//   $env:BIT_NDA_DIR = "C:/Users/<you>/bit-atelier-archiv/nda-2026-10-06"
//   npm run test:unit; npm run parity

import fs from 'node:fs';
import path from 'node:path';

/** Skip message of every test that needs the archive. */
export const NDA_SKIP_MELDUNG = 'NDA-Fixtures nicht vorhanden — BIT_NDA_DIR setzen';

/**
 * Load the archive konfig once.
 * @returns {{dir: string, pfade: Record<string,string>, werte: Record<string,unknown>}|null}
 *   null when BIT_NDA_DIR is not set
 */
function laden() {
  const roh = process.env.BIT_NDA_DIR;
  if (!roh) return null;
  const dir = path.resolve(roh.replace(/\\/g, '/'));
  const datei = path.join(dir, 'nda-konfig.json');
  if (!fs.existsSync(datei)) {
    throw new Error(`BIT_NDA_DIR ist gesetzt (${dir}), aber nda-konfig.json fehlt dort.`);
  }
  const konfig = JSON.parse(fs.readFileSync(datei, 'utf8'));
  return { dir, pfade: konfig.pfade || {}, werte: konfig.werte || {} };
}

const NDA = laden();

/** Skip reason for node:test (`{ skip: NDA_FEHLT }`), or false when the archive is there. */
export const NDA_FEHLT = NDA ? false : NDA_SKIP_MELDUNG;

/**
 * Absolute path of an archive file/folder by its neutral key.
 * @param {string} schluessel key in nda-konfig.json → pfade
 * @returns {string|null} null without BIT_NDA_DIR
 * @throws {Error} when the key is missing in the konfig
 */
export function ndaPfad(schluessel) {
  if (!NDA) return null;
  const rel = NDA.pfade[schluessel];
  if (!rel) throw new Error(`nda-konfig.json: Pfad-Schlüssel „${schluessel}" fehlt`);
  return path.join(NDA.dir, rel);
}

/**
 * Project-specific value (name, number, label) by its neutral key.
 * @param {string} schluessel key in nda-konfig.json → werte
 * @returns {any} null without BIT_NDA_DIR
 * @throws {Error} when the key is missing in the konfig
 */
export function ndaWert(schluessel) {
  if (!NDA) return null;
  if (!(schluessel in NDA.werte)) throw new Error(`nda-konfig.json: Wert-Schlüssel „${schluessel}" fehlt`);
  return NDA.werte[schluessel];
}
