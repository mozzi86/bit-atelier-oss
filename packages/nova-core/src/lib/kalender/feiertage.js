// Calendar core, part 2: public holidays. feiertageBund(jahr) is the
// nation-wide list of Germany (phase 79); feiertage(jahr, einst) adds the
// holidays of the office's federal state (phase 81: Bavaria; wave 1 / B-81-04:
// all 16 states).
//
// In:  a year (and the office calendar setting). Out: Easter Sunday and lists of
//      holidays as 'YYYY-MM-DD' strings with a key each. UTC only (./datum.js).
//
// feiertageBund stays exactly as phase 79 built it (its callers, e.g. the tax
// deadlines without an office calendar, keep their nation-wide behaviour).

import { plusTage, tag, wochentag } from "./datum.js";
import { BUNDESLAENDER, KALENDER_STANDARD } from "./bundeslaender.js";

/**
 * Easter Sunday (Gregorian), anonymous algorithm after Meeus/Jones/Butcher
 * (Gauß' Easter formula in its general form).
 * @param {number} jahr year, e.g. 2026
 * @returns {string} 'YYYY-MM-DD' (2026 → '2026-04-05')
 */
export function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tagImMonat = ((h + l - 7 * m + 114) % 31) + 1;
  return tag(jahr, monat, tagImMonat);
}

/**
 * Nation-wide public holidays of a year, sorted by date. Keys match
 * GESETZ.FEIERTAGE_BUND in src/lib/accounting/einstellungen.js.
 * @param {number} jahr year
 * @param {string|null} [land] ignored — the state holidays live in feiertage(jahr, einst) below
 * @returns {Array<{datum: string, name: string}>}
 */
export function feiertageBund(jahr, land = null) {
  void land; // nation-wide only; the state holidays live in feiertage(jahr, einst) below.
  const ostern = ostersonntag(jahr);
  const liste = [
    { datum: tag(jahr, 1, 1), name: "neujahr" },
    { datum: /** @type {string} */ (plusTage(ostern, -2)), name: "karfreitag" },
    { datum: /** @type {string} */ (plusTage(ostern, 1)), name: "ostermontag" },
    { datum: tag(jahr, 5, 1), name: "tag_der_arbeit" },
    { datum: /** @type {string} */ (plusTage(ostern, 39)), name: "christi_himmelfahrt" },
    { datum: /** @type {string} */ (plusTage(ostern, 50)), name: "pfingstmontag" },
    { datum: tag(jahr, 10, 3), name: "tag_der_deutschen_einheit" },
    { datum: tag(jahr, 12, 25), name: "weihnachtstag_1" },
    { datum: tag(jahr, 12, 26), name: "weihnachtstag_2" },
  ];
  return liste.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
}

// --- Phase 81 (81-01) / wave 1 (B-81-04): state holidays ------------------

// KALENDER_STANDARD and BUNDESLAENDER live in ./bundeslaender.js (no tables, so
// the entry chunk can import them without this module) and are re-exported here.
export { BUNDESLAENDER, KALENDER_STANDARD };

// Which state holiday applies where — source: the holiday laws of the states
// (Feiertagsgesetze der Länder): BW FTG, BayFTG, BE FTG (Gesetz über die Sonn-
// und Feiertage), BbgFTG, HB FeiertagsG, HH FeiertagsG, HFeiertagsG, MV FTG,
// NFeiertagsG, NW FeiertagsG, RP LFtG, SL FTG, SächsSFG, ST FeiertG LSA,
// SH SFTG, ThürFtG. [ASSUMED] The table was written from the known state of
// these laws (as of 2026) and NOT re-read against the law texts while building
// it; way to a confirmed value: compare with the current law texts or the
// federal overview "Gesetzliche Feiertage in Deutschland" (BMI) once a year.
// Checked on 19.11.2026 against an independently written computation of the
// rules listed below (all 16 states, 2017-2020 and 2023-2028, Easter after
// Gauss/Lichtenberg): no difference. That check confirms the code matches the
// rule list, not that the rule list matches the law texts.
// Epiphany (6.1.): BW, BY, ST.
// International Women's Day (8.3.): BE since 2019, MV since 2023.
// Corpus Christi (Easter + 60): BW, BY, HE, NW, RP, SL. [ASSUMED] Not in SN/TH:
//   there it is a holiday only in some Catholic municipalities named by state
//   regulation — the calendar setting has no municipality, so these are left out.
// Assumption Day (15.8.): SL state-wide; BY by the switch mariae_himmelfahrt.
// Augsburg Peace Festival (8.8.): BY by the switch augsburger_friedensfest.
// World Children's Day (20.9.): TH since 2019.
// Reformation Day (31.10.): BB, MV, SN, ST, TH (since 1991; earlier years are
//   not modelled); HB, HH, NI, SH since 2018; 2017 (500th anniversary) one-time
//   in ALL states.
// All Saints (1.11.): BW, BY, NW, RP, SL.
// Repentance Day (Wednesday before 23.11.): SN.
// One-time: 8.5.2020 and 8.5.2025 in BE (75th/80th anniversary of the end of
//   the war, set by amendments of the BE FTG).
// Easter Sunday and Whit Sunday (legal holidays in BB and HE) are NOT listed:
//   they are Sundays, never change a working-day count, and listing them would
//   change the holiday COUNT that feiertagsAbgleich compares with the cost-rate
//   basis.

/**
 * State holidays by one-letter key: [id, month, day] for a fixed date; month 0 = day offset from
 * Easter Sunday; B = Repentance Day, the Wednesday before 23 November.
 * @type {Readonly<Record<string, [string, number, number]>>}
 */
const TAGE = Object.freeze({
  D: ["heilige_drei_koenige", 1, 6], W: ["frauentag", 3, 8], F: ["fronleichnam", 0, 60], M: ["mariae_himmelfahrt", 8, 15],
  K: ["weltkindertag", 9, 20], R: ["reformationstag", 10, 31], A: ["allerheiligen", 11, 1], B: ["buss_und_bettag", 11, 0],
});

/** State → keys of TAGE (table above; BY's switchable days come from the setting). One row per code of BUNDESLAENDER. @type {Readonly<Record<string, string>>} */
const LAND = Object.freeze({
  SH: "R", HH: "R", NI: "R", HB: "R", NW: "FA", HE: "F", RP: "FA", BW: "DFA",
  BY: "DFA", SL: "FMA", BE: "W", BB: "R", MV: "WR", SN: "RB", ST: "DR", TH: "KR",
});

/** First year of a holiday introduced later, key state + TAGE key. @type {Readonly<Record<string, number>>} */
const AB_JAHR = Object.freeze({ BEW: 2019, MVW: 2023, THK: 2019, HBR: 2018, HHR: 2018, NIR: 2018, SHR: 2018 });

/**
 * Public holidays of a year for the office's federal state: the nation-wide
 * list of feiertageBund plus the state holidays of `einst.bundesland` (table
 * above), for Bavaria with the two switchable days 15.8./8.8. Same shape as
 * feiertageBund ([{datum, name}], sorted), built on the one Easter algorithm
 * above. An unknown state code gets the nation-wide list only.
 * feiertage(2026, KALENDER_STANDARD) → 13 entries, 9 of them on weekdays;
 * feiertage(2026, {bundesland: "NW"}) → 11 entries.
 * @param {number} jahr year
 * @param {{bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}} [einst] KALENDER_STANDARD by default
 * @returns {Array<{datum: string, name: string}>}
 */
export function feiertage(jahr, einst = KALENDER_STANDARD) {
  const liste = feiertageBund(jahr);
  const e = { ...KALENDER_STANDARD, ...(einst || {}) };
  const land = String(e.bundesland || "");
  const eigene = /** @type {Record<string, string>} */ (LAND)[land];
  const ab = /** @type {Record<string, number>} */ (AB_JAHR);
  for (const k of eigene || "") {
    if (jahr < (ab[land + k] ?? 0)) continue;
    const [name, monat, t] = /** @type {Record<string, [string, number, number]>} */ (TAGE)[k];
    const nov22 = tag(jahr, 11, 22);
    const datum = k === "B" ? plusTage(nov22, -((/** @type {number} */ (wochentag(nov22)) + 4) % 7)) // Wednesday before 23.11.
      : monat ? tag(jahr, monat, t) : plusTage(ostersonntag(jahr), t);
    liste.push({ datum: /** @type {string} */ (datum), name });
  }
  if (land === "BY") {
    if (e.mariae_himmelfahrt) liste.push({ datum: tag(jahr, 8, 15), name: "mariae_himmelfahrt" });
    if (e.augsburger_friedensfest) liste.push({ datum: tag(jahr, 8, 8), name: "augsburger_friedensfest" });
  }
  // One-time holidays: Reformation Day 2017 in every state, 8 May 2020/2025 in BE.
  if (eigene && jahr === 2017 && !liste.some((f) => f.name === "reformationstag")) liste.push({ datum: tag(2017, 10, 31), name: "reformationstag" });
  if (land === "BE" && (jahr === 2020 || jahr === 2025)) liste.push({ datum: tag(jahr, 5, 8), name: "tag_der_befreiung" });
  return liste.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
}

/**
 * True when the day is in the given holiday list.
 * @param {string} tagIso 'YYYY-MM-DD'
 * @param {ReadonlyArray<{datum: string}>} liste output of feiertage() / feiertageBund(), any years
 * @returns {boolean}
 */
export function istFeiertag(tagIso, liste) {
  return Array.isArray(liste) && liste.some((f) => f && f.datum === tagIso);
}
