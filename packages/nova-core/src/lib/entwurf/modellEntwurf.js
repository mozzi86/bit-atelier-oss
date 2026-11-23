// 115-05c (D-115-12, D-115-51): the pure draft core of the building model ("Entwurfsmodus").
//
// Model changes (building model, site, location) are a DRAFT until the person presses "Speichern". A draft holds, per record
// (bim = BimModel, komplex = BuildingComplex), only the fields that differ from the stored base the page knows, plus the base
// values of exactly those fields and the base's id / updated_date. That is enough to
//   - say how many changes are unsaved (entwurfAenderungen: per element for keyed lists),
//   - decide how a stored state goes together with the draft (entwurfEntscheiden: equal / rebase / replaced / deleted),
//   - rebase the draft on a newer stored state with the rules of 115-05a (entwurfRebase: local NEW elements are renumbered
//     against the full base, three ways per element, the site/location group as ONE unit, derived values never conflict) and
//     check its references (K7: an opening whose wall is gone is reported, never silently orphaned),
//   - keep what a save did NOT write (entwurfNachSpeichern, K5: the two records are not written atomically).
// Confirmed proposal steps (D-115-51: KI and "Zeigen und Sagen" land in the draft) wait in `schritte` and are written to the
// change log only after a successful save (entwurfSchrittVormerken / entwurfSchrittEntfernen).
//
// Pure: no I/O, no React; storage is entwurfSpeicher.js, the page wiring entwurfStand.js. Loaded lazily (size budget).
//
// In:  stored values, the page's values, stored records. Out: draft objects (format v1) and merge results.

import { elementSchluessel, gleichWert } from "../abgleich/dreiWege.js";
import { IDX_LISTEN } from "../abgleich/idxListen.js";
import { fremdeElementeAbgleichen, neueKollisionenUmnummern } from "../abgleich/modellAbgleich.js";
import { komplexAbgleichen } from "../abgleich/komplexAbgleich.js";
import { ABGELEITET } from "./entwurfRegeln.js";

/** Format version of a stored draft; another version is never misread (entwurfSpeicher.js). */
export const ENTWURF_VERSION = 1;

/**
 * The stored base of one record as the draft knows it.
 * @typedef {{id: string|null, updated_date: string|null, felder: Record<string, any>, idx?: Record<string, number[]>}} EntwurfBasis
 *   felder = the stored values of exactly the fields in `aenderungen`; idx (bim only) = the `_idx` numbers of every element list in
 *   the base (renumbering needs the full base, 115-05a A-1; the lists themselves are kept only for the changed fields)
 */

/**
 * A draft of one person on one project (format v1).
 * @typedef {{v: number, benutzer: string, projekt: string, zeit: string,
 *   basis: {bim: EntwurfBasis|null, komplex: EntwurfBasis|null},
 *   aenderungen: {bim: Record<string, any>, komplex: Record<string, any>},
 *   schritte: Array<{vorschlag_id: string, eintrag: any, pruefung?: any}>}} ModellEntwurf
 */

/** @typedef {"bim"|"komplex"} EntwurfTeil */

/**
 * An empty (clean) draft.
 * @param {{benutzer: string, projekt: string, jetzt?: Date}} a benutzer = user id; projekt = project id
 * @returns {ModellEntwurf}
 */
export function entwurfLeer({ benutzer, projekt, jetzt = new Date() }) {
  return { v: ENTWURF_VERSION, benutzer: String(benutzer), projekt: String(projekt), zeit: jetzt.toISOString(),
    basis: { bim: null, komplex: null }, aenderungen: { bim: {}, komplex: {} }, schritte: [] };
}

/** @param {any} v @returns {number[]} the `_idx` numbers of a list */
const idxVon = (v) => (Array.isArray(v) ? v.map((e) => e?._idx).filter((x) => typeof x === "number") : []);

/**
 * A source of the page reports its values (the studio its lists and envelope values, the program hook its fields, the designer
 * the site group). Only fields that differ from the base stay in the draft; a field back at its stored value leaves it. The
 * fields of OTHER sources of the same record are left alone.
 * @param {ModellEntwurf} e the draft
 * @param {EntwurfTeil} teil which record
 * @param {{stand: {id?: any, updated_date?: any}|null, basis: Record<string, any>, werte: Record<string, any>, felder: ReadonlyArray<string>,
 *   idx?: Record<string, number[]>|null}} q stand = id / updated_date of the base; basis = stored values (at least `felder`);
 *   werte = the page's values; felder = the fields this source owns; idx = `_idx` numbers of every element list of the base (bim)
 * @param {Date} [jetzt]
 * @returns {ModellEntwurf} a new draft (the input is not changed)
 */
export function entwurfMelden(e, teil, { stand, basis, werte, felder, idx = null }, jetzt = new Date()) {
  const alt = e.basis[teil];
  const aenderungen = { ...e.aenderungen[teil] };
  const basisFelder = { ...(alt?.felder || {}) };
  for (const k of felder) {
    if (gleichWert(werte?.[k], basis?.[k])) { delete aenderungen[k]; delete basisFelder[k]; continue; }
    aenderungen[k] = werte?.[k];
    basisFelder[k] = basis?.[k];
  }
  /** @type {EntwurfBasis} */
  const neueBasis = { id: stand?.id ?? alt?.id ?? null, updated_date: stand?.updated_date ?? alt?.updated_date ?? null, felder: basisFelder };
  const idxNeu = idx ?? alt?.idx;
  if (idxNeu) neueBasis.idx = idxNeu;
  return { ...e, zeit: jetzt.toISOString(), basis: { ...e.basis, [teil]: neueBasis }, aenderungen: { ...e.aenderungen, [teil]: aenderungen } };
}

/**
 * Number of unsaved changes: per element of a keyed list (added, removed, changed), 1 per other field; derived values do not count.
 * @param {ModellEntwurf|null|undefined} e @returns {number}
 */
export function entwurfAenderungen(e) {
  if (!e) return 0;
  let n = 0;
  for (const teil of /** @type {EntwurfTeil[]} */ (["bim", "komplex"])) {
    const basis = e.basis?.[teil]?.felder || {};
    for (const [k, v] of Object.entries(e.aenderungen?.[teil] || {})) {
      if (ABGELEITET.includes(k)) continue;
      const b = basis[k];
      if (Array.isArray(v) && (Array.isArray(b) || b == null)) {
        const B = new Map((b || []).map((/** @type {any} */ el) => [elementSchluessel(el), el]));
        const M = new Map(v.map((el) => [elementSchluessel(el), el]));
        let d = 0;
        for (const key of new Set([...B.keys(), ...M.keys()])) if (!gleichWert(B.get(key), M.get(key))) d += 1;
        n += d || 1; // a list that differs only by order or unkeyed elements still is one change
      } else n += 1;
    }
  }
  return n;
}

/**
 * Whether nothing would be lost: no counted change and no waiting proposal step.
 * @param {ModellEntwurf|null|undefined} e @returns {boolean}
 */
export function entwurfSauber(e) {
  return entwurfAenderungen(e) === 0 && !(e?.schritte?.length);
}

/**
 * How a stored record goes together with the draft's base of that record. Compared on INEQUALITY (115-05a): an import, a
 * seed or a restore keeps an older updated_date and is another state all the same.
 * @param {EntwurfBasis|null|undefined} basis the draft's base of the record (null = nothing drafted)
 * @param {{id?: any, updated_date?: any}|null|undefined} server the stored record now (null = there is none)
 * @returns {"gleich"|"rebase"|"ersetzt"|"geloescht"} gleich = the draft fits as it is; rebase = another state of the same record
 *   (or one created meanwhile): merge three ways; ersetzt = another record id (import, restore): never continued automatically;
 *   geloescht = the record the draft was made on is gone
 */
export function entwurfEntscheiden(basis, server) {
  if (!basis || !Object.keys(basis.felder || {}).length) return "gleich";
  if (basis.id == null) return server ? "rebase" : "gleich";
  if (!server) return "geloescht";
  if (String(server.id ?? "") !== String(basis.id)) return "ersetzt";
  return String(server.updated_date ?? "") === String(basis.updated_date ?? "") ? "gleich" : "rebase";
}

/**
 * K7: openings (customWindows) whose wall (wallIdx) is not in the walls - a rebase must not leave them silently orphaned.
 * @param {{customWalls?: any[], customWindows?: any[]}} werte the merged lists
 * @returns {Array<{schluessel: string|null, wallIdx: any}>} one entry per orphaned opening
 */
export function verweisePruefen(werte) {
  const waende = new Set(idxVon(werte?.customWalls));
  return (Array.isArray(werte?.customWindows) ? werte.customWindows : [])
    .filter((o) => o && o.wallIdx != null && !waende.has(o.wallIdx))
    .map((o) => ({ schluessel: elementSchluessel(o), wallIdx: o.wallIdx }));
}

/**
 * Rebases the draft of one record on a stored state that is not its base.
 * bim: local NEW elements (missing in the full base of their list) that carry a number the stored state gave to a new element of
 * its own get a free number first (115-05a A-1), then three ways per element; references are checked (K7).
 * komplex: komplexAbgleichen - the site/location group as ONE unit, derived values never a conflict (the stored value counts).
 * @param {{teil: EntwurfTeil, basis: Record<string, any>, mein: Record<string, any>, server: Record<string, any>,
 *   idxBasis?: Record<string, number[]>|null}} a basis = the draft's base values (of the changed fields; komplex: normalised);
 *   mein = the draft's values; server = the stored values now (all fields); idxBasis = `_idx` numbers of every list of the base
 * @returns {{werte: Record<string, any>, konflikte: any, umbenanntJeListe: Record<string, Array<[number, number]>>,
 *   verweise: Array<{schluessel: string|null, wallIdx: any}>}} werte = the draft's fields after the rebase (mine for every
 *   conflicting element); konflikte = per field (bim, dreiWege Konflikt[]) or a list (komplex, KomplexKonflikt[])
 */
export function entwurfRebase({ teil, basis, mein, server, idxBasis = null }) {
  const felder = Object.keys(mein || {});
  if (teil === "komplex") {
    const r = komplexAbgleichen({ basis: { ...server, ...basis }, mein: { ...server, ...mein }, fremd: server });
    const werte = Object.fromEntries(felder.map((k) => [k, k in r.setzen ? r.setzen[k] : mein[k]]));
    for (const k of Object.keys(r.setzen)) if (!(k in werte)) werte[k] = r.setzen[k];
    return { werte, konflikte: r.konflikte, umbenanntJeListe: {}, verweise: [] };
  }
  // the full base for renumbering: the draft's lists where it has them, else stubs of the stored numbers it knew, else the stored
  // list now (then nothing in it counts as a foreign new element)
  /** @type {Record<string, any>} */ const basisVoll = {};
  /** @type {Record<string, any>} */ const lokal = {};
  /** @type {Record<string, any>} */ const patch = {};
  for (const l of IDX_LISTEN) {
    basisVoll[l] = l in basis ? basis[l] : idxBasis?.[l] ? idxBasis[l].map((i) => ({ _idx: i })) : server?.[l];
    lokal[l] = l in mein ? mein[l] : server?.[l];
    if (server && l in server) patch[l] = server[l];
  }
  const k = neueKollisionenUmnummern({ vorher: basis, lokal, patch, basis: basisVoll });
  const meinNeu = { ...mein };
  for (const l of IDX_LISTEN) if (l in mein) meinNeu[l] = k.lokal[l];
  const umbenanntJeListe = Object.fromEntries(Object.entries(k.umbenanntJeListe).filter(([l]) => l in mein));
  const fremd = Object.fromEntries(felder.map((f) => [f, server?.[f]]));
  const r = fremdeElementeAbgleichen({ patch: fremd, vorher: basis, lokal: meinNeu, felder });
  const werte = { ...meinNeu, ...r.setzen };
  const verweise = "customWindows" in werte || "customWalls" in werte
    ? verweisePruefen({ customWalls: werte.customWalls ?? server?.customWalls, customWindows: werte.customWindows ?? server?.customWindows })
    : [];
  return { werte, konflikte: r.konflikte, umbenanntJeListe, verweise };
}

/**
 * The stored list without the GUIDs the save pinned (steckbrief guidsAnheften): an element the draft holds without `guid` counts
 * as stored when the stored one differs only by its new `guid`.
 * @param {any} mein the draft's value @param {any} gespeichert the stored value @returns {any}
 */
function ohneAngehefteteGuids(mein, gespeichert) {
  if (!Array.isArray(mein) || !Array.isArray(gespeichert)) return gespeichert;
  const ohne = new Map(mein.map((el) => [elementSchluessel(el), el?.guid == null]));
  return gespeichert.map((el) => {
    if (!el || el.guid == null || !ohne.get(elementSchluessel(el))) return el;
    const { guid: _g, ...rest } = el;
    return rest;
  });
}

/**
 * After a save of one record: what the stored record carries now leaves the draft, the rest stays (a field held back by a
 * conflict, K5 "partly saved"); the base moves to the stored record.
 * @param {ModellEntwurf} e @param {EntwurfTeil} teil @param {any} gespeichert the stored record (with id / updated_date)
 * @returns {ModellEntwurf}
 */
export function entwurfNachSpeichern(e, teil, gespeichert) {
  const aenderungen = { ...e.aenderungen[teil] };
  /** @type {Record<string, any>} */ const felder = {};
  for (const [k, v] of Object.entries(aenderungen)) {
    if (gleichWert(v, gespeichert?.[k]) || gleichWert(v, ohneAngehefteteGuids(v, gespeichert?.[k]))) delete aenderungen[k];
    else felder[k] = gespeichert?.[k];
  }
  const alt = e.basis[teil];
  /** @type {EntwurfBasis} */
  const basis = { id: gespeichert?.id ?? alt?.id ?? null, updated_date: gespeichert?.updated_date ?? alt?.updated_date ?? null, felder };
  if (alt?.idx) basis.idx = Object.fromEntries(IDX_LISTEN.map((l) => [l, gespeichert && l in gespeichert ? idxVon(gespeichert[l]) : alt.idx?.[l] || []]));
  return { ...e, basis: { ...e.basis, [teil]: basis }, aenderungen: { ...e.aenderungen, [teil]: aenderungen } };
}

/**
 * D-115-51: a confirmed proposal step waits in the draft; it is written to the change log after the save.
 * @param {ModellEntwurf} e @param {{vorschlag_id: string, eintrag: any, pruefung?: any}} s @returns {ModellEntwurf}
 */
export function entwurfSchrittVormerken(e, s) {
  return { ...e, schritte: [...(e.schritte || []).filter((x) => x.vorschlag_id !== s.vorschlag_id), { ...s, vorschlag_id: String(s.vorschlag_id) }] };
}

/**
 * D-115-51: undo of a waiting step removes its waiting log entry (nothing was written yet).
 * @param {ModellEntwurf} e @param {string} vorschlagId
 * @returns {{entwurf: ModellEntwurf, removed: boolean}} removed = the step was waiting (else it is stored and the caller marks it)
 */
export function entwurfSchrittEntfernen(e, vorschlagId) {
  const vorher = e.schritte || [];
  const schritte = vorher.filter((x) => x.vorschlag_id !== String(vorschlagId));
  return { entwurf: schritte.length === vorher.length ? e : { ...e, schritte }, removed: schritte.length !== vorher.length };
}
