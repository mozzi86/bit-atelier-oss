// Unit tests for plan 84-08 part 2 (packages/nova-designer/src/lib/tesselierung.js):
// the generator sizes baths for the DIN 18040-2 movement area (≥ 1,20 × 1,75 m) —
// bath first in the back row, stacked back rooms when the row is too narrow.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, raumSlicing, BAD_ZUSCHNITT, TUERBREITEN } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { badBewegung, BAD_BEWEGUNG, pruefeAlle } from "@designer/lib/raumQualitaet";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const masse = (z) => {
  const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].sort((a, b) => a - b);
};

describe("84-08 Teil 2 — Bad im Generator groß genug (DIN 18040-2)", () => {
  it("BAD_ZUSCHNITT entspricht der Prüfregel BAD_BEWEGUNG (1,20 × 1,20 + 0,55 m)", () => {
    assert.equal(BAD_ZUSCHNITT.kurz_m, BAD_BEWEGUNG.flaeche_m);
    assert.ok(Math.abs(BAD_ZUSCHNITT.lang_m - (BAD_BEWEGUNG.flaeche_m + BAD_BEWEGUNG.objektTiefe_m)) < 1e-9);
  });

  for (const [mix, E] of [["Standard", STD], ["Referenz", REF]]) {
    for (const [typ, w, d] of [["mittelflur", 40, 16], ["mittelflur", 30, 20], ["mfh", 70, 16], ["laubengang", 40, 16]]) {
      it(`${mix} ${typ} ${w} × ${d}: jedes Bad ≥ 1,20 × 1,75 m, jeder Raum hat eine Tür zur Diele`, () => {
        const r = tesseliere({ footprintM: rect(w, d), storeys: 1, typ, einheiten: E, raumzonen: true });
        const baeder = r.zonen.filter((z) => z.art === "sanitaer");
        assert.ok(baeder.length > 0);
        for (const b of baeder) {
          assert.equal(badBewegung(b).stufe, "ok", `${b.name} ${masse(b).map((v) => v.toFixed(2)).join(" × ")}`);
          assert.ok(b.tueren?.length === 1 && b.tueren[0].nachAussen === true, `${b.name}: Tür nach außen`);
        }
        const fails = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })
          .flatMap((q) => q.eintraege.filter((e) => e.stufe === "fail" && e.regel === "erschliessung").map((e) => `${q.we}:${e.text}`));
        assert.deepEqual(fails, [], "kein Raum ohne Zugang");
      });
    }
  }

  it("schmale tiefe Nebenraumzeile: Räume gestapelt — Bad am Dielenstreifen, Nebenraum mit Seitentür zur Diele", () => {
    // 1-Zi in a 3,5 m wide, 9,1 m deep band: side by side the back row would be ~0,76 m per room.
    const typ = STD.find((t) => t.key === "st-1zi");
    const zonen = raumSlicing({ rechteck: { x0: 0, x1: 3.5, z0: 0, z1: 9.1 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" }, typ.raumprogramm, { wohnungsgrundriss: true });
    const bad = zonen.find((z) => z.art === "sanitaer");
    const [kurz, lang] = masse(bad);
    assert.ok(kurz >= BAD_ZUSCHNITT.kurz_m - 1e-9 && lang >= BAD_ZUSCHNITT.lang_m - 1e-9, `Bad ${kurz} × ${lang}`);
    // Facade at z = 0 → corridor edge at z = 9,1, the back row lies there; the strip edge is its low side.
    assert.equal(bad.tueren[0].wand, 0, "Badtür in der Streifenkante");
    const neben = zonen.filter((z) => z.art !== "sanitaer" && z.art !== "flur" && z.art !== "aufenthalt" && !/^Abstellraum/.test(z.name));
    assert.ok(neben.length >= 1);
    for (const z of neben) {
      assert.equal(z.tueren[0].wand, 3, `${z.name}: Seitentür zur Diele (Kante x0)`);
      assert.ok(masse(z)[0] >= TUERBREITEN.zimmer + 0.3 - 1e-9, `${z.name}: Tür passt`);
    }
    assert.ok(zonen.warns.some((w) => /Bad \[84-08\].*entfällt/.test(w)), "Abstellnische entfällt mit Hinweis");
  });

  it("breite Nebenraumzeile bleibt nebeneinander (Bad mindestens 1,75 m breit bei flacher Zeile)", () => {
    const typ = STD.find((t) => t.key === "st-3zi");
    const zonen = raumSlicing({ rechteck: { x0: 0, x1: 9, z0: 0, z1: 7.1 }, fassadeBei: 0, achse: "x", level: 0, we: "WE 0-1" }, typ.raumprogramm, { wohnungsgrundriss: true });
    const rueck = zonen.filter((z) => ["sanitaer", "kueche"].includes(z.art));
    const zs = new Set(rueck.map((z) => Math.min(...z.points.map((p) => p.z)).toFixed(3)));
    assert.equal(zs.size, 1, "eine Zeile");
    const bad = zonen.find((z) => z.art === "sanitaer");
    assert.equal(badBewegung(bad).stufe, "ok");
  });
});
