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

/** Current file format version. Bump only with a migration in leseProjekt(). */
export const SCHEMA = 1;
export const DATEI_ENDUNG = '.bitproj';

/**
 * Builds the export object.
 * 79-12 (E-07): `art`/`bereiche` are optional and generic — this module has no
 * idea what an "area" is, it only stores what the caller (src/lib/exportBereiche.js,
 * which DOES know the entity lists) already decided. Omitted, the file looks
 * exactly like one written before this plan (byte-compatible).
 * @param {Record<string, object[]>} daten all collections
 * @param {string} [projektname] name shown in the import preview
 * @param {{art?: "sicherung"|"weitergabe", bereiche?: string[]}} [optionen]
 * @returns {{schema: number, app: string, exportiert: string, projektname: string, art?: string, bereiche?: string[], daten: Record<string, object[]>}}
 */
export function serialisiereProjekt(daten, projektname = 'BIT-Atelier-Demo', { art, bereiche } = {}) {
  return {
    schema: SCHEMA,
    app: 'bit-atelier-demo',
    exportiert: new Date().toISOString(),
    projektname,
    art,
    bereiche,
    daten,
  };
}

/**
 * Drops whole collections, and Setting rows with the given keys, from a data
 * snapshot before it is serialised (E-07: an export for a specialist planner
 * or client must not carry the office's own books at all — not even filtered
 * to zero rows, which would still leak the schema and any leftover Setting).
 * Returns a new object; `daten` itself is never mutated.
 * @param {Record<string, object[]>} daten
 * @param {string[]} ohne collection names to drop entirely
 * @param {string[]} ohneSettingKeys `Setting.key` values to drop from the Setting rows
 * @returns {Record<string, object[]>}
 */
function entferneBereiche(daten, ohne, ohneSettingKeys) {
  if (!ohne.length && !ohneSettingKeys.length) return daten;
  const raus = new Set(ohne);
  /** @type {Record<string, object[]>} */
  const ergebnis = {};
  for (const [entity, rows] of Object.entries(daten)) {
    if (raus.has(entity)) continue; // key left out entirely (presence-based import, see exportBereiche.js)
    if (entity === 'Setting' && ohneSettingKeys.length) {
      ergebnis[entity] = (rows || []).filter((r) => !ohneSettingKeys.includes(r?.key));
      continue;
    }
    ergebnis[entity] = rows;
  }
  return ergebnis;
}

/**
 * Record counts per collection, for the preview before an import overwrites
 * anything. 79-12: also reports `art`/`bereiche` — a file written before this
 * plan has neither, and is read as a full backup (`art: "sicherung"`), because
 * that is exactly what every file used to be.
 * @param {object} obj parsed project object
 * @returns {{projektname: string, exportiert: string, anzahl: Record<string, number>, gesamt: number, art: "sicherung"|"weitergabe", bereiche: string[]}}
 */
export function vorschau(obj) {
  /** @type {Record<string, number>} */
  const anzahl = {};
  let gesamt = 0;
  for (const [entity, rows] of Object.entries(obj?.daten || {})) {
    const n = Array.isArray(rows) ? rows.length : 0;
    anzahl[entity] = n;
    gesamt += n;
  }
  return {
    projektname: obj?.projektname || '(ohne Namen)',
    exportiert: obj?.exportiert || '(ohne Datum)',
    anzahl,
    gesamt,
    art: obj?.art === 'weitergabe' ? 'weitergabe' : 'sicherung',
    bereiche: Array.isArray(obj?.bereiche) ? obj.bereiche : [],
  };
}

/**
 * True when the bytes start with the gzip magic number.
 * @param {Uint8Array} bytes
 */
function istGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Parses a project file, transparently handling the gzipped and the plain form.
 * Rejects anything that is not a v1 project file — a half-applied import would
 * be worse than none.
 * @param {ArrayBuffer|Uint8Array} roh
 * @returns {Promise<object>} the parsed project object
 * @throws {Error} with a message meant for the user
 */
export async function parseProjektDatei(roh) {
  const bytes = roh instanceof Uint8Array ? roh : new Uint8Array(roh);
  if (!bytes.length) throw new Error('Die Datei ist leer.');

  let text;
  if (istGzip(bytes)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'Die Datei ist komprimiert, dieser Browser kann sie nicht entpacken. ' +
          'Bitte in einem aktuellen Browser öffnen.',
      );
    }
    // Cast: TS kennt Uint8Array hier nicht als BlobPart, der Browser schon.
    const strom = new Blob([/** @type {BlobPart} */ (bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(strom).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist keine gültige Projektdatei (JSON nicht lesbar).');
  }

  if (obj?.app !== 'bit-atelier-demo') {
    throw new Error('Diese Datei stammt nicht aus der BIT-Atelier-Demo.');
  }
  if (obj?.schema !== SCHEMA) {
    throw new Error(
      `Dateiversion ${obj?.schema ?? '?'} wird von dieser Fassung nicht gelesen ` +
        `(erwartet: ${SCHEMA}). Bitte mit der Fassung öffnen, die sie geschrieben hat.`,
    );
  }
  if (!obj?.daten || typeof obj.daten !== 'object') {
    throw new Error('Die Projektdatei enthält keine Daten.');
  }
  return obj;
}

/**
 * Packs the current demo state into a Blob.
 * 79-12 (E-07): `ohne`/`ohneSettingKeys` drop office areas the export dialog
 * left unchecked BEFORE anything is serialised — an export without a checked
 * area must not carry the office's own books even filtered, only left out.
 * Called with no options this is byte-compatible with every file written
 * before this plan.
 * @param {string} [projektname]
 * @param {{ohne?: string[], ohneSettingKeys?: string[], art?: "sicherung"|"weitergabe", bereiche?: string[]}} [optionen]
 * @returns {Promise<{blob: Blob, dateiname: string, obj: object}>}
 */
export async function projektAlsBlob(projektname, { ohne = [], ohneSettingKeys = [], art, bereiche } = {}) {
  const volleDaten = await demoDbAuslesen();
  const daten = entferneBereiche(volleDaten, ohne, ohneSettingKeys);
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
 * @param {{behalte?: string[], behalteSettingKeys?: string[]}} [optionen]
 * @returns {Promise<{schnappschuss: object|null, schnappschussFehler: string|null}>}
 */
export async function uebernehmeProjekt(obj, { behalte = [], behalteSettingKeys = [] } = {}) {
  return demoDbErsetzen(obj.daten, 'vor Import', { behalte, behalteSettingKeys });
}
