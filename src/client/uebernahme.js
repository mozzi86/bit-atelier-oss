// One-time takeover of an earlier installation into the desktop client's
// storage folder (Phase 70-03, Task 3).
//
// Two sources, checked in this order:
//   1. the Node installation's database (installer 92-02: %LOCALAPPDATA%\
//      BIT-Atelier\daten\db.json) — read-only through the shell, fixed paths;
//   2. the WebView's own IndexedDB of this client, where 70-02 kept the data
//      before the storage folder existed.
// The offer comes only when the storage folder holds no records yet (taking
// over into a filled folder would replace the user's work), and only once:
// meta.json gets an `uebernahme` note whatever the answer was.
//
// Order of a confirmed takeover: backup copy FIRST (the Node db.json is copied
// to <Ablageort>/uebernahme/, the IndexedDB content is written there as JSON),
// then the replacement through demoDbErsetzen (which also snapshots the
// previous, empty state), then the note in meta.json.
//
// In:  injected readers/writers (so the rules are node-testable).
// Out: uebernahmeAngebot(), uebernahmeAusfuehren(), uebernahmeAblehnen(),
//      plus the pure helpers zaehleDatensaetze / altbestandParsen.

/** Meta key of the note that stops the offer from coming twice. */
export const UEBERNAHME_META = 'uebernahme';

/**
 * Number of records in a database object `{ Entity: [records] }`; keys that
 * are not lists (a stray schema field) do not count.
 * @param {Record<string, unknown>|null|undefined} db
 * @returns {number}
 */
export function zaehleDatensaetze(db) {
  let n = 0;
  for (const rows of Object.values(db || {})) if (Array.isArray(rows)) n += rows.length;
  return n;
}

/**
 * Parses the Node installation's db.json. Only list-valued keys are kept —
 * the same shape demoDbErsetzen takes.
 * @param {string} text file content
 * @param {string} pfad for the message
 * @returns {Record<string, object[]>}
 * @throws {Error} plain text naming the file when it is not a database object
 */
export function altbestandParsen(text, pfad) {
  let roh;
  try {
    roh = JSON.parse(text);
  } catch (e) {
    throw new Error(`Die bisherige Datenbank ist beschädigt (${pfad}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Error(`Die bisherige Datenbank hat ein unbekanntes Format (${pfad}).`);
  /** @type {Record<string, object[]>} */
  const db = {};
  for (const [k, v] of Object.entries(roh)) if (Array.isArray(v)) db[k] = v;
  return db;
}

/**
 * @typedef {object} UebernahmeQuellen
 * @property {() => Promise<{pfad: string, text: string}|null>} altbestandLesen the Node db.json via the shell
 * @property {() => Promise<Record<string, object[]>>} webviewLesen this client's old IndexedDB content ({} when none)
 * @property {() => Promise<Record<string, object[]>>} ablageLesen current content of the storage folder
 * @property {(key: string, wert?: unknown) => Promise<unknown>} meta meta.json of the storage folder
 */

/**
 * @typedef {object} Angebot
 * @property {boolean} gefunden
 * @property {number} datensaetze
 * @property {'node'|'webview'|null} quelle
 * @property {string|null} pfad file of the Node source
 * @property {Record<string, object[]>|null} db the data to take over
 * @property {string|null} [grund] why there is no offer (shown nowhere, logged in meta)
 */

/**
 * Is there anything to take over? Also writes the `uebernahme` note when the
 * answer is a final "no" for a reason that will not change (folder already
 * filled), so the sources are not read again on every start.
 * @param {UebernahmeQuellen} q
 * @returns {Promise<Angebot>} `{gefunden: false, …}` when there is nothing to offer
 * @throws {Error} when the Node database exists but is damaged (shown to the user, not swallowed)
 */
export async function uebernahmeAngebot(q) {
  const kein = (/** @type {string} */ grund) => ({ gefunden: false, datensaetze: 0, quelle: null, pfad: null, db: null, grund });
  if (await q.meta(UEBERNAHME_META)) return kein('bereits entschieden');
  if (zaehleDatensaetze(await q.ablageLesen()) > 0) {
    await q.meta(UEBERNAHME_META, { zeit: new Date().toISOString(), ergebnis: 'uebersprungen', grund: 'Ablageort enthält bereits Daten' });
    return kein('Ablageort enthält bereits Daten');
  }
  const alt = await q.altbestandLesen();
  if (alt) {
    const db = altbestandParsen(alt.text, alt.pfad);
    const n = zaehleDatensaetze(db);
    if (n > 0) return { gefunden: true, datensaetze: n, quelle: 'node', pfad: alt.pfad, db };
  }
  const web = await q.webviewLesen();
  const n = zaehleDatensaetze(web);
  if (n > 0) return { gefunden: true, datensaetze: n, quelle: 'webview', pfad: null, db: web };
  return kein('nichts gefunden');
}

/**
 * Carries out a confirmed takeover: backup copy, replacement, note.
 * @param {Angebot} angebot from uebernahmeAngebot (gefunden: true)
 * @param {{
 *   sichernNode: (quelle: string, name: string) => Promise<string>,
 *   sichernText: (name: string, text: string) => Promise<string>,
 *   ersetzen: (db: Record<string, object[]>) => Promise<unknown>,
 *   meta: (key: string, wert?: unknown) => Promise<unknown>,
 *   jetzt?: () => Date,
 * }} w writers
 * @returns {Promise<{datensaetze: number, sicherung: string}>} records taken over, relative path of the backup copy
 */
export async function uebernahmeAusfuehren(angebot, w) {
  if (!angebot?.gefunden || !angebot.db) throw new Error('Es gibt nichts zu übernehmen.');
  const zeit = (w.jetzt ? w.jetzt() : new Date()).toISOString();
  const stempel = zeit.replace(/[:.]/g, '-');
  // Backup BEFORE anything is written into the storage folder.
  const sicherung = angebot.quelle === 'node' && angebot.pfad
    ? await w.sichernNode(angebot.pfad, `db-${stempel}.json`)
    : await w.sichernText(`webview-${stempel}.json`, JSON.stringify(angebot.db));
  await w.ersetzen(angebot.db);
  await w.meta(UEBERNAHME_META, { zeit, ergebnis: 'uebernommen', quelle: angebot.quelle, pfad: angebot.pfad, datensaetze: angebot.datensaetze, sicherung });
  return { datensaetze: angebot.datensaetze, sicherung };
}

/**
 * The user said no: remember it so the offer does not come again.
 * @param {Angebot} angebot
 * @param {(key: string, wert?: unknown) => Promise<unknown>} meta
 * @returns {Promise<void>}
 */
export async function uebernahmeAblehnen(angebot, meta) {
  await meta(UEBERNAHME_META, { zeit: new Date().toISOString(), ergebnis: 'abgelehnt', quelle: angebot?.quelle ?? null, datensaetze: angebot?.datensaetze ?? 0 });
}
