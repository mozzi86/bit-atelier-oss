// 97-03: lens register — one model, lenses only decide visibility per status; elements without
// status are never hidden; the input lens changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRILLEN, brilleVon, brilleSicht, zeigtStatus, sichtbarUnter, STANDARD_BRILLE, dreiDDarstellung, BLASS_DECKKRAFT } from "@core/lib/plan/brillen.js";

test("sieben Brillen aus dem Konzept, eindeutige ids, Maßstab gesetzt", () => {
  assert.deepEqual(BRILLEN.map((b) => b.id), ["eingabe", "bestand", "abbruch", "bauantrag", "ausfuehrung", "ausschreibung", "bauleitung"]);
  for (const b of BRILLEN) assert.ok([50, 100].includes(b.massstab), b.id);
  assert.equal(brilleVon("ausfuehrung").massstab, 50);
});

test("keine Brille blendet Bauteile ohne Status aus (D-BW-03)", () => {
  for (const b of BRILLEN) {
    assert.ok(zeigtStatus(b, null), b.id);
    assert.ok(zeigtStatus(b, "quatsch"), b.id);
  }
});

test("Konzept §4: Bestand ohne Neubau, Abbruchplan hebt Abbruch hervor, 1:50 ohne Abbruch", () => {
  assert.equal(brilleSicht(brilleVon("bestand"), "neubau"), "aus");
  assert.equal(brilleSicht(brilleVon("abbruch"), "abbruch"), "hervor");
  assert.equal(brilleSicht(brilleVon("abbruch"), "bestand"), "blass");
  assert.equal(brilleSicht(brilleVon("ausfuehrung"), "abbruch"), "aus");
  assert.equal(brilleSicht(brilleVon("bauantrag"), "temporaer"), "aus");
});

test("Eingabe-Brille liefert dieselbe Liste; andere filtern nach Status", () => {
  const liste = [{ status: "neubau" }, { status: "bestand" }, { status: null }, {}];
  assert.equal(sichtbarUnter(brilleVon(STANDARD_BRILLE), liste), liste);
  assert.deepEqual(sichtbarUnter(brilleVon("bestand"), liste), [{ status: "bestand" }, { status: null }, {}]);
  assert.equal(brilleVon("gibtsnicht").id, "eingabe");
  assert.deepEqual(sichtbarUnter(brilleVon("bestand"), null), []);
});

// 97-04: plan look per status and lens — colours from the ONE status table, demolition dashed,
// faded/emphasised per lens, heavier lines at 1:50; no status = today's look (null).
import { planDarstellung } from "@core/lib/plan/brillen.js";
import { statusFarbe } from "@core/lib/plan/statusDarstellung.js";

test("97-04 Planbild: Farbe aus der Statustabelle, Abbruch gestrichelt, blass/hervor, 1:50 kräftiger", () => {
  const ein = brilleVon("eingabe");
  assert.equal(planDarstellung(ein, null), null, "ohne Status: altes Bild");
  assert.equal(planDarstellung(null, "neubau"), null);
  assert.equal(planDarstellung(ein, "neubau").fill, statusFarbe("neubau"));
  assert.ok(planDarstellung(ein, "abbruch").dash, "Abbruch gestrichelt");
  assert.equal(planDarstellung(ein, "neubau").dash, undefined);
  assert.equal(planDarstellung(brilleVon("abbruch"), "bestand").opacity, 0.35);
  assert.ok(planDarstellung(brilleVon("abbruch"), "abbruch").strokeWidth > planDarstellung(ein, "abbruch").strokeWidth);
  assert.ok(planDarstellung(brilleVon("ausfuehrung"), "neubau").strokeWidth > planDarstellung(brilleVon("ausschreibung"), "neubau").strokeWidth * 1.3);
  assert.equal(planDarstellung(brilleVon("bestand"), "neubau"), null, "ausgeblendet");
  assert.match(planDarstellung(ein, "bestand").stroke, /^#[0-9a-f]{6}$/);
});

// 97-04b: S/W variant of the permit lens and the 45° hatch.
import { schraffur45 } from "@core/lib/plan/brillen.js";
test("97-04b S/W: nur Bauantrag; Bestand hellgrau, Abbruch leer gestrichelt, Neubau schraffiert", () => {
  const ba = brilleVon("bauantrag");
  assert.equal(planDarstellung(ba, "bestand", { sw: true }).fill, "#d4d4d8");
  const ab = planDarstellung(ba, "abbruch", { sw: true });
  assert.ok(ab.leer && ab.dash);
  assert.ok(planDarstellung(ba, "neubau", { sw: true }).schraffur);
  assert.equal(planDarstellung(brilleVon("eingabe"), "neubau", { sw: true }).fill, statusFarbe("neubau"), "andere Brillen bleiben farbig");
});
test("97-04b Schraffur 45°: Linien im Rechteck, Abstand stimmt, Endpunkte auf dem Rand", () => {
  const q = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1 }, { x: 0, z: 1 }];
  const l = schraffur45(q, 0.2);
  assert.ok(l.length > 10);
  for (const [p, r] of l) for (const pt of [p, r]) assert.ok(pt.x >= -1e-9 && pt.x <= 4 + 1e-9 && pt.z >= -1e-9 && pt.z <= 1 + 1e-9);
  const c = l.map(([p]) => p.x - p.z).sort((a, b) => a - b);
  assert.ok(Math.abs((c[1] - c[0]) / Math.SQRT2 - 0.2) < 1e-9);
  assert.deepEqual(schraffur45(q, 0), []);
});

// 261110-vf2: the same lens on a 3D mesh
test("3D: Eingabe-Brille ändert kein Bauteil", () => {
  for (const st of ["bestand", "abbruch", "neubau", "temporaer", null]) {
    assert.deepEqual(dreiDDarstellung(brilleVon("eingabe"), st), { sichtbar: true, deckkraft: 1, farbe: null, sicht: "normal" });
  }
});

test("3D: Abbruchplan — Abbruch kräftig gelb, Bestand blass grau, Neubau aus", () => {
  const b = brilleVon("abbruch");
  assert.deepEqual(dreiDDarstellung(b, "abbruch"), { sichtbar: true, deckkraft: 1, farbe: "#f2c230", sicht: "hervor" });
  assert.deepEqual(dreiDDarstellung(b, "bestand"), { sichtbar: true, deckkraft: BLASS_DECKKRAFT, farbe: "#9aa3ad", sicht: "blass" });
  assert.equal(dreiDDarstellung(b, "neubau").sichtbar, false);
  assert.equal(BLASS_DECKKRAFT, 0.35); // same value as the plan
});

test("3D: ohne Status nie ausgeblendet und nie umgefärbt, unter keiner Brille (D-BW-03)", () => {
  for (const b of BRILLEN) for (const st of [null, undefined, "", "quatsch"]) {
    assert.deepEqual(dreiDDarstellung(b, st), { sichtbar: true, deckkraft: 1, farbe: null, sicht: "normal" }, `${b.id}/${st}`);
  }
  assert.equal(dreiDDarstellung(null, "abbruch").sichtbar, true); // no lens = nothing changes
});

test("3D: jede Brille blendet genau die Status aus, die sie auch im Plan ausblendet", () => {
  for (const b of BRILLEN) for (const st of ["bestand", "abbruch", "neubau", "temporaer"]) {
    assert.equal(dreiDDarstellung(b, st).sichtbar, zeigtStatus(b, st), `${b.id}/${st}`);
  }
});
