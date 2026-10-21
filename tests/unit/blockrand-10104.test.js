// 101-04: closed path = perimeter block with courtyard (riegelLayout geschlossen), footprint for GRZ,
// and the extra footprint/BGF of bars in the site-plan check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { riegelLayout, flaeche } from "@core/lib/massing/riegel.js";
import { pruefen } from "@core/lib/massing/bloecke.js";

const innen = (poly, p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };

test("Blockrand 60 × 40 m: vier Ecken je Seite, keine Überlappung, Hof bleibt frei, Grundfläche × Geschosse = BGF", () => {
  const ring = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
  const r = riegelLayout(ring, { geschlossen: true, geschosse: 4 });
  assert.equal(r.einheiten.filter((e) => e.typ === "Ecke").length, 8);
  let doppelt = 0;
  for (let x = -10; x <= 70; x += 0.5) for (let y = -10; y <= 50; y += 0.5) if (r.einheiten.filter((e) => innen(e.profil, { x: x + 0.13, y: y + 0.17 })).length > 1) doppelt++;
  assert.equal(doppelt, 0, "überlappende Wohnungen");
  const hof = { x: 30, y: 20 };
  assert.ok(!r.einheiten.some((e) => innen(e.profil, hof)) && !r.flur.some((f) => innen(f, hof)), "Hof bebaut");
  // the closing edge (0,40) → (0,0) is built like every other edge
  assert.ok(r.einheiten.some((e) => innen(e.profil, { x: -3, y: 20 })) && r.einheiten.some((e) => innen(e.profil, { x: 3, y: 20 })));
  const flurFl = r.flur.reduce((s, f) => s + flaeche(f), 0);
  assert.ok(Math.abs(r.kennzahlen.grundflaeche - (r.kennzahlen.wohnflaecheGeschoss + flurFl)) < 1e-2);
  assert.ok(Math.abs(r.kennzahlen.bgf - r.kennzahlen.grundflaeche * 4) < 1e-2);
  assert.throws(() => riegelLayout(ring.slice(0, 2), { geschlossen: true }), /mindestens 3 Punkte/);
});

test("offener Pfad bleibt wie bisher (keine Ecke am Pfadende)", () => {
  const r = riegelLayout([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }], { geschosse: 1 });
  assert.equal(r.einheiten.filter((e) => e.typ === "Ecke").length, 2);
});

test("Prüfung zählt Riegel-Grundfläche und -BGF in GRZ/GFZ mit", () => {
  const grenze = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const ohne = pruefen([], { grenze });
  const mit = pruefen([], { grenze, zusatz: { grundflaeche: 2000, bgf: 8000 } });
  assert.equal(ohne.grz, 0);
  assert.equal(mit.grz, 0.2);
  assert.equal(mit.gfz, 0.8);
});
