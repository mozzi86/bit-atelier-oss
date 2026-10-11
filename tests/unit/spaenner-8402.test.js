// Unit tests for plan 84-02 (packages/nova-designer/src/lib/tesselierung.js): the
// Spänner as a pinwheel — four units round the stair enclosure, each entered from it
// (ground floor: the south-west unit from the entrance hall), hall + doors in every
// unit, lift with a 1,50 m landing (BF-45), band mode unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, effektiveRegeln, erschliessungsSkelett, SPAENNER_PODEST_M } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { pruefeAlle, badBewegung } from "@designer/lib/raumQualitaet";
import { tuerGeometrie, flurEnden } from "@designer/lib/wohnungsErschliessung";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const fl = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;
/** Point on an edge of the polygon (2 cm tolerance). */
const aufKante = (pt, poly) => poly.some((p, i) => {
  const q = poly[(i + 1) % poly.length];
  const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  const t = ((pt.x - p.x) * (q.x - p.x) + (pt.z - p.z) * (q.z - p.z)) / (len * len);
  return Math.abs((pt.x - p.x) * (q.z - p.z) - (pt.z - p.z) * (q.x - p.x)) / len < 0.02 && t > -0.01 && t < 1.01;
});

describe("84-02 — Spänner als Windmühle: jede Wohnung am Treppenraum", () => {
  it("effektiveRegeln: windmuehle nur für den Spänner im Raumzonen-Modus", () => {
    assert.equal(effektiveRegeln({}, { typ: "spaenner", raumzonen: true }).windmuehle, true);
    assert.equal(effektiveRegeln({}, { typ: "spaenner", raumzonen: false }).windmuehle, undefined);
    assert.equal(effektiveRegeln({}, { typ: "mfh", raumzonen: true }).windmuehle, undefined);
  });

  for (const [mix, E] of [["Standard", STD], ["Referenz", REF]]) {
    for (const [w, d, n] of [[24, 14, 1], [24, 18, 5], [20, 20, 5], [16, 24, 2]]) {
      it(`${mix} ${w} × ${d}, ${n} Geschoss(e): vier WE je Geschoss, Tür auf Treppenraum/Halle, alles erschlossen, Bäder groß genug`, () => {
        const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ: "spaenner", einheiten: E, raumzonen: true });
        for (let l = 0; l < n; l++) assert.equal(r.weListe.filter((x) => x.level === l).length, 4, `Geschoss ${l}`);
        const zirk = r.zonen.filter((z) => z.raumart === "treppenraum" || z.eingang);
        for (const wl of r.weListe) {
          const diele = r.zonen.find((z) => z.we === wl.we && z.level === wl.level && (z.tueren || []).some((t) => t.nach === null));
          assert.ok(diele, `${wl.we}: Wohnungstür`);
          const g = tuerGeometrie(diele, diele.tueren.find((t) => t.nach === null));
          assert.ok(zirk.some((k) => k.level === wl.level && aufKante(g.scharnier, k.points) && aufKante(g.geschlossen, k.points)), `${wl.we}: Tür liegt auf Treppenraum/Halle`);
          for (const e of flurEnden(r.zonen.filter((z) => z.level === wl.level), { we: wl.we })) assert.ok(e.ok, `${wl.we}: Dielenende ${e.ende}`);
        }
        const fails = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
          .flatMap((q) => q.eintraege.filter((e) => e.stufe === "fail" && ["erschliessung", "diele", "flurende"].includes(e.regel)).map((e) => `${q.we}:${e.regel}`));
        assert.deepEqual(fails, []);
        for (const b of r.zonen.filter((z) => z.art === "sanitaer")) assert.equal(badBewegung(b).stufe, "ok", b.name);
        // Area balance: zones + gaps = footprint × storeys (pinwheel tiles the bbox).
        const summe = r.zonen.filter((z) => z.raumart !== "balkon").reduce((s, z) => s + fl(z.points), 0);
        assert.ok(Math.abs(summe + (r.rest_m2 - (r.restNachfrage_m2 || 0)) - w * d * n) < 0.05, `Bilanz ${summe}`);
      });
    }
  }

  it("Aufzug: Podest 1,50 m vor dem Schacht gehört zum Treppenraum; keine Wohnung grenzt nur an den Schacht", () => {
    const r = tesseliere({ footprintM: rect(24, 18), storeys: 5, typ: "spaenner", einheiten: STD, raumzonen: true });
    const tr = r.zonen.find((z) => z.raumart === "treppenraum" && z.level === 2);
    const sch = r.zonen.find((z) => z.raumart === "aufzug" && z.level === 2);
    assert.ok(tr && sch);
    assert.equal(tr.points.length, 6, "Treppe + Podest als L");
    const zs = sch.points.map((p) => p.z), trZ = tr.points.map((p) => p.z);
    assert.ok(Math.abs(Math.min(...zs) - Math.min(...trZ) - SPAENNER_PODEST_M) < 1e-9, "Podest 1,50 m vor dem Schacht");
  });

  it("EG: Eingangshalle zwischen Südfassade und Kern; Südwest-Wohnung (und je nach Kontaktlänge die Ost-Wohnung) von der Halle erschlossen", () => {
    const r = tesseliere({ footprintM: rect(24, 14), storeys: 2, typ: "spaenner", einheiten: STD, raumzonen: true });
    const halle = r.zonen.filter((z) => z.eingang);
    assert.equal(halle.length, 1);
    assert.equal(halle[0].level, 0);
    const imEG = r.weListe.filter((x) => x.level === 0);
    const vonHalle = imEG.filter((wl) => {
      const diele = r.zonen.find((z) => z.we === wl.we && z.level === 0 && (z.tueren || []).some((t) => t.nach === null));
      const g = tuerGeometrie(diele, diele.tueren.find((t) => t.nach === null));
      return aufKante(g.scharnier, halle[0].points) && aufKante(g.geschlossen, halle[0].points);
    });
    // South-west arm touches only the hall; the east arm uses its longer contact (hall 5,75 m > stair 2,5 m).
    assert.ok(vonHalle.length >= 1 && vonHalle.length <= 2, String(vonHalle.length));
  });

  it("großer Grundriss: Hinweis, dass ein Spänner nur vier WE je Geschoss hat", () => {
    const r = tesseliere({ footprintM: rect(40, 26), storeys: 1, typ: "spaenner", einheiten: STD, raumzonen: true });
    assert.ok(r.hinweise.some((h) => /Spänner \[84-02\].*Mittelflur\/MFH/.test(h)));
    const klein = tesseliere({ footprintM: rect(24, 14), storeys: 1, typ: "spaenner", einheiten: STD, raumzonen: true });
    assert.ok(!klein.hinweise.some((h) => /Spänner \[84-02\]/.test(h)));
  });

  it("Band-Modus und Skelett ohne windmuehle bleiben Phase 61 (Quadranten)", () => {
    const s = erschliessungsSkelett({ footprintM: rect(24, 14), storeys: 1, typ: "spaenner" });
    assert.deepEqual(s.baender.map((b) => b.seite), ["west", "ost", "suedmitte", "nordmitte"]);
    const r = tesseliere({ footprintM: rect(24, 14), storeys: 1, typ: "spaenner", einheiten: STD });
    assert.ok(r.weListe.every((x) => !x.kopf), "Band-Modus: alte Quadranten-Bänder");
  });
});
