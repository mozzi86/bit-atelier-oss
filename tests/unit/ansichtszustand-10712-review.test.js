// Review fixes of plan 107-12 (view state): an own layer combination is stored with its layers, section / 3D views do not depend on
// the plan storey, undo moves only views of local steps, options equal to the default stay null, the section structure display reads
// the build-up of each group's own wall (basement walls), the 3D structure display reaches the layer boxes without intersection, and
// the entrance door of the sheet sits where the screen draws it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EIGENE_KOMBINATION, ausschnittGleich, ausschnittNormalisieren, ausschnitteWiederherstellen, ebenenSichtbarkeit, optionenOhneStandard,
  schnittGruppenNachStruktur, strukturAufMeshAnwenden, wandFunktionen, ANSICHT_MASSSTAEBE,
} from "@core/lib/plan/ansichtszustand.js";
import { detailgradFuer } from "@core/lib/plan/massstab.js";
import { createBuildingModel } from "@core/lib/buildingModel";
import { planGrafik, schnittGrafik } from "@designer/lib/vektorPlan";
import { planModell } from "./fixtures/planModell-10712.js";

describe("Review 107-12 — Ausschnitt reproduzierbar", () => {
  it("eigene Kombination speichert ihre Ebenen (sortiert, eindeutig); benannte Kombination nicht", () => {
    const a = ausschnittNormalisieren({ combo: EIGENE_KOMBINATION, ebenen_sichtbar: ["walls", "shell", "walls", "", 3] });
    assert.deepEqual(a.ebenen_sichtbar, ["shell", "walls"]);
    assert.equal(ausschnittNormalisieren({ combo: "Rohbau", ebenen_sichtbar: ["walls"] }).ebenen_sichtbar, null);
    assert.equal(ausschnittNormalisieren({ combo: EIGENE_KOMBINATION }).ebenen_sichtbar, null, "alter Ausschnitt ohne Ebenen lädt unverändert");
    assert.equal(ausschnittGleich(a, { ...a, ebenen_sichtbar: ["shell"] }), false);
    assert.equal(ausschnittGleich(a, { ...a, ebenen_sichtbar: ["walls", "shell"] }), true);
  });
  it("Ebenen eines Ausschnitts: benannte Kombination = ihr Satz, „Eigene“ = gespeicherte Ebenen, sonst null", () => {
    const ebenen = [{ id: "shell" }, { id: "walls" }, { id: "labels" }];
    const kombi = { Rohbau: ["shell", "walls"] };
    assert.deepEqual(ebenenSichtbarkeit({ combo: "Rohbau" }, ebenen, kombi), { shell: true, walls: true, labels: false });
    assert.deepEqual(ebenenSichtbarkeit(ausschnittNormalisieren({ combo: EIGENE_KOMBINATION, ebenen_sichtbar: ["labels"] }), ebenen, kombi), { shell: false, walls: false, labels: true });
    assert.equal(ebenenSichtbarkeit({ combo: EIGENE_KOMBINATION, ebenen_sichtbar: null }, ebenen, kombi), null);
    assert.equal(ebenenSichtbarkeit({ combo: "toString" }, ebenen, kombi), null, "kein Prototyp-Schlüssel als Kombination");
  });
  it("Schnitt- und 3D-Ausschnitt hängen nicht am Plan-Geschoss, der Grundriss schon", () => {
    assert.equal(ausschnittGleich({ type: "schnitt", level: 0 }, { type: "schnitt", level: 1 }), true);
    assert.equal(ausschnittGleich({ type: "3d", level: -1 }, { type: "3d", level: 2 }), true);
    assert.equal(ausschnittGleich({ type: "grundriss", level: 0 }, { type: "grundriss", level: 1 }), false);
  });
  it("Optionen gleich dem Standard des Detailgrads bleiben null (an- und wieder ausschalten ändert das Blatt nicht)", () => {
    const dg100 = detailgradFuer(100);
    assert.equal(optionenOhneStandard({ tuerAufschlag: true }, dg100), null);
    assert.deepEqual(optionenOhneStandard({ tuerAufschlag: false, fensterSymbol: true }, dg100), { tuerAufschlag: false });
    assert.deepEqual(optionenOhneStandard({ tuerAufschlag: true }, detailgradFuer(200)), { tuerAufschlag: true }, "1:200 hat keinen Aufschlag als Standard");
    assert.equal(optionenOhneStandard(null, dg100), null);
  });
  it("1:20 gehört zu den wählbaren Stufen", () => {
    assert.ok(ANSICHT_MASSSTAEBE.includes(20));
    assert.equal(detailgradFuer(20).zarge, true);
  });
});

describe("Review 107-12 — Undo verschiebt nur Ausschnitte lokaler Schritte", () => {
  const a = (id) => ({ id, name: id });
  it("ein Ausschnitt von einem anderen Gerät bleibt beim Undo einer Wandänderung", () => {
    // snapshot before a wall step had a1; meanwhile a5 came from another device; nothing local touched views
    assert.deepEqual(ausschnitteWiederherstellen([a("a1"), a("a5")], [a("a1")], new Set()), [a("a1"), a("a5")]);
  });
  it("Undo eines lokalen Speicherns entfernt nur diesen, Redo bringt ihn zurück; fremde bleiben", () => {
    const vor = [a("a1")], jetzt = [a("a1"), a("a2"), a("a5")];
    const zurueck = ausschnitteWiederherstellen(jetzt, vor, ["a2"]);
    assert.deepEqual(zurueck.map((v) => v.id), ["a1", "a5"]);
    const wieder = ausschnitteWiederherstellen(zurueck, [a("a1"), a("a2")], ["a2"]);
    assert.deepEqual(wieder.map((v) => v.id), ["a1", "a5", "a2"]);
  });
  it("Undo eines lokalen Löschens bringt den Ausschnitt zurück", () => {
    assert.deepEqual(ausschnitteWiederherstellen([a("a5")], [a("a1"), a("a3")], ["a3"]).map((v) => v.id), ["a5", "a3"]);
  });
});

describe("Review 107-12 — Schnitt: Strukturdarstellung je Wand (Untergeschoss mit eigenem Aufbau)", () => {
  const model = createBuildingModel({ footprintM: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 9 }, { x: 0, z: 9 }], storeys: 1, storeyHeight: 3,
    wallComposite: "cavity", untergeschosse: 1, ugComposite: "single24" });
  const eg = model.walls.find((w) => w.level === 0 && w.edge === 0);
  const ug = model.walls.find((w) => w.level === -1 && w.edge === 0);
  it("Aufbauten unterscheiden sich über und unter Gelände", () => {
    assert.ok(eg && ug);
    assert.deepEqual(wandFunktionen(eg), ["bekleidung", "sonstig", "sonstig", "kern", "bekleidung"]);
    assert.deepEqual(wandFunktionen(ug), ["kern"]);
  });
  const ring = (x, h0, h1) => [{ x, h: h0 }, { x: x + 0.1, h: h0 }, { x: x + 0.1, h: h1 }];
  const gruppen = [
    ...[0, 1, 2, 3, 4].map((schicht) => ({ schluessel: "env:0:0", schicht, ringe: [ring(schicht, 0, 3)] })),
    { schluessel: "env:-1:0", schicht: 0, ringe: [ring(0, -3, 0)] },
  ];
  it("„nur Kern“: der Kern der Kellerwand bleibt, oben nur die KS-Schicht", () => {
    const sicht = schnittGruppenNachStruktur(gruppen, model.walls, "nur-kern");
    assert.deepEqual(sicht.map((g) => `${g.schluessel}:${g.schicht}`), ["env:0:0:3", "env:-1:0:0"]);
    assert.equal(schnittGruppenNachStruktur(gruppen, model.walls, "gesamt").length, 6);
    assert.deepEqual(schnittGruppenNachStruktur([{ schluessel: "cw:4", schicht: 0 }], model.walls, "nur-kern").length, 1, "fremde Schlüssel bleiben");
  });
  it("Schnitt-PDF: dieselbe Regel (vorher fehlte der UG-Kern bei „nur Kern“)", () => {
    const zaehle = (sd) => schnittGrafik({ model, storeyHeight: 3, schnittFlaechen: gruppen, ansicht: sd ? { strukturdarstellung: sd } : null })
      .elemente.filter((e) => e.ebene === "wand" && e.pts.length === 3).length;
    assert.equal(zaehle(null), 6);
    assert.equal(zaehle("nur-kern"), 2);
    assert.equal(zaehle("ohne-bekleidung"), 4, "oben Luft, Dämmung, KS; unten der Kern");
  });
});

describe("Review 107-12 — 3D-Strukturdarstellung ohne „Wände verschneiden“", () => {
  const mat = () => ({ visible: true });
  it("Schicht-Box (eigenes Material, Schichtindex) wird nach ihrer Funktion ausgeblendet", () => {
    const funktionen = ["sonstig", "kern"];
    const boxen = [0, 1].map((schicht) => ({ userData: { schicht, eigenesMaterial: true, schichtFunktionen: funktionen, tragend: true }, material: mat() }));
    boxen.forEach((m) => strukturAufMeshAnwenden(m, "nur-kern"));
    assert.deepEqual(boxen.map((m) => m.material.visible), [false, true]);
    boxen.forEach((m) => strukturAufMeshAnwenden(m, "gesamt"));
    assert.deepEqual(boxen.map((m) => m.material.visible), [true, true]);
  });
  it("nichttragende Wand ohne Aufbau verschwindet bei „nur Kern der tragenden Bauteile“", () => {
    const m = { userData: { eigenesMaterial: true, schichtFunktionen: ["kern"], tragend: false }, material: mat() };
    strukturAufMeshAnwenden(m, "nur-kern-tragend");
    assert.equal(m.material.visible, false);
    strukturAufMeshAnwenden(m, "nur-kern");
    assert.equal(m.material.visible, true);
  });
  it("Solid mit Materialgruppen wie bisher; geteiltes Material bleibt unberührt", () => {
    const solid = { userData: { mitSchichtMaterial: true, schichtFunktionen: ["bekleidung", "kern"], tragend: true }, material: [mat(), mat()] };
    strukturAufMeshAnwenden(solid, "ohne-bekleidung");
    assert.deepEqual(solid.material.map((x) => x.visible), [false, true]);
    const geteilt = { userData: { schichtFunktionen: ["kern"], tragend: false }, material: mat() };
    assert.equal(strukturAufMeshAnwenden(geteilt, "nur-kern-tragend"), false);
    assert.equal(geteilt.material.visible, true);
  });
});

describe("Review 107-12 — Eingangstür im Blatt wie am Bildschirm", () => {
  it("Türband 1,0 m vor der Wandmitte, Aufschlag bis zur Mitte", () => {
    const { model, faelle } = planModell();
    const eg = model.walls.find((w) => w.level === 0);
    const len = Math.hypot(eg.b.x - eg.a.x, eg.b.z - eg.a.z), dx = (eg.b.x - eg.a.x) / len, dz = (eg.b.z - eg.a.z) / len;
    const u = (p) => (p.x - eg.a.x) * dx + (p.z - eg.a.z) * dz;
    const n = (p) => Math.abs((p.x - eg.a.x) * -dz + (p.z - eg.a.z) * dx);
    const g = planGrafik({ ...faelle.eingabe100, ansicht: {} });
    // door leaf: an open two-point line of the opening layer, perpendicular to the wall (both points at the same u)
    const blaetter = g.elemente.filter((e) => e.ebene === "oeffnung" && e.offen && e.pts.length === 2 && !e.dash && Math.abs(u(e.pts[0]) - u(e.pts[1])) < 1e-9 && n(e.pts[0]) < 1);
    assert.ok(blaetter.some((e) => Math.abs(u(e.pts[0]) - (len / 2 - 1)) < 1e-9), blaetter.map((e) => u(e.pts[0])).join(","));
  });
});
