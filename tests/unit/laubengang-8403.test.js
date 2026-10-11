// Unit tests for plan 84-03 (packages/nova-designer/src/lib/tesselierung.js): Laubengang —
// every unit entered from the gallery, all rooms reachable (shallow back rows fall back
// to side by side without the store niche), gallery width rule BF-16/17 as a hint.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, LAUBENGANG_RANGIER } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { pruefeAlle, badBewegung } from "@designer/lib/raumQualitaet";
import { tuerGeometrie } from "@designer/lib/wohnungsErschliessung";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const aufKante = (pt, poly) => poly.some((p, i) => {
  const q = poly[(i + 1) % poly.length];
  const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  const t = ((pt.x - p.x) * (q.x - p.x) + (pt.z - p.z) * (q.z - p.z)) / (len * len);
  return Math.abs((pt.x - p.x) * (q.z - p.z) - (pt.z - p.z) * (q.x - p.x)) / len < 0.02 && t > -0.01 && t < 1.01;
});

describe("84-03 — Laubengang: erschlossen vom Gang, Gangbreite nach DIN 18040-2", () => {
  for (const [mix, E] of [["Standard", STD], ["Referenz", REF]]) {
    for (const [w, d, n] of [[40, 16, 1], [40, 12, 3], [30, 10, 2], [60, 14, 4], [14, 40, 1]]) {
      it(`${mix} ${w} × ${d}, ${n} G.: Wohnungstür am Laubengang, kein Raum ohne Zugang, Bäder ok`, () => {
        const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ: "laubengang", einheiten: E, raumzonen: true });
        const gang = r.zonen.filter((z) => z.we === undefined && z.raumart === "flur");
        for (const wl of r.weListe) {
          const diele = r.zonen.find((z) => z.we === wl.we && z.level === wl.level && (z.tueren || []).some((t) => t.nach === null));
          assert.ok(diele, `${wl.we}: Wohnungstür`);
          const g = tuerGeometrie(diele, diele.tueren.find((t) => t.nach === null));
          assert.ok(gang.some((k) => k.level === wl.level && aufKante(g.scharnier, k.points) && aufKante(g.geschlossen, k.points)), `${wl.we}: Tür am Gang`);
        }
        const fails = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
          .flatMap((q) => q.eintraege.filter((e) => e.stufe === "fail" && ["erschliessung", "diele"].includes(e.regel)).map((e) => `${q.we}:${e.regel}:${e.raum}`));
        assert.deepEqual(fails, []);
        for (const b of r.zonen.filter((z) => z.art === "sanitaer")) assert.equal(badBewegung(b).stufe, "ok", b.name);
      });
    }
  }

  it("flache Nebenraumzeile (30 × 10): Abstellnische entfällt, Bad + Kochnische nebeneinander mit Türen", () => {
    const r = tesseliere({ footprintM: rect(30, 10), storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true });
    const we = r.weListe.find((w) => w.typKey === "st-1zi").we;
    const zonen = r.zonen.filter((z) => z.we === we);
    assert.ok(!zonen.some((z) => /^Abstellnische/.test(z.name)), "Abstellnische entfällt");
    for (const z of zonen.filter((y) => ["sanitaer", "kueche"].includes(y.art))) assert.equal(z.tueren?.length, 1, z.name);
    assert.ok(r.raumWarns.concat(r.hinweise).some((h) => h.startsWith(we) && /Abstellnische“ entfällt/.test(h)));
  });

  it("Gangbreite 1,35 < 1,50 m: Hinweis mit Anzahl der Rangierflächen (BF-16/17), nur im Raumzonen-Modus", () => {
    assert.deepEqual(LAUBENGANG_RANGIER, { breite_m: 1.5, abstand_m: 15 });
    const anzahl = (w) => {
      const h = tesseliere({ footprintM: rect(w, 12), storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true }).hinweise.find((x) => /^Laubengang \[84-03\]/.test(x));
      assert.ok(h, `Hinweis bei ${w} m`);
      assert.match(h, /DIN 18040-2 4\.3\.2/);
      return Number(h.match(/Ganglänge (\d+) nötig/)[1]);
    };
    assert.equal(anzahl(14), 1, "mindestens einmal");
    assert.equal(anzahl(30), 1);
    assert.equal(anzahl(40), 2);
    assert.equal(anzahl(60), 3);
    const band = tesseliere({ footprintM: rect(40, 12), storeys: 1, typ: "laubengang", einheiten: STD });
    assert.ok(!band.hinweise.some((x) => /84-03/.test(x)), "Band-Modus unverändert");
  });
});
