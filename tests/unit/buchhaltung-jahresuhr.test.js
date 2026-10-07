// Unit tests of the year clock's geometry and drawing model (79-10): the
// clock-face point formula, month/date angles (incl. the UTC/leap-year edge
// cases of 79-RESEARCH), the constant-gap sector path, the area-true fill
// radius, the "nice" scale, the composed uhrModell() and its shared
// symbolArten()/legendeEintraege() ordering, and roving-tabindex navigation.
//
// In:  src/lib/accounting/jahresuhr.js, JahresuhrLegende.jsx (as text) and the
//      EN part files (tests/unit/helpers/woerterbuch.mjs). Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LEGENDE_TEXTE, RADIEN, datumsWinkel, flaechentreuerRadius, legendeEintraege, monatsWinkel, naechsterMonat,
  punkt, ringSektorPfad, skala, symbolArten, uhrModell,
} from "@/lib/accounting/jahresuhr.js";
import { BUERO_STANDARD } from "@/lib/accounting/einstellungen.js";
import { englischePaareAlle } from "./helpers/woerterbuch.mjs";

/** @param {number} a @param {number} b @param {number} [eps] @param {string} [meldung] */
function nahe(a, b, eps = 0.01, meldung = "") {
  assert.ok(Math.abs(a - b) <= eps, `${meldung ? `${meldung}: ` : ""}erwartet ~${b}, war ${a}`);
}

test("punkt: 12-Uhr-Position im Uhrzeigersinn", () => {
  nahe(punkt(100, 0).x, 180); nahe(punkt(100, 0).y, 80);
  nahe(punkt(100, 90).x, 280); nahe(punkt(100, 90).y, 180);
  nahe(punkt(100, 180).x, 180); nahe(punkt(100, 180).y, 280);
  nahe(punkt(100, 270).x, 80); nahe(punkt(100, 270).y, 180);
});

test("monatsWinkel: Januar oben zentriert, 30° je Monat", () => {
  assert.deepEqual(monatsWinkel(1), [-15, 15]);
  assert.deepEqual(monatsWinkel(4), [75, 105]);
  assert.deepEqual(monatsWinkel(12), [315, 345]);
});

test("datumsWinkel: Prüfwerte aus 79-RESEARCH", () => {
  nahe(/** @type {number} */ (datumsWinkel("2026-03-10")), 54.19);
  nahe(/** @type {number} */ (datumsWinkel("2026-01-01")), 345.48);
  nahe(/** @type {number} */ (datumsWinkel("2026-02-15")), 30.54);
  nahe(/** @type {number} */ (datumsWinkel("2028-02-29")), 44.48);
  nahe(/** @type {number} */ (datumsWinkel("2026-10-10")), 264.19);
  nahe(/** @type {number} */ (datumsWinkel("2026-09-27")), 251.50);
  assert.equal(datumsWinkel("2026-02-29"), null, "kein Schaltjahr");
  nahe(/** @type {number} */ (datumsWinkel("2026-03-10T23:30:00Z")), 54.19, 0.01, "ISO mit T: erste 10 Zeichen");
});

test("ringSektorPfad: zwei Bögen (Radius 124/76), sweep 1/0, large-arc 0, Spalt 2,00 ± 0,01 an beiden Radien", () => {
  const jan = ringSektorPfad(76, 124, -15, 15);
  assert.match(jan, /A 124 124 0 0 1/);
  assert.match(jan, /A 76 76 0 0 0/);
  const feb = ringSektorPfad(76, 124, 15, 45);
  // Outer gap: Jan's outer-arc END point (adjacent to Feb, angle +15 side)
  // vs. Feb's path START point (its own outer-arc start, angle +15 side).
  const janAussenEnde = /A 124 124 0 0 1 ([\d.]+) ([\d.]+)/.exec(jan);
  const febAussenStart = /^M ([\d.]+) ([\d.]+)/.exec(feb);
  const dxA = Number(janAussenEnde[1]) - Number(febAussenStart[1]);
  const dyA = Number(janAussenEnde[2]) - Number(febAussenStart[2]);
  nahe(Math.hypot(dxA, dyA), 2.0, 0.02);
  // Inner gap: Jan's "L" point (its inner boundary near +15, adjacent to Feb)
  // vs. Feb's inner-arc END point (its inner boundary near +15, adjacent to Jan).
  const janInnenNaheFeb = /L ([\d.]+) ([\d.]+) A 76/.exec(jan);
  const febInnenNaheJan = /A 76 76 0 0 0 ([\d.]+) ([\d.]+) Z\s*$/.exec(feb);
  const dxI = Number(janInnenNaheFeb[1]) - Number(febInnenNaheJan[1]);
  const dyI = Number(janInnenNaheFeb[2]) - Number(febInnenNaheJan[2]);
  nahe(Math.hypot(dxI, dyI), 2.0, 0.02);
});

test("flaechentreuerRadius: Prüfwerte", () => {
  assert.equal(flaechentreuerRadius(0), null);
  nahe(/** @type {number} */ (flaechentreuerRadius(0.5)), 102.84);
  assert.equal(flaechentreuerRadius(1), 124);
  assert.equal(flaechentreuerRadius(1.7), 124, "über 1 wird gekappt");
  assert.equal(flaechentreuerRadius(NaN), null);
  assert.ok(/** @type {number} */ (flaechentreuerRadius(0.001)) >= 77.5, "Mindestradius für jede echte Menge");
});

test("skala: Prüfwerte", () => {
  assert.equal(skala(57300), 60000);
  assert.equal(skala(10001), 12000);
  assert.equal(skala(99999), 100000);
  assert.equal(skala(0), 1000);
  assert.equal(skala(-5), 1000);
});

const MONATSNAMEN = (m) => ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][m - 1];
/** @param {Partial<{eingaengeCent: number, abflussCent: number}>[]} teil */
const monateAus = (teil) => Array.from({ length: 12 }, (_, i) => ({ eingaengeCent: 0, abflussCent: 0, ...(teil[i] || {}) }));

test("uhrModell: liefert immer 12 Segmente, kein Eingang → fuellung null, Abfluss>Eingang → luecke", () => {
  const monate = monateAus([{ eingaengeCent: 0, abflussCent: 0 }, { eingaengeCent: 100000, abflussCent: 200000 }]);
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate, steuertage: [], fristen: [], monatsnamen: MONATSNAMEN });
  assert.equal(modell.segmente.length, 12);
  assert.equal(modell.segmente[0].fuellung, null, "Monat 1 ohne Eingang");
  assert.equal(modell.segmente[1].fuellung !== null, true);
  assert.ok(modell.segmente[1].luecke, "Abfluss > Eingang erzeugt eine Lücke");
  assert.equal(modell.segmente[0].luecke, null, "kein Abfluss, keine Lücke");
});

test("uhrModell: 10.12.2026 mit ESt + USt → eine Steuermarke mit 2 Arten", () => {
  const monate = monateAus([]);
  const steuertage = [{ arten: ["est", "ust"], nenn: "2026-12-10", faellig: "2026-12-10", betragCent: 100000, gedeckt: true, warnung: null }];
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate, steuertage, fristen: [], monatsnamen: MONATSNAMEN });
  const steuerMarken = modell.marken.filter((m) => m.art === "steuer");
  assert.equal(steuerMarken.length, 1);
  assert.deepEqual(steuerMarken[0].arten.sort(), ["est", "ust"]);
});

test("uhrModell: Frist im Vorjahr (20.12.2026) fehlt auf der Uhr 2027, steht in ausserhalb.fristen", () => {
  const modell = uhrModell({
    jahr: 2027, heute: "2026-09-27", monate: monateAus([]), steuertage: [],
    fristen: [{ datum: "2026-12-20" }], monatsnamen: MONATSNAMEN,
  });
  assert.equal(modell.marken.filter((m) => m.art === "frist").length, 0);
  assert.equal(modell.ausserhalb.fristen, 1);
});

test("uhrModell: Zeiger null für 2025 bei heute 2026-09-27, kein Pfad enthält NaN, deep-equal bei gleicher Eingabe", () => {
  const eingabe = { jahr: 2025, heute: "2026-09-27", monate: monateAus([]), steuertage: [], fristen: [], monatsnamen: MONATSNAMEN };
  const modell = uhrModell(eingabe);
  assert.equal(modell.zeiger, null);
  const alleZeichenketten = JSON.stringify(modell);
  assert.ok(!alleZeichenketten.includes("NaN"));
  assert.deepEqual(uhrModell({ ...eingabe }), modell);
});

test("symbolArten/legendeEintraege: ohne Defizit und ohne Warnung → ohne 'defizit'/'deckung-warn'; gleiche Länge und Reihenfolge", () => {
  const monate = monateAus([{ eingaengeCent: 100000, abflussCent: 50000 }]);
  const steuertage = [{ arten: ["ust"], nenn: "2026-01-10", faellig: "2026-01-12", betragCent: 1000, gedeckt: true, warnung: null }];
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate, steuertage, fristen: [], monatsnamen: MONATSNAMEN });
  const arten = symbolArten(modell);
  assert.ok(!arten.includes("defizit"));
  assert.ok(!arten.includes("deckung-warn"));
  const legende = legendeEintraege(modell, { ziel: 14, puffer: 7 });
  assert.equal(legende.length, arten.length);
  assert.deepEqual(legende.map((l) => l.symbol), arten);
});

test("naechsterMonat: Umlauf, Home/End", () => {
  assert.equal(naechsterMonat(12, "ArrowRight"), 1);
  assert.equal(naechsterMonat(1, "ArrowLeft"), 12);
  assert.equal(naechsterMonat(7, "Home"), 1);
  assert.equal(naechsterMonat(7, "End"), 12);
});

test("RADIEN: Konstanten wie in der Spezifikation", () => {
  assert.equal(RADIEN.ringInnen, 76);
  assert.equal(RADIEN.ringAussen, 124);
});

test("uhrModell: ein leeres Jahr → graue Segmente ohne Füllung/Linie/Schraffur, Skala 1.000 € (100.000 Cent)", () => {
  const modell = uhrModell({ jahr: 2024, heute: "2026-09-27", monate: monateAus([]), steuertage: [], fristen: [], monatsnamen: MONATSNAMEN });
  assert.equal(modell.skala, 100000, "skala() in Euro: 0 → 1.000 €; das Modell hält Cent");
  assert.ok(modell.segmente.every((s) => s.fuellung === null && s.abflussBogen === null && s.luecke === null));
  assert.deepEqual(symbolArten(modell), ["segment"]);
});

test("uhrModell: Skala in Cent aus dem größten Monatswert in Euro (57.300 € → 60.000 €)", () => {
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate: monateAus([{ eingaengeCent: 5730000, abflussCent: 100000 }]), steuertage: [], fristen: [], monatsnamen: MONATSNAMEN });
  assert.equal(modell.skala, 6000000);
  assert.equal(modell.segmente[0].fuellung?.radius, flaechentreuerRadius(5730000 / 6000000));
});

test("uhrModell: Geometrie kommt aus dem Modell — Abflussbogen, Monatslabel, Zeigerspitze, Fristkappe r 152,5, Deckungssymbol r 164", () => {
  const monate = monateAus([{ eingaengeCent: 100000, abflussCent: 150000 }]);
  const steuertage = [
    { arten: ["est", "ust"], nenn: "2026-12-10", faellig: "2026-12-10", betragCent: 100000, gedeckt: true, warnung: null },
    { arten: ["ust"], nenn: "2026-11-10", faellig: "2026-11-10", betragCent: 0, gedeckt: false, warnung: null },
  ];
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate, steuertage, fristen: [{ datum: "2026-10-20" }], monatsnamen: MONATSNAMEN });
  const jan = modell.segmente[0];
  assert.match(/** @type {string} */ (jan.abflussBogen?.pfad), /^M [\d.]+ [\d.]+ A [\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+$/);
  assert.ok(jan.luecke?.pfad.startsWith("M "), "Schraffur-Pfad im Modell");
  assert.deepEqual(jan.labelPunkt, { x: 180, y: 120 }, "Januar-Label oben bei r 60");
  assert.deepEqual(modell.zeigerSpitze, punkt(RADIEN.zeigerAussen, /** @type {number} */ (datumsWinkel("2026-09-27"))));
  const frist = modell.marken.find((m) => m.art === "frist");
  assert.equal(frist?.datum, "2026-10-20");
  nahe(Math.hypot(/** @type {any} */ (frist).kreis.cx - 180, /** @type {any} */ (frist).kreis.cy - 180), RADIEN.hohlkreis, 0.02, "Hohlkreis am Friststrich");
  const ok = /** @type {any} */ (modell.marken.find((m) => m.art === "deckung-ok"));
  const okZahlen = ok.pfad.match(/-?[\d.]+/g).map(Number); // M x0 y0 L x1 y1 L x2 y2
  nahe(Math.hypot((okZahlen[0] + okZahlen[4]) / 2 - 180, okZahlen[1] - 180), RADIEN.deckung, 0.05, "Haken bei r 164");
  assert.equal(ok.datum, "2026-12-10");
  const warn = /** @type {any} */ (modell.marken.find((m) => m.art === "deckung-warn"));
  const warnZahlen = warn.pfad.match(/-?[\d.]+/g).map(Number); // M cx cy-5 …
  nahe(Math.hypot(warnZahlen[0] - 180, warnZahlen[1] + 5 - 180), RADIEN.deckung, 0.05, "Warndreieck bei r 164");
  assert.deepEqual(modell.segmente[11].steuertage, [{ nenn: "2026-12-10", arten: ["est", "ust"], gedeckt: true }], "Dezember kennt seinen Steuertag (aria-label)");
  assert.equal(modell.marken.find((m) => m.art === "steuer" && m.datum === "2026-12-10")?.arten.length, 2);
  assert.ok(!JSON.stringify(modell).includes("NaN"));
});

test("legendeEintraege: GmbH/UG → Linientext mit Geschäftsführergehalt; Frist nimmt 0 Tage wörtlich, fehlend → BUERO_STANDARD", () => {
  const monate = monateAus([{ eingaengeCent: 100000, abflussCent: 50000 }]);
  const modell = uhrModell({ jahr: 2026, heute: "2026-09-27", monate, steuertage: [], fristen: [{ datum: "2026-10-20" }], monatsnamen: MONATSNAMEN });
  const gmbh = legendeEintraege(modell, { gfGehalt: true, ziel: 0, puffer: 0 });
  assert.equal(gmbh.find((e) => e.symbol === "abfluss")?.textSchluessel, LEGENDE_TEXTE.abflussGfGehalt);
  assert.deepEqual(gmbh.find((e) => e.symbol === "frist")?.werte, { ziel: 0, puffer: 0 });
  const einzel = legendeEintraege(modell, {});
  assert.equal(einzel.find((e) => e.symbol === "abfluss")?.textSchluessel, LEGENDE_TEXTE.abfluss);
  assert.deepEqual(einzel.find((e) => e.symbol === "frist")?.werte, { ziel: BUERO_STANDARD.zahlungsziel_tage, puffer: BUERO_STANDARD.puffer_tage });
});

test("Legende: jeder Text aus LEGENDE_TEXTE steht als literaler t()-Aufruf in JahresuhrLegende.jsx und hat einen englischen Eintrag mit denselben Platzhaltern", () => {
  const quelle = fs.readFileSync(new URL("../../src/components/accounting/JahresuhrLegende.jsx", import.meta.url), "utf8");
  const en = new Map(englischePaareAlle().map(([k, v]) => [k, v]));
  const platz = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const text of Object.values(LEGENDE_TEXTE)) {
    assert.ok(quelle.includes(`t(${JSON.stringify(text)})`), `literaler t()-Aufruf fehlt: ${text}`);
    assert.ok(en.has(text), `EN-Eintrag fehlt: ${text}`);
    assert.equal(platz(/** @type {string} */ (en.get(text))), platz(text), `Platzhalter: ${text}`);
  }
  for (const stueck of ["ESt 10.3., 10.6., 10.9. und 10.12.", "KSt 10.3., 10.6., 10.9. und 10.12.", "GewSt 15.2., 15.5., 15.8. und 15.11."]) {
    assert.ok(quelle.includes(`t(${JSON.stringify(stueck)})`), `Steuer-Baustein fehlt: ${stueck}`);
    assert.match(/** @type {string} */ (en.get(stueck)), /\b\d{1,2} (Feb|Mar|May|Jun|Aug|Sep|Nov|Dec)\b/, `EN-Datum als "10 Mar", nicht "3.10": ${stueck}`);
  }
});
