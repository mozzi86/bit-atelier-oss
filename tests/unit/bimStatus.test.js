// Status-Normalisierung: GENAU EINE Stelle (T-33-04, Phase 33 / W2).
//
// Warum das ein eigenes Testmodul verdient: ein Casing-Mismatch („Bestand" vs.
// „bestand") ergibt 0 Treffer OHNE Fehlermeldung. Die Menge fällt still auf 0, das LV
// sieht unverändert aus, und niemand merkt es — bis die Rechnung kommt. Deshalb: eine
// Abbildung, ein Katalog, kein Default.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  normalizeStatusMitWarnung,
  statusAnzeige,
  STATUS_WERTE,
  STATUS_WERTE_UI,
  STATUS_UNBEKANNT,
  STATUS_LABEL,
} from "@core/lib/bimClassification";
import { statusFuerPipeline } from "@core/lib/kataloge";

test("die drei Pipeline-Schreibweisen werden intern klein", () => {
  assert.equal(normalizeStatus("Bestand"), "bestand");
  assert.equal(normalizeStatus("Neubau"), "neubau");
  assert.equal(normalizeStatus("Abbruch"), "abbruch");
});

test("die IFC-Enums werden abgebildet", () => {
  assert.equal(normalizeStatus("EXISTING"), "bestand");
  assert.equal(normalizeStatus("NEW"), "neubau");
  assert.equal(normalizeStatus("DEMOLISH"), "abbruch");
});

test("bereits interne Werte bleiben stabil (Idempotenz)", () => {
  for (const s of STATUS_WERTE) assert.equal(normalizeStatus(s), s);
});

test("unbelegt und unbekannt ergeben null — NIE einen Default", () => {
  // Das ist der Kern von L8: 355 Bauteile des Realprojekts landen hier.
  for (const roh of [null, undefined, "", "   ", "?", "unbekannt", "Voelliger Unsinn", 42]) {
    assert.equal(normalizeStatus(roh), null, `${JSON.stringify(roh)} darf nicht gedeutet werden`);
  }
  assert.notEqual(normalizeStatus("irgendwas"), "neubau", "ein Default wäre eine Falschaussage");
});

test("Leerraum wird toleriert, nicht der Wert verfälscht", () => {
  assert.equal(normalizeStatus("  Abbruch  "), "abbruch");
});

test("ein unbekannter Wert kommt MIT Warnung zurück, nicht still", () => {
  const ok = normalizeStatusMitWarnung("Neubau");
  assert.deepEqual(ok, { status: "neubau", warnung: null });

  const fehlt = normalizeStatusMitWarnung(null);
  assert.equal(fehlt.status, null);
  assert.match(fehlt.warnung, /nicht belegt/);

  const falsch = normalizeStatusMitWarnung("Rueckbau");
  assert.equal(falsch.status, null);
  assert.match(falsch.warnung, /Rueckbau/, "der Rohwert muss in der Warnung stehen");
});

test("ein Katalog-Override verdrängt die eingebaute Abbildung", () => {
  // Der Katalog ist büroweit editierbar — genau deshalb liegt die Tabelle nicht im Code.
  const snapshot = {
    StatusKonvention: [
      { intern: "abbruch", pipeline: "Rückbau", ifc_enum: "DEMOLISH", aliase: ["Rückbau", "Rueckbau"] },
    ],
  };
  assert.equal(normalizeStatus("Rueckbau", snapshot), "abbruch");
  assert.equal(normalizeStatus("Bestand", snapshot), null, "der Override ersetzt die Tabelle");
});

test("die Rückrichtung (intern → Pipeline) ist deckungsgleich", () => {
  for (const s of STATUS_WERTE) {
    assert.equal(normalizeStatus(statusFuerPipeline(s)), s, `Rundlauf für ${s} kaputt`);
  }
  assert.equal(statusFuerPipeline(null), "?", "unbelegt ist im Orakel das Fragezeichen");
});

test("null ist in der UI sichtbar als unbekannt, nicht ein leeres Feld", () => {
  assert.equal(statusAnzeige(null), "unbekannt");
  assert.equal(statusAnzeige(undefined), "unbekannt");
  assert.equal(statusAnzeige("bestand"), "Bestand");
  assert.equal(STATUS_LABEL.abbruch, "Abbruch");
  assert.deepEqual(STATUS_WERTE_UI, [...STATUS_WERTE, STATUS_UNBEKANNT]);
});
