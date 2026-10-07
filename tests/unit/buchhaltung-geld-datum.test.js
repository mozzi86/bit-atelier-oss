// Unit tests of money in cents, the calendar core and the number range (79-01 T2),
// plus two guards against the time-zone trap (NB-11): the same results under
// America/Los_Angeles and Pacific/Kiritimati, and a source scan for local date
// getters in src/lib/accounting/** and the calendar core (only heuteLokal may).
//
// In:  src/lib/accounting/geld.js, @core/lib/kalender/*, @core/lib/nummernkreis.js.
// Out: assertions; two child processes with another TZ.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ausBruttoCent, centZuEuro, euroZuCent, formatEuro, parseBetragDe, rundeCent, ustCent, verteileNachSchluessel,
} from "@/lib/accounting/geld.js";
import {
  excelSerie, heuteLokal, istSchaltjahr, jahrVon, monatVon, parseTag, plusMonate, plusTage, quartalVon, tag, tageImMonat,
  tageZwischen, wochentag,
} from "@core/lib/kalender/datum.js";
import { feiertageBund, ostersonntag } from "@core/lib/kalender/feiertage.js";
import { istWerktag, naechsterWerktag } from "@core/lib/kalender/arbeitstage.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

test("Geld: USt je Rechnung, kaufmännische Rundung, Brutto-Zerlegung", () => {
  assert.equal(ustCent(3333, 19), 633);
  assert.equal(3333 + ustCent(3333, 19), 3966);
  assert.equal(ustCent(1000000, 19), 190000);
  assert.equal(rundeCent(0.5), 1);
  assert.equal(rundeCent(-0.5), -1);
  assert.equal(rundeCent(1.005 * 100), 101);
  assert.equal(Object.is(rundeCent(-0.4), -0), false);
  assert.equal(euroZuCent(1234.56), 123456);
  assert.equal(euroZuCent(0.1 + 0.2), 30);
  assert.equal(euroZuCent(undefined), 0);
  assert.equal(centZuEuro(123456), 1234.56);
  assert.deepEqual(ausBruttoCent(119000, 19), { netto: 100000, ust: 19000 });
  const z = ausBruttoCent(3966, 19);
  assert.equal(z.netto + z.ust, 3966);
});

test("verteileNachSchluessel: größter Rest, Summe exakt, Gleichstand nach Reihenfolge", () => {
  assert.deepEqual(verteileNachSchluessel(10001, [1, 1, 1]), [3334, 3334, 3333]);
  assert.deepEqual(verteileNachSchluessel(10000, [60, 40]), [6000, 4000]);
  assert.deepEqual(verteileNachSchluessel(-10001, [1, 1, 1]), [-3334, -3334, -3333]);
  assert.deepEqual(verteileNachSchluessel(100, [0, 1]), [0, 100]);
  const teile = verteileNachSchluessel(99999, [33.3, 33.3, 33.4]);
  assert.equal(teile.reduce((a, b) => a + b, 0), 99999);
  assert.throws(() => verteileNachSchluessel(100, [0, 0]), /keine Anteile/);
});

test("parseBetragDe und formatEuro", () => {
  assert.equal(parseBetragDe("1.234,56"), 123456);
  assert.equal(parseBetragDe("-12,5"), -1250);
  assert.equal(parseBetragDe(""), null);
  assert.equal(parseBetragDe("abc"), null);
  assert.equal(parseBetragDe("12"), 1200);
  assert.equal(parseBetragDe("1.234"), 123400);
  assert.equal(parseBetragDe("1234.5"), 123450);
  assert.equal(parseBetragDe(" 1.234,56 € "), 123456);
  assert.equal(parseBetragDe("1,234"), null, "drei Nachkommastellen werden nicht still gerundet");
  assert.equal(parseBetragDe("1.23,4"), null);
  assert.equal(formatEuro(123456, "de").replace(/\s/g, " "), "1.234,56 €");
  assert.equal(formatEuro(123456, "en"), "€1,234.56");
});

test("Datum: UTC-Arithmetik, Monatsende-Kappung, strenger Parser, Excel-Serie", () => {
  assert.equal(plusTage("2026-01-31", 30), "2026-03-02");
  assert.equal(plusMonate("2026-01-31", 1), "2026-02-28");
  assert.equal(plusMonate("2028-01-31", 1), "2028-02-29");
  assert.equal(plusMonate("2026-03-31", -1), "2026-02-28");
  assert.equal(plusMonate("2026-11-15", 3), "2027-02-15");
  assert.equal(parseTag("2026-02-29"), null);
  assert.equal(parseTag("2028-02-29"), "2028-02-29");
  assert.equal(parseTag("2026-03-10T23:30:00Z"), "2026-03-10");
  assert.equal(parseTag("10.03.2026"), null);
  assert.equal(parseTag(undefined), null);
  assert.equal(excelSerie("2026-09-27"), 46292);
  assert.equal(tag(2026, 13, 1), "2027-01-01");
  assert.equal(tageZwischen("2026-01-01", "2026-12-31"), 364);
  assert.equal(tageImMonat(2028, 2), 29);
  assert.equal(istSchaltjahr(1900), false);
  assert.equal(istSchaltjahr(2000), true);
  assert.equal(monatVon("2026-09-27"), 9);
  assert.equal(quartalVon("2026-09-27"), 3);
  assert.equal(jahrVon("2026-09-27"), 2026);
  assert.equal(wochentag("2026-09-27"), 0, "Sonntag");
  assert.equal(heuteLokal(new Date(2026, 8, 27, 23, 30)), "2026-09-27");
});

test("Feiertage und Werktage (§ 108 Abs. 3 AO)", () => {
  assert.equal(ostersonntag(2026), "2026-04-05");
  assert.equal(ostersonntag(2027), "2027-03-28");
  assert.equal(ostersonntag(2024), "2024-03-31");
  const f = feiertageBund(2026);
  assert.equal(f.length, 9);
  assert.deepEqual(f.map((x) => x.datum), ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"]);
  assert.equal(naechsterWerktag("2026-04-03"), "2026-04-07");
  assert.equal(naechsterWerktag("2026-10-10"), "2026-10-12");
  assert.equal(naechsterWerktag("2027-01-10"), "2027-01-11");
  assert.equal(naechsterWerktag("2026-12-25"), "2026-12-28");
  assert.equal(naechsterWerktag("2026-03-10"), "2026-03-10");
  assert.equal(istWerktag("2026-05-14"), false, "Christi Himmelfahrt");
  assert.equal(istWerktag("2026-09-28"), true);
});

test("naechsteNummer: höchste Nummer desselben Jahres + 1, fremde Jahre zählen nicht", () => {
  assert.equal(naechsteNummer("RE-{jahr}-{nr3}", ["RE-2026-013", "RE-2025-044"], "2026-03-01"), "RE-2026-014");
  assert.equal(naechsteNummer("RE-{jahr}-{nr3}", ["RE-2025-044"], "2026-03-01"), "RE-2026-001");
  assert.equal(naechsteNummer("RE-{jahr}-{nr4}", ["RE-2026-0013"], "2026-03-01"), "RE-2026-0014");
  assert.equal(naechsteNummer("RE-{jahr}-{nr3}", ["RE-2026-999"], "2026-12-31"), "RE-2026-1000");
  assert.equal(naechsteNummer("HA-{jahr}-{nr3}", ["RE-2026-013", null, "HA-2026-002"], "2026-05-01"), "HA-2026-003");
  assert.equal(naechsteNummer("PB.{nr4}", ["PB.0007", "PB.0003"], "2026-05-01"), "PB.0008");
  assert.throws(() => naechsteNummer("RE-{jahr}", [], "2026-01-01"), /\{nr3\}/);
});

// The same battery of results in a child process with another time zone.
const BATTERIE = `
  import { plusTage, plusMonate, parseTag, excelSerie, wochentag, tageZwischen } from "@core/lib/kalender/datum.js";
  import { naechsterWerktag } from "@core/lib/kalender/arbeitstage.js";
  import { ostersonntag } from "@core/lib/kalender/feiertage.js";
  import { ustTerminDaten, vorauszahlungsTermine } from "@/lib/accounting/steuertermine.js";
  import { wiederkehrendeVorkommen, afaLinearCent, rechnungsStatus } from "@/lib/accounting/grundlagen.js";
  import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
  console.log(JSON.stringify({
    a: plusTage("2026-01-31", 30), b: plusMonate("2028-01-31", 1), c: parseTag("2026-03-10T23:30:00Z"),
    d: excelSerie("2026-09-27"), e: wochentag("2026-09-27"), f: tageZwischen("2026-03-29", "2026-03-30"),
    g: naechsterWerktag("2026-04-03"), h: ostersonntag(2026),
    i: ustTerminDaten(2026, { ust_zeitraum: "monat", dauerfrist: true }), j: vorauszahlungsTermine(2026, "gewst"),
    k: wiederkehrendeVorkommen({ id: "wa-1", rhythmus: "monat", start: "2026-01-31" }, "2026-01-01", "2026-12-31"),
    l: afaLinearCent(1200000, 6, "2026-03-15", 2026),
    m: rechnungsStatus({ status: "gestellt", brutto: 100, faellig_am: "2026-09-26" }, "2026-09-27"),
    n: beispielDatensaetze("2026-09-27"),
  }));
`;

/** @param {string|undefined} tz @returns {unknown} */
function batterie(tz) {
  const env = { ...process.env };
  if (tz) env.TZ = tz;
  const aus = execFileSync(process.execPath, ["--import", "./tests/alias-register.mjs", "--input-type=module", "-e", BATTERIE],
    { cwd: WURZEL, env, encoding: "utf8" });
  return JSON.parse(aus);
}

test("Zeitzonen: America/Los_Angeles und Pacific/Kiritimati liefern identische Ergebnisse", () => {
  const referenz = batterie("Europe/Berlin");
  assert.equal(referenz.l, 166667);
  assert.deepEqual(batterie("America/Los_Angeles"), referenz);
  assert.deepEqual(batterie("Pacific/Kiritimati"), referenz);
});

test("Quelltext-Wächter: keine lokalen Datums-Getter außer in heuteLokal", () => {
  const ordner = [path.join(WURZEL, "src/lib/accounting"), path.join(WURZEL, "packages/nova-core/src/lib/kalender")];
  const dateien = ordner.flatMap((o) => fs.readdirSync(o, { recursive: true }).filter((n) => /\.m?js$/.test(n)).map((n) => path.join(o, n)));
  assert.ok(dateien.length >= 14, `nur ${dateien.length} Dateien gelesen`);
  const verboten = /\.(getDate|getMonth|getFullYear|setDate|setMonth|setFullYear|getDay|getHours)\(/g;
  const treffer = [];
  for (const datei of dateien) {
    let text = fs.readFileSync(datei, "utf8");
    // The one allowed place: the body of heuteLokal().
    text = text.replace(/export function heuteLokal\([\s\S]*?\)\s*\{[\s\S]*?\n\}/, "");
    for (const m of text.matchAll(verboten)) treffer.push(`${path.relative(WURZEL, datei)}: ${m[0]}`);
  }
  assert.deepEqual(treffer, []);
  // The guard must see heuteLokal at all (otherwise the exception above hides nothing).
  assert.match(fs.readFileSync(path.join(WURZEL, "packages/nova-core/src/lib/kalender/datum.js"), "utf8"), /export function heuteLokal\(/);
});
