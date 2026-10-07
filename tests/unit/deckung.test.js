// Deckungsreport — Modulverhalten (Phase 33 / W5).
//
// Die Ist-Zahlen des Realprojekts prüft Gate G16. Hier geht es um die Ränder:
// leere Gruppen, Bauteile ohne Zustand, Mehrfachnutzung einer GUID, und um die
// eine Stelle, an der eine bequeme Zahl fachlich falsch wäre — der Deckungsgrad
// auf nur EINER Ebene.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DECKUNG_DEFINITION, KLASSE_DE, deckungsReport, kgZuGewerkAus, klasseDe, zielgewerkVorschlag,
} from "@ava/lib/deckung.js";

const el = (o = {}) => ({
  guid: "G000000000000000000001",
  klasse: "IfcWall",
  status: "Neubau",
  typ: "TB-100",
  name: "TB-100",
  geschoss: "EG",
  qty: { NetSideArea: 10 },
  ...o,
});
const pos = (o = {}) => ({ oz: "01010010", trade: "Trockenbau", mengen_modus: "uebernahme", nachweis_element_ids: [], ...o });

test("die Definition ist Teil des Ergebnisses, nicht Kommentar", () => {
  const r = deckungsReport([el()], []);
  assert.equal(r.definition, DECKUNG_DEFINITION);
  assert.match(r.definition, /Gruppen- UND Elementebene/);
});

test("Deckungsgrad wird auf ZWEI Ebenen ausgewiesen", () => {
  const r = deckungsReport(
    [el({ guid: "A" }), el({ guid: "B" }), el({ guid: "C", typ: "TB-200", name: "TB-200" })],
    [pos({ nachweis_element_ids: ["A", "B"] })],
  );
  const s = r.je_status.Neubau;
  // 2 von 3 Bauteilen direkt verknüpft; 1 von 2 Gruppen hat eine Position.
  assert.equal(s.elemente, 3);
  assert.equal(s.elemente_direkt, 2);
  assert.equal(s.deckung_elemente_prozent, 66.67);
  assert.equal(s.gruppen, 2);
  assert.equal(s.gruppen_gedeckt, 1);
  assert.equal(s.deckung_gruppen_prozent, 50);
  // Beide Zahlen sind verschieden — genau deshalb wird nie nur eine genannt.
  assert.notEqual(s.deckung_elemente_prozent, s.deckung_gruppen_prozent);
});

test("Gruppenpropagation: ein gedecktes Bauteil deckt seine Gruppe", () => {
  const r = deckungsReport(
    [el({ guid: "A" }), el({ guid: "B" }), el({ guid: "C" })],
    [pos({ nachweis_element_ids: ["A"] })],
  );
  const g = r.gruppen[0];
  assert.equal(g.anzahl, 3);
  assert.equal(g.gedeckt, 1);
  assert.equal(g.ungedeckt, 2);
  assert.equal(g.gruppengedeckt, true);
  assert.equal(g.einschaetzung, "Position vorhanden — Verknüpfung fehlt");
  assert.equal(r.gruppen_teilweise, 1);
  // Elementebene bleibt bei 1/3 — die Propagation verändert sie NICHT.
  assert.equal(r.je_status.Neubau.deckung_elemente_prozent, 33.33);
  assert.equal(r.je_status.Neubau.deckung_elemente_gruppenbasiert_prozent, 100);
});

test("eine ungedeckte Gruppe heißt „Position prüfen\" — kein dritter Zwischenwert", () => {
  const r = deckungsReport([el()], []);
  assert.equal(r.gruppen[0].gruppengedeckt, false);
  assert.equal(r.gruppen[0].einschaetzung, "Position prüfen");
  assert.equal(r.gruppen_ohne_position, 1);
});

test("Mehrfachnutzung einer GUID wird gezählt, aber nicht doppelt gedeckt", () => {
  const r = deckungsReport(
    [el({ guid: "A" })],
    [pos({ oz: "1", nachweis_element_ids: ["A"] }), pos({ oz: "2", nachweis_element_ids: ["A"] })],
  );
  assert.equal(r.guids_distinct, 1);
  assert.equal(r.guids_summe_ueber_positionen, 2);
  assert.equal(r.elemente_gedeckt, 1, "ein Bauteil bleibt ein Bauteil");
  assert.equal(r.je_status.Neubau.elemente_direkt, 1);
});

test("Bauteile ohne Zustand landen im Bucket „?\", nicht im Nichts", () => {
  const r = deckungsReport([el({ status: null }), el({ guid: "B", status: "" })], []);
  assert.equal(r.je_status["?"].elemente, 2);
  assert.equal(Object.keys(r.je_status).length, 1);
});

test("Mengensummen: vorhandene Größen werden addiert, fehlende bleiben null", () => {
  const r = deckungsReport([
    el({ guid: "A", qty: { NetSideArea: 10.005 } }),
    el({ guid: "B", qty: { NetSideArea: 20 } }),
  ], []);
  assert.equal(r.gruppen[0].flaeche, 30.01);
  assert.equal(r.gruppen[0].volumen, null, "kein Volumen im Modell ⇒ null, nicht 0");
  assert.equal(r.gruppen[0].laenge, null);
  // Eine Gruppe ohne jede Menge bekommt überall null.
  const ohne = deckungsReport([el({ qty: {} })], []);
  assert.equal(ohne.gruppen[0].flaeche, null);
});

test("leere Gruppenmenge: keine Ausnahme, keine erfundenen 100 %", () => {
  const leer = deckungsReport([], []);
  assert.equal(leer.gruppen_gesamt, 0);
  assert.equal(leer.elemente_gesamt, 0);
  assert.equal(leer.elemente_gedeckt, 0);
  assert.deepEqual(leer.je_status, {});
  assert.deepEqual(leer.gruppen, []);
  // Auch mit null-Eingaben.
  const nix = deckungsReport(null, null);
  assert.equal(nix.gruppen_gesamt, 0);
});

test("klasseDe: deutsche Begriffe, Unbekanntes bleibt der Fachbegriff", () => {
  assert.equal(klasseDe("IfcWall"), "Wand");
  assert.equal(klasseDe("IfcDoor"), "Tür");
  assert.equal(klasseDe("IfcCurtainWall"), "Vorhangwand / Fassade");
  assert.match(klasseDe("IfcBuildingElementProxy"), /nicht klassifiziert/);
  // KEINE erfundene Übersetzung für Unbekanntes.
  assert.equal(klasseDe("IfcTank"), "IfcTank");
  assert.equal(klasseDe(null), "-");
  assert.ok(Object.keys(KLASSE_DE).length >= 20);
});

test("Zielgewerk-Vorschlag: aus dem Katalog, mit Sicherheitsangabe", () => {
  const regeln = [
    { name: "Innenwand tragend", ifc_klasse: "IfcWall", muster: { op: "glob", value: "*trag*" }, kg2018: "341", prio: 10 },
    { name: "Innenwand Trockenbau", ifc_klasse: "IfcWall", muster: { op: "glob", value: "*TB*" }, kg2018: "342", prio: 20 },
  ];
  const kgZuGewerk = new Map([["342", "Trockenbauarbeiten"]]);
  const v = zielgewerkVorschlag(el({ typ: "TB-100" }), { kgRegeln: regeln, kgZuGewerk });
  assert.equal(v.kg2018, "342");
  assert.equal(v.gewerk, "Trockenbauarbeiten");
  assert.equal(v.regel, "Innenwand Trockenbau");
  assert.equal(v.sicherheit, "eindeutig");
  // Priorität entscheidet, wenn mehrere passen.
  const mehrere = zielgewerkVorschlag(
    el({ typ: "TB-tragend-100" }),
    { kgRegeln: regeln, kgZuGewerk: new Map([["341", "Rohbau"]]) },
  );
  assert.equal(mehrere.kg2018, "341", "prio 10 schlägt prio 20");
  assert.match(mehrere.sicherheit, /2 Regeln passen/);
  // Ohne Treffer KEIN geratenes Gewerk.
  const keins = zielgewerkVorschlag(el({ klasse: "IfcTank" }), { kgRegeln: regeln, kgZuGewerk });
  assert.equal(keins.gewerk, null);
  assert.equal(keins.kg2018, null);
  assert.equal(keins.sicherheit, "kein Vorschlag");
});

test("Zielgewerk: eine Kostengruppe ohne bekanntes Gewerk ergibt null, nicht \"\"", () => {
  const regeln = [{ name: "x", ifc_klasse: "IfcWall", muster: null, kg2018: "999", prio: 1 }];
  const v = zielgewerkVorschlag(el(), { kgRegeln: regeln, kgZuGewerk: new Map() });
  assert.equal(v.kg2018, "999");
  assert.equal(v.gewerk, null);
});

test("kgZuGewerkAus: häufigstes Gewerk je Kostengruppe, aus den Positionen", () => {
  const m = kgZuGewerkAus([
    pos({ din276: "342", trade: "Trockenbau" }),
    pos({ din276: "342", trade: "Trockenbau" }),
    pos({ din276: "342", trade: "Maler" }),
    pos({ din276: "394", trade: "Abbruch" }),
    pos({ din276: null, trade: "Ohne KG" }),
  ]);
  assert.equal(m.get("342"), "Trockenbau");
  assert.equal(m.get("394"), "Abbruch");
  assert.equal(m.size, 2, "Positionen ohne Kostengruppe zählen nicht mit");
});

test("Gegenprobe: Modellmodus ohne Bauteile ist ein Befund, Pauschal nicht", () => {
  const r = deckungsReport([el()], [
    pos({ oz: "1", mengen_modus: "filter" }),
    pos({ oz: "2", mengen_modus: "uebernahme" }),
    pos({ oz: "3", mengen_modus: "auswahl" }),
    pos({ oz: "4", mengen_modus: "handeingabe" }),
  ]);
  assert.equal(r.positionen_ohne_bauteile.length, 4);
  const befunde = r.positionen_ohne_bauteile.filter((p) => p.befund.startsWith("Modellbindung"));
  assert.deepEqual(befunde.map((p) => p.oz), ["1", "3"]);
  const normal = r.positionen_ohne_bauteile.filter((p) => p.befund.includes("ohne Modellbezug"));
  assert.deepEqual(normal.map((p) => p.oz), ["2", "4"]);
});

test("Beispiel-GlobalId zeigt ein UNGEDECKTES Bauteil (das ist die Arbeit)", () => {
  const r = deckungsReport(
    [el({ guid: "GEDECKT" }), el({ guid: "OFFEN" })],
    [pos({ nachweis_element_ids: ["GEDECKT"] })],
  );
  assert.equal(r.gruppen[0].beispiel_guid, "OFFEN");
  // Ist alles gedeckt, wird das erste Bauteil gezeigt (kein null).
  const voll = deckungsReport([el({ guid: "A" })], [pos({ nachweis_element_ids: ["A"] })]);
  assert.equal(voll.gruppen[0].beispiel_guid, "A");
});

test("eigenes GUID-Feld überschreibbar (nachweis_element_ids ist der Default)", () => {
  // T-33-05: gelesen wird `nachweis_element_ids`, NIE `bim_element_ids`.
  const mitFalschemFeld = deckungsReport([el({ guid: "A" })], [{ ...pos(), bim_element_ids: ["A"] }]);
  assert.equal(mitFalschemFeld.guids_distinct, 0, "bim_element_ids darf NICHT als Nachweis gelesen werden");
  const eigen = deckungsReport([el({ guid: "A" })], [{ eigenes: ["A"] }], {
    guidsAusPosition: (p) => p.eigenes,
  });
  assert.equal(eigen.guids_distinct, 1);
});
