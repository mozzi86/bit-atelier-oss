// Wave 1 (B-81-04): working days respect the public holidays of the federal
// state chosen in the office calendar (rule "kalender.bundesland"), for all 16
// states. Before this fix feiertage() knew Bavaria only, every other state got
// the nation-wide list, and the setting offered Bavaria as its only option.
//
// Expected lists: the state holiday laws (see the source table in
// packages/nova-core/src/lib/kalender/feiertage.js). Test years are chosen so
// the state holidays fall on weekdays (2028: Easter 16 April, 31 Oct Tuesday,
// 1 Nov Wednesday, 8 Mar Wednesday, 20 Sep Wednesday, Repentance Day 22 Nov).
//
// In:  @core/lib/kalender/*, @/lib/abwesenheit/kalenderRegeln.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUNDESLAENDER, feiertage, feiertageBund, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { istArbeitstag, naechsterArbeitstag, zaehleTage } from "@core/lib/kalender/arbeitstage.js";
import { kalenderEinstellung, KALENDER_REGELN } from "@/lib/abwesenheit/kalenderRegeln.js";
import { FEIERTAG_NAMEN } from "@/lib/abwesenheit/feiertagNamen.js";

const BUND = ["neujahr", "karfreitag", "ostermontag", "tag_der_arbeit", "christi_himmelfahrt", "pfingstmontag",
  "tag_der_deutschen_einheit", "weihnachtstag_1", "weihnachtstag_2"];

/** State → holidays beyond the nation-wide list in 2028 (Bavaria with the office standard switches). */
const ZUSATZ_2028 = {
  BW: ["heilige_drei_koenige", "fronleichnam", "allerheiligen"],
  BY: ["heilige_drei_koenige", "fronleichnam", "allerheiligen", "mariae_himmelfahrt"],
  BE: ["frauentag"],
  BB: ["reformationstag"],
  HB: ["reformationstag"],
  HH: ["reformationstag"],
  HE: ["fronleichnam"],
  MV: ["frauentag", "reformationstag"],
  NI: ["reformationstag"],
  NW: ["fronleichnam", "allerheiligen"],
  RP: ["fronleichnam", "allerheiligen"],
  SL: ["fronleichnam", "mariae_himmelfahrt", "allerheiligen"],
  SN: ["reformationstag", "buss_und_bettag"],
  ST: ["heilige_drei_koenige", "reformationstag"],
  SH: ["reformationstag"],
  TH: ["weltkindertag", "reformationstag"],
};

const namen = (/** @type {string} */ land, /** @type {number} */ jahr) =>
  feiertage(jahr, { ...KALENDER_STANDARD, bundesland: land }).map((f) => f.name).sort();

test("all 16 states: holiday list 2028 = nation-wide list + the state's own days", () => {
  assert.deepEqual([...BUNDESLAENDER].sort(), Object.keys(ZUSATZ_2028).sort());
  for (const [land, zusatz] of Object.entries(ZUSATZ_2028)) {
    assert.deepEqual(namen(land, 2028), [...BUND, ...zusatz].sort(), land);
  }
});

test("dates of the state holidays 2028", () => {
  const datum = (/** @type {string} */ land, /** @type {string} */ name) =>
    feiertage(2028, { bundesland: land }).find((f) => f.name === name)?.datum;
  assert.equal(datum("SN", "buss_und_bettag"), "2028-11-22");
  assert.equal(datum("SN", "reformationstag"), "2028-10-31");
  assert.equal(datum("TH", "weltkindertag"), "2028-09-20");
  assert.equal(datum("BE", "frauentag"), "2028-03-08");
  assert.equal(datum("NW", "fronleichnam"), "2028-06-15");
  assert.equal(datum("NW", "allerheiligen"), "2028-11-01");
  assert.equal(datum("ST", "heilige_drei_koenige"), "2028-01-06");
  assert.equal(datum("SL", "mariae_himmelfahrt"), "2028-08-15");
  // Repentance Day = the Wednesday before 23 November.
  assert.equal(feiertage(2026, { bundesland: "SN" }).find((f) => f.name === "buss_und_bettag")?.datum, "2026-11-18");
  assert.equal(feiertage(2025, { bundesland: "SN" }).find((f) => f.name === "buss_und_bettag")?.datum, "2025-11-19");
});

test("holidays introduced in a later year only count from that year", () => {
  const hat = (/** @type {string} */ land, /** @type {number} */ jahr, /** @type {string} */ name) =>
    feiertage(jahr, { bundesland: land }).some((f) => f.name === name);
  // Reformation Day in the four northern states since 2018; 2017 was a one-time holiday everywhere.
  assert.equal(hat("HH", 2016, "reformationstag"), false);
  assert.equal(hat("HH", 2017, "reformationstag"), true);
  assert.equal(hat("BY", 2017, "reformationstag"), true);
  assert.equal(hat("BY", 2018, "reformationstag"), false);
  assert.equal(hat("NI", 2018, "reformationstag"), true);
  // Berlin: Women's Day since 2019, one-time 8 May in 2020 and 2025; Mecklenburg-Vorpommern: Women's Day since 2023.
  assert.equal(hat("BE", 2018, "frauentag"), false);
  assert.equal(hat("BE", 2019, "frauentag"), true);
  assert.equal(hat("BE", 2025, "tag_der_befreiung"), true);
  assert.equal(hat("BE", 2026, "tag_der_befreiung"), false);
  assert.equal(hat("MV", 2022, "frauentag"), false);
  assert.equal(hat("MV", 2023, "frauentag"), true);
  // Thuringia: World Children's Day since 2019.
  assert.equal(hat("TH", 2018, "weltkindertag"), false);
  assert.equal(hat("TH", 2019, "weltkindertag"), true);
});

test("Bavarian switches stay Bavarian; unknown state = nation-wide list", () => {
  assert.equal(feiertage(2028, { bundesland: "NW", mariae_himmelfahrt: true, augsburger_friedensfest: true }).some((f) => f.name === "mariae_himmelfahrt" || f.name === "augsburger_friedensfest"), false);
  assert.deepEqual(feiertage(2028, { bundesland: "XX" }), feiertageBund(2028));
  // Bavaria unchanged by this fix (13 days 2026, 9 on weekdays → 252 working days).
  assert.equal(feiertage(2026, KALENDER_STANDARD).length, 13);
});

test("working-day arithmetic follows the configured state (red before: NW counted like the nation-wide list)", () => {
  const nw = feiertage(2026, { bundesland: "NW" });
  // 2026: 261 weekdays − 7 nation-wide holidays on weekdays − Corpus Christi (Thu 4 June) = 253.
  assert.equal(zaehleTage("2026-01-01", "2026-12-31", { zaehlart: "arbeitstage", feiertage: nw }), 253);
  assert.equal(istArbeitstag("2026-06-04", nw), false);
  const sn = feiertage(2026, { bundesland: "SN" });
  assert.equal(naechsterArbeitstag("2026-11-18", sn), "2026-11-19");
  const hh = feiertage(2026, { bundesland: "HH" });
  assert.equal(istArbeitstag("2026-06-04", hh), true);
});

test("the office setting offers all 16 states and passes the choice through", () => {
  const regel = KALENDER_REGELN.find((r) => r.id === "kalender.bundesland");
  assert.ok(regel);
  assert.deepEqual((/** @type {any} */ (regel).optionen || []).map((/** @type {any} */ o) => o.wert).sort(), [...BUNDESLAENDER].sort());
  const einst = kalenderEinstellung((id) => (id === "kalender.bundesland" ? "SN" : undefined));
  assert.equal(einst.bundesland, "SN");
  assert.ok(feiertage(2026, einst).some((f) => f.name === "buss_und_bettag"));
});

test("every holiday id has a display name", () => {
  for (const land of BUNDESLAENDER) {
    for (const j of [2017, 2020, 2025, 2028]) {
      for (const f of feiertage(j, { bundesland: land, augsburger_friedensfest: true })) {
        assert.ok(f.name in FEIERTAG_NAMEN, `${land} ${j} ${f.name}`);
      }
    }
  }
});
