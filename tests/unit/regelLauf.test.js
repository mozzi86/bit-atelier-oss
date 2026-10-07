// RegelLauf — Modulverhalten (Phase 33 / W6, Plan 33-04).
//
// Die Ist-Zahlen des Realprojekts prüfen G22/G23. Hier geht es um die Ränder:
// kein Snapshot, leere Positionsliste, Menge alt = null, der Δ-Guard, die
// Sortierung nach Geldwert und der GB-gewichtete Fortschritt.

import test from "node:test";
import assert from "node:assert/strict";
import {
  FEHLERZUSTAND, SCHWELLE, arbeitsliste, fortschritt, laufErzeugen, laufFuerPosition,
} from "@ava/lib/regelLauf.js";

const el = (o = {}) => ({
  guid: `G${Math.random().toString(36).slice(2, 12)}`,
  klasse: "IfcWall",
  status: "Neubau",
  typ: null,
  name: "Neu__TB__15.0cm",
  geschoss: "EG",
  qty: { NetSideArea: 10 },
  ...o,
});

const wandRegel = (o = {}) => ({
  art: "modell",
  op: "add",
  selektor: {
    was: { kg: [], gewerk: [], schicht: [], ifc_klasse: ["IfcWall"] },
    zustand: { status: ["Neubau"] },
    muster: {},
    bereich: { qty: [] },
  },
  mengenbasis: "NetSideArea",
  faktor: 1,
  ...o,
});

const SNAP = "snap-1";
const drei = [el(), el(), el()];

test("KEIN Lauf ohne Snapshot — mit Grund, nicht mit Stille", () => {
  const res = laufErzeugen([{ id: "a", regeln: [wandRegel()] }], drei, {});
  assert.equal(res.ok, false);
  assert.equal(res.lauf, null);
  assert.match(res.grund, /BimSnapshot/);
});

test("KEIN Lauf auf leerem Bauteilstand — 497 Nullen sind kein Ergebnis", () => {
  const res = laufErzeugen([{ id: "a", regeln: [wandRegel()] }], [], { snapshot_id: SNAP });
  assert.equal(res.ok, false);
  assert.match(res.grund, /leer/);
  assert.equal(laufErzeugen([{ id: "a", regeln: [] }], null, { snapshot_id: SNAP }).ok, false);
});

test("ein leerer Lauf ist erlaubt — 0 Positionen sind kein Fehler", () => {
  const res = laufErzeugen([], drei, { snapshot_id: SNAP });
  assert.equal(res.ok, true);
  assert.equal(res.lauf.positionen, 0);
  assert.equal(res.lauf.regeln, 0);
  assert.deepEqual(res.lauf.abweichungen, []);
});

test("alte UND neue Menge stehen im Datensatz", () => {
  const res = laufFuerPosition({ id: "a", oz: "0001", quantity: 20, regeln: [wandRegel()] }, drei, {
    snapshot_id: SNAP,
  });
  const z = res.lauf.je_position[0];
  assert.equal(z.menge_alt, 20);
  assert.equal(z.menge_neu, 30);
  assert.equal(z.differenz, 10);
  assert.equal(z.veraendert, true);
  assert.equal(z.treffer, 3);
  assert.equal(res.lauf.anlass, "regel_bearbeitet");
});

test("Menge alt = null heißt „es gab keine“, nicht „es war 0“", () => {
  const z = laufFuerPosition({ id: "a", quantity: null, regeln: [wandRegel()] }, drei, {
    snapshot_id: SNAP,
  }).lauf.je_position[0];
  assert.equal(z.menge_alt, null);
  assert.equal(z.differenz, null);
  assert.equal(z.veraendert, true, "von „keine Menge“ auf 30 ist eine Änderung");
});

test("Δ-Guard: unter der Schwelle gilt es NICHT als Änderung", () => {
  const knapp = laufFuerPosition(
    { id: "a", quantity: 30 + SCHWELLE / 2, regeln: [wandRegel()] },
    drei,
    { snapshot_id: SNAP },
  ).lauf;
  assert.equal(knapp.geaendert, 0);
  assert.deepEqual(knapp.abweichungen, []);
  const drueber = laufFuerPosition(
    { id: "a", quantity: 30 + SCHWELLE * 3, regeln: [wandRegel()] },
    drei,
    { snapshot_id: SNAP },
  ).lauf;
  assert.equal(drueber.geaendert, 1);
});

test("0 Treffer und Menge 0 sind BENANNTE Zustände, nicht leere Zellen", () => {
  const daneben = wandRegel();
  daneben.selektor.zustand.status = ["neubau"]; // Casing — greift nicht
  const z = laufFuerPosition({ id: "a", quantity: 30, regeln: [daneben] }, drei, {
    snapshot_id: SNAP,
  }).lauf.je_position[0];
  assert.ok(z.fehlerzustaende.includes(FEHLERZUSTAND.KEINE_TREFFER));
  assert.ok(z.fehlerzustaende.includes(FEHLERZUSTAND.MENGE_NULL));
  assert.ok(z.warnungen.length > 0);
});

test("Treffer, aber Größe fehlt ⇒ Menge 0 mit Warnung UND Fehlerzustand", () => {
  const ohneGroesse = [el({ qty: {} }), el({ qty: {} })];
  const z = laufFuerPosition({ id: "a", quantity: null, regeln: [wandRegel()] }, ohneGroesse, {
    snapshot_id: SNAP,
  }).lauf.je_position[0];
  assert.equal(z.treffer, 2);
  assert.equal(z.menge_neu, 0);
  assert.ok(z.fehlerzustaende.includes(FEHLERZUSTAND.MENGE_NULL));
  assert.equal(z.fehlerzustaende.includes(FEHLERZUSTAND.KEINE_TREFFER), false);
  assert.ok(z.warnungen.some((w) => /ohne Größe/.test(w)));
});

test("Referenzfehler landen im Lauf — aber nur, wenn Kataloge übergeben sind", () => {
  const kaputt = wandRegel({ mengenbasis: "NetSideAra" });
  const ohneKatalog = laufFuerPosition({ id: "a", regeln: [kaputt] }, drei, { snapshot_id: SNAP })
    .lauf.je_position[0];
  assert.equal(ohneKatalog.fehlerzustaende.includes(FEHLERZUSTAND.REFERENZ_UNGUELTIG), false);

  const mitKatalog = laufFuerPosition({ id: "a", regeln: [kaputt] }, drei, {
    snapshot_id: SNAP,
    kataloge: {},
  }).lauf.je_position[0];
  assert.ok(mitKatalog.fehlerzustaende.includes(FEHLERZUSTAND.REFERENZ_UNGUELTIG));
});

test("Geldwert wird nur mit Einheitspreis gebildet — nie als 0 geraten", () => {
  const mit = laufFuerPosition({ id: "a", quantity: 20, unit_price: 5, regeln: [wandRegel()] }, drei, {
    snapshot_id: SNAP,
  }).lauf.je_position[0];
  assert.equal(mit.geldwert, 50);
  const ohne = laufFuerPosition({ id: "a", quantity: 20, regeln: [wandRegel()] }, drei, {
    snapshot_id: SNAP,
  }).lauf.je_position[0];
  assert.equal(ohne.geldwert, null);
});

test("arbeitsliste sortiert nach Geldwert; Positionen ohne Preis stehen HINTEN", () => {
  const lauf = laufErzeugen(
    [
      { id: "klein", quantity: 0, unit_price: 1, regeln: [wandRegel()] },
      { id: "gross", quantity: 0, unit_price: 100, regeln: [wandRegel()] },
      { id: "ohne", quantity: 0, regeln: [wandRegel()] },
    ],
    drei,
    { snapshot_id: SNAP },
  ).lauf;
  const liste = arbeitsliste(lauf);
  assert.deepEqual(liste.map((z) => z.position_id), ["gross", "klein", "ohne"]);
  assert.equal(liste[2].ohne_preis, true);
  // `nurGeaendert: false` liefert alle Zeilen.
  assert.equal(arbeitsliste(lauf, { nurGeaendert: false }).length, 3);
});

test("fortschritt: Stückanteil UND GB-Anteil, nie einer allein", () => {
  const fs = fortschritt([
    { id: "a", mengen_modus: "filter", quantity: 100, unit_price: 100 },
    { id: "b", mengen_modus: "uebernahme", quantity: 1, unit_price: 100 },
    { id: "c", mengen_modus: "uebernahme", quantity: 1, unit_price: 100 },
    { id: "d", mengen_modus: "uebernahme", quantity: 1, unit_price: 100 },
  ]);
  assert.equal(fs.positionen, 4);
  assert.equal(fs.modellgebunden, 1);
  assert.equal(fs.uebernahmen, 3);
  assert.equal(fs.anteil_positionen, 25, "nach Stück: 25 %");
  assert.equal(fs.anteil_gb, 97.1, "nach Geld: 97,1 % — dieselbe Lage, andere Aussage");
  assert.match(fs.hinweis, /Stückanteil ist NICHT die Aussage/);
});

test("fortschritt: Warnung erst ab 2 Modellständen nach der letzten Prüfung", () => {
  const snapshots = [{ id: "s1", stand: "2026-01-01" }, { id: "s2", stand: "2026-06-01" }];
  const geprueft = fortschritt(
    [{ id: "a", mengen_modus: "uebernahme", modell_geprueft_am: "2026-07-01" }],
    { snapshots, heute: "2026-08-01" },
  );
  assert.equal(geprueft.ungeprueft_seit_2_staenden, 0);
  assert.equal(geprueft.warnung, null);
  assert.equal(geprueft.arbeitsliste[0].alter_tage, 31);

  const alt = fortschritt(
    [{ id: "a", mengen_modus: "uebernahme", modell_geprueft_am: "2025-01-01" }],
    { snapshots, heute: "2026-08-01" },
  );
  assert.equal(alt.ungeprueft_seit_2_staenden, 1);
  assert.match(alt.warnung, /seit 2 Modellständen ungeprüft/);

  // Ohne Prüfdatum gilt die Position als ungeprüft — nicht als geprüft.
  const nie = fortschritt([{ id: "a", mengen_modus: "uebernahme" }], { snapshots });
  assert.equal(nie.ungeprueft_seit_2_staenden, 1);
  assert.equal(nie.arbeitsliste[0].alter_tage, null);
});

test("fortschritt: modellgebundene Positionen stehen NICHT in der Arbeitsliste", () => {
  const fs = fortschritt([
    { id: "a", mengen_modus: "filter" },
    { id: "b", mengen_modus: "uebernahme" },
  ]);
  assert.equal(fs.arbeitsliste.length, 1);
  assert.equal(fs.arbeitsliste[0].position_id, "b");
});

test("fortschritt auf leerer Eingabe: keine erfundenen Prozente", () => {
  const fs = fortschritt([]);
  assert.equal(fs.positionen, 0);
  assert.equal(fs.anteil_positionen, null);
  assert.equal(fs.anteil_gb, null);
  assert.equal(fs.gb_gesamt, 0);
});
