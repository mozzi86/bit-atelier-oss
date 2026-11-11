// Base proposal ("Basisvorschlag") and revision index of the Stände world.
//
// Base: per storey one state is the drawing base everything else is compared against. The
// proposal is only a default — the user can pick another state; this module never decides
// silently.
// Revision: the plan's letter index (A … Z, AA …) rises ONLY on a hand-over ("Abgabe") and only
// when something changed since the last hand-over — the set of change IDs or the base state.
// Handing the same content over twice keeps the index.
//
// In:  plain state/change objects. Out: plain objects. No I/O; the date is passed in.

import { bboxFlaeche } from "./dxfPlangrundlage.js";

/**
 * @typedef {import("./dxfPlangrundlage.js").PlanBbox} PlanBbox
 * @typedef {{id: string, reihe: string, datum: string|null, ausrichtung?: {art: 'auto'|'manuell'|'offen'}|null, bbox?: PlanBbox|null}} BasisKandidat
 *   reihe = series key (planReihe.js `schluessel`); datum = 'YYYY-MM-DD' or null (undated)
 * @typedef {{standId: string|null, grund: 'referenzreihe'|'flaeche'|'keiner'}} BasisVorschlag
 */

/** Minimum share of the reference bbox area a non-reference state must cover. [ASSUMED 50 %, from the feature description] */
export const BASIS_MIN_FLAECHENANTEIL = 0.5;

/** Newest first, undated last; same date → id order (stable, deterministic). */
function neuesteZuerst(/** @type {BasisKandidat} */ a, /** @type {BasisKandidat} */ b) {
  if (a.datum && b.datum && a.datum !== b.datum) return b.datum.localeCompare(a.datum);
  if (a.datum && !b.datum) return -1;
  if (!a.datum && b.datum) return 1;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Proposes the base state of one storey.
 * 1. A storey with a floor plan series (the reference series) → the newest state of that series.
 * 2. Otherwise → the newest dated, ALIGNED (art ≠ 'offen') state whose bbox covers at least
 *    BASIS_MIN_FLAECHENANTEIL of the reference area; undated states only when no dated one
 *    qualifies. Without a reference area (unknown) the area check is skipped.
 * 3. Nothing qualifies → standId null.
 * @param {{staende: BasisKandidat[], referenzReihe?: string|null, referenzFlaeche?: number|null}} e
 *   staende = all states of the storey; referenzReihe = series key of the floor plan (null = the
 *   storey has none); referenzFlaeche = bbox area of the reference state, m²
 * @returns {BasisVorschlag}
 */
export function basisVorschlag({ staende, referenzReihe = null, referenzFlaeche = null }) {
  const liste = (Array.isArray(staende) ? staende : []).filter((s) => s && s.id != null);
  if (referenzReihe) {
    const ref = liste.filter((s) => s.reihe === referenzReihe).sort(neuesteZuerst);
    if (ref.length) return { standId: ref[0].id, grund: "referenzreihe" };
  }
  const minFlaeche = Number.isFinite(referenzFlaeche) && /** @type {number} */ (referenzFlaeche) > 0 ? BASIS_MIN_FLAECHENANTEIL * /** @type {number} */ (referenzFlaeche) : 0;
  const kandidaten = liste
    .filter((s) => s.ausrichtung && s.ausrichtung.art !== "offen")
    .filter((s) => !minFlaeche || bboxFlaeche(s.bbox) >= minFlaeche)
    .sort(neuesteZuerst);
  return kandidaten.length ? { standId: kandidaten[0].id, grund: "flaeche" } : { standId: null, grund: "keiner" };
}

/**
 * Next letter index: "" → A, A → B, Z → AA, AZ → BA. Same convention as naechsterIndex() in
 * src/lib/werkplanung/plaene.js (upper case letters) — re-implemented here because @core must
 * not import from the app (`@/`, eslint package boundaries).
 * @param {string|null|undefined} index current index ("" / null = none yet)
 * @returns {string}
 * @throws {Error} when the index is not made of letters A–Z
 */
export function naechsterRevisionsIndex(index) {
  const s = String(index || "").trim().toUpperCase();
  if (!/^[A-Z]*$/.test(s)) throw new Error(`Index „${index}“ ist kein Buchstabenindex`);
  if (s === "") return "A";
  const z = s.split("");
  for (let i = z.length - 1; i >= 0; i--) {
    if (z[i] !== "Z") { z[i] = String.fromCharCode(z[i].charCodeAt(0) + 1); return z.join(""); }
    z[i] = "A";
  }
  return "A" + z.join("");
}

/**
 * @typedef {{id: string, art?: string|null}} Aenderung one change; art = display label of what changed ("Wand", "Tür" …)
 * @typedef {{index: string, datum: string, von: string, vermerk: string, basisStandId: string|null, aenderungIds: string[]}} VerlaufEintrag
 *   datum 'YYYY-MM-DD'; aenderungIds sorted, unique
 */

/**
 * Automatic note for a hand-over: count per kind, most frequent first, then by name; changes
 * without a kind count as "Änderung". Example: "2× Wand, 1× Tür".
 * @param {Aenderung[]} aenderungen
 * @returns {string} "" when there are no changes
 */
export function abgabeVermerk(aenderungen) {
  /** @type {Map<string, Set<string>>} */
  const je = new Map();
  for (const a of Array.isArray(aenderungen) ? aenderungen : []) {
    if (!a || a.id == null) continue;
    const art = String(a.art || "").trim() || "Änderung";
    if (!je.has(art)) je.set(art, new Set());
    /** @type {Set<string>} */ (je.get(art)).add(String(a.id));
  }
  return [...je.entries()]
    .map(([art, ids]) => /** @type {[string, number]} */ ([art, ids.size]))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
    .map(([art, n]) => `${n}× ${art}`)
    .join(", ");
}

/** Sorted unique id list. */
const idListe = (/** @type {Aenderung[]} */ a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => x && x.id != null).map((x) => String(x.id)))].sort();

/**
 * Hand-over: appends a history entry with the next index — but only when the change set or the
 * base state differs from the last entry (the first hand-over always gets an entry, index A).
 * @param {VerlaufEintrag[]|null|undefined} verlauf previous history, oldest first (not mutated)
 * @param {{datum: string, von: string, basisStandId: string|null, aenderungen: Aenderung[], vermerk?: string|null}} abgabe
 *   datum 'YYYY-MM-DD' (passed in, the module has no clock); von = who hands over;
 *   vermerk = own note (default: abgabeVermerk(aenderungen), "Keine Änderungen" when empty)
 * @returns {{neu: boolean, eintrag: VerlaufEintrag|null, verlauf: VerlaufEintrag[]}}
 *   neu = a new index was issued; eintrag = the new entry, or the unchanged last one
 */
export function abgeben(verlauf, { datum, von, basisStandId, aenderungen, vermerk = null }) {
  const alt = Array.isArray(verlauf) ? verlauf : [];
  const letzter = alt.length ? alt[alt.length - 1] : null;
  const ids = idListe(aenderungen);
  const basis = basisStandId ?? null;
  if (letzter && (letzter.basisStandId ?? null) === basis && gleicheListe(letzter.aenderungIds, ids)) {
    return { neu: false, eintrag: letzter, verlauf: alt.slice() };
  }
  /** @type {VerlaufEintrag} */
  const eintrag = {
    index: naechsterRevisionsIndex(letzter?.index),
    datum: String(datum || ""),
    von: String(von || ""),
    vermerk: (vermerk && String(vermerk).trim()) || abgabeVermerk(aenderungen) || "Keine Änderungen",
    basisStandId: basis,
    aenderungIds: ids,
  };
  return { neu: true, eintrag, verlauf: [...alt, eintrag] };
}

/** Equal as sorted unique sets. */
function gleicheListe(/** @type {string[]|null|undefined} */ a, /** @type {string[]} */ b) {
  const x = [...new Set((a || []).map(String))].sort();
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
