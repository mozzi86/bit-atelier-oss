// Project file for the serverless demo: save the whole working state to one
// file and read it back.
//
// Why this exists: "everything stays in your browser" is the platform's core
// promise, but without an export it is also a trap — clear the browser data, use
// another machine, or ask a colleague to look, and the work is gone or
// unreachable (finding BEF-04 / BL-03). A file is the missing half of the
// no-cloud position, and it doubles as the handover route between office,
// specialist planner and client.
//
// In:  the demo database (all collections) or a .bitproj file the visitor picks.
// Out: a .bitproj file (JSON, gzip-compressed where the browser supports it) /
//      the parsed object plus a preview, so nothing is overwritten unseen.
//
// Format v1: { schema: 1, app: "bit-atelier-demo", exportiert: <ISO>,
//              projektname: <string>, daten: { [Entity]: [...] } }
// The file starts with "{" when stored as plain text and with 0x1f 0x8b when
// gzipped — the reader decides on the first byte, so both stay readable and the
// extension never lies.

import { demoDbAuslesen, demoDbErsetzen, letzteSicherungSetzen } from './demoDb.js';
// 93-10: the pure half (format, parser, area filter, merges) lives in projektDateiFormat.js so the
// local server can validate double-clicked files with the same parser. Re-exported here unchanged.
import { DATEI_ENDUNG, serialisiereProjekt, entferneBereiche, vorschau, parseProjektDatei } from './projektDateiFormat.js';

export {
  SCHEMA, DATEI_ENDUNG, serialisiereProjekt, entferneBereiche, vorschau, parseProjektDatei,
  mitBehaltenem, projekteIn, vorhandeneProjekte, kopieAnfuegen,
} from './projektDateiFormat.js';

/**
 * Packs the current demo state into a Blob.
 * 79-12 (E-07): `ohne`/`ohneSettingKeys` drop office areas the export dialog
 * left unchecked BEFORE anything is serialised — an export without a checked
 * area must not carry the office's own books even filtered, only left out.
 * Called with no options this is byte-compatible with every file written
 * before this plan.
 * @param {string} [projektname]
 * @param {{ohne?: string[], ohneSettingKeys?: string[], ohneDokumentBereiche?: string[], art?: "sicherung"|"weitergabe", bereiche?: string[]}} [optionen]
 * @returns {Promise<{blob: Blob, dateiname: string, obj: object}>}
 */
export async function projektAlsBlob(projektname, { ohne = [], ohneSettingKeys = [], ohneDokumentBereiche = [], art, bereiche } = {}) {
  const volleDaten = await demoDbAuslesen();
  const daten = entferneBereiche(volleDaten, ohne, ohneSettingKeys, ohneDokumentBereiche);
  const obj = serialisiereProjekt(daten, projektname, { art, bereiche });
  const text = JSON.stringify(obj);
  const tag = new Date().toISOString().slice(0, 10);
  const sicher = (obj.projektname || 'projekt').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
  const dateiname = `${sicher}_${tag}${DATEI_ENDUNG}`;

  // Compression is opportunistic: CompressionStream is missing in older Safari,
  // and a plain-text file is still a valid project file.
  if (typeof CompressionStream !== 'undefined') {
    const strom = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return { blob: await new Response(strom).blob(), dateiname, obj };
  }
  return { blob: new Blob([text], { type: 'application/json' }), dateiname, obj };
}

/**
 * Saves the current demo state to the visitor's downloads folder.
 * 69-07: a successful file export stamps meta.letzteSicherung — the ONLY
 * writer (the snapshot ring never claims "saved to a file"). 79-12 (E-07): a
 * "weitergabe" export (an area left unchecked) is deliberately NOT a backup —
 * it must not stamp letzteSicherung, or the backup nudge would fall silent
 * after a handover file that never actually saved the office's own books.
 * @param {string} [projektname]
 * @param {{ohne?: string[], ohneSettingKeys?: string[], art?: "sicherung"|"weitergabe", bereiche?: string[]}} [optionen]
 * @returns {Promise<string>} the file name that was offered
 */
export async function exportProjekt(projektname, optionen = {}) {
  const { blob, dateiname, obj } = await projektAlsBlob(projektname, optionen);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before the URL disappears.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (obj.art !== 'weitergabe') {
    try {
      await letzteSicherungSetzen();
    } catch {
      // A failed stamp must not break the download itself — the bar simply
      // shows again next visit (honest default).
    }
  }
  return dateiname;
}

/**
 * Reads a picked file WITHOUT touching the database — the caller shows the
 * preview and asks first.
 * @param {File} datei
 * @returns {Promise<{obj: object, vorschau: ReturnType<typeof vorschau>}>}
 */
export async function leseProjektDatei(datei) {
  const obj = await parseProjektDatei(await datei.arrayBuffer());
  return { obj, vorschau: vorschau(obj) };
}

/**
 * Applies a previously read project file, replacing everything (except the
 * areas named in `behalte`/`behalteSettingKeys`, 79-12/E-07 — an area the file
 * omits keeps its local data instead of being wiped).
 * 69-13: returns demoDbErsetzen's report ({schnappschuss, schnappschussFehler})
 * so the caller can surface a failed automatic snapshot honestly.
 * @param {object} obj result of leseProjektDatei().obj
 * @param {{behalte?: string[], behalteSettingKeys?: string[], behalteDokumentBereiche?: string[]}} [optionen]
 * @returns {Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>}
 */
export async function uebernehmeProjekt(obj, { behalte = [], behalteSettingKeys = [], behalteDokumentBereiche = [] } = {}) {
  return demoDbErsetzen(obj.daten, 'vor Import', { behalte, behalteSettingKeys, behalteDokumentBereiche });
}
