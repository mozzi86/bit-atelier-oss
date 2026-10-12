// Data contract of an absence (phase 82, 82-01 contract; rules of the leave
// account and the team calendar in 82-04).
//
// Why no diagnosis field, no health information about third persons and no
// free text for sickness: health data are special categories (Art. 9 DSGVO,
// E-14) — the employer only needs the duration of an incapacity, never its
// reason. A sick child is recorded as 'abwesend' without a reason (no
// 'krank_kind': that would be health information about a third person). A
// note is kept only for leave, training, special leave and overtime
// compensation; for 'krank' and 'abwesend' it is dropped on normalisation.
//
// Absences live in the personnel storage class of phase 80 (D-P82-38): never
// in the .bitproj, a snapshot, a reset, an import or the cloud; read and
// written only through src/lib/people/bueroOrgaPersonal.js. No audit log.
//
// Pure. In: raw records. Out: ABWESENHEIT_ARTEN, ABWESENHEIT_STATUS,
// ABWESENHEIT_FELDER, normalisiereAbwesenheit, abwesenheitStatusWechsel,
// direktErfassbar; 82-04: konflikte, sichtbarerGrund, ueberlappung.

import { darfGrundSehen } from "@core/lib/rechte.js";

/**
 * Kinds of absence with German label (i18n key), whether a note is allowed and
 * whether the entry may be created directly as recorded (no request).
 * @type {Readonly<Record<string, Readonly<{label: string, notiz: boolean, direkt: boolean}>>>}
 */
export const ABWESENHEIT_ARTEN = Object.freeze({
  urlaub: Object.freeze({ label: "Urlaub", notiz: true, direkt: false }),
  krank: Object.freeze({ label: "Krank", notiz: false, direkt: true }),
  abwesend: Object.freeze({ label: "Abwesend", notiz: false, direkt: true }),
  fortbildung: Object.freeze({ label: "Fortbildung", notiz: true, direkt: false }),
  sonderurlaub: Object.freeze({ label: "Sonderurlaub", notiz: true, direkt: false }),
  ueberstunden: Object.freeze({ label: "Überstundenausgleich", notiz: true, direkt: false }),
  elternzeit: Object.freeze({ label: "Elternzeit", notiz: false, direkt: false }),
  betriebsruhe: Object.freeze({ label: "Betriebsruhe", notiz: false, direkt: false }),
});

/** States with German label; 'genehmigt' of a sickness reads "erfasst". */
export const ABWESENHEIT_STATUS = Object.freeze({
  beantragt: Object.freeze({ label: "beantragt" }),
  genehmigt: Object.freeze({ label: "genehmigt" }),
  abgelehnt: Object.freeze({ label: "abgelehnt" }),
  storniert: Object.freeze({ label: "storniert" }),
});

/** All fields of the contract — no diagnosis, no reason text, no doctor. */
export const ABWESENHEIT_FELDER = Object.freeze([
  "id", "mitarbeiter_id", "art", "von", "bis", "halbtag_von", "halbtag_bis", "status",
  "vertretung_id", "entschieden_von", "entschieden_am", "notiz", "beispiel", "created_date", "updated_date",
]);

/** Allowed transitions (82-RESEARCH § Datenverträge). */
const UEBERGAENGE = Object.freeze({
  beantragt: Object.freeze(["genehmigt", "abgelehnt", "storniert"]),
  genehmigt: Object.freeze(["storniert"]),
  abgelehnt: Object.freeze([]),
  storniert: Object.freeze([]),
});

/**
 * Cleans a record: only contract fields, known kind and state, note only where
 * allowed. A sickness or absence without state is 'genehmigt' (recorded), any
 * other kind 'beantragt'.
 * @param {Record<string, any>} roh
 * @returns {Record<string, any>}
 */
export function normalisiereAbwesenheit(roh) {
  /** @type {Record<string, any>} */
  const aus = {};
  for (const f of ABWESENHEIT_FELDER) if (roh && f in roh) aus[f] = roh[f];
  const art = Object.prototype.hasOwnProperty.call(ABWESENHEIT_ARTEN, aus.art) ? aus.art : "urlaub";
  aus.art = art;
  if (!ABWESENHEIT_ARTEN[art].notiz) delete aus.notiz;
  if (!Object.prototype.hasOwnProperty.call(ABWESENHEIT_STATUS, aus.status)) aus.status = ABWESENHEIT_ARTEN[art].direkt ? "genehmigt" : "beantragt";
  aus.halbtag_von = aus.halbtag_von === true;
  aus.halbtag_bis = aus.halbtag_bis === true;
  return aus;
}

/**
 * State change with the decision recorded at the record (no audit log).
 * @param {Record<string, any>} abwesenheit
 * @param {'genehmigt'|'abgelehnt'|'storniert'} ziel
 * @param {{von: string|null, amIso: string}} entscheidung user id and day 'YYYY-MM-DD'
 * @returns {{ok: true, abwesenheit: Record<string, any>} | {ok: false, fehler: 'uebergang'}}
 */
export function abwesenheitStatusWechsel(abwesenheit, ziel, { von, amIso }) {
  const erlaubt = UEBERGAENGE[abwesenheit?.status] || [];
  if (!erlaubt.includes(ziel)) return { ok: false, fehler: "uebergang" };
  return { ok: true, abwesenheit: { ...abwesenheit, status: ziel, entschieden_von: von ?? null, entschieden_am: amIso } };
}

/**
 * Whether a kind may be created directly as recorded ('krank', 'abwesend') —
 * leave always starts as a request.
 * @param {string} art
 * @returns {boolean}
 */
export function direktErfassbar(art) {
  return ABWESENHEIT_ARTEN[art]?.direkt === true;
}

// ---------------------------------------------------------------------------
// 82-04: conflicts and the visible reason. Conflicts are only warnings (D-P82-13):
// an urgent approval stays possible, the decision is recorded at the record.
// Warnings are data (art + werte); the sentence is built in the UI through t().

/** @param {string} tag @param {number} n @returns {string} */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Overlap of two periods, or null.
 * @param {{von: string, bis?: string}|Record<string, any>} a
 * @param {{von: string, bis?: string}|Record<string, any>} b
 * @returns {{von: string, bis: string}|null}
 */
export function ueberlappung(a, b) {
  const von = a.von > b.von ? a.von : b.von;
  const aBis = a.bis || a.von;
  const bBis = b.bis || b.von;
  const bis = aBis < bBis ? aBis : bBis;
  return von <= bis ? { von, bis } : null;
}

/** @param {Record<string, any>} a @returns {boolean} counts as absent (approved or requested) */
const zaehlt = (a) => a && (a.status === "genehmigt" || a.status === "beantragt");

/**
 * Warnings for a request against all absences.
 * @param {Record<string, any>} antrag {id?, mitarbeiter_id, art, von, bis, vertretung_id}
 * @param {ReadonlyArray<Record<string, any>>} alle
 * @param {{maxGleichzeitig?: number, rest?: number|null, tage?: number|null}} [optionen]
 *   maxGleichzeitig: rule kalender.max_gleichzeitig_abwesend; rest/tage: leave balance and days of the request
 * @returns {Array<{art: string, werte: Record<string, any>}>}
 */
export function konflikte(antrag, alle, { maxGleichzeitig = 2, rest = null, tage = null } = {}) {
  /** @type {Array<{art: string, werte: Record<string, any>}>} */
  const aus = [];
  const andere = (alle || []).filter((a) => a && a.id !== antrag.id && zaehlt(a));
  if (antrag.vertretung_id) {
    for (const a of andere.filter((x) => x.mitarbeiter_id === antrag.vertretung_id)) {
      const u = ueberlappung(antrag, a);
      if (u) aus.push({ art: "vertretung_abwesend", werte: { vertretung: antrag.vertretung_id, von: u.von, bis: u.bis } });
    }
  }
  for (const a of andere.filter((x) => x.mitarbeiter_id === antrag.mitarbeiter_id && x.art !== "betriebsruhe")) {
    const u = ueberlappung(antrag, a);
    if (u) aus.push({ art: "ueberschneidung", werte: { von: u.von, bis: u.bis } });
  }
  // Too many at the same time: the request's person plus distinct others on one day.
  for (let tag = antrag.von; tag && tag <= (antrag.bis || antrag.von); tag = plus(tag, 1)) {
    const personen = new Set(andere.filter((a) => a.mitarbeiter_id !== antrag.mitarbeiter_id && a.art !== "betriebsruhe" && a.von <= tag && (a.bis || a.von) >= tag).map((a) => a.mitarbeiter_id));
    if (personen.size + 1 > maxGleichzeitig) {
      aus.push({ art: "zu_viele_gleichzeitig", werte: { datum: tag, anzahl: personen.size + 1, max: maxGleichzeitig } });
      break;
    }
  }
  if (antrag.art === "urlaub" && typeof rest === "number" && typeof tage === "number" && tage > rest) aus.push({ art: "rest_reicht_nicht", werte: { tage, rest } });
  for (const a of andere.filter((x) => x.art === "betriebsruhe" && x.status === "genehmigt")) {
    const u = ueberlappung(antrag, a);
    if (u) aus.push({ art: "betriebsruhe", werte: { von: u.von, bis: u.bis } });
  }
  return aus;
}

/**
 * The kind of an absence as the access may see it — only for the request list
 * and the balance, never for the team calendar (E-14): with personnel rights or
 * for the own entry the kind, otherwise 'abwesend'.
 * @param {any} zugriff
 * @param {Record<string, any>} abwesenheit
 * @returns {string}
 */
export function sichtbarerGrund(zugriff, abwesenheit) {
  return darfGrundSehen(zugriff, abwesenheit?.mitarbeiter_id) ? String(abwesenheit?.art || "abwesend") : "abwesend";
}
