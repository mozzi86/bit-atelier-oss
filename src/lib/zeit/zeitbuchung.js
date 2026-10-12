// Data contract of a time booking (Zeitbuchung, phase 81): parsing an entered
// duration, the derived month/ISO-week fields, the status workflow and which
// work stages (LPH) may be booked. Pure — no API, no React — so the grid, the
// approval tab, the controlling and the unit tests share one set of rules.
//
// Zeitbuchung (bitApi.entities, through src/lib/zeitHonorar/speicher.js):
//   mitarbeiter_id  opaque id of an 80 Mitarbeiter or "inhaber" (virtual owner, E-17) — never a name copy
//   project_id      string | null (null = office time)
//   lph             1..n | null (n = number of work stages of the contract's service profile, E-13)
//   leistung        'grund'|'besondere'|'honorarnachtrag'|'akquise'|'gewaehrleistung'
//   honorarnachtrag_id, kategorie_intern ('verwaltung'|'akquise'|'fortbildung'|'sonstiges'|null)
//   datum 'YYYY-MM-DD', monat 'YYYY-MM', kw 'YYYY-Www' (derived: filter() only compares equality)
//   minuten         whole minutes, a multiple of the grid (zeit_honorar.raster)
//   notiz, status, eingereicht_am, freigegeben_von, freigegeben_am, ablehnung_grund,
//   quelle 'manuell'|'timer'|'import', beispiel?
// Proof of approval lives on the booking itself — no AuditLog (80 invariant:
// personnel-related code never writes the AuditLog, D-P81-24).
//
// In:  bookings, contracts (79 Honorarvertrag), dates. Out: pure functions and
//      label tables (German i18n keys).

import { isoWoche, parseTag, tageZwischen } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";

/** Status labels (German i18n keys). "Entwurf" alone means "Design" in the dictionary. */
export const ZEIT_STATUS_LABELS = Object.freeze({
  entwurf: "im Entwurf",
  eingereicht: "Eingereicht",
  freigegeben: "Freigegeben",
  abgelehnt: "Abgelehnt",
});

/** Kinds of work of a project booking (German i18n keys). */
export const LEISTUNG_LABELS = Object.freeze({
  grund: "Grundleistung",
  besondere: "Besondere Leistung",
  honorarnachtrag: "Honorarnachtrag",
  akquise: "Akquise",
  gewaehrleistung: "Gewährleistung",
});

/** Categories of office time without a project (German i18n keys). */
export const KATEGORIE_INTERN_LABELS = Object.freeze({
  verwaltung: "Verwaltung",
  akquise: "Akquise",
  fortbildung: "Fortbildung",
  sonstiges: "Sonstiges",
});

/** Sources of a booking. */
export const ZEIT_QUELLEN = Object.freeze(["manuell", "timer", "import"]);

/**
 * Allowed status changes. entwurf → eingereicht → freigegeben; eingereicht →
 * abgelehnt (reason required) → entwurf; an approved booking is reopened only
 * by the person who approved it.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ERLAUBTE_UEBERGAENGE = Object.freeze({
  entwurf: Object.freeze(["eingereicht"]),
  eingereicht: Object.freeze(["freigegeben", "abgelehnt"]),
  abgelehnt: Object.freeze(["entwurf"]),
  freigegeben: Object.freeze(["entwurf"]),
});

/**
 * Parses an entered duration into whole minutes on the grid.
 * Accepted: hours with comma or point ("1,5", "2.25"), "h:mm" ("1:45"),
 * minutes ("150m", "150 min"), hours and minutes ("2h30", "2 h 30", "2h").
 * "0" is valid (the grid clears the cell with it).
 * @param {string} text user input
 * @param {number} rasterMinuten grid in minutes (zeit_honorar.raster, e.g. 15)
 * @returns {{ok: true, minuten: number} | {ok: false, fehler: 'leer'|'format'|'raster'}}
 */
export function parseDauer(text, rasterMinuten) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return { ok: false, fehler: "leer" };
  let minuten = null;
  let m;
  if ((m = s.match(/^(\d+)(?:m|min)$/))) minuten = Number(m[1]);
  else if ((m = s.match(/^(\d+):([0-5]\d)$/))) minuten = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(\d+)(?:h|std)(?:(\d+)(?:m|min)?)?$/))) minuten = Number(m[1]) * 60 + Number(m[2] || 0);
  else if ((m = s.match(/^(\d+)(?:[.,](\d+))?$/))) minuten = Number(`${m[1]}.${m[2] || 0}`) * 60;
  if (minuten === null || !Number.isFinite(minuten)) return { ok: false, fehler: "format" };
  // Float noise of decimal hours (1,1 h = 66.00000000000001 min) is not a real fraction.
  minuten = Math.round(minuten * 1000) / 1000;
  const raster = Number(rasterMinuten) > 0 ? Number(rasterMinuten) : 1;
  if (!Number.isInteger(minuten) || minuten % raster !== 0) return { ok: false, fehler: "raster" };
  return { ok: true, minuten };
}

/**
 * Sets the derived fields monat ('YYYY-MM') and kw ('YYYY-Www', ISO 8601) from
 * datum. Returns a new object; an invalid date leaves monat/kw null.
 * @template {Record<string, any>} T
 * @param {T} buchung
 * @returns {T & {monat: string|null, kw: string|null}}
 */
export function ableiten(buchung) {
  const d = parseTag(buchung?.datum);
  const w = d ? isoWoche(d) : null;
  return { ...buchung, monat: d ? d.slice(0, 7) : null, kw: w ? `${w.jahr}-W${String(w.woche).padStart(2, "0")}` : null };
}

/**
 * Week key 'YYYY-Www' of an ISO year and week.
 * @param {number} jahr
 * @param {number} woche
 * @returns {string}
 */
export function kwSchluessel(jahr, woche) {
  return `${jahr}-W${String(woche).padStart(2, "0")}`;
}

/**
 * Changes the status of a booking according to ERLAUBTE_UEBERGAENGE and writes
 * the proof fields on the booking (D-P81-24). Rejecting needs a reason;
 * reopening an approved booking only by the approver (freigegeben_von).
 * @param {Record<string, any>} buchung
 * @param {string} ziel target status
 * @param {{nutzerId?: string|null, grund?: string, jetztIso?: string}} [kontext]
 *   nutzerId = the person acting (mitarbeiter_id or "inhaber"); jetztIso = ISO timestamp
 * @returns {{ok: true, buchung: Record<string, any>} | {ok: false, fehler: 'uebergang'|'grund_fehlt'|'nicht_freigeber'}}
 */
export function statusWechsel(buchung, ziel, { nutzerId = null, grund = "", jetztIso = new Date().toISOString() } = {}) {
  const von = buchung?.status || "entwurf";
  if (!(ERLAUBTE_UEBERGAENGE[von] || []).includes(ziel)) return { ok: false, fehler: "uebergang" };
  /** @type {Record<string, any>} */
  const neu = { ...buchung, status: ziel };
  if (ziel === "eingereicht") {
    neu.eingereicht_am = jetztIso;
  } else if (ziel === "freigegeben") {
    neu.freigegeben_von = nutzerId;
    neu.freigegeben_am = jetztIso;
    neu.ablehnung_grund = null;
  } else if (ziel === "abgelehnt") {
    if (!String(grund || "").trim()) return { ok: false, fehler: "grund_fehlt" };
    neu.ablehnung_grund = String(grund).trim();
  } else if (ziel === "entwurf") {
    if (von === "freigegeben") {
      if (!nutzerId || nutzerId !== buchung.freigegeben_von) return { ok: false, fehler: "nicht_freigeber" };
      neu.freigegeben_von = null;
      neu.freigegeben_am = null;
    }
    neu.eingereicht_am = null;
  }
  return { ok: true, buchung: neu };
}

/**
 * Whether a booking may still be edited: only drafts, and only within the
 * correction period (zeit_honorar.bearbeitbar_tage) counted from the booked day.
 * @param {Record<string, any>} buchung
 * @param {string} heuteIso 'YYYY-MM-DD'
 * @param {{bearbeitbarTage?: number}} [optionen] days (default 14)
 * @returns {boolean}
 */
export function bearbeitbar(buchung, heuteIso, { bearbeitbarTage = 14 } = {}) {
  if ((buchung?.status || "entwurf") !== "entwurf") return false;
  const abstand = tageZwischen(buchung?.datum, heuteIso);
  if (abstand === null) return false;
  return abstand <= Number(bearbeitbarTage);
}

/**
 * Work stages (LPH numbers) that may be booked on a contract: the commissioned
 * stages of 79's Honorarvertrag, never beyond the number of stages of its
 * service profile (leistungsbildInfo(…).lph — 9, 6 structural, 4 landscape,
 * 3 land-use plans; E-13). Without a contract: 1–9 of the object planning
 * [ASSUMED] — a project without a contract is usually in acquisition or before
 * the contract, and § 34 has nine stages.
 * @param {Record<string, any>|null|undefined} vertrag 79 Honorarvertrag
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable tables (tests, like 79)
 * @returns {number[]} LPH numbers, ascending
 */
export function buchbareLph(vertrag, optionen = {}) {
  if (!vertrag) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const info = leistungsbildInfo(vertrag.leistungsbild, optionen);
  const lphVertrag = Array.isArray(vertrag.lph) ? vertrag.lph : [];
  // Without an official table the profile has no stage list; the stored lph array still says how many.
  const anzahl = info?.lph?.length || lphVertrag.length || 9;
  const nummern = info?.lph?.length ? info.lph.map((s) => s.nr) : Array.from({ length: anzahl }, (_, i) => i + 1);
  return nummern.filter((nr, i) => i < anzahl && lphVertrag[i]?.beauftragt === true);
}

/**
 * Bookable stages of a project over all its contracts (a project may carry
 * several, e.g. building and interiors — 79 data model "≥ 1 per project"):
 * the union of buchbareLph. Without any contract: 1–9 [ASSUMED, see above].
 * @param {ReadonlyArray<Record<string, any>>} vertraege all Honorarvertrag records
 * @param {string|null} projectId
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {number[]}
 */
export function buchbareLphFuerProjekt(vertraege, projectId, optionen = {}) {
  const eigene = (Array.isArray(vertraege) ? vertraege : []).filter((v) => v && v.project_id === projectId);
  if (!eigene.length) return buchbareLph(null);
  const menge = new Set();
  for (const v of eigene) for (const nr of buchbareLph(v, optionen)) menge.add(nr);
  return [...menge].sort((a, b) => a - b);
}
