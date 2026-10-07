// HOAI 2021 service profiles (Leistungsbilder): the registry of all 14 profiles
// plus the data the fee calculator needs next to the fee tables — work-stage
// percentages (LPH), the § 33 rule for technical systems, the § 36 caps for the
// conversion surcharge and the § 35 point bands (decision E-13).
//
// In:  the two fee tables of tafel2021.js and the additional tables registered in
//      ./tafeln/index.js (79-14). No aliases, no packages, only these two
//      relative imports — server code and unit tests read this file directly.
// Out: LEISTUNGSBILDER (registry, 14 entries in fixed order), the HoaiTafel records
//      for buildings, interiors and open spaces, leistungsbildInfo(key),
//      tafelStatus(key), alleLeistungsbilder().
//
// Rule of E-13: only a record with `status: "amtlich"` and without `annahme`
// computes. Everything else is "Tafel fehlt" in the UI — which is something other
// than "frei vereinbar" outside the table range (§ 13).
//
// Registry labels are German source strings for t(); the i18n guard reads the
// `label` fields of the LEISTUNGSBILDER literal (double quotes, no "];" inside).

import { GEPRUEFT_AM, GILT_AB, QUELLE, TAFEL_FREIANLAGEN, TAFEL_GEBAEUDE_INNENRAEUME } from "./tafel2021.js";
import { WEITERE_TAFELN } from "./tafeln/index.js";

/**
 * One fee table with everything the calculator needs.
 * `zeilen`: rows [Bezugswert, [Zone-I-von, …, letzte Zone von, letzte Zone bis]] —
 * row width = number of zones + 1; Bezugswert in `einheit` (Euro or hectares),
 * fee values in Euro. `lph`: work stages with their share in percent of the fee.
 * @typedef {{
 *   leistungsbild: string,
 *   paragraf: number,
 *   fassung: string,
 *   bezug: "anrechenbare_kosten_euro"|"flaeche_ha",
 *   einheit: "EUR"|"ha",
 *   zonen: ReadonlyArray<string>,
 *   zeilen: ReadonlyArray<readonly [number, ReadonlyArray<number>]>,
 *   lph: ReadonlyArray<{nr: number, bezeichnung: string, prozent: number}>,
 *   lphParagraf: number,
 *   umbau_max_prozent: number|null,
 *   quelle: string,
 *   abgerufen_am: string,
 *   status: "amtlich"|string,
 *   annahme?: boolean,
 * }} HoaiTafel
 */

/**
 * Registry entry of one service profile.
 * `teil`: part of the HOAI (2 Flächenplanung, 3 Objektplanung, 4 Fachplanung).
 * `kostenregel`: "p33" = anrechenbare Kosten from KG 300/400 (§ 33), "manuell" =
 * the user enters the Bezugswert (§ 38, § 42, § 46, § 50, § 54 or area in ha).
 * @typedef {{
 *   key: string,
 *   label: string,
 *   teil: number,
 *   tafelParagraf: number,
 *   lphParagraf: number,
 *   kostenregel: "p33"|"manuell",
 *   tafel: HoaiTafel|null,
 * }} Leistungsbild
 */

/**
 * Deep freeze for plain data (objects and arrays).
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function friere(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) friere(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

const ZONEN_FUENF = ["I", "II", "III", "IV", "V"];

// Names of the nine work stages of the object planning (§ 34 Abs. 3, § 39 Abs. 3).
const LPH_NAMEN = [
  "Grundlagenermittlung",
  "Vorplanung",
  "Entwurfsplanung",
  "Genehmigungsplanung",
  "Ausführungsplanung",
  "Vorbereitung der Vergabe",
  "Mitwirkung bei der Vergabe",
  "Objektüberwachung – Bauüberwachung und Dokumentation",
  "Objektbetreuung",
];

/**
 * @param {number[]} prozente share of each work stage in percent
 * @returns {Array<{nr: number, bezeichnung: string, prozent: number}>}
 */
const lphListe = (prozente) => prozente.map((prozent, i) => ({ nr: i + 1, bezeichnung: LPH_NAMEN[i], prozent }));

/**
 * Work-stage percentages. § 34 Abs. 3 HOAI (buildings and interiors) and
 * § 39 Abs. 3 HOAI (open spaces); each list sums to 100 (%).
 */
export const LPH = friere({
  gebaeude: lphListe([2, 7, 15, 3, 25, 10, 4, 32, 2]),
  innenraeume: lphListe([2, 7, 15, 2, 30, 7, 3, 32, 2]),
  freianlagen: lphListe([3, 10, 16, 4, 25, 7, 3, 30, 2]),
});

/**
 * § 33 Abs. 2 HOAI: costs of technical systems (KG 400) that the architect does
 * not plan count in full up to 25 % of the other anrechenbare Kosten and by half
 * above that. Shares as fractions (0.25 = 25 %).
 */
export const KG400_REGEL = friere({ voll_bis_anteil: 0.25, darueber_faktor: 0.5, quelle: "§ 33 Abs. 2 HOAI" });

/**
 * Upper limit of the conversion surcharge (Umbauzuschlag) in percent of the base fee.
 * § 36 Abs. 1 HOAI: buildings up to 33 %, § 36 Abs. 2: interiors up to 50 %.
 * Open spaces 33 % is [ASSUMED] — § 40 Abs. 6 was not fetched; check before relying on it.
 */
export const UMBAU_MAX_PROZENT = friere({ gebaeude: 33, innenraeume: 50, freianlagen: 33 });

/**
 * § 35 Abs. 6 HOAI: evaluation points → fee zone for buildings (I ≤ 10,
 * II 11–18, III 19–26, IV 27–34, V 35–42). `bis` inclusive, in points.
 */
export const PUNKTE_ZONEN_P35 = friere([
  { zone: "I", bis: 10 },
  { zone: "II", bis: 18 },
  { zone: "III", bis: 26 },
  { zone: "IV", bis: 34 },
  { zone: "V", bis: 42 },
]);

/**
 * Builds a HoaiTafel record for one of the two tables of tafel2021.js.
 * @param {string} leistungsbild registry key
 * @param {number} paragraf fee-table paragraph
 * @param {ReadonlyArray<readonly [number, ReadonlyArray<number>]>} zeilen
 * @param {Array<{nr: number, bezeichnung: string, prozent: number}>} lph
 * @param {number} lphParagraf
 * @param {number|null} umbau upper limit of the conversion surcharge in percent
 * @param {string} quelle URL of the fee-table paragraph
 * @returns {HoaiTafel}
 */
function tafelSatz(leistungsbild, paragraf, zeilen, lph, lphParagraf, umbau, quelle) {
  return {
    leistungsbild,
    paragraf,
    fassung: "HOAI 2021",
    bezug: "anrechenbare_kosten_euro",
    einheit: "EUR",
    zonen: ZONEN_FUENF,
    zeilen,
    lph,
    lphParagraf,
    umbau_max_prozent: umbau,
    quelle,
    abgerufen_am: GEPRUEFT_AM,
    status: "amtlich",
  };
}

/** § 35 table with the LPH of § 34 Abs. 3 for buildings. */
export const HOAI_TAFEL_GEBAEUDE = friere(tafelSatz("gebaeude", 35, TAFEL_GEBAEUDE_INNENRAEUME, LPH.gebaeude, 34, UMBAU_MAX_PROZENT.gebaeude, QUELLE.p35));
/** § 35 table with the LPH of § 34 Abs. 3 for interiors. */
export const HOAI_TAFEL_INNENRAEUME = friere(tafelSatz("innenraeume", 35, TAFEL_GEBAEUDE_INNENRAEUME, LPH.innenraeume, 34, UMBAU_MAX_PROZENT.innenraeume, QUELLE.p35));
/** § 40 table with the LPH of § 39 Abs. 3 for open spaces. */
export const HOAI_TAFEL_FREIANLAGEN = friere(tafelSatz("freianlagen", 40, TAFEL_FREIANLAGEN, LPH.freianlagen, 39, UMBAU_MAX_PROZENT.freianlagen, QUELLE.p40));

// The paragraphs of the eleven profiles without a transferred table follow the
// HOAI outline (79-RESEARCH "HOAI-Datenformat und Registry"); they are [ASSUMED]
// until 79-14 checks them against the fetched table of contents. Cost rules:
// § 38 open spaces, § 42 engineering structures, § 46 traffic facilities,
// § 50 structural planning, § 54 technical equipment; land-use planning by area.
/**
 * The registry of all 14 service profiles in fixed order (E-13), frozen below.
 * @type {Leistungsbild[]}
 */
export const LEISTUNGSBILDER = [
  { key: "gebaeude", label: "Gebäude", teil: 3, tafelParagraf: 35, lphParagraf: 34, kostenregel: "p33", tafel: HOAI_TAFEL_GEBAEUDE },
  { key: "innenraeume", label: "Innenräume", teil: 3, tafelParagraf: 35, lphParagraf: 34, kostenregel: "p33", tafel: HOAI_TAFEL_INNENRAEUME },
  { key: "freianlagen", label: "Freianlagen", teil: 3, tafelParagraf: 40, lphParagraf: 39, kostenregel: "manuell", tafel: HOAI_TAFEL_FREIANLAGEN },
  { key: "ingenieurbauwerke", label: "Ingenieurbauwerke", teil: 3, tafelParagraf: 44, lphParagraf: 43, kostenregel: "manuell", tafel: null },
  { key: "verkehrsanlagen", label: "Verkehrsanlagen", teil: 3, tafelParagraf: 48, lphParagraf: 47, kostenregel: "manuell", tafel: null },
  { key: "tragwerksplanung", label: "Tragwerksplanung", teil: 4, tafelParagraf: 52, lphParagraf: 51, kostenregel: "manuell", tafel: null },
  { key: "technische_ausruestung", label: "Technische Ausrüstung", teil: 4, tafelParagraf: 56, lphParagraf: 55, kostenregel: "manuell", tafel: null },
  { key: "flaechennutzungsplan", label: "Flächennutzungsplan", teil: 2, tafelParagraf: 20, lphParagraf: 18, kostenregel: "manuell", tafel: null },
  { key: "bebauungsplan", label: "Bebauungsplan", teil: 2, tafelParagraf: 21, lphParagraf: 19, kostenregel: "manuell", tafel: null },
  { key: "landschaftsplan", label: "Landschaftsplan", teil: 2, tafelParagraf: 28, lphParagraf: 23, kostenregel: "manuell", tafel: null },
  { key: "gruenordnungsplan", label: "Grünordnungsplan", teil: 2, tafelParagraf: 29, lphParagraf: 24, kostenregel: "manuell", tafel: null },
  { key: "landschaftsrahmenplan", label: "Landschaftsrahmenplan", teil: 2, tafelParagraf: 30, lphParagraf: 25, kostenregel: "manuell", tafel: null },
  { key: "landschaftspflegerischer_begleitplan", label: "Landschaftspflegerischer Begleitplan", teil: 2, tafelParagraf: 31, lphParagraf: 26, kostenregel: "manuell", tafel: null },
  { key: "pflege_entwicklungsplan", label: "Pflege- und Entwicklungsplan", teil: 2, tafelParagraf: 32, lphParagraf: 27, kostenregel: "manuell", tafel: null },
];
friere(LEISTUNGSBILDER);

/** HOAI 2021 in force since ('YYYY-MM-DD'). */
export const HOAI_GILT_AB = GILT_AB;

/**
 * True when a record may compute: status "amtlich" and no `annahme` (E-13).
 * @param {HoaiTafel|null|undefined} satz
 * @returns {boolean}
 */
function istAmtlich(satz) {
  return Boolean(satz && satz.status === "amtlich" && !satz.annahme);
}

/**
 * The table record of a profile: from the registry entry, otherwise from
 * WEITERE_TAFELN (79-14). A later registered record wins, so 79-14 could also
 * replace a table here without editing this file.
 * @param {string} key registry key
 * @param {ReadonlyArray<HoaiTafel>} [weitere] additional records (injectable for tests)
 * @returns {HoaiTafel|null}
 */
function datensatzFuer(key, weitere = WEITERE_TAFELN) {
  const zusatz = [...weitere].reverse().find((t) => t && t.leistungsbild === key);
  if (zusatz) return zusatz;
  return LEISTUNGSBILDER.find((e) => e.key === key)?.tafel ?? null;
}

/**
 * Registry entry merged with its table record: everything the fee form and the
 * calculator need in one object. Unknown key → null. A profile without a record
 * (or with a record that is not "amtlich") has `tafel: null`, empty `zonen`/`lph`
 * and `status: "fehlt"` — it stays selectable but does not compute.
 * @param {string} key registry key, e.g. "gebaeude"
 * @param {{weitere?: ReadonlyArray<HoaiTafel>}} [optionen] injectable additional records (tests)
 * @returns {(Leistungsbild & {
 *   zonen: ReadonlyArray<string>, lph: ReadonlyArray<{nr: number, bezeichnung: string, prozent: number}>,
 *   bezug: string|null, einheit: string|null, umbau_max_prozent: number|null,
 *   quelle: string|null, abgerufen_am: string|null, status: "amtlich"|"fehlt",
 * })|null}
 */
export function leistungsbildInfo(key, optionen = {}) {
  const basis = LEISTUNGSBILDER.find((e) => e.key === key);
  if (!basis) return null;
  const satz = datensatzFuer(key, optionen.weitere);
  if (!istAmtlich(satz)) {
    return {
      ...basis, tafel: null, zonen: [], lph: [], bezug: null, einheit: null,
      umbau_max_prozent: null, quelle: satz?.quelle ?? null, abgerufen_am: satz?.abgerufen_am ?? null, status: "fehlt",
    };
  }
  return {
    ...basis,
    tafel: satz,
    zonen: satz.zonen,
    lph: satz.lph,
    bezug: satz.bezug,
    einheit: satz.einheit,
    umbau_max_prozent: satz.umbau_max_prozent,
    quelle: satz.quelle,
    abgerufen_am: satz.abgerufen_am,
    status: "amtlich",
  };
}

/**
 * Whether a profile computes: "amtlich" only for a record with status
 * "amtlich" and without `annahme`; "fehlt" otherwise (also for unknown keys).
 * @param {string} key registry key
 * @param {{weitere?: ReadonlyArray<HoaiTafel>}} [optionen] injectable additional records (tests)
 * @returns {"amtlich"|"fehlt"}
 */
export function tafelStatus(key, optionen = {}) {
  if (!LEISTUNGSBILDER.some((e) => e.key === key)) return "fehlt";
  return istAmtlich(datensatzFuer(key, optionen.weitere)) ? "amtlich" : "fehlt";
}

/**
 * All 14 profiles as leistungsbildInfo objects, in registry order.
 * @returns {Array<NonNullable<ReturnType<typeof leistungsbildInfo>>>}
 */
export function alleLeistungsbilder() {
  return LEISTUNGSBILDER.map((e) => /** @type {NonNullable<ReturnType<typeof leistungsbildInfo>>} */ (leistungsbildInfo(e.key)));
}
