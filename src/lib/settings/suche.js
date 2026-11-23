// Full-text search over the settings (80-03, KRITIK-05/A11Y-I18N-22: "jede
// Einstellung ist auffindbar") — over area titles/descriptions/keywords AND, for
// every visible rule book, individual rule labels/ids/sources. Pure: takes the
// registries as data instead of importing them, so a test needs no DOM and a
// caller controls exactly which rows are in scope.
//
// Area visibility (@/lib/settings/bereiche.js SICHTBARKEIT) and readiness are the
// CALLER's job — `bereiche` is expected to already be the list the page shows as
// tabs; suchUmfang() builds exactly that from sichtbareBereiche(kontext) and the
// area readiness, so the UI and the tests share one rule. Rule-book visibility is
// applied HERE, because every RegelGruppe already carries its own
// `sichtbar(kontext)` predicate (@core/lib/regelwerk.js) — reusing it needs no
// import of @/lib/settings/regelwerke.js and stays in sync with it automatically
// (DS-12/E-03: a hidden rule book, e.g. "personal" without access, yields none of
// its rules here either).
//
// In:  bereiche (already visible), regelwerke (any/all — filtered by kontext
//      here), kontext, an optional translator, a result cap.
// Out: sucheEinstellungen(text, optionen), suchUmfang(sichtbare, istBereit, regelwerke).

import { lockerBewerten, suchNormal } from "@core/lib/lockereSuche.js";

/**
 * One search hit.
 * @typedef {{bereich: string, regelId?: string, titel: string, treffer: string}} Treffer
 *   bereich: settings area key ('office', 'display', 'rules', …) — a rule match
 *     always carries the key of the area that houses rule books ('rules');
 *   regelId: only present for a rule match ('personal.mindestlohn', …);
 *   titel: the matched title (untranslated German — the caller passes it through
 *     `uebersetzen`/t() to render it); treffer: the field that matched (for a
 *     future result highlight, currently the same as titel).
 */

/** Settings-area key that houses every rule book (src/lib/settings/bereiche.js). */
const REGELN_BEREICH = "rules";

/**
 * Search scope of the settings page: the areas the page renders as tabs (visible in
 * the context AND ready) and the rule books only while the "rules" tab is among
 * them — every rule hit jumps to ?tab=rules, so without that tab it would land on
 * the fallback tab instead (80-03 task 6: hits on areas with BEREIT = false stay
 * hidden; E-03/DS-12: hits on hidden areas as well).
 * @template {{key: string}} B
 * @param {ReadonlyArray<B>} sichtbare areas visible in the context, i.e.
 *   sichtbareBereiche(kontext) from src/lib/settings/bereiche.js
 * @param {(key: string) => boolean} istBereit readiness per area key
 * @param {ReadonlyArray<import("@core/lib/regelwerk.js").RegelGruppe>} regelwerke all rule books
 * @returns {{bereiche: B[], regelwerke: ReadonlyArray<import("@core/lib/regelwerk.js").RegelGruppe>}}
 *   ready for sucheEinstellungen(text, {...umfang, kontext})
 */
export function suchUmfang(sichtbare, istBereit, regelwerke) {
  const bereiche = sichtbare.filter((b) => istBereit(b.key));
  return { bereiche, regelwerke: bereiche.some((b) => b.key === REGELN_BEREICH) ? regelwerke : [] };
}

/**
 * Searches the settings. Matching is the shared forgiving matcher (111-13,
 * @core/lib/lockereSuche: case, umlaut/ß spelling, word order and one small typo
 * do not matter) over: area title, description and keywords (German AND
 * translated) for `bereiche`; rule label, id and source for every rule of every
 * VISIBLE group of `regelwerke`. Area matches sort before rule matches; within
 * each group the better match comes first, equal matches keep registry order. An empty/whitespace query
 * returns no matches — the settings page shows no result list, not "everything".
 * @param {string} text raw search input (as typed)
 * @param {{
 *   bereiche?: ReadonlyArray<{key: string, titel: string, beschreibung: string, stichworte: string}>,
 *   regelwerke?: ReadonlyArray<import("@core/lib/regelwerk.js").RegelGruppe>,
 *   kontext?: any,
 *   uebersetzen?: (s: string) => string,
 *   max?: number,
 * }} [optionen]
 * @returns {Treffer[]} at most `max` (default 8) hits, areas before rules
 */
export function sucheEinstellungen(text, optionen = {}) {
  const { bereiche = [], regelwerke = [], kontext = {}, uebersetzen = (s) => s, max = 8 } = optionen;
  if (!suchNormal(text)) return [];

  // All fields of a row form one text, so the query words may come from different fields in any order (111-13).
  /** @param {Array<string|undefined|null>} felder @returns {number} 0 = no match */
  const wert = (felder) => lockerBewerten(text, felder.filter(Boolean).join(" "));
  /** @param {Array<{t: Treffer, w: number}>} liste @returns {Treffer[]} best first, stable */
  const geordnet = (liste) => liste.map((x, i) => ({ ...x, i })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.t);

  /** @type {Array<{t: Treffer, w: number}>} */
  const bereichsTreffer = [];
  for (const b of bereiche) {
    const w = wert([b.titel, uebersetzen(b.titel), b.beschreibung, uebersetzen(b.beschreibung), b.stichworte]);
    if (w > 0) bereichsTreffer.push({ t: { bereich: b.key, titel: b.titel, treffer: b.titel }, w });
  }

  /** @type {Array<{t: Treffer, w: number}>} */
  const regelTreffer = [];
  for (const gruppe of regelwerke) {
    if (gruppe.sichtbar && !gruppe.sichtbar(kontext)) continue;
    for (const r of gruppe.regeln || []) {
      const w = wert([r.label, uebersetzen(r.label), r.id, r.quelle, r.abschnitt]);
      if (w > 0) regelTreffer.push({ t: { bereich: REGELN_BEREICH, regelId: r.id, titel: r.label, treffer: r.label }, w });
    }
  }

  return [...geordnet(bereichsTreffer), ...geordnet(regelTreffer)].slice(0, max);
}
