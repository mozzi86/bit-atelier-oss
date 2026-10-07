// Unit tests for the balcony switch of tesselierung.js (75-13 Task 3, MSB-22):
// regeln.balkon["<typKey>|<raum>"] → balcony zone (raumart "balkon") in front of the
// room's own facade, 1,5 m deep (D-P75-13-B), 0,5 m clear to both room partitions,
// area from the polygon with WoFlV 25 % (CITED WoFlV §4), distance-area hint
// BayBO Art. 6 Abs. 6 Satz 1 Nr. 2 [CITED] when the balconies of one facade exceed 1/3.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, BALKON } from "@designer/lib/tesselierung";
import { woflvFlaeche, WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { weGruppen } from "@designer/lib/massstab";
import { pruefeWohnung } from "@designer/lib/raumQualitaet";
import { isoSzeneAusModell } from "@designer/lib/isoKamera";

const FP30 = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const basis = { footprintM: FP30, storeys: 2, typ: "mfh", einheiten: STD, raumzonen: true };
const mit = (balkon, regeln = {}) => tesseliere({ ...basis, regeln: { balkon, ...regeln } });
const balkone = (r) => r.zonen.filter((z) => z.raumart === "balkon");
const ext = (pts) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("regeln.balkon — Geometrie (75-13 Task 3)", () => {
  const r = mit({ "st-1zi|Wohnen/Schlafen": true });

  it("ein Balkon je Einheit des Typs und Geschoss (2 Einheiten × 2 Geschosse = 4), Zone raumart balkon mit we/level/raum", () => {
    const b = balkone(r);
    assert.equal(b.length, 4);
    assert.deepEqual(b.map((z) => z.we).sort(), ["WE 0-1", "WE 0-4", "WE 1-1", "WE 1-4"]);
    assert.deepEqual(b.map((z) => z.level).sort(), [0, 0, 1, 1]);
    assert.ok(b.every((z) => z.art === "balkon" && z.fensterpflicht === false && /^Wohnen\/Schlafen/.test(z.raum)));
    assert.match(b[0].name, /^Balkon Wohnen\/Schlafen \(WE \d-\d\) ·WT$/);
  });

  it("Tiefe 1,5 m vor der Fassade (außerhalb der Gebäudehülle), Rand 0,5 m zu beiden Raumgrenzen", () => {
    const zone = r.zonen.find((z) => z.name === "Wohnen/Schlafen (WE 0-1) ·WT");
    const raum = ext(zone.points);
    const bk = ext(balkone(r).find((z) => z.we === "WE 0-1" && z.level === 0).points);
    assert.ok(near(bk.z1, -10) && near(bk.z0, -10 - BALKON.tiefe_m), `z ${bk.z0}…${bk.z1}`);
    assert.ok(near(bk.x0, raum.x0 + BALKON.rand_m, 0.011), `links ${bk.x0} vs ${raum.x0}`);
    assert.ok(near(bk.x1, raum.x1 - BALKON.rand_m, 0.011), `rechts ${bk.x1} vs ${raum.x1}`);
    assert.equal(BALKON.tiefe_m, 1.5);
    assert.equal(BALKON.rand_m, 0.5);
  });

  it("nie über einer Trennwand: der Balkon liegt im x-Bereich der Raumfassade (Südfassade und Nordfassade)", () => {
    for (const bz of balkone(r)) {
      const raum = r.zonen.find((z) => z.we === bz.we && z.level === bz.level && z.name === bz.raum);
      const re = ext(raum.points), be = ext(bz.points);
      assert.ok(be.x0 >= re.x0 - 1e-6 && be.x1 <= re.x1 + 1e-6, `${bz.we} L${bz.level}: ${be.x0}…${be.x1} ⊄ ${re.x0}…${re.x1}`);
    }
    // North band: the balcony lies beyond z = +10.
    const nord = balkone(r).find((z) => z.we === "WE 0-4");
    assert.ok(ext(nord.points).z0 >= 10 - 1e-6 && ext(nord.points).z1 <= 10 + BALKON.tiefe_m + 1e-6);
  });

  it("Fläche = Polygon (Breite − 2 × 0,5 m) × 1,5 m", () => {
    const zone = r.zonen.find((z) => z.name === "Wohnen/Schlafen (WE 0-1) ·WT");
    const raum = ext(zone.points);
    const b = balkone(r).find((z) => z.we === "WE 0-1" && z.level === 0);
    const soll = (raum.x1 - raum.x0 - 2 * BALKON.rand_m) * BALKON.tiefe_m;
    assert.ok(Math.abs(b.flaeche_m2 - soll) < 0.02, `${b.flaeche_m2} vs ${soll}`);
  });

  it("WoFlV: die Balkonfläche aus der Geometrie geht mit 25 % ein (CITED WoFlV §4 Abs. 4)", () => {
    const b = balkone(r).find((z) => z.we === "WE 0-1" && z.level === 0);
    const raeume = [{ name: "Wohnen", flaeche_m2: 30 }];
    const ohne = woflvFlaeche({ raeume }).wohnflaeche_m2;
    const mitB = woflvFlaeche({ raeume, balkone: [{ m2: b.flaeche_m2, anrechnung: BALKON.anrechnung }] }).wohnflaeche_m2;
    assert.ok(Math.abs(mitB - ohne - 0.25 * b.flaeche_m2) < 1e-9);
  });
});

describe("regeln.balkon — Schalter und Grenzen (75-13 Task 3)", () => {
  it("Schalter aus (leer, false oder Schlüssel fehlt) → keine Zone, Ausgabe byte-gleich zum Default", () => {
    const def = JSON.stringify(tesseliere(basis));
    assert.equal(JSON.stringify(mit({})), def);
    assert.equal(JSON.stringify(mit({ "st-1zi|Wohnen/Schlafen": false })), def);
    assert.equal(JSON.stringify(mit(null)), def);
  });

  it("Innenraum (Abstellraum ohne Fassadenkante) hat keinen Balkon: keine Zone, Hinweis nennt den Grund", () => {
    const r = mit({ "st-2zi|Abstellraum": true });
    assert.equal(balkone(r).length, 0);
    assert.ok(r.hinweise.some((h) => /Balkon an „Abstellraum“ nicht möglich — Raum ohne Fassadenkante/.test(h)));
  });

  it("Balkon an mehreren Räumen einer Fassade über 1/3 der Wandlänge → Hinweis BayBO Art. 6 Abs. 6 Satz 1 Nr. 2 [CITED]", () => {
    const alle = {};
    for (const t of STD) for (const rp of t.raumprogramm) if (rp.fensterpflicht) alle[`${t.key}|${rp.raum}`] = true;
    const r = mit(alle);
    assert.ok(balkone(r).length > 4);
    const h = r.hinweise.find((x) => /Abstandsflächen-Privileg entfällt/.test(x));
    assert.ok(h, r.hinweise.join(" | "));
    assert.match(h, /BayBO Art\. 6 Abs\. 6 Satz 1 Nr\. 2 \[CITED\]/);
    assert.doesNotMatch(h, /Abs\. 8/, "alte Absatznummer (HANDOFF §12) ist überholt");
    assert.match(h, /1\/3 der Wandbreite/);
  });

  it("wenige Balkone (unter 1/3 der Fassade) lösen den Abstandsflächen-Hinweis nicht aus", () => {
    const r = mit({ "st-1zi|Wohnen/Schlafen": true });
    assert.ok(!r.hinweise.some((x) => /Abstandsflächen-Privileg/.test(x)));
  });

  it("Balkon ist keine Wand: regeln.wandstaerken erzeugt dieselben Wandsegmente mit und ohne Balkon", () => {
    const a = mit({}, { wandstaerken: true }), b = mit({ "st-1zi|Wohnen/Schlafen": true }, { wandstaerken: true });
    assert.ok(a.waende.length > 0);
    assert.equal(JSON.stringify(a.waende), JSON.stringify(b.waende));
  });

  it("Balkon ist kein Raum: weGruppen und pruefeWohnung ignorieren die Zone", () => {
    const r = mit({ "st-1zi|Wohnen/Schlafen": true });
    const ohneBalkon = r.zonen.filter((z) => z.raumart !== "balkon");
    const g1 = weGruppen(r.zonen), g2 = weGruppen(ohneBalkon);
    assert.equal(g1.size, g2.size);
    for (const [k, v] of g2) assert.ok(Math.abs(g1.get(k).flaecheM2 - v.flaecheM2) < 1e-9, `Fläche ${k}`);
    const p1 = pruefeWohnung(r.zonen, { we: "WE 0-1", regeln: {} }), p2 = pruefeWohnung(ohneBalkon, { we: "WE 0-1", regeln: {} });
    assert.equal(JSON.stringify(p1), JSON.stringify(p2));
  });

  it("Iso: isoSzeneAusModell reicht raumart durch (Balkon = flache Platte im 3D), Räume bleiben ohne Feld", () => {
    const r = mit({ "st-1zi|Wohnen/Schlafen": true });
    const zonen = r.zonen.filter((z) => z.we === "WE 0-1" && z.level === 0);
    const szene = isoSzeneAusModell(FP30, zonen, { storeys: 2, storeyHeight: 3 });
    const bk = szene.fokusZonen.filter((z) => z.raumart === "balkon");
    assert.equal(bk.length, 1);
    assert.ok(szene.fokusZonen.filter((z) => z.raumart !== "balkon").every((z) => z.raumart === undefined || z.raumart !== "balkon"));
  });
});
