// Plan series ("Planreihe") and state ("Stand") from a file name — the ordering backbone of the
// Stände world. A plan from outside arrives again and again as a new dated file of the same
// drawing; recover/backup/copy files of the same date hang on that state instead of looking
// like a new one.
//
//   Planreihe = file name without date, without copy suffixes and without extension
//               ("Test-Reihe_2026-01-05.dxf" and "Test-Reihe 260210 (2).dxf" → "Test-Reihe")
//   Stand     = one dated version of a series (date from the name, else the passed file date)
//   Kopie     = _recover, backup, .bak, (2), "Kopie", "Copy" … of the same series and date
//
// In:  file names (strings), optional file dates. Out: plain objects. No I/O, no clock.

/**
 * Copy markers, checked case-insensitively against the name WITHOUT extension. Each must stand
 * as a word of its own (separated by space, _, -, . or the string edge). [ASSUMED list: the
 * suffixes AutoCAD, Windows, macOS and common file sync tools write.]
 * @type {ReadonlyArray<RegExp>}
 */
const KOPIE_MUSTER = Object.freeze([
  /(^|[\s_.-])recover(ed|y)?(?=$|[\s_.-])/i,
  /(^|[\s_.-])backup(?=$|[\s_.-])/i,
  /(^|[\s_.-])bak(?=$|[\s_.-])/i,
  /(^|[\s_.-])sicherung(?=$|[\s_.-])/i,
  /(^|[\s_.-])kopie(\s*\(\d+\))?(\s+von)?(?=$|[\s_.-])/i,
  /(^|[\s_.-])copy(\s*\(\d+\))?(\s+of)?(?=$|[\s_.-])/i,
  /\s*\(\d{1,3}\)\s*$/,
]);
// Not a copy marker on purpose: a bare trailing number ("Name 2", macOS duplicates) — it cannot
// be told apart from a plan number ("Grundriss EG 2").

/** Extensions that mark a backup file by themselves. */
const KOPIE_ENDUNGEN = Object.freeze(["bak", "sv$", "dxf~", "dwg~", "tmp"]);

/**
 * @typedef {{iso: string, quelle: 'name'|'datei', format: string|null, roh: string|null}} PlanDatum
 *   iso = 'YYYY-MM-DD'; format = which name pattern matched ('JJJJ-MM-TT', 'JJJJMMTT', 'JJMMTT',
 *   'TT.MM.JJJJ', 'TT.MM.JJ') or null for a file date; roh = matched text in the name
 * @typedef {{name: string, reihe: string, schluessel: string, datum: PlanDatum|null, kopie: boolean,
 *   kopieMerkmal: string|null, endung: string}} PlanDatei
 *   reihe = display name of the series; schluessel = grouping key (lower case, separators unified);
 *   kopieMerkmal = matched copy marker (null = original)
 */

/** Valid calendar date? Returns 'YYYY-MM-DD' or null. */
function isoDatum(/** @type {number} */ j, /** @type {number} */ m, /** @type {number} */ t) {
  if (!(j >= 1900 && j <= 2199 && m >= 1 && m <= 12 && t >= 1 && t <= 31)) return null;
  const d = new Date(Date.UTC(j, m - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) return null;
  return `${String(j).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
}

/** Two-digit year → 20JJ. [ASSUMED: plan files of this century; 19JJ would be a scanned archive plan with a 4-digit year.] */
const jahr2 = (/** @type {string} */ jj) => 2000 + Number(jj);

/**
 * Name date patterns in priority order. The digit runs must not touch other digits, so a plan
 * number like "A-1234567" is no date. Within one pattern the LAST occurrence wins (a date
 * appended later is the newer revision).
 * @type {ReadonlyArray<{format: string, re: RegExp, iso: (m: RegExpExecArray) => string|null}>}
 */
const DATUM_MUSTER = Object.freeze([
  { format: "JJJJ-MM-TT", re: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/g, iso: (m) => isoDatum(Number(m[1]), Number(m[2]), Number(m[3])) },
  { format: "TT.MM.JJJJ", re: /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g, iso: (m) => isoDatum(Number(m[3]), Number(m[2]), Number(m[1])) },
  { format: "TT.MM.JJ", re: /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/g, iso: (m) => isoDatum(jahr2(m[3]), Number(m[2]), Number(m[1])) },
  { format: "JJJJMMTT", re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g, iso: (m) => isoDatum(Number(m[1]), Number(m[2]), Number(m[3])) },
  // [ASSUMED] JJMMTT only when it is a valid date; a 6-digit plan number that happens to be one
  // (e.g. "120512") is read as a date — the user can still correct the state by hand later.
  { format: "JJMMTT", re: /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g, iso: (m) => isoDatum(jahr2(m[1]), Number(m[2]), Number(m[3])) },
]);

/**
 * Finds the date in a file name (without extension).
 * @param {string} stamm name without extension
 * @returns {{iso: string, format: string, start: number, ende: number, roh: string}|null}
 */
export function datumImNamen(stamm) {
  const s = String(stamm ?? "");
  for (const { format, re, iso } of DATUM_MUSTER) {
    re.lastIndex = 0;
    /** @type {{iso: string, format: string, start: number, ende: number, roh: string}|null} */
    let treffer = null;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const d = iso(m);
      if (d) treffer = { iso: d, format, start: m.index, ende: m.index + m[0].length, roh: m[0] };
    }
    if (treffer) return treffer;
  }
  return null;
}

/**
 * File date → 'YYYY-MM-DD' (local calendar day for Date/number; a string is taken as ISO).
 * @param {string|number|Date|null|undefined} d
 * @returns {string|null}
 */
export function dateiDatumIso(d) {
  if (d == null || d === "") return null;
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.trim());
    return m ? isoDatum(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return isoDatum(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Separators between name parts. */
const TRENNER = /[\s_.-]+/g;

/**
 * Splits a file name into series, date and copy marker.
 * @param {string} dateiname file name (a path is cut to its last part)
 * @param {{dateidatum?: string|number|Date|null}} [opt] file date (modified), used when the name has no date
 * @returns {PlanDatei}
 */
export function planDateiZerlegen(dateiname, { dateidatum = null } = {}) {
  const name = String(dateiname ?? "").split(/[\\/]/).pop() || "";
  // Extension: last ".xxx"; ".dxf.bak" → endung "bak", the inner ".dxf" is dropped as well.
  let stamm = name, endung = "";
  const pe = /\.([A-Za-z0-9$~]{1,5})$/.exec(stamm);
  if (pe) { endung = pe[1].toLowerCase(); stamm = stamm.slice(0, pe.index); }
  /** @type {string|null} */
  let kopieMerkmal = KOPIE_ENDUNGEN.includes(endung) ? `.${endung}` : null;
  if (kopieMerkmal) {
    const innen = /\.(dxf|dwg)$/i.exec(stamm);
    if (innen) stamm = stamm.slice(0, innen.index);
  }

  const dat = datumImNamen(stamm);
  let rest = dat ? `${stamm.slice(0, dat.start)} ${stamm.slice(dat.ende)}` : stamm;
  for (const re of KOPIE_MUSTER) {
    const m = re.exec(rest);
    if (m) { kopieMerkmal = kopieMerkmal || m[0].replace(/^[\s_.-]+/, "").trim(); rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length); }
  }
  const reihe = rest.replace(/[\s_.-]+$/g, "").replace(/^[\s_.-]+/g, "").replace(/\s{2,}/g, " ").trim() || stamm.trim() || name;
  const schluessel = reihe.toLowerCase().replace(TRENNER, " ").trim();

  /** @type {PlanDatum|null} */
  let datum = null;
  if (dat) datum = { iso: dat.iso, quelle: "name", format: dat.format, roh: dat.roh };
  else {
    const iso = dateiDatumIso(dateidatum);
    if (iso) datum = { iso, quelle: "datei", format: null, roh: null };
  }
  return { name, reihe, schluessel, datum, kopie: kopieMerkmal != null, kopieMerkmal, endung };
}

/**
 * @template T
 * @typedef {{datum: PlanDatum|null, datei: PlanDatei & {quelle: T}, kopien: Array<PlanDatei & {quelle: T}>}} PlanStand
 *   datei = the original (or, when only copies exist, the first copy); kopien = the rest
 */
/**
 * @template T
 * @typedef {{reihe: string, schluessel: string, staende: PlanStand<T>[]}} PlanReihe
 */

/**
 * Groups a file list into series → states (newest first, undated last) → copies.
 * Rules:
 * - Same series = same `schluessel`; display name = that of the newest original.
 * - Same state = same date ('YYYY-MM-DD'); undated files form one undated state per series.
 * - A copy whose date comes only from the FILE date (no date in its name) attaches to the newest
 *   state of its series that has an original [ASSUMED: a recover/backup file is written at
 *   another time than its original, so its file date says nothing about the plan state].
 * - Within a state the original comes first; several originals of one day (rare) — the first in
 *   name order is `datei`, the others are listed as `kopien` too.
 * @template T
 * @param {Array<{name: string, dateidatum?: string|number|Date|null, quelle?: T}>} dateien
 *   quelle = anything the caller wants back (id, File object …)
 * @returns {PlanReihe<T>[]} series sorted by display name
 */
export function dateienGruppieren(dateien) {
  /** @type {Map<string, Array<PlanDatei & {quelle: T}>>} */
  const jeReihe = new Map();
  for (const d of Array.isArray(dateien) ? dateien : []) {
    if (!d || typeof d.name !== "string") continue;
    const z = /** @type {PlanDatei & {quelle: T}} */ ({ ...planDateiZerlegen(d.name, { dateidatum: d.dateidatum }), quelle: /** @type {T} */ (d.quelle) });
    if (!jeReihe.has(z.schluessel)) jeReihe.set(z.schluessel, []);
    /** @type {Array<PlanDatei & {quelle: T}>} */ (jeReihe.get(z.schluessel)).push(z);
  }
  /** @type {PlanReihe<T>[]} */
  const reihen = [];
  for (const [schluessel, liste] of jeReihe) {
    liste.sort((a, b) => a.name.localeCompare(b.name));
    /** @type {Map<string, Array<PlanDatei & {quelle: T}>>} */
    const jeStand = new Map();
    const schl = (/** @type {PlanDatei} */ z) => z.datum?.iso ?? "";
    const neuesterMitOriginal = liste.filter((z) => !z.kopie).map(schl).sort().reverse()[0];
    for (const z of liste) {
      let k = schl(z);
      if (z.kopie && z.datum?.quelle !== "name" && neuesterMitOriginal != null) k = neuesterMitOriginal;
      if (!jeStand.has(k)) jeStand.set(k, []);
      /** @type {Array<PlanDatei & {quelle: T}>} */ (jeStand.get(k)).push(z);
    }
    /** @type {PlanStand<T>[]} */
    const staende = [];
    for (const [k, dl] of jeStand) {
      const originale = dl.filter((z) => !z.kopie), kopien = dl.filter((z) => z.kopie);
      const datei = originale[0] || kopien[0];
      const rest = [...originale, ...kopien].filter((z) => z !== datei);
      const nameDatum = dl.find((z) => z.datum?.quelle === "name")?.datum;
      staende.push({ datum: k ? (datei.datum?.iso === k ? datei.datum : nameDatum || { iso: k, quelle: "datei", format: null, roh: null }) : null, datei, kopien: rest });
    }
    // Newest first, undated last.
    staende.sort((a, b) => (a.datum ? (b.datum ? b.datum.iso.localeCompare(a.datum.iso) : -1) : (b.datum ? 1 : 0)));
    const anzeige = staende.find((s) => !s.datei.kopie)?.datei.reihe ?? staende[0].datei.reihe;
    reihen.push({ reihe: anzeige, schluessel, staende });
  }
  return reihen.sort((a, b) => a.reihe.localeCompare(b.reihe));
}
