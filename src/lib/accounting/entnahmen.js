// Drawings / partner profit shares (phase 79, plan 79-06, E-04/BUCH-10/BUCH-18):
// owner's drawings for a sole proprietor, drawings per partner with a yearly
// profit-sharing key for GbR/PartG, and the managing-director-salary hint for
// GmbH/UG (no drawings there — rechtsformWirkung().entnahmen === "gf_gehalt").
// The switch only changes plan, required fields and texts (rechtsform.js); it
// never drops recorded data, so every function here reads whatever is stored
// regardless of the CURRENT legal form.
//
// In:  Gesellschafter/Entnahme records (datenmodell.js, amounts in EURO),
//      WiederkehrendeAusgabe (kategorie "personal", for the GmbH/UG hint),
//      the effective settings (wirksameEinstellungen) and a reference date.
// Out: pure functions in CENTS (geld.js convention) plus literal t() text
//      helpers for the legal-form-dependent headings (i18n guard pattern of
//      ausgaben.js kategorieText).

import { jahrVon, monatVon } from "@core/lib/kalender/datum.js";
import { euroZuCent, formatEuro, rundeCent, verteileNachSchluessel } from "./geld.js";
import { rechtsformWirkung } from "./rechtsform.js";

/**
 * One monthly plan-vs-actual entry of one active person (see geplanteEntnahmen).
 * @typedef {{gesellschafter_id: string, monat: string, planCent: number, istCent: number, restCent: number}} PlanMonat
 */

/**
 * One row of the drawings-vs-profit-share overview for a non-corporate legal
 * form (see uebersicht).
 * @typedef {{id: string, name: string, rolle: string, prozent: number|null, gewinnanteil: number, ist: number, planRest: number, differenz: number, ueberentnahme: boolean}} EntnahmeUebersichtZeile
 */

/**
 * One recurring managing-director-salary entry (GmbH/UG, see uebersicht).
 * @typedef {{vorlage_id: string, bezeichnung: string, betragMonatCent: number}} GfGehaltZeile
 */

/**
 * Drawings of one year, summed per Gesellschafter (the "Ist" figure of the
 * overview; independent of the legal form — a switch never deletes recorded
 * drawings).
 * @param {{Entnahme?: Array<Record<string, any>>}} daten bh.daten
 * @param {number|string} jahr business year, e.g. 2026
 * @returns {Record<string, number>} cents per gesellschafter_id
 */
export function entnahmenJeGesellschafter(daten, jahr) {
  const liste = Array.isArray(daten?.Entnahme) ? daten.Entnahme : [];
  /** @type {Record<string, number>} */
  const aus = {};
  for (const e of liste) {
    if (String(e?.datum || "").slice(0, 4) !== String(jahr)) continue;
    const id = e?.gesellschafter_id;
    if (!id) continue;
    aus[id] = (aus[id] || 0) + euroZuCent(e?.betrag);
  }
  return aus;
}

/**
 * Monthly plan vs. actual per active person, for the year clock (79-10): the
 * CURRENT month (plan − actual of that month, never negative, so an already
 * fully-drawn month shows 0, not a negative rest) and every FUTURE month of
 * `jahr` (the full monthly plan — a person has no start date, so a partner
 * added mid-year gets the same full-plan treatment as any other future
 * month). Past months carry no plan (already drawn or missed, not a forecast
 * line item any more). GmbH/UG have no drawings at all (the managing
 * director's salary runs as an expense, 79-04) — empty list.
 * @param {Array<{id?: string, aktiv?: boolean, entnahme_plan_monat?: number}>} gesellschafter Gesellschafter records
 * @param {Array<{gesellschafter_id?: string, datum?: string, betrag?: number}>} entnahmen Entnahme records (any year — filtered here)
 * @param {string} heute 'YYYY-MM-DD'
 * @param {number|string} jahr business year to plan for
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown}} einst effective settings
 * @returns {PlanMonat[]}
 */
export function geplanteEntnahmen(gesellschafter, entnahmen, heute, jahr, einst) {
  if (rechtsformWirkung(einst).entnahmen === "gf_gehalt") return [];
  const aktive = (Array.isArray(gesellschafter) ? gesellschafter : []).filter((g) => g && g.aktiv !== false);
  if (aktive.length === 0) return [];
  const liste = Array.isArray(entnahmen) ? entnahmen : [];
  const heuteMonatIndex = jahrVon(heute) * 12 + /** @type {number} */ (monatVon(heute));
  const jahrZahl = Number(jahr);

  /** @type {PlanMonat[]} */
  const aus = [];
  for (const g of aktive) {
    const planCent = euroZuCent(g.entnahme_plan_monat);
    for (let m = 1; m <= 12; m++) {
      const monatIndex = jahrZahl * 12 + m;
      if (monatIndex < heuteMonatIndex) continue; // past month: not a forecast line any more
      const monat = `${jahrZahl}-${String(m).padStart(2, "0")}`;
      const istCent = monatIndex === heuteMonatIndex
        ? liste.filter((e) => e?.gesellschafter_id === g.id && String(e?.datum || "").slice(0, 7) === monat)
            .reduce((n, e) => n + euroZuCent(e?.betrag), 0)
        : 0; // future months: full plan, regardless of any (unusual) future-dated entry
      aus.push({ gesellschafter_id: /** @type {string} */ (g.id), monat, planCent, istCent, restCent: Math.max(planCent - istCent, 0) });
    }
  }
  return aus;
}

/**
 * Checks a profit-sharing key (Setting.schluessel[jahr], GbR/PartG only):
 * the percentages must sum to 100 (tolerance for float noise).
 * @param {Record<string, number>|null|undefined} schluessel gesellschafter_id → percent
 * @returns {{ok: boolean, summe: number}}
 */
export function schluesselPruefen(schluessel) {
  const summe = schluessel && typeof schluessel === "object"
    ? Object.values(schluessel).reduce((n, p) => n + (typeof p === "number" && Number.isFinite(p) ? p : 0), 0)
    : 0;
  return { ok: Math.abs(summe - 100) < 0.001, summe };
}

/**
 * The profit-sharing key actually in force, by legal form (E-04, the "Rechtsform
 * × Wirkung" matrix): a sole proprietor needs none — the one active person
 * (`rolle: "inhaber"`, or the first active record when none carries that role)
 * gets 100 % without a Setting entry; GbR/PartG use the stored key of `jahr`,
 * but only when it actually sums to 100 % (an incomplete key must not silently
 * split a profit, so callers see `null` — "Gewinnschlüssel fehlt" — instead of
 * a wrong split); a corporation has none (profit distribution needs a
 * shareholder resolution, not a stored key).
 * @param {{Gesellschafter?: Array<{id?: string, rolle?: string, aktiv?: boolean}>}} daten bh.daten
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown, schluessel?: Record<string, Record<string, number>>}} einst effective settings
 * @param {number|string} jahr business year
 * @returns {Record<string, number>|null} gesellschafter_id → percent, or null when none applies
 */
export function wirksamerSchluessel(daten, einst, jahr) {
  const wirkung = rechtsformWirkung(einst);
  if (wirkung.entnahmen === "gf_gehalt") return null;
  if (!wirkung.schluesselNoetig) {
    const aktive = (Array.isArray(daten?.Gesellschafter) ? daten.Gesellschafter : []).filter((g) => g && g.aktiv !== false);
    const inhaber = aktive.find((g) => g.rolle === "inhaber") || aktive[0];
    return inhaber?.id ? { [inhaber.id]: 100 } : {};
  }
  const gespeichert = einst && typeof einst === "object" && einst.schluessel && typeof einst.schluessel === "object"
    ? einst.schluessel[jahr] : undefined;
  return gespeichert && schluesselPruefen(gespeichert).ok ? gespeichert : null;
}

/**
 * Splits a profit (in cents) by a profit-sharing key, largest-remainder method
 * (geld.js verteileNachSchluessel): shares sum exactly to `gewinnCent`, no
 * cent lost or invented to rounding. Order is by gesellschafter_id (ascending,
 * deterministic) — the ONLY place ties (equal fractional remainders) are
 * decided, so the same key always splits the same way regardless of object
 * key order. A missing or empty key (schluessel_fehlt) returns `{}`, never a
 * thrown error — the caller shows "Gewinnschlüssel fehlt" instead of a split.
 * @param {number} gewinnCent profit in cents (may be 0 — no profit entered yet)
 * @param {Record<string, number>|null|undefined} schluessel gesellschafter_id → percent
 * @returns {Record<string, number>} gesellschafter_id → cents
 */
export function gewinnanteile(gewinnCent, schluessel) {
  const ids = schluessel && typeof schluessel === "object" ? Object.keys(schluessel).sort() : [];
  if (ids.length === 0) return {};
  const anteile = ids.map((id) => schluessel[id]);
  const summe = anteile.reduce((n, a) => n + (Number.isFinite(a) && a > 0 ? a : 0), 0);
  if (!(summe > 0)) return {};
  const teile = verteileNachSchluessel(gewinnCent, anteile);
  return Object.fromEntries(ids.map((id, i) => [id, teile[i]]));
}

/**
 * Monthly equivalent of a WiederkehrendeAusgabe amount (its `brutto` is the
 * amount of ONE occurrence — monthly, quarterly or yearly, grundlagen.js
 * wiederkehrendeVorkommen), for the GmbH/UG managing-director-salary hint.
 * @param {{brutto?: number, rhythmus?: string}} vorlage WiederkehrendeAusgabe
 * @returns {number} cents per month
 */
function monatsBetragCent(vorlage) {
  const teiler = vorlage?.rhythmus === "jahr" ? 12 : vorlage?.rhythmus === "quartal" ? 3 : 1;
  return rundeCent(euroZuCent(vorlage?.brutto) / teiler);
}

/**
 * Drawings vs. profit-share overview (E-04, the tab's core figure). Two
 * shapes, by legal form:
 * - sole proprietor / GbR / PartG: one row per ACTIVE Gesellschafter (sorted
 *   by id, deterministic), `prozent`/`gewinnanteil` from wirksamerSchluessel +
 *   gewinnanteile (0 when no valid key — "kein NaN"), `ist` = the year's
 *   recorded drawings (entnahmenJeGesellschafter), `planRest` = the summed
 *   rest-of-year plan (geplanteEntnahmen), `differenz` = gewinnanteil −
 *   (ist + planRest), `ueberentnahme` = differenz < 0.
 * - GmbH/UG: no rows — instead the recurring managing-director salaries
 *   (WiederkehrendeAusgabe, kategorie "personal", aktiv) as `gfGehalt` plus
 *   their monthly sum; drawings play no part here (rechtsformWirkung().hinweise
 *   "keine_privatentnahmen").
 * @param {{Gesellschafter?: Array<Record<string, any>>, Entnahme?: Array<Record<string, any>>, WiederkehrendeAusgabe?: Array<Record<string, any>>}} daten bh.daten
 * @param {number|string} jahr business year
 * @param {number} gewinnCent profit of `jahr` in cents (0 when not entered yet)
 * @param {string} heute 'YYYY-MM-DD'
 * @param {Record<string, any>} einst effective settings
 * @returns {EntnahmeUebersichtZeile[]|{gfGehalt: GfGehaltZeile[], summeMonatCent: number}}
 */
export function uebersicht(daten, jahr, gewinnCent, heute, einst) {
  const wirkung = rechtsformWirkung(einst);
  if (wirkung.entnahmen === "gf_gehalt") {
    const gfGehalt = (Array.isArray(daten?.WiederkehrendeAusgabe) ? daten.WiederkehrendeAusgabe : [])
      .filter((v) => v?.kategorie === "personal" && v?.aktiv !== false)
      .map((v) => ({ vorlage_id: v.id, bezeichnung: v.lieferant || "", betragMonatCent: monatsBetragCent(v) }));
    return { gfGehalt, summeMonatCent: gfGehalt.reduce((n, g) => n + g.betragMonatCent, 0) };
  }

  const gesellschafter = (Array.isArray(daten?.Gesellschafter) ? daten.Gesellschafter : [])
    .slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const aktive = gesellschafter.filter((g) => g && g.aktiv !== false);
  const schluessel = wirksamerSchluessel(daten, einst, jahr) || {};
  const anteile = gewinnanteile(gewinnCent, schluessel);
  const istJeGesellschafter = entnahmenJeGesellschafter(daten, jahr);
  const planEntnahmen = geplanteEntnahmen(gesellschafter, Array.isArray(daten?.Entnahme) ? daten.Entnahme : [], heute, jahr, einst);

  return aktive.map((g) => {
    const gewinnanteil = anteile[/** @type {string} */ (g.id)] || 0;
    const ist = istJeGesellschafter[/** @type {string} */ (g.id)] || 0;
    const planRest = planEntnahmen.filter((p) => p.gesellschafter_id === g.id).reduce((n, p) => n + p.restCent, 0);
    return {
      id: g.id, name: g.name, rolle: g.rolle,
      prozent: Object.prototype.hasOwnProperty.call(schluessel, g.id) ? schluessel[g.id] : null,
      gewinnanteil, ist, planRest, differenz: gewinnanteil - (ist + planRest), ueberentnahme: gewinnanteil - (ist + planRest) < 0,
    };
  });
}

/**
 * Table model of one year's drawings for CSV/XLSX export (ExportKnopf), sorted
 * by date.
 * @param {{Gesellschafter?: Array<Record<string, any>>, Entnahme?: Array<Record<string, any>>}} daten bh.daten
 * @param {number|string} jahr business year (falsy = every year)
 * @param {(schluessel: string) => string} t translator (column labels, art text)
 * @param {Record<string, any>} einst effective settings (person-column heading by legal form)
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function entnahmenTabelle(daten, jahr, t, einst) {
  const namen = Object.fromEntries((Array.isArray(daten?.Gesellschafter) ? daten.Gesellschafter : []).map((g) => [g.id, g.name]));
  const liste = (Array.isArray(daten?.Entnahme) ? daten.Entnahme : [])
    .filter((e) => !jahr || String(e?.datum || "").slice(0, 4) === String(jahr))
    .slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  return {
    titel: t("Entnahmen"),
    spalten: [
      { key: "person", label: personTitel(rechtsformWirkung(einst).rechtsform, t), typ: "text" },
      { key: "datum", label: t("Datum"), typ: "datum" },
      { key: "betrag", label: t("Betrag"), typ: "betrag" },
      { key: "art", label: t("Art"), typ: "text" },
    ],
    zeilen: liste.map((e) => ({ person: namen[e.gesellschafter_id] || e.gesellschafter_id, datum: e.datum, betrag: e.betrag, art: artText(e.art, t) })),
  };
}

/**
 * Tab heading, by legal form (literal t() calls for the i18n guard — pattern
 * of ausgaben.js kategorieText).
 * @param {string} rechtsform key of RECHTSFORMEN
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function ueberschriftText(rechtsform, t) {
  switch (rechtsform) {
    case "gbr": return t("Entnahmen je Gesellschafter");
    case "partg": return t("Entnahmen je Partner");
    default: return t("Privatentnahmen");
  }
}

/**
 * Person title/role label, by legal form (GesellschafterFormular, the person
 * column of entnahmenTabelle). GmbH/UG never reach here — no person form there.
 * @param {string} rechtsform key of RECHTSFORMEN
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function personTitel(rechtsform, t) {
  switch (rechtsform) {
    case "gbr": return t("Gesellschafter/in");
    case "partg": return t("Partner/in");
    default: return t("Inhaber/in");
  }
}

/**
 * GesellschafterFormular dialog title, by legal form and mode: the rechtsform
 * noun (personTitel, already legal-form-specific) plus a generic add/edit
 * word — two new keys ("Neu", reused "Bearbeiten") instead of six spelled-out
 * combinations, and no accusative-case guessing on the noun slash form.
 * @param {string} rechtsform key of RECHTSFORMEN
 * @param {boolean} bearbeiten true = editing an existing record
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function personFormTitel(rechtsform, bearbeiten, t) {
  const titel = personTitel(rechtsform, t);
  return bearbeiten ? `${titel} – ${t("Bearbeiten")}` : `${t("Neu")}: ${titel}`;
}

/**
 * Default Gesellschafter.rolle for a NEW record, by legal form (T3: "vorbelegt
 * nach Rechtsform").
 * @param {string} rechtsform key of RECHTSFORMEN
 * @returns {"inhaber"|"gesellschafter"|"partner"}
 */
export function standardRolle(rechtsform) {
  if (rechtsform === "gbr") return "gesellschafter";
  if (rechtsform === "partg") return "partner";
  return "inhaber";
}

/**
 * Entnahme.art label (literal t() calls for the i18n guard).
 * @param {string} art key ("bar"|"ueberweisung"|"sache"|"steuer")
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function artText(art, t) {
  switch (art) {
    case "bar": return t("Bar");
    case "ueberweisung": return t("Überweisung");
    case "sache": return t("Sachentnahme");
    case "steuer": return t("Steuerentnahme");
    default: return art;
  }
}

/**
 * One overview row as a plain-text sentence (the bar chart's aria-label — the
 * table stays the accessible data view, this is only the chart's alternative
 * text, dataviz-Skill).
 * @param {EntnahmeUebersichtZeile} zeile one row of uebersicht()
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function zeileAlsSatz(zeile, t) {
  return `${zeile.name}: ${t("Entnahmen")} ${formatEuro(zeile.ist + zeile.planRest)}, ${t("Gewinnanteil")} ${formatEuro(zeile.gewinnanteil)}`;
}
