// 72-01 A-7/A-8 (Befunde N-07, N-12): EINE Label-Abbildung @core/lib/labels.js.
//
// Geprüft wird die Abnahme aus dem Review:
//   - „concept"/„temperate"/„undefined" erscheinen nirgends mehr als Anzeige
//     (labelFor liefert deutsche Labels oder „—" bei leer)
//   - ALTE Seed-Werte („LP 5 - …", Köppen „Cfb", deutsche Labels) werden beim
//     Lesen auf Keys normalisiert — beide Datengenerationen auf einer Basis
//   - Klimazone: DE/AT/CH-Standort → "temperate" (A-8), unbekannt → null
//   - statusInfo/hoaiProgress verstehen beide Generationen (projectModel)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  labelFor,
  STATUS_LABELS,
  TYPE_LABELS,
  CLIMATE_ZONE_LABELS,
  ENERGY_TARGET_LABELS,
  normalisiereStatus,
  normalisiereKlimazone,
  normalisiereHoaiPhase,
  normalisiereProjekt,
  normalisiereProjekte,
  klimazoneAusStandort,
} from "@core/lib/labels";
import { statusInfo, hoaiProgress, hoaiPhaseShort } from "@core/lib/projectModel";

describe("labels — labelFor (Anzeige)", () => {
  it("Key → deutsches Label", () => {
    assert.equal(labelFor(STATUS_LABELS, "concept"), "Konzept");
    assert.equal(labelFor(STATUS_LABELS, "construction"), "Im Bau");
    assert.equal(labelFor(TYPE_LABELS, "commercial"), "Gewerbe");
    assert.equal(labelFor(CLIMATE_ZONE_LABELS, "temperate"), "Gemäßigt");
    assert.equal(labelFor(ENERGY_TARGET_LABELS, "kfw_40"), "KfW 40");
  });

  it("leer/null → Gedankenstrich (nie undefined im Text, Befund N-07)", () => {
    assert.equal(labelFor(STATUS_LABELS, ""), "—");
    assert.equal(labelFor(STATUS_LABELS, null), "—");
    assert.equal(labelFor(STATUS_LABELS, undefined), "—");
  });

  it("unbekannter Wert bleibt sichtbar (kein Verschweigen)", () => {
    assert.equal(labelFor(STATUS_LABELS, "in_abnahme"), "in_abnahme");
  });
});

describe("labels — Normalisierung alter Seed-Werte (A-7)", () => {
  it("status: deutsches Label → Key; Key bleibt", () => {
    assert.equal(normalisiereStatus("Konzept"), "concept");
    assert.equal(normalisiereStatus("Im Bau"), "construction");
    assert.equal(normalisiereStatus("LP 5"), "LP 5"); // kein Status → unverändert
    assert.equal(normalisiereStatus("concept"), "concept");
    assert.equal(normalisiereStatus(""), null);
    assert.equal(normalisiereStatus(null), null);
  });

  it("climate_zone: Köppen-Code und Label → Key", () => {
    assert.equal(normalisiereKlimazone("Cfb"), "temperate");
    assert.equal(normalisiereKlimazone("Dfb"), "continental");
    assert.equal(normalisiereKlimazone("Gemäßigt"), "temperate");
    assert.equal(normalisiereKlimazone("tropical"), "tropical");
    assert.equal(normalisiereKlimazone(null), null);
  });

  it("hoai_phase: LP-5-String → 5; Zahl bleibt; '7' → 7", () => {
    assert.equal(normalisiereHoaiPhase("LP 5 - Ausführungsplanung"), 5);
    assert.equal(normalisiereHoaiPhase("LP 1 - Grundlagenermittlung"), 1);
    assert.equal(normalisiereHoaiPhase(7), 7);
    assert.equal(normalisiereHoaiPhase("9"), 9);
    assert.equal(normalisiereHoaiPhase("unsinn"), null);
    assert.equal(normalisiereHoaiPhase(null), null);
  });

  it("normalisiereProjekt: Kopie, Eingabe unverändert (keine Mutation)", () => {
    const alt = { id: "p1", name: "X", status: "Konzept", climate_zone: "Cfb", hoai_phase: "LP 5 - Ausführungsplanung" };
    const neu = normalisiereProjekt(alt);
    assert.deepEqual(neu, { id: "p1", name: "X", status: "concept", climate_zone: "temperate", hoai_phase: 5 });
    assert.equal(alt.status, "Konzept", "Original bleibt unangetastet");
    assert.notEqual(neu, alt);
  });

  it("normalisiereProjekte: Liste; Nicht-Array → []", () => {
    assert.equal(normalisiereProjekte([]).length, 0);
    assert.deepEqual(normalisiereProjekte(null), []);
    assert.equal(normalisiereProjekte([{ status: "Machbarkeit" }])[0].status, "feasibility");
  });
});

describe("labels — klimazoneAusStandort (A-8)", () => {
  it("DACH → temperate (String und Objekt)", () => {
    assert.equal(klimazoneAusStandort("Nürnberg"), "temperate");
    assert.equal(klimazoneAusStandort("Nürnberg, Deutschland"), "temperate");
    assert.equal(klimazoneAusStandort("Frankfurt am Main"), "temperate");
    assert.equal(klimazoneAusStandort({ city: "Wien", country: "AT" }), "temperate");
    assert.equal(klimazoneAusStandort({ country: "DE" }), "temperate");
    assert.equal(klimazoneAusStandort({ address: "Am Nordhang 12", city: "Frankfurt", country: "DE" }), "temperate");
  });

  it("unbekannt/leer → null (kein Ratespiel)", () => {
    assert.equal(klimazoneAusStandort("Kairo, Ägypten"), null);
    assert.equal(klimazoneAusStandort(""), null);
    assert.equal(klimazoneAusStandort(null), null);
    assert.equal(klimazoneAusStandort(undefined), null);
  });

  it("de in Fremdwörtern trifft NICHT (Wortgrenze)", () => {
    assert.equal(klimazoneAusStandort("Denpasar"), null); // enthält "de" ohne Wortgrenze
  });
});

describe("projectModel — beide Datengenerationen (A-7)", () => {
  it("statusInfo: Seed-Projekt (construction) und Formular-Projekt (concept)", () => {
    assert.equal(statusInfo("construction").label, "Im Bau");
    assert.equal(statusInfo("concept").label, "Konzept");
    assert.equal(statusInfo("design_development").label, "Entwurfsplanung");
    // Alt-Wert wird intern normalisiert.
    assert.equal(statusInfo("Im Bau").label, "Im Bau");
    // leer → „—" statt undefined.
    assert.equal(statusInfo(null).label, "—");
    assert.equal(statusInfo(undefined).label, "—");
  });

  it("hoaiProgress/hoaiPhaseShort: LP-String (Seed) und Zahl (Formular) gleich", () => {
    const seed = { hoai_phase: "LP 5 - Ausführungsplanung" };
    const formular = { hoai_phase: 5 };
    assert.equal(hoaiProgress(seed), hoaiProgress(formular));
    assert.equal(hoaiProgress(seed), 56); // 5/9 ≈ 56 %
    assert.equal(hoaiPhaseShort(seed), "LP 5");
    assert.equal(hoaiPhaseShort(formular), "LP 5");
    assert.equal(hoaiPhaseShort({}), "—");
  });

  it("hoaiProgress Fallback: Status-Schätzung incl. concept", () => {
    assert.equal(hoaiProgress({ status: "concept" }), 4);
    assert.equal(hoaiProgress({ status: "Konzept" }), 4);
    assert.equal(hoaiProgress({}), 0);
  });
});
