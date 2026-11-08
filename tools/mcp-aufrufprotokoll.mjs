// mcp-aufrufprotokoll.mjs — call log of the MCP server (plan 111-01, finding K-03).
//
// Every tools/call of tools/mcp-server.mjs leaves exactly one JSON line in
// <data folder>/ki-protokoll/mcp-<YYYY-MM-DD>.jsonl: time, client, person, tool, shortened and
// redacted arguments, result kind, duration in milliseconds and the optional reason (begruendung).
// The log must never disturb a call: every write error is caught, the tool answer stays as it is,
// and the error appears once on stderr.
//
// In:  log entries (plain objects) from the MCP server; the data folder via an injected finder.
// Out: JSONL files (append, rotated by size, removed after a number of days); read-back for the
//      tool aufrufprotokoll_lesen.
// Imports nothing from packages/ (like tools/mcp-server.mjs, which ships without the app sources).
// No dependency — node:fs / node:path only.

import fs from 'node:fs';
import path from 'node:path';

/** Sub-folder of the data folder that holds the call log. */
export const PROTOKOLL_UNTERORDNER = 'ki-protokoll';

/**
 * Size limit of one log file in bytes before it is rotated (renamed to -1, -2 …).
 * [ASSUMED] 5 MB: about 10,000 calls with full arguments — enough for a day of agent work and still
 * opens in any text editor. No source; change when real logs show a different volume.
 */
export const MAX_DATEI_BYTES = 5 * 1024 * 1024;

/**
 * Days a log file is kept; older files are removed when the server first finds its log folder.
 * [ASSUMED] 30 days: long enough to answer "what did the agent do last month", short enough that a
 * forgotten log does not grow without bound. No legal retention rule known for this local log.
 */
export const AUFBEWAHRUNG_TAGE = 30;

/**
 * Longest text of one argument in characters before it is cut in the log.
 * [ASSUMED] 2,000 characters: an IFC property, a command line or a short note fits whole; a pasted
 * document or an image does not belong in the log.
 */
export const MAX_ARGUMENT_ZEICHEN = 2000;

/**
 * Redaction patterns of the Python harness, as written there (harness/harness/jsonlog.py REDACTIONS):
 * [Python regex source, Python replacement]. A unit test compares these texts with jsonlog.py, so both
 * logs hide the same secrets. `(?i)` and `\1` are converted for JavaScript in alsRegExp / alsErsatz.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const HARNESS_MUSTER = Object.freeze([
  [String.raw`\bsk-[A-Za-z0-9_-]{8,}`, 'sk-***'],
  [String.raw`(?i)\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}`, 'Bearer ***'],
  [String.raw`(?i)\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*\S+`, String.raw`\1=***`],
  [String.raw`(?i)(x-api-key\s*[:=]\s*)\S+`, String.raw`\1***`],
]);

/**
 * Patterns only the MCP server needs: the token of the local control channel (24 random bytes as
 * lowercase hex = 48 characters, server/steuerungRouter.js) and its header form.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const ZUSATZ_MUSTER = Object.freeze([
  [String.raw`(?i)(x-bit-steuerung\s*[:=]\s*)\S+`, String.raw`\1***`],
  // review 111-01: forms the harness list misses - "Authorization: Basic …", "password: x", "apikey=…", user:pw@host
  [String.raw`(?i)(authorization\s*[:=]\s*)(?!bearer\s+\*\*\*)(?:(?:basic|bearer|token|digest)\s+)?\S+`, String.raw`\1***`],
  [String.raw`(?i)\b((?:passw(?:or)?d|passwort|kennwort|pwd|apikey|api-key|secret)\w*\s*[:=]\s*)\S+`, String.raw`\1***`],
  [String.raw`(://[^:/@\s]+:)[^@\s]+@`, String.raw`\1***@`],
  [String.raw`(?<![0-9a-f])[0-9a-f]{48}(?![0-9a-f])`, '***'],
]);

/**
 * Wait in milliseconds before a failed data-folder lookup is tried again (5 min) [ASSUMED: long enough that a
 * hanging app does not slow every tool call, short enough that a later app start is picked up].
 */
export const NEU_VERSUCH_MS = 5 * 60 * 1000;

/** Argument keys whose value is never written, whatever it looks like (api_key, token, passwort …). */
const GEHEIME_SCHLUESSEL = /api[_-]?key|token|secret|passwor|kennwort|schluessel|schlüssel/i;

/**
 * Python regex source → JavaScript RegExp (global). Only the leading inline flag `(?i)` needs a change.
 * @param {string} quelle Python regex source
 * @returns {RegExp}
 */
export function alsRegExp(quelle) {
  const i = quelle.startsWith('(?i)');
  return new RegExp(i ? quelle.slice(4) : quelle, i ? 'gi' : 'g');
}

/**
 * Python replacement → JavaScript replacement: `\1` becomes `$1`.
 * @param {string} ersatz @returns {string}
 */
export function alsErsatz(ersatz) {
  return ersatz.replace(/\\(\d)/g, '$$$1');
}

const REGELN = [...HARNESS_MUSTER, ...ZUSATZ_MUSTER].map(([q, e]) => /** @type {[RegExp, string]} */ ([alsRegExp(q), alsErsatz(e)]));

/**
 * Hides secrets in a value before it is logged: known secret values (e.g. the control token read from
 * the data folder), the patterns above in every string, and every value under a secret-looking key.
 * Pure; returns a new value.
 * @param {unknown} wert any JSON-like value
 * @param {string[]} [geheimnisse] exact secret strings (≥ 8 characters) to replace by ***
 * @returns {unknown}
 */
export function schwaerzen(wert, geheimnisse = []) {
  if (typeof wert === 'string') {
    let t = wert;
    for (const g of geheimnisse) if (g && g.length >= 8) t = t.split(g).join('***');
    for (const [rx, ersatz] of REGELN) t = t.replace(rx, ersatz);
    return t;
  }
  if (Array.isArray(wert)) return wert.map((v) => schwaerzen(v, geheimnisse));
  if (wert && typeof wert === 'object') {
    /** @type {Record<string, unknown>} */
    const aus = {};
    for (const [k, v] of Object.entries(wert)) aus[k] = GEHEIME_SCHLUESSEL.test(k) && v != null && v !== '' ? '***' : schwaerzen(v, geheimnisse);
    return aus;
  }
  return wert;
}

/**
 * Cuts every top-level argument to `max` characters: a long text keeps its start plus a note, a long
 * object or list becomes the start of its JSON text plus a note. Short values stay as they are.
 * @param {unknown} args tool arguments (anything but a plain object gives {})
 * @param {number} [max] characters per argument
 * @returns {Record<string, unknown>}
 */
export function kuerzen(args, max = MAX_ARGUMENT_ZEICHEN) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  /** @type {Record<string, unknown>} */
  const aus = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') aus[k] = v.length > max ? `${v.slice(0, max)}… [gekürzt: ${v.length} Zeichen]` : v;
    else if (v && typeof v === 'object') {
      const json = JSON.stringify(v);
      aus[k] = json.length > max ? `${json.slice(0, max)}… [gekürzt: ${json.length} Zeichen JSON]` : v;
    } else aus[k] = v;
  }
  return aus;
}

/** @param {number} n @returns {string} two digits */
const zwei = (n) => String(n).padStart(2, '0');

/**
 * Local calendar day of a date as YYYY-MM-DD (the person's day, not UTC).
 * @param {Date} d @returns {string}
 */
export function tagText(d) {
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

/** File name pattern: mcp-<day>.jsonl (active) or mcp-<day>-<n>.jsonl (rotated, n = 1 oldest). */
const DATEI_MUSTER = /^mcp-(\d{4})-(\d{2})-(\d{2})(?:-(\d+))?\.jsonl$/;

/**
 * Renames a full log file to the first free suffix: mcp-<day>-1.jsonl, -2 …; the next line then starts
 * a fresh active file. Side effect: one rename.
 * @param {string} datei absolute path of the active file
 * @returns {string} the new path of the old content
 */
export function rotieren(datei) {
  const basis = datei.replace(/\.jsonl$/, '');
  let n = 1;
  while (fs.existsSync(`${basis}-${n}.jsonl`)) n += 1;
  const ziel = `${basis}-${n}.jsonl`;
  fs.renameSync(datei, ziel);
  return ziel;
}

/**
 * Appends one entry as a JSON line to today's file; rotates first when the line would push the file over
 * `maxBytes`. Synchronous on purpose: the line is on disk before the tool answer leaves. Throws on any file
 * error — the caller (AufrufProtokoll) catches it.
 * @param {string} ordner absolute log folder (created when missing)
 * @param {Record<string, unknown>} eintrag log entry
 * @param {{jetzt?: Date, maxBytes?: number}} [opt] date of the file name; size limit in bytes
 * @returns {string} path of the file written
 */
export function zeileAnhaengen(ordner, eintrag, { jetzt = new Date(), maxBytes = MAX_DATEI_BYTES } = {}) {
  fs.mkdirSync(ordner, { recursive: true });
  const datei = path.join(ordner, `mcp-${tagText(jetzt)}.jsonl`);
  const zeile = `${JSON.stringify(eintrag)}\n`;
  let groesse = 0;
  try { groesse = fs.statSync(datei).size; } catch { /* no file yet */ }
  if (groesse > 0 && groesse + Buffer.byteLength(zeile) > maxBytes) rotieren(datei);
  fs.appendFileSync(datei, zeile, 'utf8');
  return datei;
}

/**
 * Removes log files whose day (from the file name) lies more than `tage` days before `jetzt`.
 * Only files named like the log are touched; anything else in the folder stays.
 * @param {string} ordner absolute log folder
 * @param {{tage?: number, jetzt?: Date}} [opt] retention in days; "today" (injectable for tests)
 * @returns {string[]} names of the removed files
 */
export function aufraeumen(ordner, { tage = AUFBEWAHRUNG_TAGE, jetzt = new Date() } = {}) {
  let namen;
  try { namen = fs.readdirSync(ordner); } catch { return []; }
  const grenze = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - tage).getTime();
  const weg = [];
  for (const name of namen) {
    const m = DATEI_MUSTER.exec(name);
    if (!m) continue;
    const tag = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (tag < grenze) {
      fs.rmSync(path.join(ordner, name), { force: true });
      weg.push(name);
    }
  }
  return weg;
}

/**
 * Log files of the folder, oldest first: by day, and within a day the rotated files (-1, -2 …) before the
 * active one.
 * @param {string} ordner @returns {string[]} file names
 */
function dateienSortiert(ordner) {
  let namen;
  try { namen = fs.readdirSync(ordner); } catch { return []; }
  return namen.map((n) => ({ n, m: DATEI_MUSTER.exec(n) })).filter((x) => x.m)
    .map(({ n, m }) => ({ n, tag: `${m[1]}${m[2]}${m[3]}`, nr: m[4] ? Number(m[4]) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.tag === b.tag ? a.nr - b.nr : a.tag < b.tag ? -1 : 1))
    .map((x) => x.n);
}

/**
 * The last `anzahl` entries of the log (newest last), optionally only one tool or one result kind.
 * Reads files from the newest backwards until enough entries are found; a broken line is skipped.
 * @param {string} ordner absolute log folder
 * @param {{anzahl?: number, werkzeug?: string, ergebnis?: string}} [filter] count (entries); tool name; result kind
 * @returns {Array<Record<string, any>>}
 */
export function protokollLesen(ordner, { anzahl = 20, werkzeug, ergebnis } = {}) {
  /** @type {Array<Record<string, any>>} */
  const treffer = [];
  const dateien = dateienSortiert(ordner);
  for (let i = dateien.length - 1; i >= 0 && treffer.length < anzahl; i -= 1) {
    const zeilen = fs.readFileSync(path.join(ordner, dateien[i]), 'utf8').split('\n').filter(Boolean);
    for (let j = zeilen.length - 1; j >= 0 && treffer.length < anzahl; j -= 1) {
      let e;
      try { e = JSON.parse(zeilen[j]); } catch { continue; }
      if (werkzeug && e.werkzeug !== werkzeug) continue;
      if (ergebnis && e.ergebnis !== ergebnis) continue;
      treffer.push(e);
    }
  }
  return treffer.reverse();
}

/**
 * The call log of one MCP server process. Finds its folder once (and retries while none is known), cleans
 * up old files once, and writes entries without ever throwing.
 */
export class AufrufProtokoll {
  /**
   * @param {object} opt
   * @param {() => Promise<string|null>} opt.ordnerFinden returns the absolute DATA folder (not the log folder) or null
   * @param {(text: string) => void} [opt.melden] one line to stderr
   * @param {() => Date} [opt.jetzt] clock (tests)
   * @param {number} [opt.maxBytes] size limit per file in bytes
   * @param {number} [opt.aufbewahrungTage] retention in days
   * @param {string[]} [opt.geheimnisse] secret strings known up front (e.g. BIT_STEUERUNG_TOKEN)
   */
  constructor({ ordnerFinden, melden = (t) => process.stderr.write(`[bit-atelier-mcp] ${t}\n`), jetzt = () => new Date(),
    maxBytes = MAX_DATEI_BYTES, aufbewahrungTage = AUFBEWAHRUNG_TAGE, geheimnisse = [] }) {
    this.ordnerFinden = ordnerFinden;
    this.melden = melden;
    this.jetzt = jetzt;
    this.maxBytes = maxBytes;
    this.aufbewahrungTage = aufbewahrungTage;
    this.geheimnisse = geheimnisse.filter(Boolean);
    /** @type {string|null} absolute log folder once found */
    this.ordnerPfad = null;
    /** @type {Set<string>} kinds of problems already reported (each once per process) */
    this.gemeldet = new Set();
    /** @type {number} clock time (ms) of the last failed folder lookup; 0 = none */
    this.ordnerFehlschlag = 0;
  }

  /**
   * Redacts a value with this log's rules and known secrets (for fields that are cut BEFORE they reach
   * `schreiben`, e.g. the reason — redact first, then cut, so no secret prefix survives the cut).
   * @param {unknown} wert @returns {unknown}
   */
  bereinigen(wert) {
    return schwaerzen(wert, this.geheimnisse);
  }

  /**
   * Reports a problem once per kind and process.
   * @param {string} art kind key @param {string} text
   */
  einmal(art, text) {
    if (this.gemeldet.has(art)) return;
    this.gemeldet.add(art);
    try { this.melden(text); } catch { /* stderr gone: nothing left to tell */ }
  }

  /**
   * The log folder, or null when no data folder is known (then no log, one stderr line). A relative path is
   * refused: it would land in whatever folder the client started the server from.
   * @returns {Promise<string|null>}
   */
  async ordner() {
    if (this.ordnerPfad) return this.ordnerPfad;
    // a failed lookup is not repeated on every call: a hanging app would add its time limit to each tool call
    if (this.ordnerFehlschlag && this.jetzt().getTime() - this.ordnerFehlschlag < NEU_VERSUCH_MS) return null;
    let daten = null;
    try {
      daten = await this.ordnerFinden();
    } catch (err) {
      daten = null;
      this.einmal('ordner-fehler', `call log off: data folder not found (${/** @type {any} */ (err)?.message || err})`);
    }
    if (!daten) {
      this.ordnerFehlschlag = this.jetzt().getTime();
      this.einmal('ordner', 'call log off: no data folder (set BIT_DATA_DIR or start BIT-Atelier) - tool calls are not logged');
      return null;
    }
    if (!path.isAbsolute(daten)) {
      this.einmal('relativ', `call log off: data folder ${JSON.stringify(daten)} is not an absolute path`);
      return null;
    }
    this.ordnerPfad = path.join(daten, PROTOKOLL_UNTERORDNER);
    // the control token in the data folder is a secret of this computer: never in the log, whatever form it takes
    try { this.geheimnisse.push(fs.readFileSync(path.join(daten, 'steuerung.token'), 'utf8').trim()); } catch { /* no token file */ }
    try {
      const weg = aufraeumen(this.ordnerPfad, { tage: this.aufbewahrungTage, jetzt: this.jetzt() });
      if (weg.length) this.melden(`call log: removed ${weg.length} file(s) older than ${this.aufbewahrungTage} days`);
    } catch (err) {
      this.einmal('aufraeumen', `call log: clean-up failed (${/** @type {any} */ (err)?.message || err})`);
    }
    return this.ordnerPfad;
  }

  /**
   * Writes one entry (arguments, reason and message are redacted; arguments shortened). Never throws.
   * @param {Record<string, any>} eintrag fields of the log line; `argumente`, `begruendung`, `meldung` are cleaned here
   * @returns {Promise<boolean>} true when the line is on disk
   */
  async schreiben(eintrag) {
    try {
      const ordner = await this.ordner();
      if (!ordner) return false;
      const sauber = { ...eintrag };
      if ('argumente' in sauber) sauber.argumente = kuerzen(schwaerzen(sauber.argumente, this.geheimnisse));
      if (sauber.begruendung) sauber.begruendung = schwaerzen(sauber.begruendung, this.geheimnisse);
      if (typeof sauber.meldung === 'string') sauber.meldung = /** @type {string} */ (schwaerzen(sauber.meldung, this.geheimnisse)).slice(0, 300);
      zeileAnhaengen(ordner, sauber, { jetzt: this.jetzt(), maxBytes: this.maxBytes });
      return true;
    } catch (err) {
      this.einmal('schreiben', `call log could not be written (${/** @type {any} */ (err)?.message || err}) - tool answers are not affected`);
      return false;
    }
  }
}
