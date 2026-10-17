// 98-09: residential bar along a path — double-loaded corridor, unit mix close to the target
// shares, corner units at joints, no overlaps, key figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { riegelLayout, flaeche, MIX_VORLAGEN } from "@core/lib/massing/riegel.js";

test("gerader Riegel 60 m: Flur in der Mitte, beidseitig Wohnungen, Fläche = Länge × 2 × Tiefe", () => {
  const r = riegelLayout([{ x: 0, y: 0 }, { x: 60, y: 0 }], { geschosse: 4 });
  assert.equal(r.flur.length, 1);
  assert.ok(Math.abs(flaeche(r.flur[0]) - 60 * 1.6) < 1e-6);
  assert.ok(Math.abs(r.kennzahlen.wohnflaecheGeschoss - 60 * 2 * 7) < 1e-6);
  assert.ok(r.einheiten.every((e) => e.typ !== "Ecke"));
  assert.equal(r.kennzahlen.wohnungen, r.einheiten.length * 4);
  // Units on one side tile the length exactly, none narrower than 3 m.
  const links = r.einheiten.filter((e) => e.seite === 1).map((e) => Math.hypot(e.profil[1].x - e.profil[0].x, e.profil[1].y - e.profil[0].y));
  assert.ok(Math.abs(links.reduce((a, b) => a + b, 0) - 60) < 1e-6);
  assert.ok(links.every((w) => w >= 3));
});

test("Mix bleibt nahe an den Zielanteilen", () => {
  const r = riegelLayout([{ x: 0, y: 0 }, { x: 300, y: 0 }], { mix: "ausgewogen", geschosse: 1 });
  const summe = Object.values(r.kennzahlen.jeTyp).reduce((a, b) => a + b, 0);
  for (const [typ, ziel] of Object.entries(MIX_VORLAGEN.ausgewogen)) {
    assert.ok(Math.abs((r.kennzahlen.jeTyp[typ] || 0) / summe - ziel) < 0.08, `${typ}: ${(r.kennzahlen.jeTyp[typ] || 0) / summe}`);
  }
});

test("L-Pfad: Eckwohnungen am Knick, keine Überlappung, einhüftig nur eine Seite", () => {
  const pfad = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }];
  const r = riegelLayout(pfad, { geschosse: 1 });
  assert.equal(r.einheiten.filter((e) => e.typ === "Ecke").length, 2);
  const e1 = riegelLayout(pfad, { art: "einhueftig", geschosse: 1 });
  assert.ok(e1.einheiten.every((e) => e.seite === 1));
  // No two units overlap: sum of unit areas equals the area of their union (sampled grid).
  const innen = (poly, p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  let doppelt = 0;
  for (let x = -10; x <= 50; x += 0.5) for (let y = -10; y <= 40; y += 0.5) if (r.einheiten.filter((e) => innen(e.profil, { x: x + 0.13, y: y + 0.17 })).length > 1) doppelt++;
  assert.equal(doppelt, 0, "überlappende Wohnungen");
  assert.throws(() => riegelLayout([{ x: 0, y: 0 }]), /mindestens 2 Punkte/);
});

test("Flur läuft ohne Lücke über den Knick", () => {
  const r = riegelLayout([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }], { geschosse: 1 });
  const innen = (poly, p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  for (const p of [{ x: 30, y: 0 }, { x: 36, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 4 }, { x: 40, y: 10 }]) {
    assert.ok(r.flur.some((f) => innen(f, { x: p.x + 0.01, y: p.y + 0.01 })), `Flur fehlt bei ${p.x}/${p.y}`);
  }
});
