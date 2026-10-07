// Unit tests of drawings / partner profit shares (79-06): plan-vs-actual per
// active person, the profit-sharing key (sum check, effective key by legal
// form), the largest-remainder profit split (property test: 1,000 random
// profits/keys sum exactly), and the drawings-vs-profit-share overview per
// legal form (E-04) including the GmbH/UG managing-director-salary hint.
//
// In:  src/lib/accounting/entnahmen.js, src/lib/accounting/beispielDaten.js
//      (contract test T4), src/lib/accounting/einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entnahmenJeGesellschafter, geplanteEntnahmen, gewinnanteile, schluesselPruefen,
  uebersicht, wirksamerSchluessel,
} from "@/lib/accounting/entnahmen.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { euroZuCent } from "@/lib/accounting/geld.js";

const EINZEL = wirksameEinstellungen({ rechtsform: "einzelunternehmen" });
const GBR = wirksameEinstellungen({ rechtsform: "gbr" });
const GMBH = wirksameEinstellungen({ rechtsform: "gmbh" });

test("entnahmenJeGesellschafter: summiert nur das angefragte Jahr, in Cent", () => {
  const daten = { Entnahme: [
    { gesellschafter_id: "g1", datum: "2026-03-10", betrag: 1000 },
    { gesellschafter_id: "g1", datum: "2026-06-10", betrag: 500 },
    { gesellschafter_id: "g1", datum: "2027-01-10", betrag: 9999 }, // anderes Jahr, zählt nicht
    { gesellschafter_id: "g2", datum: "2026-01-01", betrag: 200 },
  ] };
  assert.deepEqual(entnahmenJeGesellschafter(daten, 2026), { g1: 150000, g2: 20000 });
  assert.deepEqual(entnahmenJeGesellschafter(daten, 2027), { g1: 999900 });
});

test("geplanteEntnahmen: Plan 5.000 €/Monat, heute 2026-09-27, Ist September 3.000 € → Rest September 2.000 €, Oktober–Dezember je 5.000 €, Summe 17.000,00 €; vergangene Monate ohne Plan", () => {
  const gesellschafter = [{ id: "g1", aktiv: true, entnahme_plan_monat: 5000 }];
  const entnahmen = [{ gesellschafter_id: "g1", datum: "2026-09-15", betrag: 3000 }];
  const plan = geplanteEntnahmen(gesellschafter, entnahmen, "2026-09-27", 2026, EINZEL);
  const monate = plan.map((p) => p.monat);
  assert.deepEqual(monate, ["2026-09", "2026-10", "2026-11", "2026-12"], "vergangene Monate (Jan–Aug) fehlen");
  assert.equal(plan.find((p) => p.monat === "2026-09")?.restCent, 200000, "Rest September = 5.000 − 3.000 = 2.000,00 €");
  assert.ok(plan.filter((p) => p.monat !== "2026-09").every((p) => p.restCent === 500000), "Oktober–Dezember je 5.000,00 €");
  const summe = plan.reduce((n, p) => n + p.restCent, 0);
  assert.equal(summe, 1700000, "geplante Summe Rest des Jahres 17.000,00 €");
});

test("geplanteEntnahmen: ein bereits im laufenden Monat voll entnommener Plan → Rest 0, nie negativ", () => {
  const gesellschafter = [{ id: "g1", aktiv: true, entnahme_plan_monat: 9500 }];
  const entnahmen = [{ gesellschafter_id: "g1", datum: "2026-09-25", betrag: 9500 }];
  const plan = geplanteEntnahmen(gesellschafter, entnahmen, "2026-09-27", 2026, EINZEL);
  assert.equal(plan.find((p) => p.monat === "2026-09")?.restCent, 0);
  // Überentnahme im laufenden Monat darf keinen negativen Rest erzeugen.
  const entnahmenUeber = [{ gesellschafter_id: "g1", datum: "2026-09-25", betrag: 20000 }];
  const planUeber = geplanteEntnahmen(gesellschafter, entnahmenUeber, "2026-09-27", 2026, EINZEL);
  assert.equal(planUeber.find((p) => p.monat === "2026-09")?.restCent, 0, "nie negativ");
});

test("geplanteEntnahmen: eine erst im laufenden Monat angelegte Person (kein Startdatum) bekommt ohne Ist den vollen Monatsplan", () => {
  const gesellschafter = [{ id: "g-neu", aktiv: true, entnahme_plan_monat: 2000 }];
  const plan = geplanteEntnahmen(gesellschafter, [], "2026-09-27", 2026, EINZEL);
  assert.equal(plan.find((p) => p.monat === "2026-09")?.restCent, 200000, "voller Monatsplan ohne Ist");
});

test("geplanteEntnahmen: GmbH/UG haben keine Entnahmen — leere Liste", () => {
  const gesellschafter = [{ id: "g1", aktiv: true, entnahme_plan_monat: 9500 }];
  assert.deepEqual(geplanteEntnahmen(gesellschafter, [], "2026-09-27", 2026, GMBH), []);
});

test("schluesselPruefen: 60/30 → Summe 90, nicht ok; 60/40 → ok", () => {
  assert.deepEqual(schluesselPruefen({ a: 60, b: 30 }), { ok: false, summe: 90 });
  assert.deepEqual(schluesselPruefen({ a: 60, b: 40 }), { ok: true, summe: 100 });
  assert.equal(schluesselPruefen(null).ok, false);
  assert.equal(schluesselPruefen({}).summe, 0);
});

test("wirksamerSchluessel: Einzelunternehmen → 100 % an die eine Inhaberin, ohne Setting-Eintrag", () => {
  const daten = { Gesellschafter: [{ id: "bsp-g1", rolle: "inhaber", aktiv: true }] };
  assert.deepEqual(wirksamerSchluessel(daten, EINZEL, 2026), { "bsp-g1": 100 });
});

test("wirksamerSchluessel: GbR ohne gespeicherten (oder unvollständigen) Schlüssel des Jahres → null (schluessel_fehlt)", () => {
  const daten = { Gesellschafter: [{ id: "g1", aktiv: true }, { id: "g2", aktiv: true }] };
  assert.equal(wirksamerSchluessel(daten, GBR, 2026), null, "kein Setting-Eintrag");
  const mitUnvollstaendigem = wirksameEinstellungen({ rechtsform: "gbr", schluessel: { 2026: { g1: 60, g2: 30 } } });
  assert.equal(wirksamerSchluessel(daten, mitUnvollstaendigem, 2026), null, "Summe 90 %, nicht 100 %");
  const mitGueltigem = wirksameEinstellungen({ rechtsform: "gbr", schluessel: { 2026: { g1: 60, g2: 40 } } });
  assert.deepEqual(wirksamerSchluessel(daten, mitGueltigem, 2026), { g1: 60, g2: 40 });
});

test("wirksamerSchluessel: GmbH/UG → null (keine Gewinnverteilung per Schlüssel)", () => {
  assert.equal(wirksamerSchluessel({ Gesellschafter: [] }, GMBH, 2026), null);
});

test("gewinnanteile: 100.000,01 € bei 50/50 → 50.000,01 € / 50.000,00 € (kleinere id bekommt den Rest-Cent bei Gleichstand)", () => {
  const anteile = gewinnanteile(euroZuCent(100000.01), { "bsp-g2": 50, "bsp-g1": 50 });
  assert.deepEqual(anteile, { "bsp-g1": euroZuCent(50000.01), "bsp-g2": euroZuCent(50000) });
});

test("gewinnanteile: 1.000,00 € bei 33,33/33,33/33,34 → 333,30 € / 333,30 € / 333,40 €, Summe exakt der Gewinn", () => {
  const anteile = gewinnanteile(euroZuCent(1000), { a: 33.33, b: 33.33, c: 33.34 });
  assert.deepEqual(anteile, { a: euroZuCent(333.3), b: euroZuCent(333.3), c: euroZuCent(333.4) });
  assert.equal(Object.values(anteile).reduce((n, c) => n + c, 0), euroZuCent(1000));
});

test("gewinnanteile: fehlender oder leerer Schlüssel → {} statt NaN oder Fehler", () => {
  assert.deepEqual(gewinnanteile(euroZuCent(50000), null), {});
  assert.deepEqual(gewinnanteile(euroZuCent(50000), {}), {});
  assert.deepEqual(gewinnanteile(euroZuCent(50000), { a: 0, b: 0 }), {});
});

test("Eigenschaftstest: 1.000 Zufallsgewinne/-schlüssel — die Summe der Anteile ist immer exakt der Gewinn", () => {
  for (let i = 0; i < 1000; i++) {
    const gewinnCent = Math.round(Math.random() * 100000000); // bis zu 1.000.000,00 €
    const anzahl = 2 + Math.floor(Math.random() * 4); // 2–5 Gesellschafter
    const schluessel = {};
    for (let k = 0; k < anzahl; k++) schluessel[`g${k}`] = 1 + Math.random() * 100;
    const anteile = gewinnanteile(gewinnCent, schluessel);
    const summe = Object.values(anteile).reduce((n, c) => n + c, 0);
    assert.equal(summe, gewinnCent, `Lauf ${i}: Schlüssel ${JSON.stringify(schluessel)}, Gewinn ${gewinnCent}`);
  }
});

test("uebersicht: Gewinnanteil 46.800 €, Ist 40.000 €, Plan-Rest 12.000 € → ueberentnahme true, Differenz −5.200,00 €", () => {
  const daten = {
    Gesellschafter: [{ id: "g1", name: "Testperson", rolle: "inhaber", aktiv: true, entnahme_plan_monat: 12000 }],
    Entnahme: [{ gesellschafter_id: "g1", datum: "2026-01-15", betrag: 40000 }],
  };
  // Plan-Rest 12.000 € über einen einzigen künftigen Monat (Dezember) erzwingen.
  const zeilen = uebersicht(daten, 2026, euroZuCent(46800), "2026-12-27", EINZEL);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].gewinnanteil, euroZuCent(46800));
  assert.equal(zeilen[0].ist, euroZuCent(40000));
  assert.equal(zeilen[0].planRest, euroZuCent(12000));
  assert.equal(zeilen[0].differenz, euroZuCent(-5200));
  assert.equal(zeilen[0].ueberentnahme, true);
});

test("uebersicht: GmbH — Geschäftsführergehalt (kategorie personal, aktiv) 7.000 €/Monat, geplanteEntnahmen bleibt außen vor", () => {
  const daten = {
    Gesellschafter: [{ id: "g1", aktiv: true }], // frühere Person, keine Wirkung mehr auf GmbH
    Entnahme: [],
    WiederkehrendeAusgabe: [
      { id: "wa-gf", kategorie: "personal", lieferant: "Geschäftsführergehalt", rhythmus: "monat", brutto: 7000, aktiv: true },
      { id: "wa-alt", kategorie: "personal", lieferant: "Alt-Vertrag", rhythmus: "monat", brutto: 500, aktiv: false }, // inaktiv, zählt nicht
    ],
  };
  const ergebnis = uebersicht(daten, 2026, euroZuCent(0), "2026-09-27", GMBH);
  assert.deepEqual(ergebnis, { gfGehalt: [{ vorlage_id: "wa-gf", bezeichnung: "Geschäftsführergehalt", betragMonatCent: euroZuCent(7000) }], summeMonatCent: euroZuCent(7000) });
});

// --- T4 Vertragstest: der Kontrakt hält auf den echten Beispieldaten -----------------------

test("Vertragstest (T4): beispielDatensaetze('2026-09-27') — Einzelunternehmen, Plan-Rest 28.500,00 €, wirksamerSchluessel {bsp-g1: 100}, GmbH → geplanteEntnahmen []", () => {
  const heute = "2026-09-27";
  const bsp = beispielDatensaetze(heute);
  const einst = wirksameEinstellungen(bsp.Setting[0].value);
  const daten = { Gesellschafter: bsp.Gesellschafter, Entnahme: bsp.Entnahme, WiederkehrendeAusgabe: bsp.WiederkehrendeAusgabe };

  const plan = geplanteEntnahmen(bsp.Gesellschafter, bsp.Entnahme, heute, 2026, einst);
  const restSumme = plan.reduce((n, p) => n + p.restCent, 0);
  assert.equal(restSumme, euroZuCent(28500), "Plan-Rest des Jahres = 3 × 9.500 € (September bereits voll entnommen, Rest 0)");
  assert.ok(Number.isFinite(restSumme) && !Number.isNaN(restSumme));

  assert.deepEqual(wirksamerSchluessel(daten, einst, 2026), { "bsp-g1": 100 });

  const anteile = gewinnanteile(euroZuCent(100000), wirksamerSchluessel(daten, einst, 2026));
  assert.deepEqual(anteile, { "bsp-g1": euroZuCent(100000) });

  const zeilen = /** @type {any[]} */ (uebersicht(daten, 2026, euroZuCent(100000), heute, einst));
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].ist, euroZuCent(85500), "Ist Januar–September = 9 × 9.500 €");
  assert.ok(!Number.isNaN(zeilen[0].differenz));

  const gmbhEinst = wirksameEinstellungen({ ...bsp.Setting[0].value, rechtsform: "gmbh" });
  assert.deepEqual(geplanteEntnahmen(bsp.Gesellschafter, bsp.Entnahme, heute, 2026, gmbhEinst), []);
});

test("Vertragstest GbR (b-06): Beispieldaten + „Gesellschafter B“ (Plan 2.000 €, keine Entnahme), Schlüssel 60/40 → Plan-Rest 28.500 € + 8.000 € = 36.500 €, Gewinnanteile 60.000/40.000 €", () => {
  const heute = "2026-09-27";
  const bsp = beispielDatensaetze(heute);
  const gesellschafter = [...bsp.Gesellschafter, { id: "bsp-g2", name: "Gesellschafter B", rolle: "gesellschafter", aktiv: true, entnahme_plan_monat: 2000 }];
  const einst = wirksameEinstellungen({ ...bsp.Setting[0].value, rechtsform: "gbr", schluessel: { 2026: { "bsp-g1": 60, "bsp-g2": 40 } } });
  const daten = { Gesellschafter: gesellschafter, Entnahme: bsp.Entnahme };

  assert.deepEqual(wirksamerSchluessel(daten, einst, 2026), { "bsp-g1": 60, "bsp-g2": 40 });
  assert.deepEqual(gewinnanteile(euroZuCent(100000), wirksamerSchluessel(daten, einst, 2026)), { "bsp-g1": euroZuCent(60000), "bsp-g2": euroZuCent(40000) });

  const plan = geplanteEntnahmen(gesellschafter, bsp.Entnahme, heute, 2026, einst);
  const restA = plan.filter((p) => p.gesellschafter_id === "bsp-g1").reduce((n, p) => n + p.restCent, 0);
  const restB = plan.filter((p) => p.gesellschafter_id === "bsp-g2").reduce((n, p) => n + p.restCent, 0);
  assert.equal(restA, euroZuCent(28500), "Inhaberin A: 0 € September + 28.500 € Oktober–Dezember");
  assert.equal(restB, euroZuCent(8000), "Gesellschafter B: 2.000 € September + 6.000 € Oktober–Dezember");
  assert.equal(restA + restB, euroZuCent(36500));

  const zeilen = /** @type {any[]} */ (uebersicht(daten, 2026, euroZuCent(100000), heute, einst));
  assert.equal(zeilen.length, 2);
  const summePlanRest = zeilen.reduce((n, z) => n + z.planRest, 0);
  assert.equal(summePlanRest, euroZuCent(36500));
});
