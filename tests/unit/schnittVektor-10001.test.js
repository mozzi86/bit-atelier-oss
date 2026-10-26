// 100-01: the section as a vector PDF at true scale — cut walls and slabs from the model, level marks
// after DIN 1356-1 (triangle + value), dimension lines, nothing outside the sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { schnittGrafik, vektorPlanPdf, koteText } from "@designer/lib/vektorPlan";
import { createBuildingModel } from "@core/lib/buildingModel";
import { brilleVon } from "@core/lib/plan/brillen.js";

const model = createBuildingModel({ footprintM: [{ x: -10, z: -6 }, { x: 10, z: -6 }, { x: 10, z: 6 }, { x: -10, z: 6 }], storeys: 3, storeyHeight: 3 });

test("Kotentext: ±0,00, Vorzeichen, Komma, zwei Nachkommastellen", () => {
  assert.equal(koteText(0), "±0,00");
  assert.equal(koteText(3), "+3,00");
  assert.equal(koteText(-2.5), "-2,50");
  assert.equal(koteText(0.004), "±0,00");
});

test("Schnitt: zwei geschnittene Hüllwände über die volle Höhe, Decken, Koten je Geschoss + OK Dach", () => {
  const g = schnittGrafik({ model, storeyHeight: 3, massstab: 100 });
  const waende = g.elemente.filter((e) => e.ebene === "wand");
  assert.equal(waende.length, 2);
  const hoehen = waende[0].pts.map((p) => -p.z);
  assert.equal(Math.max(...hoehen), model.totalHeight);
  assert.equal(waende[0].breite_mm, 0.5, "Schnittkante = Liniengruppe 0,5 bei 1:100");
  assert.equal(g.elemente.filter((e) => e.ebene === "decke").length, model.slabs.length);
  const koten = g.elemente.filter((e) => e.ebene === "kote" && e.art === "text").map((e) => e.text);
  assert.ok(koten.some((t) => t.startsWith("±0,00")), koten.join(" | "));
  assert.ok(koten.some((t) => t.startsWith("+3,00")), koten.join(" | "));
  assert.ok(koten.some((t) => t.endsWith("OK Dach")), koten.join(" | "));
  // DIN 1356-1: filled triangle with its tip on the level line
  const dreieck = g.elemente.find((e) => e.ebene === "kote" && e.art === "poly" && e.fill);
  assert.equal(dreieck.pts.length, 3);
  assert.equal(dreieck.pts[0].z, 0);
});

test("Schnitt: Höhe zeigt nach oben (z = -Höhe), Bbox schließt Texte und Maßketten ein", () => {
  const g = schnittGrafik({ model, storeyHeight: 3, massstab: 100 });
  assert.ok(g.bbox.z0 <= -model.totalHeight, "Dach oberhalb der Geländelinie");
  for (const e of g.elemente) {
    if (e.art !== "text") continue;
    assert.ok(e.x >= g.bbox.x0 && e.x <= g.bbox.x1, `Text ${e.text} in der Bbox`);
  }
  const kote = g.elemente.find((e) => e.art === "text" && e.ausrichtung === "rechts");
  const breite = kote.text.length * 0.55 * 2.5 * 0.1;
  assert.ok(kote.x - breite >= g.bbox.x0 - 1e-9, "rechtsbündiger Kotentext ragt nicht links aus dem Blatt");
});

test("Ebenen aus: ohne labels keine Koten, ohne dimensions keine Maßketten, ohne shell keine Wände", () => {
  const g = schnittGrafik({ model, layerVis: { labels: false, dimensions: false, shell: false } });
  assert.equal(g.elemente.filter((e) => ["kote", "bemassung", "wand", "decke"].includes(e.ebene)).length, 0);
});

test("Brille: Abbruch-Status färbt die geschnittenen Hüllwände gelb und gestrichelt", () => {
  const g = schnittGrafik({ model, brille: brilleVon("bauantrag"), huelleStatus: "abbruch" });
  const w = g.elemente.find((e) => e.ebene === "wand");
  assert.equal(w.fill, "#f2c230");
  assert.ok(w.dash);
});

test("PDF: gültig, maßstäblich auf A3, Titel nennt den Schnitt", async () => {
  const g = schnittGrafik({ model, massstab: 100 });
  const { bytes, format } = await vektorPlanPdf(g, { massstab: 100, projekt: "Testprojekt", planinhalt: "Schnitt", brille: brilleVon("eingabe"), datum: "22.10.2026" });
  assert.equal(format, "A3");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.match(doc.getTitle() || "", /Schnitt 1:100/);
});
