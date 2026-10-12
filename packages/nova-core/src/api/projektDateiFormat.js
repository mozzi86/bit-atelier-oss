// projektDateiFormat.js — the pure half of the .bitproj project file (plan 93-10, split out of
// projektDatei.js): format constants, serialisation, area filter, parser, the "keep what the file
// lacks" merge and the "add as copy" merge.
//
// Why a separate module: since 93-10 the local Express server reads .bitproj files too (double-click
// on a file → server/dateiOeffnenRouter.js). The server must validate with THE SAME parser the browser
// import uses, but it cannot import projektDatei.js, which pulls the in-browser database (demoDb.js →
// IndexedDB). Everything here is free of storage, DOM and Node APIs, so both sides import it.
// projektDatei.js re-exports every name, so existing imports keep working unchanged.
//
// In:  plain data objects / the bytes of a file. Out: plain data objects; nothing is written anywhere.
//
// Format v1: { schema: 1, app: "bit-atelier-demo", exportiert: <ISO>, projektname: <string>,
//              art?: "sicherung"|"weitergabe", bereiche?: string[], daten: { [Entity]: [...] } }
// The file starts with "{" when stored as plain text and with 0x1f 0x8b when gzipped.

import { neueId } from './sammlungKern.js';

/** Current file format version. Bump only with a migration in parseProjektDatei(). */
export const SCHEMA = 1;
/** File extension of a project file, with the dot. */
export const DATEI_ENDUNG = '.bitproj';

/**
 * Builds the export object.
 * 79-12 (E-07): `art`/`bereiche` are optional and generic — this module has no idea what an "area" is,
 * it only stores what the caller (src/lib/exportBereiche.js) already decided. Omitted, the file looks
 * exactly like one written before 79-12 (byte-compatible).
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
 * Drops whole collections, and Setting rows with the given keys, from a data snapshot before it is
 * serialised (E-07: a handover export must not carry the office's own books at all — not even filtered
 * to zero rows). Returns a new object; `daten` itself is never mutated.
 * @param {Record<string, object[]>} daten
 * @param {string[]} ohne collection names to drop entirely
 * @param {string[]} ohneSettingKeys `Setting.key` values to drop from the Setting rows
 * @param {string[]} [ohneDokumentBereiche] 82-02: `Document.bereich` values whose rows are dropped
 * @returns {Record<string, object[]>}
 */
export function entferneBereiche(daten, ohne, ohneSettingKeys, ohneDokumentBereiche = []) {
  if (!ohne.length && !ohneSettingKeys.length && !ohneDokumentBereiche.length) return daten;
  const raus = new Set(ohne);
  /** @type {Record<string, object[]>} */
  const ergebnis = {};
  for (const [entity, rows] of Object.entries(daten)) {
    if (raus.has(entity)) continue; // key left out entirely (presence-based import, see exportBereiche.js)
    if (entity === 'Setting' && ohneSettingKeys.length) {
      ergebnis[entity] = (rows || []).filter((r) => !ohneSettingKeys.includes(/** @type {any} */ (r)?.key));
      continue;
    }
    if (entity === 'Document' && ohneDokumentBereiche.length) {
      ergebnis[entity] = (rows || []).filter((r) => !ohneDokumentBereiche.includes(/** @type {any} */ (r)?.bereich));
      continue;
    }
    ergebnis[entity] = rows;
  }
  return ergebnis;
}

/**
 * Record counts per collection, for the preview before an import overwrites anything. A file written
 * before 79-12 has neither `art` nor `bereiche` and is read as a full backup (`art: "sicherung"`).
 * @param {object} obj parsed project object
 * @returns {{projektname: string, exportiert: string, anzahl: Record<string, number>, gesamt: number, art: "sicherung"|"weitergabe", bereiche: string[]}}
 */
export function vorschau(obj) {
  const o = /** @type {any} */ (obj);
  /** @type {Record<string, number>} */
  const anzahl = {};
  let gesamt = 0;
  for (const [entity, rows] of Object.entries(o?.daten || {})) {
    const n = Array.isArray(rows) ? rows.length : 0;
    anzahl[entity] = n;
    gesamt += n;
  }
  return {
    projektname: o?.projektname || '(ohne Namen)',
    exportiert: o?.exportiert || '(ohne Datum)',
    anzahl,
    gesamt,
    art: o?.art === 'weitergabe' ? 'weitergabe' : 'sicherung',
    bereiche: Array.isArray(o?.bereiche) ? o.bereiche : [],
  };
}

/**
 * True when the bytes start with the gzip magic number.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function istGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Parses a project file, transparently handling the gzipped and the plain form. Rejects anything that
 * is not a v1 project file — a half-applied import would be worse than none.
 * The server (93-10) unpacks gzip itself with a size cap first and hands in the plain bytes, so the
 * DecompressionStream branch only runs in the browser.
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
    // Cast: TS does not accept Uint8Array as BlobPart here, the browser does.
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
  if (!obj?.daten || typeof obj.daten !== 'object' || Array.isArray(obj.daten)) {
    throw new Error('Die Projektdatei enthält keine Daten.');
  }
  return obj;
}

/**
 * The state an import leaves behind: the file's collections, plus — from the CURRENT state — every
 * collection, Setting row and Document area the file does not carry (79-12/82-02: a handover file
 * without an office area must not wipe that area locally). Pure; used by demoDb.demoDbErsetzen (browser)
 * and by the server import (93-10), so both editions keep exactly the same things.
 * @param {Record<string, object[]>} vorher current state (not mutated)
 * @param {Record<string, object[]>} db the file's collections (not mutated)
 * @param {{behalte?: string[], behalteSettingKeys?: string[], behalteDokumentBereiche?: string[]}} [optionen]
 * @returns {Record<string, object[]>} the new state (shares row objects with the inputs)
 */
export function mitBehaltenem(vorher, db, { behalte = [], behalteSettingKeys = [], behalteDokumentBereiche = [] } = {}) {
  if (!behalte.length && !behalteSettingKeys.length && !behalteDokumentBereiche.length) return db;
  /** @type {Record<string, object[]>} */
  const neu = { ...db };
  for (const entity of behalte) {
    if (!Object.prototype.hasOwnProperty.call(db, entity) && vorher[entity]) neu[entity] = vorher[entity];
  }
  if (behalteSettingKeys.length) {
    const alteZeilen = (vorher.Setting || []).filter((r) => behalteSettingKeys.includes(/** @type {any} */ (r)?.key));
    if (alteZeilen.length) {
      const neueZeilen = (neu.Setting || []).filter((r) => !behalteSettingKeys.includes(/** @type {any} */ (r)?.key));
      neu.Setting = [...neueZeilen, ...alteZeilen];
    }
  }
  if (behalteDokumentBereiche.length) {
    const alteDoks = (vorher.Document || []).filter((r) => behalteDokumentBereiche.includes(/** @type {any} */ (r)?.bereich));
    const neueDoks = (neu.Document || []).filter((r) => !behalteDokumentBereiche.includes(/** @type {any} */ (r)?.bereich));
    if (alteDoks.length || neueDoks.length !== (neu.Document || []).length) neu.Document = [...neueDoks, ...alteDoks];
  }
  return neu;
}

/**
 * Project ids and names of a data object — the identity a re-opened file is recognised by (93-10:
 * "same project" = at least one `Project.id` of the file exists locally).
 * @param {Record<string, object[]>|null|undefined} daten
 * @returns {Array<{id: string, name: string}>}
 */
export function projekteIn(daten) {
  const zeilen = Array.isArray(daten?.Project) ? daten.Project : [];
  return zeilen
    .filter((p) => typeof /** @type {any} */ (p)?.id === 'string' && /** @type {any} */ (p).id)
    .map((p) => ({ id: /** @type {any} */ (p).id, name: String(/** @type {any} */ (p).name || /** @type {any} */ (p).title || '') }));
}

/**
 * Projects of the file that already exist locally (same id).
 * @param {Record<string, object[]>} dateiDaten the file's collections
 * @param {Iterable<string>} lokaleIds project ids present locally
 * @returns {Array<{id: string, name: string}>}
 */
export function vorhandeneProjekte(dateiDaten, lokaleIds) {
  const lokal = new Set(lokaleIds);
  return projekteIn(dateiDaten).filter((p) => lokal.has(p.id));
}

/**
 * Adds the file's PROJECT data next to the local data as an independent copy (93-10 "als Kopie"):
 * every taken record gets a fresh id, and every string value — or object key — anywhere in a taken
 * record that equals an old id of the file is rewritten to the new id, so project_id references and
 * id-keyed maps keep pointing inside the copy. Project names get `zusatz` appended.
 * Never taken: `Setting` (office settings), the collections in `ohne` (the caller passes the office
 * areas of the export registry), Document rows of `ohneDokumentBereiche`, and rows with
 * `scope: "buero"` (office-wide catalogues, catalog-seed.js) — a copy of a project must not duplicate
 * the office's own books or standards.
 * @param {Record<string, object[]>} lokal current state (not mutated)
 * @param {Record<string, object[]>} dateiDaten the file's collections (not mutated)
 * @param {{ohne?: string[], ohneDokumentBereiche?: string[], zusatz?: string, idFabrik?: () => string}} [optionen]
 *   zusatz = suffix for Project names (default " (Kopie)"); idFabrik = id generator (tests)
 * @returns {{daten: Record<string, object[]>, kopiert: number}} the merged state and the count of added records
 */
export function kopieAnfuegen(lokal, dateiDaten, { ohne = [], ohneDokumentBereiche = [], zusatz = ' (Kopie)', idFabrik = neueId } = {}) {
  const raus = new Set(['Setting', ...ohne]);
  /** @type {Record<string, any[]>} */
  const auswahl = {};
  /** @type {Map<string, string>} */
  const neueIds = new Map();
  for (const [entity, rows] of Object.entries(dateiDaten || {})) {
    if (raus.has(entity) || !Array.isArray(rows)) continue;
    const genommen = rows.filter((r) => {
      const z = /** @type {any} */ (r);
      if (!z || typeof z !== 'object' || Array.isArray(z)) return false;
      if (z.scope === 'buero') return false;
      if (entity === 'Document' && ohneDokumentBereiche.includes(z.bereich)) return false;
      return true;
    });
    if (!genommen.length) continue;
    auswahl[entity] = genommen;
    for (const z of genommen) {
      if (typeof z.id === 'string' && z.id && !neueIds.has(z.id)) neueIds.set(z.id, idFabrik());
    }
  }

  /** @param {any} wert @returns {any} */
  const umschreiben = (wert) => {
    if (typeof wert === 'string') return neueIds.get(wert) ?? wert;
    if (Array.isArray(wert)) return wert.map(umschreiben);
    if (wert && typeof wert === 'object') {
      /** @type {Record<string, any>} */
      const kopie = {};
      for (const [k, v] of Object.entries(wert)) kopie[neueIds.get(k) ?? k] = umschreiben(v);
      return kopie;
    }
    return wert;
  };

  /** @type {Record<string, object[]>} */
  const daten = { ...lokal };
  let kopiert = 0;
  for (const [entity, rows] of Object.entries(auswahl)) {
    const kopien = rows.map((r) => {
      const k = umschreiben(r);
      if (entity === 'Project' && typeof k.name === 'string') k.name = `${k.name}${zusatz}`;
      return k;
    });
    daten[entity] = [...(lokal[entity] || []), ...kopien];
    kopiert += kopien.length;
  }
  return { daten, kopiert };
}
