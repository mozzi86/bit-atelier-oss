// Calendar core, part 2: public holidays. v1 knows only the nation-wide
// holidays of Germany; phase 81 adds state holidays (e.g. Bavaria) through the
// `land` parameter that is already part of the signature.
//
// In:  a year. Out: Easter Sunday and the list of nation-wide holidays as
//      'YYYY-MM-DD' strings with a key each. UTC only (./datum.js).
//
// Phase 81 (81-01) adds the state holidays of Bavaria as a separate function,
// feiertage(jahr, einst) — feiertageBund stays exactly as phase 79 built it
// (its callers, e.g. the tax deadlines, keep their nation-wide behaviour).

import { plusTage, tag } from "./datum.js";

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
 * @param {string|null} [land] federal state code — prepared for phase 81, ignored in v1
 * @returns {Array<{datum: string, name: string}>}
 */
export function feiertageBund(jahr, land = null) {
  void land; // nation-wide only; the state holidays live in feiertage(jahr, einst) below (phase 81).
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

// --- Phase 81 (81-01): state holidays of Bavaria ---------------------------

/**
 * Calendar setting of the office: federal state and the two Bavarian holidays
 * that depend on the municipality. [ASSUMED] Bavaria with Assumption Day
 * (15.8.) — the office is in Nuremberg; whether 15.8. is a holiday there
 * depends on the district (Art. 1 Abs. 1 Nr. 2 BayFTG: municipalities with a
 * predominantly Catholic population) and is UNVERIFIED for the office address.
 * Way to a confirmed value: the municipality list of the Bavarian State Office
 * for Statistics. The Augsburg Peace Festival (8.8.) applies only in the city
 * of Augsburg (Art. 1 Abs. 2 BayFTG), so it is off.
 * @type {Readonly<{bundesland: string, mariae_himmelfahrt: boolean, augsburger_friedensfest: boolean}>}
 */
export const KALENDER_STANDARD = Object.freeze({ bundesland: "BY", mariae_himmelfahrt: true, augsburger_friedensfest: false });

/**
 * Public holidays of a year for the office's federal state: the nation-wide
 * list of feiertageBund plus — for Bavaria (Art. 1 BayFTG) — Epiphany (6.1.),
 * Corpus Christi (Easter + 60), All Saints (1.11.) and the two switchable days
 * 15.8./8.8. Same shape as feiertageBund ([{datum, name}], sorted), built on
 * the one Easter algorithm above. Other states: nation-wide only, until a
 * phase needs them.
 * feiertage(2026, KALENDER_STANDARD) → 13 entries, 9 of them on weekdays.
 * @param {number} jahr year
 * @param {{bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}} [einst] KALENDER_STANDARD by default
 * @returns {Array<{datum: string, name: string}>}
 */
export function feiertage(jahr, einst = KALENDER_STANDARD) {
  const liste = feiertageBund(jahr);
  const e = { ...KALENDER_STANDARD, ...(einst || {}) };
  if (e.bundesland === "BY") {
    liste.push({ datum: tag(jahr, 1, 6), name: "heilige_drei_koenige" });
    liste.push({ datum: /** @type {string} */ (plusTage(ostersonntag(jahr), 60)), name: "fronleichnam" });
    liste.push({ datum: tag(jahr, 11, 1), name: "allerheiligen" });
    if (e.mariae_himmelfahrt) liste.push({ datum: tag(jahr, 8, 15), name: "mariae_himmelfahrt" });
    if (e.augsburger_friedensfest) liste.push({ datum: tag(jahr, 8, 8), name: "augsburger_friedensfest" });
  }
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
