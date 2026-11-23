// W-1118-21: dimension chains of the floor plan sheet and the plan set (several sheets in one PDF).
// The chains are derived from the model the sheet draws (hull walls, drawn openings, drawn walls, rooms) — nothing per project.
// Placeholder building only (createBuildingModel default footprint); no data of a real project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { planGrafik, schnittGrafik, vektorPlanPdf, plansatzPdf } from "@designer/lib/vektorPlan";
import { planKetten, kettenPruefung, kettenElemente, REIHE_MM } from "@designer/lib/planMassketten.js";
import { createBuildingModel } from "@core/lib/buildingModel";
import { wandGeometrie } from "@core/lib/bauteil/referenz.js";

const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
const huell = model.walls.filter((w) => w.level === 0);
const zentrum = model.footprint.reduce((a, q) => ({ x: a.x + q.x / model.footprint.length, z: a.z + q.z / model.footprint.length }), { x: 0, z: 0 });
const laenge = (k) => Math.round(Math.hypot(k.punkte.at(-1).x - k.punkte[0].x, k.punkte.at(-1).z - k.punkte[0].z) * 100) / 100;

/** Outer extent of the hull along the direction of a wall (all hull wall outlines projected). */
function aussenmass(w) {
  const g = wandGeometrie(w);
  const us = huell.flatMap((x) => wandGeometrie(x).polygon).map((p) => p.x * g.richtung.x + p.z * g.richtung.z);
  return Math.round((Math.max(...us) - Math.min(...us)) * 100) / 100;
}

test("plain facade: wall row (corner wall, clear inside, corner wall) and the overall chain, outer corner to outer corner", () => {
  const ketten = planKetten({ huellWaende: huell, zentrum });
  assert.equal(ketten.length, 2 * huell.length);
  for (const w of huell) {
    const k0 = `env:${w.level}:${w.edge}`, dicke = Math.round(wandGeometrie(w).dicke_m * 100) / 100;
    const [waende, gesamt] = ketten.filter((k) => k.bezug === k0);
    assert.deepEqual([waende.art, waende.reihe, gesamt.art, gesamt.reihe], ["waende", 0, "gesamt", 1]);
    assert.equal(laenge(gesamt), aussenmass(w), `${k0}: overall length is the outer dimension of the building`);
    const stuecke = waende.punkte.slice(1).map((p, i) => Math.round(Math.hypot(p.x - waende.punkte[i].x, p.z - waende.punkte[i].z) * 100) / 100);
    assert.deepEqual([stuecke[0], stuecke[2]], [dicke, dicke], "the corner walls' thickness at both ends");
    assert.equal(Math.round((stuecke[0] + stuecke[1] + stuecke[2]) * 100) / 100, aussenmass(w));
  }
  for (const p of kettenPruefung(ketten)) assert.ok(p.ok, `${p.bezug}: ${p.summe_m} = ${p.gesamt_m}`);
});

test("openings and a cross wall give three rows; the pieces add up to the overall length as printed", () => {
  const w = huell[0], g = wandGeometrie(w), k0 = `env:${w.level}:${w.edge}`;
  // a drawn wall across the facade, ending on its reference line at 37 % of its length (odd position: rounding must not break the sums)
  const u = g.laenge_m * 0.37, fuss = { x: w.a.x + g.richtung.x * u, z: w.a.z + g.richtung.z * u };
  const innen = { x: zentrum.x - fuss.x, z: zentrum.z - fuss.z }, s = Math.sign(innen.x * g.normale.x + innen.z * g.normale.z) || 1;
  const quer = { a: fuss, b: { x: fuss.x + g.normale.x * s * 3, z: fuss.z + g.normale.z * s * 3 }, level: 0, thickness: 0.115 };
  const oeffnungen = new Map([[k0, [{ mitte_u: g.laenge_m * 0.2, breite: 1.26 }, { mitte_u: g.laenge_m * 0.71, breite: 0.885 }]]]);
  const ketten = planKetten({ huellWaende: huell, oeffnungen, waende: [quer], zentrum }).filter((k) => k.bezug === k0);
  assert.deepEqual(ketten.map((k) => [k.art, k.reihe]), [["oeffnungen", 0], ["waende", 1], ["gesamt", 2]]);
  assert.equal(ketten[0].punkte.length, 6, "two openings: start, four jambs, end");
  // wall row: both corner walls' inner faces and both faces of the cross wall
  assert.equal(ketten[1].punkte.length, 6);
  const dicken = ketten[1].punkte.slice(1).map((p, i) => Math.round(Math.hypot(p.x - ketten[1].punkte[i].x, p.z - ketten[1].punkte[i].z) * 1000) / 1000);
  assert.ok(dicken.includes(0.12) || dicken.includes(0.11), `the cross wall's thickness is a piece of the wall row (${dicken})`);
  const pr = kettenPruefung(ketten);
  assert.equal(pr.length, 2);
  for (const p of pr) assert.ok(p.ok, `${p.art}: ${p.summe_m} = ${p.gesamt_m}`);
  // printed numbers: the pieces of a row, as written on the sheet, add up to the printed overall number
  const { elemente } = kettenElemente(ketten, { massstab: 50, linien: { duenn: 0.18, ansicht: 0.35 }, zentrum });
  const zahl = (/** @type {string} */ t) => Number(t.replace(".", "").replace(",", "."));
  const texte = elemente.filter((e) => e.art === "text");
  const gesamt = zahl(texte.find((t) => t.kette === "gesamt").text);
  for (const art of ["oeffnungen", "waende"]) {
    const summe = texte.filter((t) => t.kette === art).reduce((a, t) => a + zahl(t.text), 0);
    assert.equal(Math.round(summe * 100), Math.round(gesamt * 100), `${art}: printed pieces = printed overall length`);
  }
});

test("rows lie outside the building, 10 / 18 / 26 mm from the outer face on paper", () => {
  const w = huell[0], g = wandGeometrie(w), k0 = `env:${w.level}:${w.edge}`;
  const oeffnungen = new Map([[k0, [{ mitte_u: g.laenge_m / 2, breite: 1.0 }]]]);
  const ketten = planKetten({ huellWaende: huell, oeffnungen, zentrum }).filter((k) => k.bezug === k0);
  assert.deepEqual(ketten.map((k) => k.art), ["oeffnungen", "waende", "gesamt"]);
  for (const massstab of [50, 100]) {
    for (const k of ketten) {
      const { elemente } = kettenElemente([k], { massstab, linien: { duenn: 0.18, ansicht: 0.35 }, zentrum });
      const linie = elemente[0];
      // distance of the dimension line from the measured (outer face) points, in mm on paper
      const p = k.punkte[0], d = g.richtung;
      const quer = Math.abs((linie.pts[0].x - p.x) * -d.z + (linie.pts[0].z - p.z) * d.x);
      assert.ok(Math.abs((quer * 1000) / massstab - (REIHE_MM.erste + k.reihe * REIHE_MM.abstand)) < 1e-6, `1:${massstab} row ${k.reihe}`);
      // away from the building: farther from the centre than the measured face
      const ab = (/** @type {{x: number, z: number}} */ q) => (q.x - zentrum.x) * k.aussen.x + (q.z - zentrum.z) * k.aussen.z;
      assert.ok(ab(linie.pts[0]) > ab(p));
    }
  }
});

test("rooms: clear width and depth from the room outline, short niches left out", () => {
  const raum = { name: "Zimmer", points: [{ x: 1, z: 1 }, { x: 5.2, z: 1 }, { x: 5.2, z: 4.5 }, { x: 1, z: 4.5 }] };
  const nische = { name: "Schacht", points: [{ x: 6, z: 1 }, { x: 6.5, z: 1 }, { x: 6.5, z: 1.6 }, { x: 6, z: 1.6 }] };
  const ketten = planKetten({ huellWaende: huell, raeume: [raum, nische], zentrum }).filter((k) => k.art === "raum");
  assert.deepEqual(ketten.map((k) => k.bezug), ["Zimmer", "Zimmer"]);
  assert.deepEqual(ketten.map(laenge).sort(), [3.5, 4.2]);
});

test("planGrafik: without the switch nothing changes; with it the chains are on layer bemassung and the proof is attached", () => {
  const eingabe = { model, level: 0, customZones: [{ points: [{ x: 1, z: 1 }, { x: 5, z: 1 }, { x: 5, z: 4 }, { x: 1, z: 4 }], level: 0, name: "Zimmer" }], massstab: 50 };
  const ohne = planGrafik(eingabe);
  assert.equal(ohne.elemente.some((e) => e.ebene === "bemassung"), false);
  assert.equal("kettenPruefung" in ohne, false);
  const mit = planGrafik({ ...eingabe, massketten: true });
  assert.deepEqual(mit.elemente.filter((e) => e.ebene !== "bemassung"), ohne.elemente, "the drawing itself is untouched");
  const zahlen = mit.elemente.filter((e) => e.ebene === "bemassung" && e.art === "text");
  assert.equal(zahlen.filter((t) => t.kette === "gesamt").length, huell.length);
  assert.equal(zahlen.filter((t) => t.kette === "raum").length, 2);
  assert.ok(Array.isArray(mit.kettenPruefung));
  // the sheet grows by the rows: the bounding box contains every chain point
  for (const e of mit.elemente.filter((x) => x.ebene === "bemassung" && x.art === "poly")) for (const p of e.pts) {
    assert.ok(p.x >= mit.bbox.x0 - 1e-9 && p.x <= mit.bbox.x1 + 1e-9 && p.z >= mit.bbox.z0 - 1e-9 && p.z <= mit.bbox.z1 + 1e-9);
  }
  assert.ok(mit.bbox.x1 - mit.bbox.x0 > ohne.bbox.x1 - ohne.bbox.x0);
  // the layer switch "Bemaßung" hides them
  assert.equal(planGrafik({ ...eingabe, massketten: true, layerVis: { dimensions: false } }).elemente.some((e) => e.ebene === "bemassung"), false);
});

test("turned sheet: numbers stay readable (0° or −90°), chains follow the drawing", () => {
  const g = planGrafik({ model, level: 0, massstab: 50, massketten: true, blattDrehung: 90 });
  const zahlen = g.elemente.filter((e) => e.ebene === "bemassung" && e.art === "text");
  assert.equal(zahlen.length, 4 * huell.length, "per facade: three pieces of the wall row and the overall length");
  for (const t of zahlen) assert.ok(t.drehung_grad === undefined || t.drehung_grad === -90, `angle ${t.drehung_grad}`);
  const gerade = planGrafik({ model, level: 0, massstab: 50, massketten: true }).elemente.filter((e) => e.ebene === "bemassung" && e.art === "text");
  assert.deepEqual(zahlen.map((t) => t.text).sort(), gerade.map((t) => t.text).sort(), "same numbers on the turned sheet");
});

test("plan set: one PDF, one page per sheet at true scale, numbered; the single sheet is unchanged", async () => {
  const blatt = (/** @type {number} */ level) => ({ grafik: planGrafik({ model, level, massstab: 50, massketten: true }), planinhalt: `Grundriss ${level}`, massstab: 50 });
  const schnitt = { grafik: schnittGrafik({ model, storeyHeight: 3, massstab: 50 }), planinhalt: "Schnitt A-A", massstab: 50 };
  const leer = { grafik: { elemente: [], bbox: null, markiert: [] }, planinhalt: "leer", massstab: 50 };
  const satz = await plansatzPdf([blatt(0), blatt(1), leer, schnitt], { projekt: "Testhaus", datum: "22.11.2026" });
  assert.deepEqual(satz.blaetter.map((b) => b.planinhalt), ["Grundriss 0", "Grundriss 1", "Schnitt A-A"]);
  const doc = await PDFDocument.load(satz.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 3);
  assert.match(String(doc.getTitle()), /Testhaus.*Plansatz 1:50/);
  // every page has the size of the format its sheet reports
  const MM = { A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
  doc.getPages().forEach((p, i) => {
    const [b, h] = MM[satz.blaetter[i].format];
    assert.ok(Math.abs(p.getWidth() - (b * 72) / 25.4) < 0.01 && Math.abs(p.getHeight() - (h * 72) / 25.4) < 0.01);
  });
  await assert.rejects(() => plansatzPdf([leer]), /Plansatz ist leer/);
  // single sheet: still one page, same result fields
  const einzel = await vektorPlanPdf(blatt(0).grafik, { massstab: 50, projekt: "Testhaus", planinhalt: "Grundriss 0", datum: "22.11.2026" });
  assert.equal((await PDFDocument.load(einzel.bytes, { updateMetadata: false })).getPageCount(), 1);
  assert.equal(einzel.format, satz.blaetter[0].format);
});
