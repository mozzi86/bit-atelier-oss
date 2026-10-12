// Phase 81 (81-01): the additive calendar functions in the 79 core — Berlin day
// of a timestamp, years, ISO weeks, Bavarian holidays, working days and target
// minutes. 79's own functions are re-checked where 81 relies on them; their full
// suite stays tests/unit/buchhaltung-geld-datum.test.js. Runs under any TZ
// (the verify step repeats it with TZ=UTC).
//
// In:  @core/lib/kalender/*. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { datumText, isoTag, isoWoche, plusJahre, wochenTage } from "@core/lib/kalender/datum.js";
import { feiertage, feiertageBund, istFeiertag, KALENDER_STANDARD, ostersonntag } from "@core/lib/kalender/feiertage.js";
import { istArbeitstag, naechsterArbeitstag, naechsterWerktag, sollMinuten, zaehleTage } from "@core/lib/kalender/arbeitstage.js";

test("79-Exporte unverändert, zusätzliche Osterprüfwerte", () => {
  assert.equal(ostersonntag(2026), "2026-04-05");
  assert.equal(ostersonntag(2027), "2027-03-28");
  assert.equal(ostersonntag(2285), "2285-03-22");
  assert.equal(feiertageBund(2026).length, 9);
  assert.equal(naechsterWerktag("2026-10-10"), "2026-10-12");
  // 79 knows only nation-wide holidays: 15.08.2025 (Friday) stays a working day there.
  assert.equal(naechsterWerktag("2025-08-15"), "2025-08-15");
});

test("feiertage: Bayern mit 15.8. = 13 Tage, ohne = 12, enthält die Bundesliste vollständig", () => {
  const by = feiertage(2026, KALENDER_STANDARD);
  assert.equal(by.length, 13);
  assert.equal(feiertage(2026, { ...KALENDER_STANDARD, mariae_himmelfahrt: false }).length, 12);
  for (const f of feiertageBund(2026)) assert.ok(by.some((x) => x.datum === f.datum && x.name === f.name), f.name);
  for (const f of by) assert.deepEqual(Object.keys(f).sort(), ["datum", "name"]);
  // Corpus Christi = Easter + 60 days (2026-04-05 + 60 = 2026-06-04).
  assert.ok(by.some((f) => f.name === "fronleichnam" && f.datum === "2026-06-04"));
  assert.ok(istFeiertag("2026-01-06", by));
  assert.ok(!istFeiertag("2026-01-07", by));
  // Augsburg only when switched on.
  assert.ok(feiertage(2026, { augsburger_friedensfest: true }).some((f) => f.datum === "2026-08-08"));
  // Another state: nation-wide only (not implemented yet).
  assert.equal(feiertage(2026, { bundesland: "NW" }).length, 9);
  // Sorted by date.
  const daten = by.map((f) => f.datum);
  assert.deepEqual([...daten].sort(), daten);
});

test("zaehleTage: 252 Arbeitstage in Bayern 2026 (261 Wochentage − 9 Feiertage an Wochentagen)", () => {
  const liste = feiertage(2026, KALENDER_STANDARD);
  assert.equal(zaehleTage("2026-01-01", "2026-12-31", { zaehlart: "arbeitstage", feiertage: liste }), 252);
  assert.equal(zaehleTage("2026-01-01", "2026-12-31", { zaehlart: "arbeitstage" }), 252, "Standard = Bayern");
  // KW 40: Mo–Sa are 6 Werktage, but Saturday 03.10. is German Unity Day → 5.
  assert.equal(zaehleTage("2026-09-28", "2026-10-04", { zaehlart: "werktage", feiertage: liste }), 5);
  assert.equal(zaehleTage("2026-10-05", "2026-10-11", { zaehlart: "werktage", feiertage: liste }), 6);
  assert.equal(zaehleTage("2026-10-04", "2026-09-28"), 0);
});

test("isoTag: Berliner Kalendertag eines Zeitstempels, Tage bleiben", () => {
  assert.equal(isoTag("2026-06-19T22:00:00Z"), "2026-06-20"); // UTC+2 in summer
  assert.equal(isoTag("2026-12-31T23:30:00Z"), "2027-01-01"); // UTC+1 in winter
  assert.equal(isoTag("2026-09-28"), "2026-09-28");
  assert.equal(isoTag(Date.UTC(2026, 8, 28, 21, 59)), "2026-09-28");
  assert.equal(isoTag(new Date("2026-09-28T22:00:00Z")), "2026-09-29");
  assert.equal(isoTag("kein Datum"), null);
  assert.equal(isoTag("2026-02-30"), null);
});

test("isoWoche und wochenTage", () => {
  assert.deepEqual(isoWoche("2026-09-28"), { jahr: 2026, woche: 40 });
  assert.deepEqual(isoWoche("2026-10-04"), { jahr: 2026, woche: 40 });
  assert.deepEqual(isoWoche("2027-01-01"), { jahr: 2026, woche: 53 });
  assert.deepEqual(isoWoche("2024-12-30"), { jahr: 2025, woche: 1 });
  const kw40 = wochenTage(2026, 40);
  assert.equal(kw40.length, 7);
  assert.equal(kw40[0], "2026-09-28");
  assert.equal(kw40[6], "2026-10-04");
  assert.deepEqual(wochenTage(2025, 1)[0], "2024-12-30");
  assert.deepEqual(wochenTage(2026, 0), []);
});

test("sollMinuten: Vertrag, Feiertag, Teilzeit an den ersten Wochentagen, Tagessoll ohne Vertrag", () => {
  const liste = [...feiertage(2026, KALENDER_STANDARD)];
  assert.equal(sollMinuten("2026-09-28", "2026-10-04", { wochenstunden: 40, arbeitstageWoche: 5, feiertage: liste }), 2400);
  // KW 22/2026: Whit Monday 25.05. → 4 days × 480.
  assert.equal(sollMinuten("2026-05-25", "2026-05-31", { wochenstunden: 40, arbeitstageWoche: 5, feiertage: liste }), 1920);
  // 24 h on 3 days: 480 min Mo–Mi [ASSUMED first weekdays], Th/Fr 0.
  assert.equal(sollMinuten("2026-09-28", "2026-10-04", { wochenstunden: 24, arbeitstageWoche: 3, feiertage: liste }), 1440);
  assert.equal(sollMinuten("2026-10-01", "2026-10-02", { wochenstunden: 24, arbeitstageWoche: 3, feiertage: liste }), 0);
  // Without a contract: daily target 480 on Mo–Fr (E-17).
  assert.equal(sollMinuten("2026-09-28", "2026-10-04", { tagessollMinuten: 480, feiertage: liste }), 2400);
  assert.equal(sollMinuten("2026-05-25", "2026-05-31", { tagessollMinuten: 480, feiertage: liste }), 1920);
  assert.equal(sollMinuten("2026-09-28", "2026-10-04", {}), 0);
});

test("plusJahre, naechsterArbeitstag, istArbeitstag, datumText", () => {
  assert.equal(plusJahre("2028-02-29", 5), "2033-02-28");
  assert.equal(plusJahre("2026-09-28", -1), "2025-09-28");
  assert.equal(naechsterArbeitstag("2025-08-15", feiertage(2025, KALENDER_STANDARD)), "2025-08-18");
  assert.equal(naechsterArbeitstag("2026-10-10"), "2026-10-12");
  assert.equal(naechsterArbeitstag("2026-09-28"), "2026-09-28");
  assert.equal(istArbeitstag("2026-01-06"), false, "Heilige Drei Könige in Bayern");
  assert.equal(istArbeitstag("2026-01-07"), true);
  assert.equal(istArbeitstag("2026-01-06", feiertageBund(2026)), true, "mit Bundesliste ein Arbeitstag");
  assert.equal(datumText("2026-09-28"), "28.09.2026");
  assert.equal(datumText("2026-09-28", "en"), "28/09/2026");
  assert.equal(datumText("x"), "");
});
