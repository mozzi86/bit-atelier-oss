// 86-02: slanted remainders — multi-part half-plane cut (simple pieces, no bridges), polygon
// minus/inside a convex region, wedge added to the window room in front of it, and the solver
// bookkeeping (rest + occupied = footprint, figures, hint, proportion limit, doors).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  schneideHalbebeneTeile, schneideHalbebene, ohneKonvex, inKonvex, flaeche, punktImPolygon, schwerpunkt,
} from "@designer/lib/formGeometrie";
import { schraegenZuschlagen, halbebenenVon, SCHRAEGE } from "@designer/lib/schraegen";
import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const U = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 44, z: 40 }, { x: 44, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const TRAPEZ = [{ x: -30, z: -8 }, { x: 30, z: -8 }, { x: 22, z: 9 }, { x: -24, z: 9 }];
const FUENFECK = (() => {
  const p = [[596, 688], [736, 204], [1099, 104], [1433, 261], [1268, 550]].map(([x, y]) => ({ x: x / 13.5, z: -y / 13.5 }));
  const c = schwerpunkt(p);
  return p.map((q) => ({ x: q.x - c.x, z: q.z - c.z }));
})();
const summe = (teile) => teile.reduce((s, t) => s + flaeche(t), 0);
/** Distance of a point to a polygon outline (m). */
const randAbstand = (p, poly) => {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z));
  }
  return m;
};
/** Does the ring touch itself (a zero-width bridge = a repeated point)? */
const hatBruecke = (t) => new Set(t.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`)).size !== t.length;

describe("86-02 — Mehrteil-Schnitt (Geometrie-Kern)", () => {
  it("U geschnitten bei z ≥ 20: zwei einfache Schenkel statt eines Rings mit Brücke", () => {
    const teile = schneideHalbebeneTeile(U, 0, -1, -20);
    assert.equal(teile.length, 2);
    for (const t of teile) { assert.ok(Math.abs(flaeche(t) - 320) < 1e-9); assert.equal(hatBruecke(t), false); }
    assert.ok(Math.abs(flaeche(schneideHalbebene(U, 0, -1, -20)) - 640) < 1e-9, "Sutherland–Hodgman: gleiche Fläche, ein Ring");
  });

  it("eine Kette: identisch mit Sutherland–Hodgman (Restpolygone früherer Pläne byte-gleich)", () => {
    assert.deepEqual(schneideHalbebeneTeile(TRAPEZ, 1, 0, 0), [schneideHalbebene(TRAPEZ, 1, 0, 0)]);
    assert.deepEqual(schneideHalbebeneTeile(U, 1, 0, 70), [U]);
    assert.deepEqual(schneideHalbebeneTeile(U, 1, 0, -1), []);
  });

  it("ohneKonvex + inKonvex = Polygon (Flächenbilanz), alle Teile einfach", () => {
    const quadrat = halbebenenVon([{ x: 10, z: 10 }, { x: 50, z: 10 }, { x: 50, z: 30 }, { x: 10, z: 30 }]);
    for (const poly of [U, TRAPEZ, FUENFECK]) {
      const aussen = ohneKonvex(poly, quadrat, 0), innen = inKonvex(poly, quadrat);
      assert.ok(Math.abs(summe(aussen) + summe(innen) - flaeche(poly)) < 1e-6);
      for (const t of [...aussen, ...innen]) assert.equal(hatBruecke(t), false);
    }
  });
});

describe("86-02 — schraegenZuschlagen", () => {
  const raum = {
    name: "Wohnen (WE 0-1) ·WT", we: "WE 0-1", level: 0, raumart: "wohnen", art: "aufenthalt", fensterpflicht: true, fensterwand: 0,
    points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 5 }, { x: 0, z: 5 }], flaeche_m2: 20,
    tueren: [{ wand: 2, u_m: 1, breite_m: 0.885, aufschlag: "links", nach: "Diele (WE 0-1) ·WT", typ: "zimmer" }],
  };
  const keil = [{ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 4, z: 0 }];

  it("Keil vor der Fensterwand wird zugeschlagen: Schrägwand, Fläche, Tür- und Fensterwand-Index", () => {
    const r = schraegenZuschlagen([raum], [keil]);
    const z = r.zonen[0];
    assert.equal(r.raeume, 1);
    assert.ok(Math.abs(z.flaeche_m2 - 24) < 1e-9);
    assert.ok(z.points.length > 4);
    assert.ok(Math.abs(summe(r.restJeGeschoss.get(0))) < 1e-6, "Keil ganz verbraucht");
    // The door wall (old edge 2, x4,z5 → x0,z5) keeps its points under the new index.
    const t = z.tueren[0], a = z.points[t.wand], b = z.points[(t.wand + 1) % z.points.length];
    assert.deepEqual([a, b], [{ x: 4, z: 5 }, { x: 0, z: 5 }]);
    // Window wall = the slanted segment (longest of the bulged run).
    const fa = z.points[z.fensterwand], fb = z.points[(z.fensterwand + 1) % z.points.length];
    assert.ok(Math.abs(Math.hypot(fb.x - fa.x, fb.z - fa.z) - Math.hypot(4, 2)) < 1e-9);
  });

  it("Tür auf der Kante, Nicht-Fensterraum, zu tiefer Raum: nichts passiert (dieselbe Liste)", () => {
    const mitTuer = { ...raum, tueren: [{ ...raum.tueren[0], wand: 0 }] };
    assert.equal(schraegenZuschlagen([mitTuer], [keil]).zonen[0], mitTuer);
    const bad = { ...raum, fensterpflicht: false };
    assert.equal(schraegenZuschlagen([bad], [keil]).zonen[0], bad);
    // 1,8 × 4 m facade = 7,2 m ≥ 5 m depth + 2 m wedge, so take a 3 m wide room 5 m deep: 5,4 − 5 = 0,4 m allowed.
    const schmal = { ...raum, points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 5 }, { x: 0, z: 5 }] };
    const r = schraegenZuschlagen([schmal], [[{ x: 0, z: 0 }, { x: 0, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 0 }]]);
    const tiefe = Math.max(...r.zonen[0].points.map((p) => 5 - p.z));
    assert.ok(tiefe <= 1.8 * 3 + 1e-9, "Seitenverhältnis ≤ 1 : 1,8");
  });

  it("ohne Rest: dieselbe Zonen-Liste", () => {
    const z = [raum];
    assert.equal(schraegenZuschlagen(z, []).zonen, z);
    assert.equal(SCHRAEGE.tiefeMax_m, 2.5);
  });
});

describe("86-02 — tesseliere nutzt die Schrägen", () => {
  for (const [name, fp] of [["Trapez", TRAPEZ], ["Fünfeck", FUENFECK]]) {
    for (const typ of ["mittelflur", "mfh", "spaenner"]) {
      it(`${name} ${typ}: Hinweis, Füllgrad, Rest + belegt = Footprint, alles in der Form`, () => {
        const r = tesseliere({ footprintM: fp, storeys: 2, typ, einheiten: STD, raumzonen: true });
        assert.ok(r.hinweise.some((h) => h.includes("[86-02]")));
        assert.ok(r.form.zuschlag_m2 > 0);
        assert.ok(Math.abs(summe(r.form.rest) + r.form.belegt_m2 - r.form.gesamt_m2) < 0.05);
        for (const z of r.zonen) {
          for (const p of z.points) assert.ok(punktImPolygon(fp, p.x, p.z) || randAbstand(p, fp) < 1e-4, `${z.name} innerhalb`);
          assert.ok(Math.abs(z.flaeche_m2 - flaeche(z.points)) < 1e-6 || z.raumart === "balkon" || z.points.length === 4 || !z.fensterpflicht);
          for (const t of z.tueren || []) assert.ok(t.wand >= 0 && t.wand < z.points.length);
        }
        // WE areas carry the added share.
        const jeWe = new Map();
        for (const z of r.zonen.filter((q) => q.we && q.raumart !== "balkon")) jeWe.set(`${z.level}|${z.we}`, (jeWe.get(`${z.level}|${z.we}`) || 0) + z.flaeche_m2);
        for (const w of r.weListe) {
          const ist = jeWe.get(`${w.level}|${w.we}`);
          if (ist !== undefined) assert.ok(ist <= w.flaeche_m2 + 1e-6, `${w.we}: Räume ≤ WE-Fläche`);
        }
      });
    }
  }

  it("deterministisch und Rechteck unberührt", () => {
    const a = tesseliere({ footprintM: FUENFECK, storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true });
    const b = tesseliere({ footprintM: FUENFECK, storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true });
    assert.deepEqual(a, b);
    const r = tesseliere({ footprintM: [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 16 }, { x: 0, z: 16 }], storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true });
    assert.equal(r.hinweise.some((h) => h.includes("[86-02]")), false);
  });
});
