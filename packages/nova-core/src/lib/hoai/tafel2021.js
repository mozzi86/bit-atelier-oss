// HOAI 2021 fee tables § 35 Abs. 1 (buildings and interiors) and § 40 Abs. 1
// (open spaces) — shared core for phase 79 (accounting) and phase 81 (offers,
// contracts). Deliberately import-free and frozen: server code, unit tests and
// every package can read it without the alias hook.
//
// In:  nothing. Out: the two tables as rows
//      [anrechenbare Kosten in Euro, [Zone I von, II von, III von, IV von, V von, V bis]]
//      (fee values in Euro), their sources and the verification date.
//
// The numbers are NOT typed by hand: they were generated from the official HTML
// by .planning/phases/79-buchhaltung/tmp-e2e/hoai-tafel-abruf.mjs (fetched
// 2026-09-27), which checks every row for continuity (upper bound of
// zone n = lower bound of zone n+1) and compares them with 79-RESEARCH.md.
//
// Maintenance rule: a new HOAI version gets NEW constants (and a new row with a
// new `ab` date in src/lib/accounting/einstellungen.js) — these stay unchanged.

/**
 * Freezes a fee table deeply and gives it its row type.
 * @param {Array<[number, number[]]>} zeilen rows [anrechenbare Kosten in Euro, six zone bounds in Euro]
 * @returns {ReadonlyArray<readonly [number, ReadonlyArray<number>]>}
 */
function friere(zeilen) {
  return /** @type {any} */ (Object.freeze(zeilen.map((z) => Object.freeze([z[0], Object.freeze(z[1])]))));
}

/** Official sources (gesetze-im-internet.de, HOAI 2021 = hoai_2013 with the 2021 amendment). */
export const QUELLE = Object.freeze({
  p33: "https://www.gesetze-im-internet.de/hoai_2013/__33.html",
  p34: "https://www.gesetze-im-internet.de/hoai_2013/__34.html",
  p35: "https://www.gesetze-im-internet.de/hoai_2013/__35.html",
  p36: "https://www.gesetze-im-internet.de/hoai_2013/__36.html",
  p39: "https://www.gesetze-im-internet.de/hoai_2013/__39.html",
  p40: "https://www.gesetze-im-internet.de/hoai_2013/__40.html",
});

/** Date the tables were fetched and checked against the research tables ('YYYY-MM-DD'). */
export const GEPRUEFT_AM = "2026-09-27";

/** Date the HOAI 2021 came into force ('YYYY-MM-DD'). */
export const GILT_AB = "2021-01-01";

/**
 * § 35 Abs. 1 HOAI — Honorare für Grundleistungen bei Gebäuden und Innenräumen.
 * 20 rows; first value anrechenbare Kosten in Euro, then the six zone bounds in Euro.
 */
export const TAFEL_GEBAEUDE_INNENRAEUME = friere([
  [25000, [3120, 3657, 4339, 5412, 6094, 6631]],
  [35000, [4217, 4942, 5865, 7315, 8237, 8962]],
  [50000, [5804, 6801, 8071, 10066, 11336, 12333]],
  [75000, [8342, 9776, 11601, 14469, 16293, 17727]],
  [100000, [10790, 12644, 15005, 18713, 21074, 22928]],
  [150000, [15500, 18164, 21555, 26883, 30274, 32938]],
  [200000, [20037, 23480, 27863, 34751, 39134, 42578]],
  [300000, [28750, 33692, 39981, 49864, 56153, 61095]],
  [500000, [45232, 53006, 62900, 78449, 88343, 96118]],
  [750000, [64666, 75781, 89927, 112156, 126301, 137416]],
  [1000000, [83182, 97479, 115675, 144268, 162464, 176761]],
  [1500000, [119307, 139813, 165911, 206923, 233022, 253527]],
  [2000000, [153965, 180428, 214108, 267034, 300714, 327177]],
  [3000000, [220161, 258002, 306162, 381843, 430003, 467843]],
  [5000000, [343879, 402984, 478207, 596416, 671640, 730744]],
  [7500000, [493923, 578816, 686862, 856648, 964694, 1049587]],
  [10000000, [638277, 747981, 887604, 1107012, 1246635, 1356339]],
  [15000000, [915129, 1072416, 1272601, 1587176, 1787360, 1944648]],
  [20000000, [1180414, 1383298, 1641513, 2047281, 2305496, 2508380]],
  [25000000, [1436874, 1683837, 1998153, 2492079, 2806395, 3053358]],
]);

/**
 * § 40 Abs. 1 HOAI — Honorare für Grundleistungen bei Freianlagen.
 * 20 rows; first value anrechenbare Kosten in Euro, then the six zone bounds in Euro.
 */
export const TAFEL_FREIANLAGEN = friere([
  [20000, [3643, 4348, 5229, 6521, 7403, 8108]],
  [25000, [4406, 5259, 6325, 7888, 8954, 9807]],
  [30000, [5147, 6143, 7388, 9215, 10460, 11456]],
  [35000, [5870, 7006, 8426, 10508, 11928, 13064]],
  [40000, [6577, 7850, 9441, 11774, 13365, 14638]],
  [50000, [7953, 9492, 11416, 14238, 16162, 17701]],
  [60000, [9287, 11085, 13332, 16627, 18874, 20672]],
  [75000, [11227, 13400, 16116, 20100, 22816, 24989]],
  [100000, [14332, 17106, 20574, 25659, 29127, 31901]],
  [125000, [17315, 20666, 24855, 30999, 35188, 38539]],
  [150000, [20201, 24111, 28998, 36166, 41053, 44963]],
  [200000, [25746, 30729, 36958, 46094, 52323, 57306]],
  [250000, [31053, 37063, 44576, 55594, 63107, 69117]],
  [350000, [41147, 49111, 59066, 73667, 83622, 91586]],
  [500000, [55300, 66004, 79383, 99006, 112385, 123088]],
  [650000, [69114, 82491, 99212, 123736, 140457, 153834]],
  [800000, [82430, 98384, 118326, 147576, 167518, 183472]],
  [1000000, [99578, 118851, 142942, 178276, 202368, 221641]],
  [1250000, [120238, 143510, 172600, 215265, 244355, 267627]],
  [1500000, [140204, 167340, 201261, 251011, 284931, 312067]],
]);
