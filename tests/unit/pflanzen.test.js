// Unit-Tests für packages/nova-designer/src/lib/pflanzen.js (Phase 37, GARTEN-02/03/04).
// Kulisse: Klima mit kältestem Monatsminimum −2 °C → T_extrem −10 °C → USDA-Zone 8; 550 mm/a = trocken.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LAGEPLAN_DEFAULT, neuesElement, neueFlaeche } from "@designer/lib/lageplan";
import {
  PFLANZEN_KATALOG, PFLANZEN_TYPEN, FLAECHEN_ARTEN, GRUEN_ARTEN, TROCKEN_MM,
  winterhaertezone, klimaAmStandort, eignung, aussenanlagenPlanChecks, pflanzenMengen, gruenflaecheAusLayer,
} from "@designer/lib/pflanzen";

const months = (tMin) => Array.from({ length: 12 }, (_, i) => ({ month: i, temp: tMin + 6, tMin: i === 0 ? tMin : tMin + 5, precip: 45 }));
const KLIMA_MILD = klimaAmStandort({ months: months(-2), annualPrecip: 800, avgTemp: 9.5, offline: false });
const KLIMA_TROCKEN = klimaAmStandort({ months: months(-2), annualPrecip: 550, avgTemp: 10, offline: false });
const KLIMA_KALT = klimaAmStandort({ months: months(-22), annualPrecip: 700, avgTemp: 2, offline: false }); // T_extrem −30 → Zone 4
const FP = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const QUADRAT = (s, dx = 0) => [{ x: dx, z: 20 }, { x: dx + s, z: 20 }, { x: dx + s, z: 20 + s }, { x: dx, z: 20 + s }];

describe("pflanzen: Katalog", () => {
  it("jeder Typ hat Krone, Höhe, Licht, Zone, Trockenheit, Resilienz; Ids eindeutig", () => {
    const alle = PFLANZEN_KATALOG.flatMap((g) => g.typen);
    assert.ok(alle.length >= 18);
    for (const t of alle) {
      assert.ok(t.krone_m > 0 && t.hoehe_m > 0, t.id);
      assert.ok(Array.isArray(t.licht) && t.licht.length, t.id);
      assert.ok(t.zone_min >= 3 && t.zone_min <= 10, t.id);
      assert.ok(["gering", "mittel", "hoch"].includes(t.trockenheit) && ["gering", "mittel", "hoch"].includes(t.klimaresilienz), t.id);
    }
    assert.equal(new Set(alle.map((t) => t.id)).size, alle.length);
    assert.equal(PFLANZEN_TYPEN.feldahorn.gruppe, "Bäume");
    assert.deepEqual(GRUEN_ARTEN, ["gruen", "beet"]);
    assert.equal(FLAECHEN_ARTEN.befestigt.gruen, false);
  });
});

describe("pflanzen: Klima am Standort", () => {
  it("winterhaertezone nach USDA-Grenzen", () => {
    assert.equal(winterhaertezone(-10), 8);
    assert.equal(winterhaertezone(-20), 6);
    assert.equal(winterhaertezone(-30), 4);
    assert.equal(winterhaertezone(NaN), 6);
  });
  it("klimaAmStandort: T_extrem = min(tMin) − 8 K → Zone; trocken unter 600 mm; offline ohne Zone", () => {
    assert.equal(KLIMA_MILD.tExtrem, -10);
    assert.equal(KLIMA_MILD.zone, 8);
    assert.equal(KLIMA_MILD.trocken, false);
    assert.equal(KLIMA_TROCKEN.trocken, true);
    assert.ok(KLIMA_TROCKEN.niederschlag_mm < TROCKEN_MM);
    const off = klimaAmStandort({ offline: true, months: [] });
    assert.equal(off.zone, null);
    assert.equal(off.offline, true);
  });
});

describe("pflanzen: Eignung", () => {
  it("Feldahorn sonnig in Zone 8 → geeignet; Rotbuche an sonnigem Platz → bedingt (Licht)", () => {
    assert.equal(eignung("feldahorn", { klima: KLIMA_MILD, licht: "sonnig" }).status, "geeignet");
    const rb = eignung("rotbuche", { klima: KLIMA_MILD, licht: "sonnig" });
    assert.equal(rb.status, "bedingt");
    assert.ok(rb.gruende.some((g) => g.startsWith("Licht")));
  });
  it("Olivenbaum (Zone ≥ 9) in Zone 8 → ungeeignet; Hortensie am trockenen Standort → bedingt + Klimawandel-Hinweis", () => {
    assert.equal(eignung("olivenbaum", { klima: KLIMA_MILD, licht: "sonnig" }).status, "ungeeignet");
    const ho = eignung("hortensie", { klima: KLIMA_TROCKEN, licht: "halbschattig" });
    assert.equal(ho.status, "bedingt");
    assert.ok(ho.gruende.some((g) => g.includes("Trocken")) && ho.gruende.some((g) => g.includes("Klimawandel")));
    assert.equal(eignung("feldahorn", { klima: KLIMA_KALT }).status, "ungeeignet");
  });
  it("Klima offline → offen (Licht kann trotzdem auf bedingt setzen); unbekannter Typ → offen", () => {
    assert.equal(eignung("feldahorn", { klima: null, licht: "sonnig" }).status, "offen");
    assert.equal(eignung("rotbuche", { klima: null, licht: "sonnig" }).status, "bedingt");
    assert.equal(eignung("gibtsnicht", {}).status, "offen");
  });
});

describe("pflanzen: Checks, Mengen, Grünfläche", () => {
  it("Checks nur pass/warn/offen; leerer Plan ohne Parzelle → offen-Einträge", () => {
    const items = aussenanlagenPlanChecks(LAGEPLAN_DEFAULT, { footprint: FP, parzelleM: null, klima: KLIMA_MILD });
    assert.ok(items.every((i) => ["pass", "warn", "offen"].includes(i.status)));
    assert.equal(items.find((i) => i.key === "parzelle").status, "offen");
    assert.equal(items.find((i) => i.key === "eignung").status, "offen");
    assert.equal(items.find((i) => i.key === "gruen").status, "offen");
  });
  it("Pflanze im Gebäude → Lage warn; Krone zu nah an der Fassade → warn; frei stehend → pass", () => {
    let l = neuesElement(LAGEPLAN_DEFAULT, { typ: "feldahorn", x: 0, z: 0 }).layer; // inside the footprint
    let items = aussenanlagenPlanChecks(l, { footprint: FP, parzelleM: null, klima: KLIMA_MILD, lichtJeElement: { el_1: "sonnig" } });
    assert.equal(items.find((i) => i.key === "lage").status, "warn");
    l = neuesElement(LAGEPLAN_DEFAULT, { typ: "feldahorn", x: 0, z: 9 }).layer; // 2 m from the façade, crown r = 4
    items = aussenanlagenPlanChecks(l, { footprint: FP, klima: KLIMA_MILD, lichtJeElement: { el_1: "sonnig" } });
    assert.equal(items.find((i) => i.key === "fassade").status, "warn");
    assert.equal(items.find((i) => i.key === "lage").status, "pass");
    l = neuesElement(LAGEPLAN_DEFAULT, { typ: "feldahorn", x: 0, z: 20 }).layer;
    items = aussenanlagenPlanChecks(l, { footprint: FP, klima: KLIMA_MILD, lichtJeElement: { el_1: "sonnig" } });
    assert.equal(items.find((i) => i.key === "fassade").status, "pass");
    assert.equal(items.find((i) => i.key === "eignung").status, "pass");
  });
  it("pflanzenMengen zählt je Typ mit Kronenfläche; gruenflaecheAusLayer = gruen + beet", () => {
    let l = neuesElement(LAGEPLAN_DEFAULT, { typ: "feldahorn", x: 0, z: 20 }).layer;
    l = neuesElement(l, { typ: "feldahorn", x: 10, z: 20 }).layer;
    l = neuesElement(l, { typ: "lavendel", x: 5, z: 25 }).layer;
    const m = pflanzenMengen(l);
    assert.equal(m[0].typ, "feldahorn");
    assert.equal(m[0].anzahl, 2);
    assert.ok(Math.abs(m[0].krone_m2 - 2 * Math.PI * 16) < 0.2);
    l = neueFlaeche(l, { art: "gruen", points: QUADRAT(10) }).layer;
    l = neueFlaeche(l, { art: "beet", points: QUADRAT(4, 20) }).layer;
    l = neueFlaeche(l, { art: "befestigt", points: QUADRAT(5, 40) }).layer;
    assert.equal(gruenflaecheAusLayer(l), 116);
  });
});
