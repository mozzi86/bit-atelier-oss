// Calendar core, part 2: public holidays. v1 knows only the nation-wide
// holidays of Germany; phase 81 adds state holidays (e.g. Bavaria) through the
// `land` parameter that is already part of the signature.
//
// In:  a year. Out: Easter Sunday and the list of nation-wide holidays as
//      'YYYY-MM-DD' strings with a key each. UTC only (./datum.js).

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
  void land; // v1: nation-wide only; phase 81 adds the state holidays.
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
