// 97-09: vector plan at TRUE scale — 1 m in the model is 10 mm on paper at 1:100, the sheet is
// the smallest DIN format that fits, line weights per ISO 128 line group, lens colours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { planGrafik, blattLayout, linienGruppe, vektorPlanPdf } from "@designer/lib/vektorPlan";
import { createBuildingModel } from "@core/lib/buildingModel";
import { brilleVon } from "@core/lib/plan/brillen.js";

const model = createBuildingModel({ footprintM: null, storeys: 1, storeyHeight: 3 });

test("Liniengruppe 0,5 bei 1:100, 0,7 bei 1:50", () => {
  assert.deepEqual(linienGruppe(100), { schnitt: 0.5, ansicht: 0.25, duenn: 0.125 });
  assert.equal(linienGruppe(50).schnitt, 0.7);
});

test("Blatt: echte Länge auf Papier, kleinstes passendes Format, A0 zu klein → Fehler", () => {
  const l = blattLayout({ x0: 0, z0: 0, x1: 20, z1: 14 }, 100);
  assert.deepEqual(l.zeichnung_mm, { b: 200, h: 140 });
  assert.equal(l.format, "A3");
  assert.equal(blattLayout({ x0: 0, z0: 0, x1: 20, z1: 14 }, 50).format, "A2");
  assert.throws(() => blattLayout({ x0: 0, z0: 0, x1: 500, z1: 300 }, 50), /passt bei 1:50 nicht auf A0/);
});

test("Grafik: Hüllwände als Polygone, Status farbig, ohne Status Poché, Raumtext mit Fläche", () => {
  const g = planGrafik({ model, level: 0, customWalls: [{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, thickness: 0.24, status: "abbruch" }],
    customZones: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], level: 0, name: "Bad ·WT" }], brille: brilleVon("bauantrag") });
  const polys = g.elemente.filter((e) => e.art === "poly");
  assert.equal(polys.length, model.walls.filter((w) => w.level === 0).length + 1);
  const abbruch = polys.at(-1);
  assert.equal(abbruch.fill, "#f2c230"); assert.ok(abbruch.dash);
  assert.equal(polys[0].fill, "#3f3f46");
  const text = g.elemente.find((e) => e.art === "text");
  assert.equal(text.text, "Bad  12,00 m²");
});

test("PDF: gültig, Blattgröße in pt = A3 quer, Titel trägt den Maßstab", async () => {
  const g = planGrafik({ model, level: 0 });
  const { bytes, format } = await vektorPlanPdf(g, { massstab: 100, projekt: "Testprojekt", planinhalt: "Grundriss EG", brille: brilleVon("eingabe"), datum: "16.10.2026" });
  assert.equal(format, "A3");
  const doc = await PDFDocument.load(bytes);
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(Math.round(width / (72 / 25.4)), 420);
  assert.equal(Math.round(height / (72 / 25.4)), 297);
  assert.match(doc.getTitle(), /1:100/);
  await assert.rejects(() => vektorPlanPdf({ elemente: [], bbox: null }, { massstab: 100 }), /Keine Zeichnung/);
});
