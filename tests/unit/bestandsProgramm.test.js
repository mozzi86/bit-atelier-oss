import test from "node:test";
import assert from "node:assert/strict";
import { ifcGuidToUuid, uuidToIfcGuid, guidKey } from "@ifc/lib/ifcGuid";
import { programmAusBestand, dinGruppe, DIN277_ZU_NUTZUNG } from "@designer/lib/bestandsProgramm";

test("ifcGuidToUuid — echtes Referenzprojekt-Paar aus BimSnapshot und ASR-Export", () => {
  // Am 26.08.2026 an den Realdaten verifiziert: dieselbe Identität, zwei Schreibweisen.
  assert.equal(ifcGuidToUuid("3_VBElciFeIeExQx_$ZOnK"), "fe7cb3af-9ac3-e84a-83bb-6bbfbf8d8c54");
});

test("ifcGuidToUuid — Rundlauf über beide Richtungen", () => {
  const g = "3_VBElciFeIeExQx_$ZOnK";
  assert.equal(uuidToIfcGuid(ifcGuidToUuid(g)), g);
});

test("ifcGuidToUuid — ungültige Eingaben liefern null, werfen nicht", () => {
  assert.equal(ifcGuidToUuid(""), null);
  assert.equal(ifcGuidToUuid(null), null);
  assert.equal(ifcGuidToUuid("zu-kurz"), null);
  assert.equal(ifcGuidToUuid("!".repeat(22)), null, "Zeichen außerhalb des Alphabets");
  assert.equal(uuidToIfcGuid("keine-uuid"), null);
});

test("guidKey — beide Schreibweisen ergeben denselben Schlüssel", () => {
  assert.equal(guidKey("3_VBElciFeIeExQx_$ZOnK"), guidKey("FE7CB3AF-9AC3-E84A-83BB-6BBFBF8D8C54"));
});

test("dinGruppe — findet die Gruppe unabhängig von der Position im Array", () => {
  // Genau die Falle vom 26.08.: mal Position 0, mal Position 1.
  assert.equal(dinGruppe(["02 NUF Büroarbeit", "Innenraum"]), "02");
  assert.equal(dinGruppe(["Innenraum", "01 NUF Wohnen und Aufenthalt"]), "01");
  assert.equal(dinGruppe(["Innenraum"]), null);
  assert.equal(dinGruppe(null), null);
});

test("DIN-Gruppe 01 wird NICHT auf 'wohnen' abgebildet", () => {
  // Regressionsschutz für den Nutzer-Befund „das ist kein Wohnprojekt": die Gruppe
  // heißt „Wohnen und Aufenthalt", meint hier aber Aufenthaltsflächen im Bürobau.
  assert.equal(DIN277_ZU_NUTZUNG["01"].use, "gemeinschaft");
  assert.notEqual(DIN277_ZU_NUTZUNG["01"].use, "wohnen");
});

const snapshot = (...raeume) => ({
  name: "Testbestand",
  elemente: [
    { ifc_klasse: "IfcWall", mengen: { area: 999 } }, // muss ignoriert werden
    ...raeume,
  ],
});
const raum = (gruppe, area, geschoss = "EG", guid = null) => ({
  ifc_klasse: "IfcSpace",
  guid,
  geschoss,
  klassifikation: gruppe ? ["Innenraum", `${gruppe} NUF Test`] : ["Innenraum"],
  mengen: { area },
});

test("programmAusBestand — Summen bleiben exakt (area × count = Gesamtfläche)", () => {
  const r = programmAusBestand(snapshot(raum("02", 30), raum("02", 50), raum("08", 20)));
  const buero = r.items.find((i) => i.use === "buero");
  assert.equal(buero.count, 2);
  assert.equal(buero.area, 40); // Mittel aus 30 und 50
  assert.equal(buero.area * buero.count, 80); // exakt die Summe der Einzelflächen
  assert.equal(r.kennzahlen.raeume, 3, "nur IfcSpace zählt, die Wand nicht");
  assert.equal(r.kennzahlen.flaeche, 100);
});

test("programmAusBestand — Gruppen mit gleicher Nutzungsart werden zusammengefasst", () => {
  // 05, 06 und 07 zeigen alle auf `gemeinschaft` — es darf nur EINE Zeile entstehen,
  // sonst zählt die Tabelle doppelt.
  const r = programmAusBestand(snapshot(raum("05", 10), raum("06", 20), raum("07", 30)));
  const g = r.items.filter((i) => i.use === "gemeinschaft");
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 3);
  assert.equal(g[0].area * g[0].count, 60);
  assert.equal(r.gruppen.length, 3, "die drei DIN-Gruppen bleiben einzeln nachweisbar");
});

test("programmAusBestand — Räume ohne DIN-Gruppe werden sichtbar, nicht einsortiert", () => {
  const r = programmAusBestand(snapshot(raum("02", 25), raum(null, 15)));
  assert.equal(r.unklassifiziert.anzahl, 1);
  assert.equal(r.unklassifiziert.flaeche, 15);
  assert.equal(r.items.length, 1, "der unklassifizierte Raum landet in KEINER Nutzungsart");
});

test("programmAusBestand — ASR-Namen kommen über die GUID-Umrechnung dazu", () => {
  const r = programmAusBestand(
    snapshot(raum("02", 25, "EG", "3_VBElciFeIeExQx_$ZOnK")),
    [{ guid: "fe7cb3af-9ac3-e84a-83bb-6bbfbf8d8c54", name: "Copy Shop 01" }],
  );
  assert.deepEqual(r.gruppen[0].beispiele, ["Copy Shop 01"]);
});

test("programmAusBestand — leerer/fehlender Snapshot ergibt leeres Programm ohne Wurf", () => {
  for (const leer of [null, undefined, {}, { elemente: [] }]) {
    const r = programmAusBestand(leer);
    assert.deepEqual(r.items, []);
    assert.equal(r.kennzahlen.raeume, 0);
  }
});
